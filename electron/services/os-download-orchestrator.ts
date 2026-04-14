import * as path from 'path';
import * as fse from 'fs-extra';
import { createScopedLogger } from '../utils/logger';
import { OSArchivePackager } from '../../src/core/downloaders/os-shared/archive-packager';
import { OSRepoPackager } from '../../src/core/downloaders/os-shared/repo-packager';
import type {
  OSArchitecture,
  OSDistribution,
  OSPackageInfo,
  PackageDependency,
} from '../../src/core/downloaders/os-shared/types';
import { createDownloadProgressEmitter } from './download-progress';
import {
  buildOSDownloadStartResult,
  cleanupGeneratedOutputs,
  createOSDownloaderForDistribution,
  createOSResolverForDistribution,
  DEFAULT_OS_OUTPUT_OPTIONS,
  writeRepositoryScripts,
  type OSDownloadFailure,
  type OSGeneratedOutput,
  type OSDownloadStartOptions,
} from './os-package-router';

const log = createScopedLogger('OSDownloadOrchestrator');

export interface OSDownloadOrchestrator {
  resolveDependencies(options: {
    packages: OSPackageInfo[];
    distribution: OSDistribution;
    architecture: OSArchitecture;
    includeOptional?: boolean;
    includeRecommends?: boolean;
  }): Promise<{
    packages: OSPackageInfo[];
    unresolved: PackageDependency[];
    conflicts: Array<{ package: string; versions: OSPackageInfo[] }>;
  }>;
  startDownload(options: OSDownloadStartOptions): Promise<ReturnType<typeof buildOSDownloadStartResult>>;
  cancelDownload(): Promise<{ success: true }>;
  getCacheStats(): Promise<{ size: number; count: number; path: string }>;
  clearCache(): Promise<{ success: true }>;
}

export function createOSDownloadOrchestrator(params: {
  getMainWindow: () => Electron.BrowserWindow | null;
}): OSDownloadOrchestrator {
  const progressEmitter = createDownloadProgressEmitter(params.getMainWindow);
  let osDownloadCancelled = false;
  let osDownloadAbortController: AbortController | null = null;

  return {
    async resolveDependencies(options) {
      const resolver = createOSResolverForDistribution({
        distribution: options.distribution,
        architecture: options.architecture,
        includeOptional: options.includeOptional ?? false,
        includeRecommends: options.includeRecommends ?? false,
        progressEmitter,
      });
      const result = await resolver.resolveDependencies(options.packages);
      return {
        packages: result.packages,
        unresolved: result.unresolved,
        conflicts: result.conflicts,
      };
    },

    async startDownload(options) {
      const {
        packages,
        outputDir,
        distribution,
        architecture,
        resolveDependencies,
        includeOptionalDeps,
        concurrency = 3,
        outputOptions: rawOutputOptions,
      } = options;

      const outputOptions = {
        ...DEFAULT_OS_OUTPUT_OPTIONS,
        ...rawOutputOptions,
      };
      const warnings: string[] = [];
      let unresolved: PackageDependency[] = [];
      let conflicts: Array<{ package: string; versions: OSPackageInfo[] }> = [];

      log.info(`Starting OS package download: ${packages.length} packages to ${outputDir}`);
      osDownloadCancelled = false;
      osDownloadAbortController = new AbortController();

      await fse.ensureDir(outputDir);

      let packagesToDownload = packages;
      if (resolveDependencies) {
        const resolver = createOSResolverForDistribution({
          distribution,
          architecture,
          includeOptional: includeOptionalDeps ?? false,
          includeRecommends: includeOptionalDeps ?? false,
          progressEmitter,
          abortSignal: osDownloadAbortController.signal,
        });

        try {
          const resolved = await resolver.resolveDependencies(packages);
          packagesToDownload = resolved.packages;
          warnings.push(...resolved.warnings);
          unresolved = resolved.unresolved;
          conflicts = resolved.conflicts;
        } catch (error) {
          if ((error as { name?: string })?.name === 'AbortError' || osDownloadCancelled) {
            warnings.push('의존성 해결 단계에서 취소되어 다운로드를 시작하지 않았습니다.');
            osDownloadAbortController = null;
            return buildOSDownloadStartResult({
              outputDir,
              distribution,
              outputOptions,
              warnings,
              cancelled: true,
            });
          }
          throw error;
        }

        if (osDownloadCancelled) {
          warnings.push('의존성 해결 단계에서 취소되어 다운로드를 시작하지 않았습니다.');
          osDownloadAbortController = null;
          return buildOSDownloadStartResult({
            outputDir,
            distribution,
            outputOptions,
            warnings,
            cancelled: true,
          });
        }

        if (conflicts.length > 0) {
          progressEmitter.emitOSProgress({
            currentPackage: `버전 충돌 ${conflicts.length}건 감지`,
            currentIndex: 0,
            totalPackages: packagesToDownload.length,
            bytesDownloaded: 0,
            totalBytes: 0,
            speed: 0,
            phase: 'resolving',
          });
        }
      }

      if (unresolved.length > 0) {
        progressEmitter.emitOSProgress({
          currentPackage: `해결되지 않은 의존성 ${unresolved.length}건`,
          currentIndex: 0,
          totalPackages: packagesToDownload.length,
          bytesDownloaded: 0,
          totalBytes: 0,
          speed: 0,
          phase: 'resolving',
        });
        osDownloadAbortController = null;
        return buildOSDownloadStartResult({
          outputDir,
          distribution,
          outputOptions,
          warnings,
          unresolved,
          conflicts,
        });
      }

      const stagingDir = await fse.mkdtemp(path.join(outputDir, '.depssmuggler-os-'));
      const downloader = createOSDownloaderForDistribution({
        distribution,
        architecture,
        outputDir: stagingDir,
        concurrency,
        progressEmitter,
        abortSignal: osDownloadAbortController.signal,
        onCancel: () => {
          osDownloadCancelled = true;
        },
        mainWindow: params.getMainWindow(),
      });
      const downloadedFiles = new Map<string, string>();
      const successfulPackages: OSPackageInfo[] = [];
      const failedPackages: OSDownloadFailure[] = [];
      const skippedPackages: OSPackageInfo[] = [];
      const generatedOutputs: OSGeneratedOutput[] = [];

      try {
        for (const [index, pkg] of packagesToDownload.entries()) {
          if (osDownloadCancelled) {
            markRemainingPackagesAsSkipped({
              packagesToDownload,
              startIndex: index,
              skippedPackages,
              successfulPackages,
              downloadedFiles,
              warnings,
            });
            break;
          }

          progressEmitter.emitOSProgress({
            currentPackage: pkg.name,
            currentIndex: index + 1,
            totalPackages: packagesToDownload.length,
            bytesDownloaded: 0,
            totalBytes: pkg.size,
            speed: 0,
            phase: 'downloading',
          });

          const result = await downloader.downloadPackage(pkg);
          if (result.cancelled || osDownloadCancelled) {
            markRemainingPackagesAsSkipped({
              packagesToDownload,
              startIndex: index,
              skippedPackages,
              successfulPackages,
              downloadedFiles,
              warnings,
            });
            break;
          }

          if (result.success && result.filePath) {
            successfulPackages.push(pkg);
            downloadedFiles.set(`${pkg.name}-${pkg.version}`, result.filePath);
            continue;
          }

          if (result.skipped) {
            skippedPackages.push(pkg);
            continue;
          }

          failedPackages.push({
            package: pkg,
            error: result.error?.message || '다운로드 실패',
          });
        }

        if (!osDownloadCancelled && successfulPackages.length > 0) {
          progressEmitter.emitOSProgress({
            currentPackage: '결과 패키징',
            currentIndex: successfulPackages.length,
            totalPackages: successfulPackages.length,
            bytesDownloaded: successfulPackages.length,
            totalBytes: successfulPackages.length,
            speed: 0,
            phase: 'packaging',
          });

          try {
            if (outputOptions.type === 'archive' || outputOptions.type === 'both') {
              const archivePackager = new OSArchivePackager();
              const archiveOutput = {
                type: 'archive' as const,
                path: `${path.join(outputDir, 'os-packages')}.${
                  outputOptions.archiveFormat === 'tar.gz' ? 'tar.gz' : 'zip'
                }`,
                label: `압축 파일 (${outputOptions.archiveFormat || 'zip'})`,
              };
              generatedOutputs.push(archiveOutput);
              await archivePackager.createArchive(successfulPackages, downloadedFiles, {
                format: outputOptions.archiveFormat || 'zip',
                outputPath: path.join(outputDir, 'os-packages'),
                includeScripts: outputOptions.generateScripts,
                scriptTypes: outputOptions.scriptTypes,
                packageManager: distribution.packageManager,
                repoName: 'depssmuggler-local',
              });

              if (osDownloadCancelled) {
                await cleanupGeneratedOutputs(generatedOutputs);
                generatedOutputs.length = 0;
                successfulPackages.length = 0;
                warnings.push('패키징 단계에서 취소되어 생성 중이던 출력물을 정리했습니다.');
              }
            }

            if (
              !osDownloadCancelled &&
              (outputOptions.type === 'repository' || outputOptions.type === 'both')
            ) {
              const repoPath = path.join(outputDir, 'repository');
              const repoPackager = new OSRepoPackager();
              generatedOutputs.push({
                type: 'repository',
                path: repoPath,
                label: '로컬 저장소',
              });
              await repoPackager.createLocalRepo(successfulPackages, downloadedFiles, {
                packageManager: distribution.packageManager,
                outputPath: repoPath,
                repoName: 'depssmuggler-local',
                includeSetupScript:
                  outputOptions.generateScripts &&
                  outputOptions.scriptTypes.includes('local-repo'),
              });

              if (outputOptions.generateScripts) {
                await writeRepositoryScripts(
                  repoPath,
                  successfulPackages,
                  distribution.packageManager,
                  outputOptions.scriptTypes
                );
              }

              if (osDownloadCancelled) {
                await cleanupGeneratedOutputs(generatedOutputs);
                generatedOutputs.length = 0;
                successfulPackages.length = 0;
                warnings.push('패키징 단계에서 취소되어 생성 중이던 출력물을 정리했습니다.');
              }
            }
          } catch (error) {
            if (generatedOutputs.length > 0) {
              await cleanupGeneratedOutputs(generatedOutputs);
              generatedOutputs.length = 0;
            }
            throw error;
          }
        }

        if (osDownloadCancelled && generatedOutputs.length > 0) {
          await cleanupGeneratedOutputs(generatedOutputs);
          generatedOutputs.length = 0;
          successfulPackages.length = 0;
          warnings.push('패키징 단계에서 취소되어 생성된 출력물을 정리했습니다.');
        }

        return buildOSDownloadStartResult({
          success: successfulPackages,
          failed: failedPackages,
          skipped: skippedPackages,
          outputDir,
          distribution,
          outputOptions,
          generatedOutputs,
          warnings,
          unresolved,
          conflicts,
          cancelled: osDownloadCancelled,
        });
      } finally {
        osDownloadCancelled = false;
        osDownloadAbortController = null;
        await fse.remove(stagingDir);
      }
    },

    async cancelDownload() {
      osDownloadCancelled = true;
      osDownloadAbortController?.abort();
      return { success: true };
    },

    async getCacheStats() {
      return {
        size: 0,
        count: 0,
        path: '',
      };
    },

    async clearCache() {
      return { success: true };
    },
  };
}

function markRemainingPackagesAsSkipped(params: {
  packagesToDownload: OSPackageInfo[];
  startIndex: number;
  skippedPackages: OSPackageInfo[];
  successfulPackages: OSPackageInfo[];
  downloadedFiles: Map<string, string>;
  warnings: string[];
}): void {
  const {
    packagesToDownload,
    startIndex,
    skippedPackages,
    successfulPackages,
    downloadedFiles,
    warnings,
  } = params;

  if (successfulPackages.length > 0) {
    warnings.push(
      `다운로드 취소로 임시 파일 ${successfulPackages.length}개를 정리했습니다. 최종 출력물은 생성되지 않았습니다.`
    );
  } else {
    warnings.push('다운로드가 취소되어 최종 출력물을 생성하지 않았습니다.');
  }

  skippedPackages.push(...packagesToDownload.slice(startIndex));
  successfulPackages.length = 0;
  downloadedFiles.clear();
}
