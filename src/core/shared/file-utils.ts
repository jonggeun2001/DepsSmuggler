// 파일 다운로드 및 압축 유틸리티
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import archiver from 'archiver';

export type ProgressCallback = (downloaded: number, total: number) => void;

export interface DownloadOptions {
  signal?: AbortSignal;
  shouldPause?: () => boolean;  // 일시정지 여부를 체크하는 콜백
}

/**
 * 파일 다운로드 (진행률 콜백 포함)
 * HTTP/HTTPS 모두 지원, 리다이렉트 자동 처리, AbortSignal로 취소 가능
 */
export async function downloadFile(
  url: string,
  destPath: string,
  onProgress: ProgressCallback,
  options?: DownloadOptions
): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const protocol = url.startsWith('https') ? https : http;
    let pauseCheckInterval: NodeJS.Timeout | null = null;

    // 정리 함수
    const cleanup = () => {
      if (pauseCheckInterval) {
        clearInterval(pauseCheckInterval);
        pauseCheckInterval = null;
      }
    };

    const request = protocol
      .get(url, { headers: { 'User-Agent': 'DepsSmuggler/1.0' } }, (response) => {
        // 리다이렉트 처리
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            cleanup();
            file.close();
            fs.unlinkSync(destPath);
            downloadFile(redirectUrl, destPath, onProgress, options)
              .then(resolve)
              .catch(reject);
            return;
          }
        }

        const totalLength = parseInt(response.headers['content-length'] || '0', 10);
        let downloadedLength = 0;
        let isPaused = false;

        response.on('data', (chunk: Buffer) => {
          downloadedLength += chunk.length;
          onProgress(downloadedLength, totalLength);

          // 일시정지 콜백 체크
          if (options?.shouldPause?.() && !isPaused) {
            isPaused = true;
            response.pause();
            console.log(`[downloadFile] Stream paused at ${downloadedLength}/${totalLength} bytes`);

            // 주기적으로 재개 여부 확인
            pauseCheckInterval = setInterval(() => {
              if (!options?.shouldPause?.()) {
                isPaused = false;
                cleanup();
                response.resume();
                console.log(`[downloadFile] Stream resumed at ${downloadedLength}/${totalLength} bytes`);
              }
            }, 100);
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          cleanup();
          file.close();
          resolve();
        });
      })
      .on('error', (err) => {
        cleanup();
        file.close();
        fs.unlink(destPath, () => {});
        reject(err);
      });

    // AbortSignal 처리
    if (options?.signal) {
      options.signal.addEventListener('abort', () => {
        cleanup();
        request.destroy();
        file.close();
        fs.unlink(destPath, () => {});
        reject(new Error('Download aborted'));
      });
    }
  });
}

/**
 * ZIP 압축 파일 생성
 */
export async function createZipArchive(
  sourceDir: string,
  outputPath: string
): Promise<void> {
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
export async function createTarGzArchive(
  sourceDir: string,
  outputPath: string
): Promise<void> {
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
