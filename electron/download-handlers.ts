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
  createZipArchive,
  generateInstallScripts,
  Architecture,
} from '../src/core/shared';
import {
  getCondaDownloader,
  getMavenDownloader,
  getDockerDownloader,
  getNpmDownloader,
} from '../src/core';

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

// mainWindow 참조를 저장할 변수
let getMainWindow: () => BrowserWindow | null = () => null;

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
              pythonVersion
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
                }
              );

              // flat 구조로도 복사 (packagesDir 루트에 jar 파일)
              const flatFileName = `${artifactId}-${pkg.version}.jar`;
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
          // 설치 스크립트 생성 (의존성 포함)
          if (includeScripts) {
            generateInstallScripts(outputDir, allPackages);
          }

          // ZIP 압축 (outputFormat이 zip인 경우)
          if (outputFormat === 'zip') {
            try {
              const zipPath = `${outputDir}.zip`;
              await createZipArchive(outputDir, zipPath);
              log.info(`Created ZIP archive: ${zipPath}`);
            } catch (error) {
              log.error('Failed to create ZIP archive:', error);
            }
          }

          // 전체 완료 이벤트 전송
          mainWindow?.webContents.send('download:all-complete', {
            success: true,
            outputPath: outputDir,
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

  log.info('다운로드 핸들러 등록 완료');
}
