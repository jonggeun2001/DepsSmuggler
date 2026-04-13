/**
 * 다운로드 관련 IPC 핸들러
 */

import { BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import * as fse from 'fs-extra';
import pLimit from 'p-limit';
import { createScopedLogger } from './utils/logger';
import {
  DownloadPackage,
  DownloadOptions as SharedDownloadOptions,
  getPyPIDownloadUrl,
  downloadFile,
  generateInstallScripts,
  Architecture,
} from '../src/core/shared';
import {
  getCondaDownloader,
  getMavenDownloader,
  getDockerDownloader,
  getNpmDownloader,
  getYumDownloader,
  getAptDownloader,
  getApkDownloader,
  getYumResolver,
  getAptResolver,
  getApkResolver,
} from '../src/core';
import { OSArchivePackager } from '../src/core/downloaders/os-shared/archive-packager';
import { OSRepoPackager } from '../src/core/downloaders/os-shared/repo-packager';
import { OSScriptGenerator } from '../src/core/downloaders/os-shared/script-generator';
import { getArchivePackager } from '../src/core/packager/archive-packager';
import type { PackageInfo } from '../src/types';
import type {
  OSPackageInfo,
  OSDistribution,
  OSArchitecture,
  OSDownloadProgress,
  OSErrorAction,
  OSPackageOutputOptions,
  PackageDependency,
} from '../src/core/downloaders/os-shared/types';
import { dialog } from 'electron';

const log = createScopedLogger('Download');

// 타입 별칭 (공통 모듈에서 가져온 타입 사용)
type DownloadOptions = SharedDownloadOptions;

// 진행 상황 스로틀링을 위한 마지막 전송 시간 추적
const lastProgressTime = new Map<string, number>();
const PROGRESS_THROTTLE_MS = 1000; // 1초 간격으로 스로틀링

/**
 * 진행 상황 전송 (스로틀링 적용)
 * @param mainWindow BrowserWindow 인스턴스
 * @param packageId 패키지 ID
 * @param data 진행 상황 데이터
 * @param force 스로틀링 무시하고 강제 전송 (완료/에러 상태)
 */
function sendProgressThrottled(
  mainWindow: BrowserWindow | null,
  packageId: string,
  data: {
    status: string;
    progress: number;
    downloadedBytes: number;
    totalBytes: number;
    speed?: number;
  },
  force = false
): void {
  const now = Date.now();
  const lastTime = lastProgressTime.get(packageId) || 0;

  // 강제 전송이거나 스로틀 간격이 지났으면 전송
  if (force || now - lastTime >= PROGRESS_THROTTLE_MS) {
    lastProgressTime.set(packageId, now);
    mainWindow?.webContents.send('download:progress', {
      packageId,
      ...data,
    });
  }
}

// 다운로드 상태
let downloadCancelled = false;
let downloadPaused = false;
let downloadAbortController: AbortController | null = null;
let osDownloadCancelled = false;
let osDownloadAbortController: AbortController | null = null;

// mainWindow 참조를 저장할 변수
let getMainWindow: () => BrowserWindow | null = () => null;

interface OSDownloadStartOptions {
  packages: OSPackageInfo[];
  outputDir: string;
  distribution: OSDistribution;
  architecture: OSArchitecture;
  resolveDependencies?: boolean;
  includeOptionalDeps?: boolean;
  verifyGPG?: boolean;
  concurrency?: number;
  outputOptions?: OSPackageOutputOptions;
}

interface OSGeneratedOutput {
  type: 'archive' | 'repository';
  path: string;
  label: string;
}

interface OSDownloadFailure {
  package: OSPackageInfo;
  error: string;
}

interface OSDownloadStartResult {
  success: OSPackageInfo[];
  failed: OSDownloadFailure[];
  skipped: OSPackageInfo[];
  outputPath: string;
  packageManager: OSDistribution['packageManager'];
  outputOptions: OSPackageOutputOptions;
  generatedOutputs: OSGeneratedOutput[];
  warnings: string[];
  unresolved: PackageDependency[];
  conflicts: Array<{
    package: string;
    versions: OSPackageInfo[];
  }>;
  cancelled: boolean;
}

const DEFAULT_OS_OUTPUT_OPTIONS: OSPackageOutputOptions = {
  type: 'archive',
  archiveFormat: 'zip',
  generateScripts: true,
  scriptTypes: ['dependency-order'],
};

function emitOSProgress(
  mainWindow: BrowserWindow | null,
  progress: OSDownloadProgress
): void {
  mainWindow?.webContents.send('os:download:progress', progress);
}

function createOSDownloadErrorHandler(
  mainWindow: BrowserWindow | null
): (error: { package?: OSPackageInfo; message: string }) => Promise<OSErrorAction> {
  return async (error) => {
    const pkgName = error.package?.name || '알 수 없는 패키지';
    const result = await dialog.showMessageBox(mainWindow!, {
      type: 'error',
      title: '다운로드 오류',
      message: `패키지 다운로드 중 오류가 발생했습니다.\n\n${pkgName}: ${error.message}`,
      buttons: ['재시도', '건너뛰기', '취소'],
      defaultId: 0,
      cancelId: 2,
    });

    switch (result.response) {
      case 0:
        return 'retry';
      case 1:
        return 'skip';
      default:
        osDownloadCancelled = true;
        return 'skip';
    }
  };
}

function getOSResolverForDistribution(
  distribution: OSDistribution,
  architecture: OSArchitecture,
  includeOptionalDeps: boolean,
  mainWindow: BrowserWindow | null,
  abortSignal?: AbortSignal
) {
  const onProgress = (message: string, current: number, total: number) => {
    emitOSProgress(mainWindow, {
      currentPackage: message,
      currentIndex: current,
      totalPackages: total,
      bytesDownloaded: 0,
      totalBytes: 0,
      speed: 0,
      phase: 'resolving',
    });
    mainWindow?.webContents.send('os:resolveDependencies:progress', {
      message,
      current,
      total,
    });
  };

  switch (distribution.packageManager) {
    case 'yum':
      return getYumResolver({
        repositories: distribution.defaultRepos,
        architecture,
        includeOptional: includeOptionalDeps,
        includeRecommends: includeOptionalDeps,
        distribution,
        onProgress,
        abortSignal,
      });
    case 'apt':
      return getAptResolver({
        repositories: distribution.defaultRepos,
        architecture,
        includeOptional: includeOptionalDeps,
        includeRecommends: includeOptionalDeps,
        distribution,
        onProgress,
        abortSignal,
      });
    case 'apk':
      return getApkResolver({
        repositories: distribution.defaultRepos,
        architecture,
        includeOptional: includeOptionalDeps,
        includeRecommends: includeOptionalDeps,
        distribution,
        onProgress,
        abortSignal,
      });
    default:
      throw new Error(`Unsupported package manager: ${distribution.packageManager}`);
  }
}

function getOSDownloaderForDistribution(
  distribution: OSDistribution,
  architecture: OSArchitecture,
  outputDir: string,
  concurrency: number,
  mainWindow: BrowserWindow | null,
  abortSignal?: AbortSignal
) {
  const onError = createOSDownloadErrorHandler(mainWindow);
  const onProgress = (progress: OSDownloadProgress) => {
    emitOSProgress(mainWindow, progress);
  };

  const downloaderOptions = {
    distribution,
    architecture,
    repositories: distribution.defaultRepos,
    outputDir,
    concurrency,
    abortSignal,
    onProgress,
    onError,
  };

  switch (distribution.packageManager) {
    case 'yum':
      return getYumDownloader(downloaderOptions);
    case 'apt':
      return getAptDownloader(downloaderOptions);
    case 'apk':
      return getApkDownloader(downloaderOptions);
    default:
      throw new Error(`Unsupported package manager: ${distribution.packageManager}`);
  }
}

function buildOSDownloadStartResult(
  params: {
    success?: OSPackageInfo[];
    failed?: OSDownloadFailure[];
    skipped?: OSPackageInfo[];
    outputDir: string;
    distribution: OSDistribution;
    outputOptions: OSPackageOutputOptions;
    generatedOutputs?: OSGeneratedOutput[];
    warnings?: string[];
    unresolved?: PackageDependency[];
    conflicts?: Array<{
      package: string;
      versions: OSPackageInfo[];
    }>;
    cancelled?: boolean;
  }
): OSDownloadStartResult {
  return {
    success: params.success ?? [],
    failed: params.failed ?? [],
    skipped: params.skipped ?? [],
    outputPath: params.outputDir,
    packageManager: params.distribution.packageManager,
    outputOptions: params.outputOptions,
    generatedOutputs: params.generatedOutputs ?? [],
    warnings: params.warnings ?? [],
    unresolved: params.unresolved ?? [],
    conflicts: params.conflicts ?? [],
    cancelled: params.cancelled ?? false,
  };
}

async function writeRepositoryScripts(
  outputDir: string,
  packages: OSPackageInfo[],
  packageManager: OSDistribution['packageManager'],
  scriptTypes: OSPackageOutputOptions['scriptTypes']
): Promise<void> {
  const scriptGenerator = new OSScriptGenerator();

  if (scriptTypes.includes('dependency-order')) {
    const scripts = scriptGenerator.generateDependencyOrderScript(
      packages,
      packageManager,
      { packageDir: packageManager === 'yum' ? './Packages' : '.' }
    );
    await fse.writeFile(path.join(outputDir, 'install.sh'), scripts.bash);
    await fse.writeFile(path.join(outputDir, 'install.ps1'), scripts.powershell);
  }
}

async function cleanupGeneratedOutputs(outputs: OSGeneratedOutput[]): Promise<void> {
  await Promise.all(outputs.map((output) => fse.remove(output.path)));
}

/**
 * 다운로드 관련 IPC 핸들러 등록
 * @param windowGetter mainWindow를 반환하는 함수
 */
export function registerDownloadHandlers(windowGetter: () => BrowserWindow | null): void {
  getMainWindow = windowGetter;

  // 다운로드 시작 핸들러 (동시 다운로드 지원)
  ipcMain.handle('download:start', async (event, data: { packages: DownloadPackage[]; options: DownloadOptions }) => {
    const handlerStartTime = Date.now();
    log.info(`[TIMING] download:start handler entered`);

    const { packages, options } = data;
    const { outputDir, outputFormat, includeScripts, targetOS, architecture, pythonVersion, concurrency = 3 } = options;

    log.info(`Starting download: ${packages.length} packages to ${outputDir} (concurrency: ${concurrency})`);

    downloadCancelled = false;
    downloadPaused = false;
    downloadAbortController = new AbortController();

    // 의존성 해결은 dependency:resolve IPC에서 미리 수행됨
    // download:start에서는 전달받은 패키지 목록을 그대로 다운로드
    const allPackages: DownloadPackage[] = packages;

    const mainWindow = getMainWindow();

    // 다운로드 시작 상태 전송
    mainWindow?.webContents.send('download:status', {
      phase: 'downloading',
      message: '다운로드 중...',
    });

    // 즉시 반환하고, 다운로드 준비와 실행은 다음 이벤트 루프에서 시작 (UI 블로킹 방지)
    setImmediate(async () => {
      // 출력 디렉토리 생성 (비동기)
      const packagesDir = path.join(outputDir, 'packages');
      await fse.ensureDir(packagesDir);

      // p-limit을 사용한 동시 다운로드 제어
      const limit = pLimit(concurrency);

      // 단일 패키지 다운로드 함수
      const downloadPackage = async (pkg: DownloadPackage): Promise<{ id: string; success: boolean; error?: string }> => {
        // 이벤트 루프에 양보하여 UI 블로킹 방지
        await new Promise(resolve => setImmediate(resolve));

        log.debug(`[PKG:${pkg.name}] Starting - cancelled=${downloadCancelled}, paused=${downloadPaused}`);

        // 취소 체크
        if (downloadCancelled) {
          log.info(`[PKG:${pkg.name}] Skipped - download was cancelled`);
          return { id: pkg.id, success: false, error: 'cancelled' };
        }

        // 일시정지 대기
        if (downloadPaused) {
          log.info(`[PKG:${pkg.name}] Waiting - download is paused`);
        }
        while (downloadPaused && !downloadCancelled) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (downloadCancelled) {
          log.info(`[PKG:${pkg.name}] Skipped after pause - download was cancelled`);
          return { id: pkg.id, success: false, error: 'cancelled' };
        }

        try {
          // 진행 상태 전송: 시작 (강제 전송)
          sendProgressThrottled(mainWindow, pkg.id, {
            status: 'downloading',
            progress: 0,
            downloadedBytes: 0,
            totalBytes: 0,
            speed: 0,
          }, true);

          let downloadUrl: { url: string; filename: string } | null = null;

          // 패키지 타입에 따라 다운로드 URL 가져오기
          if (pkg.type === 'pip') {
            downloadUrl = await getPyPIDownloadUrl(
              pkg.name,
              pkg.version,
              architecture || pkg.architecture,
              targetOS,
              pythonVersion,
              pkg.indexUrl  // indexUrl 전달 추가
            );
          } else if (pkg.type === 'conda') {
            // Conda 패키지: CondaDownloader를 통해 직접 다운로드
            const condaDownloader = getCondaDownloader();
            const channel = (pkg.metadata?.repository as string)?.split('/')[0] || 'conda-forge';

            // 디버그: 전달받은 pkg 확인
            log.info(`[DEBUG] conda pkg: ${pkg.name}@${pkg.version}, downloadUrl=${pkg.downloadUrl}, metadata.downloadUrl=${pkg.metadata?.downloadUrl}, metadata=${JSON.stringify(pkg.metadata)}`);

            // 1. 이미 downloadUrl이 있으면 사용
            let condaDownloadUrl = pkg.downloadUrl || (pkg.metadata?.downloadUrl as string | undefined);

            // 2. 없으면 메타데이터 조회
            if (!condaDownloadUrl) {
              // subdir 정보 활용 (resolver에서 저장됨)
              const subdir = pkg.metadata?.subdir as string | undefined;
              const filename = pkg.metadata?.filename as string | undefined;

              if (subdir && filename) {
                // subdir, filename이 있으면 URL 직접 생성
                condaDownloadUrl = `https://conda.anaconda.org/${channel}/${subdir}/${filename}`;
              } else {
                // 없으면 메타데이터 다시 조회 (이벤트 루프 양보 후)
                await new Promise(resolve => setImmediate(resolve));
                const arch = (pkg.architecture || architecture || 'x86_64') as Architecture;
                const metadata = await condaDownloader.getPackageMetadata(pkg.name, pkg.version, channel, arch);
                condaDownloadUrl = metadata.metadata?.downloadUrl as string | undefined;
              }
            }

            if (condaDownloadUrl) {
              const filename = path.basename(new URL(condaDownloadUrl).pathname);
              downloadUrl = { url: condaDownloadUrl, filename };
            }
          } else if (pkg.type === 'npm') {
            // npm 패키지: npm downloader를 통해 메타데이터 조회
            const npmDownloader = getNpmDownloader();
            const metadata = await npmDownloader.getPackageMetadata(pkg.name, pkg.version);
            const tarballUrl = metadata.metadata?.downloadUrl;
            if (tarballUrl) {
              const filename = path.basename(new URL(tarballUrl).pathname);
              downloadUrl = { url: tarballUrl, filename };
            }
          } else if (pkg.type === 'maven') {
            // Maven 패키지: MavenDownloader 사용 (jar + pom + sha1 파일 다운로드)
            const mavenDownloader = getMavenDownloader();
            const parts = pkg.name.split(':');
            if (parts.length >= 2) {
              const groupId = parts[0];
              const artifactId = parts[1];
              // 사용자가 선택한 classifier (WizardPage에서 전달)
              const classifier = (pkg as { classifier?: string }).classifier;
              let mavenTotalBytes = 0;

              // .m2 구조로 m2repo 디렉토리에 다운로드
              const m2RepoDir = path.join(packagesDir, 'm2repo');
              await fse.ensureDir(m2RepoDir);

              const jarPath = await mavenDownloader.downloadPackage(
                {
                  type: 'maven',
                  name: pkg.name,
                  version: pkg.version,
                  metadata: {
                    groupId,
                    artifactId,
                    classifier, // 사용자 선택 classifier 전달
                  },
                },
                m2RepoDir,
                (progress) => {
                  mavenTotalBytes = progress.totalBytes;
                  sendProgressThrottled(mainWindow, pkg.id, {
                    status: 'downloading',
                    progress: progress.progress,
                    downloadedBytes: progress.downloadedBytes,
                    totalBytes: progress.totalBytes,
                    speed: progress.speed,
                  });
                },
                {
                  targetOS,
                  targetArchitecture: architecture,
                }
              );

              // flat 구조로도 복사 (packagesDir 루트에 jar 파일)
              // classifier가 있으면 파일명에 포함 (예: lwjgl-3.3.1-natives-linux.jar)
              const flatFileName = classifier
                ? `${artifactId}-${pkg.version}-${classifier}.jar`
                : `${artifactId}-${pkg.version}.jar`;
              const flatDestPath = path.join(packagesDir, flatFileName);
              if (jarPath && (await fse.pathExists(jarPath))) {
                await fse.copy(jarPath, flatDestPath);
              }

              // 완료 상태 전송 (강제 전송)
              sendProgressThrottled(mainWindow, pkg.id, {
                status: 'completed',
                progress: 100,
                downloadedBytes: mavenTotalBytes,
                totalBytes: mavenTotalBytes,
              }, true);

              return { id: pkg.id, success: true };
            }
          } else if (pkg.type === 'yum' || pkg.type === 'apt' || pkg.type === 'apk') {
            // OS 패키지는 장바구니에 담긴 URL 정보 사용
            const pkgWithUrl = pkg as {
              downloadUrl?: string;
              repository?: { baseUrl: string; name?: string };
              location?: string;
              architecture?: string;
            };
            if (pkgWithUrl.downloadUrl) {
              const ext = pkg.type === 'yum' ? 'rpm' : pkg.type === 'apt' ? 'deb' : 'apk';
              const filename = `${pkg.name}-${pkg.version}.${ext}`;
              downloadUrl = { url: pkgWithUrl.downloadUrl, filename };
            } else if (pkgWithUrl.repository?.baseUrl && pkgWithUrl.location) {
              // 저장소 기본 URL과 위치로 URL 생성
              // $basearch 변수를 실제 아키텍처로 치환
              const arch = pkgWithUrl.architecture || pkg.architecture || 'x86_64';
              const baseUrl = pkgWithUrl.repository.baseUrl.replace(/\$basearch/g, arch);
              const url = `${baseUrl}${pkgWithUrl.location}`;
              const filename = path.basename(pkgWithUrl.location);
              downloadUrl = { url, filename };
            }
          } else if (pkg.type === 'docker') {
            // Docker 이미지는 별도 처리 (레이어별 다운로드 + tar 생성)
            const dockerDownloader = getDockerDownloader();
            const registry = (pkg.metadata?.registry as string) || 'docker.io';
            const arch = (pkg.architecture || 'amd64') as Architecture;

            let dockerTotalBytes = 0;
            await dockerDownloader.downloadImage(
              pkg.name,
              pkg.version,
              arch,
              packagesDir,
              (progress) => {
                dockerTotalBytes = progress.totalBytes;
                sendProgressThrottled(mainWindow, pkg.id, {
                  status: 'downloading',
                  progress: progress.progress,
                  downloadedBytes: progress.downloadedBytes,
                  totalBytes: progress.totalBytes,
                  speed: progress.speed,
                });
              },
              registry
            );

            // 완료 상태 전송 (강제 전송)
            sendProgressThrottled(mainWindow, pkg.id, {
              status: 'completed',
              progress: 100,
              downloadedBytes: dockerTotalBytes,
              totalBytes: dockerTotalBytes,
            }, true);

            return { id: pkg.id, success: true };
          }

          if (!downloadUrl) {
            throw new Error(`다운로드 URL을 찾을 수 없습니다: ${pkg.name}@${pkg.version}`);
          }

          const destPath = path.join(packagesDir, downloadUrl.filename);
          let lastSpeedUpdate = Date.now();
          let lastBytes = 0;
          let finalTotalBytes = 0;
          let currentSpeed = 0;

          await downloadFile(downloadUrl.url, destPath, (downloaded, total) => {
            const now = Date.now();
            const elapsed = (now - lastSpeedUpdate) / 1000;
            finalTotalBytes = total;

            // 속도 계산 (0.3초마다)
            if (elapsed >= 0.3) {
              currentSpeed = (downloaded - lastBytes) / elapsed;
              lastSpeedUpdate = now;
              lastBytes = downloaded;
            }

            const progress = total > 0 ? Math.round((downloaded / total) * 100) : 0;

            // 일시정지 상태일 때 UI 업데이트 (강제 전송)
            if (downloadPaused) {
              sendProgressThrottled(mainWindow, pkg.id, {
                status: 'paused',
                progress,
                downloadedBytes: downloaded,
                totalBytes: total,
                speed: 0,
              }, true);
              return; // 일시정지 시 일반 업데이트 스킵
            }

            // 스로틀링 적용된 진행 상황 전송
            sendProgressThrottled(mainWindow, pkg.id, {
              status: 'downloading',
              progress,
              downloadedBytes: downloaded,
              totalBytes: total,
              speed: currentSpeed,
            });
          }, {
            signal: downloadAbortController?.signal,
            shouldPause: () => downloadPaused,  // 일시정지 콜백 전달
          });

          // 완료 상태 전송 (강제 전송)
          sendProgressThrottled(mainWindow, pkg.id, {
            status: 'completed',
            progress: 100,
            downloadedBytes: finalTotalBytes,
            totalBytes: finalTotalBytes,
          }, true);

          // 완료된 패키지의 스로틀 상태 정리
          lastProgressTime.delete(pkg.id);

          return { id: pkg.id, success: true };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          log.error(`Download failed for ${pkg.name}:`, errorMessage);

          // 실패 상태 전송 (강제 전송)
          mainWindow?.webContents.send('download:progress', {
            packageId: pkg.id,
            status: 'failed',
            progress: 0,
            downloadedBytes: 0,
            totalBytes: 0,
            error: errorMessage,
          });

          // 실패한 패키지의 스로틀 상태 정리
          lastProgressTime.delete(pkg.id);

          return { id: pkg.id, success: false, error: errorMessage };
        }
      };

      // 동시 다운로드 실행
      const downloadPromises = allPackages.map((pkg) => limit(() => downloadPackage(pkg)));

      // 백그라운드에서 다운로드 진행
      Promise.all(downloadPromises).then(async (downloadResults) => {
        // 취소된 항목 제외하고 결과 수집
        const results = downloadResults.filter(r => r.error !== 'cancelled');

        if (!downloadCancelled) {
          let finalOutputPath = outputDir;
          const isSupportedOutputFormat = outputFormat === 'zip' || outputFormat === 'tar.gz';

          // 설치 스크립트 생성 (의존성 포함)
          if (includeScripts) {
            generateInstallScripts(outputDir, allPackages);
          }

          if (!isSupportedOutputFormat) {
            mainWindow?.webContents.send('download:all-complete', {
              success: false,
              outputPath: outputDir,
              error: `지원하지 않는 출력 형식입니다: ${String(outputFormat)}`,
            });
            return;
          }

          if (isSupportedOutputFormat) {
            try {
              const archivePath = `${outputDir}.${outputFormat === 'zip' ? 'zip' : 'tar.gz'}`;
              const archivePackager = getArchivePackager();
              const packageInfos: PackageInfo[] = allPackages.map((pkg) => ({
                type: pkg.type as PackageInfo['type'],
                name: pkg.name,
                version: pkg.version,
                arch: pkg.architecture as PackageInfo['arch'],
                metadata: pkg.metadata,
              }));

              mainWindow?.webContents.send('download:status', {
                phase: 'packaging',
                message: `${outputFormat.toUpperCase()} 패키징 중...`,
              });

              finalOutputPath = await archivePackager.createArchiveFromDirectory(
                outputDir,
                archivePath,
                packageInfos,
                {
                  format: outputFormat,
                  includeManifest: true,
                  includeReadme: true,
                }
              );

              log.info(`Created ${outputFormat} archive: ${finalOutputPath}`);
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              log.error(`Failed to create ${outputFormat} archive:`, error);
              mainWindow?.webContents.send('download:all-complete', {
                success: false,
                outputPath: outputDir,
                error: errorMessage,
              });
              return;
            }
          }

          // 전체 완료 이벤트 전송
          mainWindow?.webContents.send('download:all-complete', {
            success: true,
            outputPath: finalOutputPath,
            results,
          });
        } else {
          // 취소됨
          mainWindow?.webContents.send('download:all-complete', {
            success: false,
            cancelled: true,
            outputPath: outputDir,
          });
        }
      }).catch((error) => {
        log.error('Download failed:', error);
        mainWindow?.webContents.send('download:all-complete', {
          success: false,
          outputPath: outputDir,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });

    // 즉시 반환하여 UI 블로킹 방지
    log.info(`[TIMING] download:start returning after ${Date.now() - handlerStartTime}ms`);
    return { success: true, started: true };
  });

  // 다운로드 일시정지 (HTTP 스트림도 pause() 호출)
  ipcMain.handle('download:pause', async () => {
    log.info(`[PAUSE] Called - current state: paused=${downloadPaused}, cancelled=${downloadCancelled}`);
    downloadPaused = true;
    log.info('[PAUSE] Set downloadPaused=true - HTTP streams will pause on next data chunk');
    return { success: true };
  });

  // 다운로드 재개
  ipcMain.handle('download:resume', async () => {
    log.info(`[RESUME] Called - current state: paused=${downloadPaused}, cancelled=${downloadCancelled}`);
    downloadPaused = false;
    log.info('[RESUME] Set downloadPaused=false');
    return { success: true };
  });

  // 다운로드 취소
  ipcMain.handle('download:cancel', async () => {
    log.info(`[CANCEL] Called - current state: paused=${downloadPaused}, cancelled=${downloadCancelled}, hasController=${!!downloadAbortController}`);
    downloadCancelled = true;
    // 진행 중인 모든 다운로드 즉시 중단
    if (downloadAbortController) {
      downloadAbortController.abort();
      log.info('[CANCEL] AbortController.abort() called');
    } else {
      log.warn('[CANCEL] No AbortController available!');
    }
    // 스로틀 상태 정리
    lastProgressTime.clear();
    return { success: true };
  });

  // 출력 폴더 검사 (비동기)
  ipcMain.handle('download:check-path', async (_, outputDir: string) => {
    log.debug(`Checking output path: ${outputDir}`);

    try {
      if (!outputDir) {
        return { exists: false, files: [], fileCount: 0, totalSize: 0 };
      }

      // 폴더 존재 여부 확인
      const exists = await fse.pathExists(outputDir);
      if (!exists) {
        return { exists: false, files: [], fileCount: 0, totalSize: 0 };
      }

      // 폴더 내용 검사 (비동기)
      const files: string[] = [];
      let totalSize = 0;

      const scanDir = async (dir: string): Promise<void> => {
        const entries = await fse.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await scanDir(fullPath);
          } else {
            files.push(path.relative(outputDir, fullPath));
            const stat = await fse.stat(fullPath);
            totalSize += stat.size;
          }
        }
      };

      await scanDir(outputDir);

      return {
        exists: true,
        files,
        fileCount: files.length,
        totalSize,
      };
    } catch (error) {
      log.error('Failed to check output path:', error);
      return { exists: false, files: [], fileCount: 0, totalSize: 0 };
    }
  });

  // 출력 폴더 삭제 (비동기)
  ipcMain.handle('download:clear-path', async (_, outputDir: string) => {
    const startTime = Date.now();
    log.info(`[TIMING] Clearing output path started: ${outputDir}`);

    try {
      if (!outputDir) {
        return { success: false, deleted: false };
      }

      // 폴더가 없으면 성공으로 처리
      const exists = await fse.pathExists(outputDir);
      if (!exists) {
        log.info(`[TIMING] Path does not exist, took ${Date.now() - startTime}ms`);
        return { success: true, deleted: false };
      }

      // 폴더 내용 삭제 (폴더 자체는 유지) - 비동기 방식
      log.info(`[TIMING] Starting fse.emptyDir...`);
      await fse.emptyDir(outputDir);
      log.info(`[TIMING] Output path cleared successfully, took ${Date.now() - startTime}ms`);

      return { success: true, deleted: true };
    } catch (error) {
      log.error(`[TIMING] Failed to clear output path (${Date.now() - startTime}ms):`, error);
      return { success: false, deleted: false };
    }
  });

  // OS 패키지 의존성 해결
  ipcMain.handle(
    'os:resolveDependencies',
    async (
      _event,
      options: {
        packages: OSPackageInfo[];
        distribution: OSDistribution;
        architecture: OSArchitecture;
        includeOptional?: boolean;
        includeRecommends?: boolean;
      }
    ) => {
      const { packages, distribution, architecture, includeOptional, includeRecommends } = options;
      const mainWindow = getMainWindow();

      log.info(`Resolving OS package dependencies: ${packages.length} packages on ${distribution.id}`);

      // packageManager에 따라 적절한 resolver 선택
      let resolver;
      switch (distribution.packageManager) {
        case 'yum':
          resolver = getYumResolver({
            repositories: distribution.defaultRepos,
            architecture,
            includeOptional: includeOptional ?? false,
            includeRecommends: includeRecommends ?? false,
            distribution,
            onProgress: (message, current, total) => {
              mainWindow?.webContents.send('os:resolveDependencies:progress', {
                message,
                current,
                total,
              });
            },
          });
          break;

        case 'apt':
          resolver = getAptResolver({
            repositories: distribution.defaultRepos,
            architecture,
            includeOptional: includeOptional ?? false,
            includeRecommends: includeRecommends ?? false,
            distribution,
            onProgress: (message, current, total) => {
              mainWindow?.webContents.send('os:resolveDependencies:progress', {
                message,
                current,
                total,
              });
            },
          });
          break;

        case 'apk':
          resolver = getApkResolver({
            repositories: distribution.defaultRepos,
            architecture,
            includeOptional: includeOptional ?? false,
            includeRecommends: includeRecommends ?? false,
            distribution,
            onProgress: (message, current, total) => {
              mainWindow?.webContents.send('os:resolveDependencies:progress', {
                message,
                current,
                total,
              });
            },
          });
          break;

        default:
          throw new Error(`Unsupported package manager: ${distribution.packageManager}`);
      }

      // 의존성 해결 실행
      const result = await resolver.resolveDependencies(packages);

      return {
        packages: result.packages,
        unresolved: result.unresolved,
        conflicts: result.conflicts,
      };
    }
  );

  // OS 패키지 다운로드 시작
  ipcMain.handle(
    'os:download:start',
    async (
      _event,
      options: OSDownloadStartOptions
    ) => {
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

      const mainWindow = getMainWindow();
      const outputOptions: OSPackageOutputOptions = {
        ...DEFAULT_OS_OUTPUT_OPTIONS,
        ...rawOutputOptions,
      };
      const warnings: string[] = [];
      let unresolved: PackageDependency[] = [];
      let conflicts: Array<{
        package: string;
        versions: OSPackageInfo[];
      }> = [];

      log.info(`Starting OS package download: ${packages.length} packages to ${outputDir}`);
      osDownloadCancelled = false;
      osDownloadAbortController = new AbortController();

      await fse.ensureDir(outputDir);

      let packagesToDownload = packages;
      if (resolveDependencies) {
        const resolver = getOSResolverForDistribution(
          distribution,
          architecture,
          includeOptionalDeps ?? false,
          mainWindow,
          osDownloadAbortController.signal
        );
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
          emitOSProgress(mainWindow, {
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
        emitOSProgress(mainWindow, {
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
      const downloader = getOSDownloaderForDistribution(
        distribution,
        architecture,
        stagingDir,
        concurrency,
        mainWindow,
        osDownloadAbortController.signal
      );
      const downloadedFiles = new Map<string, string>();
      const successfulPackages: OSPackageInfo[] = [];
      const failedPackages: OSDownloadFailure[] = [];
      const skippedPackages: OSPackageInfo[] = [];
      const generatedOutputs: OSGeneratedOutput[] = [];

      try {
        for (const [index, pkg] of packagesToDownload.entries()) {
          if (osDownloadCancelled) {
            if (successfulPackages.length > 0) {
              warnings.push(
                `다운로드 취소로 임시 파일 ${successfulPackages.length}개를 정리했습니다. 최종 출력물은 생성되지 않았습니다.`
              );
            } else {
              warnings.push('다운로드가 취소되어 최종 출력물을 생성하지 않았습니다.');
            }
            skippedPackages.push(...packagesToDownload.slice(index));
            successfulPackages.length = 0;
            downloadedFiles.clear();
            break;
          }

          emitOSProgress(mainWindow, {
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
            if (successfulPackages.length > 0) {
              warnings.push(
                `다운로드 취소로 임시 파일 ${successfulPackages.length}개를 정리했습니다. 최종 출력물은 생성되지 않았습니다.`
              );
            } else {
              warnings.push('다운로드가 취소되어 최종 출력물을 생성하지 않았습니다.');
            }
            skippedPackages.push(...packagesToDownload.slice(index));
            successfulPackages.length = 0;
            downloadedFiles.clear();
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
          emitOSProgress(mainWindow, {
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
                path: `${path.join(outputDir, 'os-packages')}.${outputOptions.archiveFormat === 'tar.gz' ? 'tar.gz' : 'zip'}`,
                label: `압축 파일 (${outputOptions.archiveFormat || 'zip'})`,
              };
              generatedOutputs.push(archiveOutput);
              await archivePackager.createArchive(
                successfulPackages,
                downloadedFiles,
                {
                  format: outputOptions.archiveFormat || 'zip',
                  outputPath: path.join(outputDir, 'os-packages'),
                  includeScripts: outputOptions.generateScripts,
                  scriptTypes: outputOptions.scriptTypes,
                  packageManager: distribution.packageManager,
                  repoName: 'depssmuggler-local',
                }
              );

              if (osDownloadCancelled) {
                await cleanupGeneratedOutputs(generatedOutputs);
                generatedOutputs.length = 0;
                successfulPackages.length = 0;
                warnings.push('패키징 단계에서 취소되어 생성 중이던 출력물을 정리했습니다.');
              }
            }

            if (!osDownloadCancelled && (outputOptions.type === 'repository' || outputOptions.type === 'both')) {
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
    }
  );

  ipcMain.handle('os:download:cancel', async () => {
    osDownloadCancelled = true;
    osDownloadAbortController?.abort();
    return { success: true };
  });

  // OS 패키지 캐시 통계
  ipcMain.handle('os:cache:stats', async () => {
    // 각 다운로더의 캐시 통계를 수집
    // 현재는 기본값 반환
    return {
      size: 0,
      count: 0,
      path: '',
    };
  });

  // OS 패키지 캐시 초기화
  ipcMain.handle('os:cache:clear', async () => {
    // 각 다운로더의 캐시를 초기화
    // 현재는 성공 반환
    return { success: true };
  });

  log.info('다운로드 핸들러 등록 완료');
}
