// 파일 다운로드 및 압축 유틸리티
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import archiver from 'archiver';
import logger from '../../utils/logger';

export type ProgressCallback = (downloaded: number, total: number) => void;

export interface FileDownloadOptions {
  signal?: AbortSignal;
  shouldPause?: () => boolean; // 일시정지 여부를 체크하는 콜백
}

/**
 * 파일 다운로드 (진행률 콜백 포함)
 * HTTP/HTTPS 모두 지원, 리다이렉트 자동 처리, AbortSignal로 취소 가능
 */
export async function downloadFile(
  url: string,
  destPath: string,
  onProgress: ProgressCallback,
  options?: FileDownloadOptions
): Promise<void> {
  return downloadAttempt(url, 0);

  function downloadAttempt(currentUrl: string, redirects: number): Promise<void> {
    if (options?.signal?.aborted) return Promise.reject(new Error('Download aborted'));

    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(destPath);
      const protocol = currentUrl.startsWith('https') ? https : http;
      let pauseCheckInterval: NodeJS.Timeout | null = null;
      let settled = false;
      let request: http.ClientRequest | undefined;
      let activeResponse: http.IncomingMessage | undefined;
      const onAbort = () => fail(new Error('Download aborted'));

      const cleanup = () => {
        if (pauseCheckInterval) {
          clearInterval(pauseCheckInterval);
          pauseCheckInterval = null;
        }
        options?.signal?.removeEventListener('abort', onAbort);
      };

      // 이전 시도의 정리가 끝난 다음에만 재시도가 같은 경로를 사용할 수 있다.
      const closeAndRemove = (done: (error?: Error) => void) => {
        file.close((closeError?: NodeJS.ErrnoException | null) => {
          fs.unlink(destPath, (unlinkError) => {
            done(
              closeError || (unlinkError?.code !== 'ENOENT' ? unlinkError : undefined) || undefined
            );
          });
        });
      };

      function fail(error: Error) {
        if (settled) return;
        settled = true;
        cleanup();
        activeResponse?.unpipe(file);
        activeResponse?.destroy();
        request?.destroy();
        closeAndRemove((cleanupError) => {
          reject(
            cleanupError
              ? new Error(`${error.message} (파일 정리 실패: ${cleanupError.message})`)
              : error
          );
        });
      }

      file.on('error', fail);
      options?.signal?.addEventListener('abort', onAbort, { once: true });

      try {
        request = protocol.get(
          currentUrl,
          { headers: { 'User-Agent': 'DepsSmuggler/1.0' } },
          (response) => {
            activeResponse = response;
            if (settled) {
              response.destroy();
              return;
            }

            if (response.statusCode === 301 || response.statusCode === 302) {
              const redirectUrl = response.headers.location;
              if (!redirectUrl) {
                fail(new Error(`HTTP ${response.statusCode}: 리다이렉트 Location이 없습니다.`));
                return;
              }
              if (redirects >= 20) {
                fail(
                  new Error(`HTTP ${response.statusCode}: 리다이렉트 제한(20회)을 초과했습니다.`)
                );
                return;
              }
              let nextUrl: string;
              try {
                nextUrl = new URL(redirectUrl, currentUrl).href;
              } catch (error) {
                fail(error instanceof Error ? error : new Error(String(error)));
                return;
              }
              settled = true;
              cleanup();
              response.destroy();
              request?.destroy();
              closeAndRemove((error) => {
                if (error) reject(error);
                else downloadAttempt(nextUrl, redirects + 1).then(resolve, reject);
              });
              return;
            }

            const status = response.statusCode ?? 0;
            if (status < 200 || status >= 300) {
              fail(
                new Error(
                  `HTTP ${status}${response.statusMessage ? ` ${response.statusMessage}` : ''}: 다운로드에 실패했습니다.`
                )
              );
              return;
            }

            const totalLength = parseInt(response.headers['content-length'] || '0', 10);
            let downloadedLength = 0;
            let isPaused = false;
            const interruptedError = () => new Error(
              `Download interrupted: ${downloadedLength}/${totalLength || 'unknown'} bytes received`
            );

            response.on('error', fail);
            response.once('aborted', () => fail(interruptedError()));
            response.once('close', () => {
              if (!response.complete) fail(interruptedError());
            });

            response.on('data', (chunk: Buffer) => {
              if (settled) return;
              downloadedLength += chunk.length;
              onProgress(downloadedLength, totalLength);
              if (settled) return;

              // 일시정지 콜백 체크
              if (options?.shouldPause?.() && !isPaused) {
                isPaused = true;
                response.pause();
                logger.debug('[downloadFile] Stream paused', { downloadedLength, totalLength });

                // 주기적으로 재개 여부 확인
                pauseCheckInterval = setInterval(() => {
                  if (!options?.shouldPause?.()) {
                    isPaused = false;
                    if (pauseCheckInterval) clearInterval(pauseCheckInterval);
                    pauseCheckInterval = null;
                    response.resume();
                    logger.debug('[downloadFile] Stream resumed', {
                      downloadedLength,
                      totalLength,
                    });
                  }
                }, 100);
              }
            });

            response.pipe(file);

            file.once('finish', () => {
              if (settled) return;
              if (!response.complete || (
                response.headers['content-length'] !== undefined && downloadedLength !== totalLength
              )) {
                fail(interruptedError());
                return;
              }
              file.close((error?: NodeJS.ErrnoException | null) => {
                if (error) {
                  fail(error);
                  return;
                }
                if (settled) return;
                settled = true;
                cleanup();
                resolve();
              });
            });
          }
        );
        request.on('error', fail);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}

/**
 * ZIP 압축 파일 생성
 */
export async function createZipArchive(sourceDir: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve());
    archive.on('error', (err: Error) => reject(err));

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

/**
 * tar.gz 압축 파일 생성
 */
export async function createTarGzArchive(sourceDir: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('tar', { gzip: true, gzipOptions: { level: 9 } });

    output.on('close', () => resolve());
    archive.on('error', (err: Error) => reject(err));

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}
