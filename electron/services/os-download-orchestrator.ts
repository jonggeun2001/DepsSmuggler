import * as path from 'path';
import * as fse from 'fs-extra';
import { createDownloadProgressEmitter } from './download-progress';
import { runOSDownloadPool } from './os-download-pool';
import {
  buildOSDownloadStartResult,
  cleanupGeneratedOutputs,
  createOSDownloaderForDistribution,
  createOSDownloadErrorHandler,
  createOSResolverForDistribution,
  DEFAULT_OS_OUTPUT_OPTIONS,
  writeRepositoryScripts,
  type OSDownloadFailure,
  type OSGeneratedOutput,
  type OSDownloadStartOptions,
} from './os-package-router';
import { OSArchivePackager } from '../../src/core/downloaders/os-shared/archive-packager';
import { OSRepoPackager } from '../../src/core/downloaders/os-shared/repo-packager';
import { createScopedLogger } from '../utils/logger';
import type {
  OSArchitecture,
  OSDistribution,
  OSPackageInfo,
  PackageDependency,
} from '../../src/core/downloaders/os-shared/types';
import type { PackagingDetails } from '../../src/types/packaging';

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
  startDownload(
    options: OSDownloadStartOptions
  ): Promise<ReturnType<typeof buildOSDownloadStartResult>>;
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

      if (osDownloadAbortController) throw new Error('이미 OS 패키지 다운로드가 진행 중입니다.');
      progressEmitter.clearOSProgress();
      log.info(`Starting OS package download: ${packages.length} packages to ${outputDir}`);
      osDownloadCancelled = false;
      const controller = new AbortController();
      osDownloadAbortController = controller;
      let stagingDir: string | undefined;
      const cancel = () => {
        osDownloadCancelled = true;
        controller.abort();
        progressEmitter.clearOSProgress();
      };
      try {
        await fse.ensureDir(outputDir);

        let packagesToDownload = packages;
        if (resolveDependencies) {
          const resolver = createOSResolverForDistribution({
            distribution,
            architecture,
            includeOptional: includeOptionalDeps ?? false,
            includeRecommends: includeOptionalDeps ?? false,
            progressEmitter,
            abortSignal: controller.signal,
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
          return buildOSDownloadStartResult({
            outputDir,
            distribution,
            outputOptions,
            warnings,
            unresolved,
            conflicts,
          });
        }

        const downloadStagingDir = await fse.mkdtemp(path.join(outputDir, '.depssmuggler-os-'));
        stagingDir = downloadStagingDir;
        const handleError = createOSDownloadErrorHandler(
          params.getMainWindow(),
          cancel,
          controller.signal
        );
        const onError: typeof handleError = (error) => {
          // Native errors remain immediate; show the latest progress before the queued dialog.
          progressEmitter.flushOSProgress();
          return handleError(error);
        };
        const downloadedFiles = new Map<string, string>();
        const successfulPackages: OSPackageInfo[] = [];
        const failedPackages: OSDownloadFailure[] = [];
        const skippedPackages: OSPackageInfo[] = [];
        const generatedOutputs: OSGeneratedOutput[] = [];

        const results = await runOSDownloadPool({
          packages: packagesToDownload,
          concurrency,
          controller,
          cancel,
          onProgress: (progress) => progressEmitter.emitOSProgress(progress),
          createDownloader: (slot, onProgress) =>
            createOSDownloaderForDistribution({
              distribution,
              architecture,
              // Parallel duplicates cannot write/clean the same path; all slots are removed together.
              outputDir: path.join(downloadStagingDir, `slot-${slot}`),
              concurrency,
              progressEmitter: { ...progressEmitter, emitOSProgress: onProgress },
              abortSignal: controller.signal,
              onCancel: cancel,
              onError,
              mainWindow: params.getMainWindow(),
            }),
        });
        // Record in input order, independent of completion order.
        for (const [index, pkg] of packagesToDownload.entries()) {
          const result = results[index];
          if (result?.success && result.filePath) {
            successfulPackages.push(pkg);
            downloadedFiles.set(`${pkg.name}-${pkg.version}`, result.filePath);
          } else if (!result || result.skipped || result.cancelled) {
            skippedPackages.push(pkg);
          } else {
            failedPackages.push({ package: pkg, error: result.error?.message || '다운로드 실패' });
          }
        }
        if (osDownloadCancelled) {
          warnings.push(
            successfulPackages.length > 0
              ? `다운로드 취소로 임시 파일 ${successfulPackages.length}개를 정리했습니다. 최종 출력물은 생성되지 않았습니다.`
              : '다운로드가 취소되어 최종 출력물을 생성하지 않았습니다.'
          );
          successfulPackages.length = 0;
          downloadedFiles.clear();
        }

        if (!osDownloadCancelled && successfulPackages.length > 0) {
          const emitPackaging = (packagingDetails: PackagingDetails) => {
            if (controller.signal.aborted) return;
            progressEmitter.emitOSProgress({
              currentPackage: '결과 패키징',
              currentIndex: successfulPackages.length,
              totalPackages: successfulPackages.length,
              bytesDownloaded: 0,
              totalBytes: 0,
              speed: 0,
              phase: 'packaging',
              packagingDetails,
            });
          };
          emitPackaging({ message: '파일 생성 준비 중...' });

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
                onStage: (message) => emitPackaging({ message }),
                onProgress: (archiveProgress) =>
                  emitPackaging({
                    message:
                      archiveProgress.percentage >= 99
                        ? '압축 파일 저장 마무리 중...'
                        : `${(outputOptions.archiveFormat || 'zip').toUpperCase()} 압축 중...`,
                    archiveProgress,
                  }),
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
              emitPackaging({ message: '로컬 저장소 생성 중...' });
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
                  outputOptions.generateScripts && outputOptions.scriptTypes.includes('local-repo'),
              });

              if (outputOptions.generateScripts) {
                emitPackaging({ message: '저장소 설치 스크립트 생성 중...' });
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
        if (!osDownloadCancelled) progressEmitter.flushOSProgress();
        controller.abort();
        progressEmitter.clearOSProgress();
        try {
          if (stagingDir) await fse.remove(stagingDir);
        } finally {
          osDownloadCancelled = false;
          osDownloadAbortController = null;
        }
      }
    },

    async cancelDownload() {
      osDownloadCancelled = true;
      osDownloadAbortController?.abort();
      progressEmitter.clearOSProgress();
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
