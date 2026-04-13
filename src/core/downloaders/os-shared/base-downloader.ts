/**
 * Base OS Package Downloader
 * 패키지 다운로드 기본 클래스
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  OSPackageInfo,
  Repository,
  OSDistribution,
  OSArchitecture,
  OSDownloadProgress,
  OSDownloadError,
  OSErrorAction,
} from './types';
import { GPGVerifier, type VerificationResult } from './gpg-verifier';
import { getDownloadedFileKey } from './package-file-utils';

/**
 * 다운로드 결과
 */
export interface DownloadResult {
  /** 성공 여부 */
  success: boolean;
  /** 저장된 파일 경로 */
  filePath?: string;
  /** 에러 */
  error?: Error;
  /** 사용자가 건너뛰기를 선택했는지 여부 */
  skipped?: boolean;
  /** 사용자가 다운로드를 취소했는지 여부 */
  cancelled?: boolean;
  /** 검증 결과 */
  verification?: VerificationResult;
}

export interface DownloadPackagesResult {
  success: OSPackageInfo[];
  failed: Array<{ package: OSPackageInfo; error: Error }>;
  downloadedFiles: Map<string, string>;
}

/**
 * 다운로더 옵션
 */
export interface BaseDownloaderOptions {
  /** 출력 디렉토리 */
  outputDir: string;
  /** 대상 배포판 */
  distribution: OSDistribution;
  /** 대상 아키텍처 */
  architecture: OSArchitecture;
  /** 사용할 저장소 목록 */
  repositories: Repository[];
  /** 동시 다운로드 수 */
  concurrency: number;
  /** GPG 검증기 */
  gpgVerifier?: GPGVerifier;
  /** 다운로드 취소 신호 */
  abortSignal?: AbortSignal;
  /** 진행 콜백 */
  onProgress?: (progress: OSDownloadProgress) => void;
  /** 에러 콜백 */
  onError?: (error: OSDownloadError) => Promise<OSErrorAction>;
}

/**
 * 기본 OS 패키지 다운로더
 */
export abstract class BaseOSDownloader {
  protected options: BaseDownloaderOptions;
  protected maxRetries = 3;
  protected retryDelay = 1000;

  constructor(options: BaseDownloaderOptions) {
    this.options = options;
    this.ensureOutputDir();
  }

  /**
   * 출력 디렉토리 생성
   */
  protected ensureOutputDir(): void {
    if (!fs.existsSync(this.options.outputDir)) {
      fs.mkdirSync(this.options.outputDir, { recursive: true });
    }
  }

  /**
   * 패키지 다운로드 URL 생성
   */
  protected abstract getDownloadUrl(pkg: OSPackageInfo): string;

  /**
   * 패키지 파일명 생성
   */
  protected abstract getFilename(pkg: OSPackageInfo): string;

  protected createAbortError(): Error {
    const error = new Error('Download cancelled');
    error.name = 'AbortError';
    return error;
  }

  protected isAbortError(error: unknown): boolean {
    return this.options.abortSignal?.aborted === true || (error as { name?: string })?.name === 'AbortError';
  }

  /**
   * 단일 패키지 다운로드
   */
  async downloadPackage(pkg: OSPackageInfo): Promise<DownloadResult> {
    if (this.options.abortSignal?.aborted) {
      return {
        success: false,
        error: this.createAbortError(),
        cancelled: true,
      };
    }

    const url = this.getDownloadUrl(pkg);
    const filename = this.getFilename(pkg);
    const filePath = path.join(this.options.outputDir, filename);

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        // 다운로드
        await this.downloadFile(url, filePath, pkg);

        // GPG 검증
        let verification: VerificationResult | undefined;
        if (this.options.gpgVerifier) {
          verification = await this.options.gpgVerifier.verifyPackage(pkg, filePath);

          if (!verification.verified && !verification.skipped) {
            throw new Error(`Verification failed: ${verification.reason}`);
          }
        }

        return {
          success: true,
          filePath,
          verification,
        };
      } catch (error) {
        lastError = error as Error;

        if (this.isAbortError(lastError)) {
          return {
            success: false,
            error: this.createAbortError(),
            cancelled: true,
          };
        }

        if (attempt < this.maxRetries) {
          // 재시도 전 대기
          await new Promise((resolve) => setTimeout(resolve, this.retryDelay * attempt));
        } else {
          // 마지막 시도 실패 - 사용자에게 물어보기
          if (this.options.onError) {
            const action = await this.options.onError({
              type: 'network',
              message: lastError.message,
              package: pkg,
              cause: lastError,
              retryable: true,
            });

            if (action === 'retry') {
              attempt = 0; // 다시 시도
              continue;
            } else if (action === 'skip') {
              return {
                success: false,
                error: lastError,
                skipped: true,
              };
            } else {
              throw lastError;
            }
          }
        }
      }
    }

    return {
      success: false,
      error: lastError || new Error('Download failed'),
    };
  }

  /**
   * 파일 다운로드
   */
  protected async downloadFile(
    url: string,
    destPath: string,
    pkg: OSPackageInfo
  ): Promise<void> {
    if (this.options.abortSignal?.aborted) {
      throw this.createAbortError();
    }

    const response = await fetch(url, {
      signal: this.options.abortSignal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error('Response body is not readable');
    }

    const chunks: Uint8Array[] = [];
    let downloaded = 0;
    let lastBytes = 0;
    let lastTime = Date.now();
    let currentSpeed = 0;

    while (true) {
      if (this.options.abortSignal?.aborted) {
        throw this.createAbortError();
      }

      const { done, value } = await reader.read();

      if (done) break;

      chunks.push(value);
      downloaded += value.length;

      // 속도 계산 (0.3초마다)
      const now = Date.now();
      const elapsed = (now - lastTime) / 1000;
      if (elapsed >= 0.3) {
        currentSpeed = (downloaded - lastBytes) / elapsed;
        lastBytes = downloaded;
        lastTime = now;
      }

      // 진행률 콜백
      if (this.options.onProgress) {
        this.options.onProgress({
          currentPackage: pkg.name,
          currentIndex: 0,
          totalPackages: 1,
          bytesDownloaded: downloaded,
          totalBytes: contentLength || pkg.size,
          speed: currentSpeed,
          phase: 'downloading',
        });
      }
    }

    // 파일 저장
    const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    fs.writeFileSync(destPath, buffer);
  }

  /**
   * 여러 패키지 다운로드 (병렬)
   */
  async downloadPackages(
    packages: OSPackageInfo[]
  ): Promise<DownloadPackagesResult> {
    const success: OSPackageInfo[] = [];
    const failed: Array<{ package: OSPackageInfo; error: Error }> = [];
    const downloadedFiles = new Map<string, string>();

    // 간단한 병렬 처리 (concurrency 제한)
    const queue = [...packages];
    const inProgress: Promise<void>[] = [];

    const processNext = async (): Promise<void> => {
      if (queue.length === 0) return;

      const pkg = queue.shift()!;
      const result = await this.downloadPackage(pkg);

      if (result.success) {
        success.push(pkg);
        if (result.filePath) {
          downloadedFiles.set(getDownloadedFileKey(pkg), result.filePath);
        }
      } else {
        failed.push({ package: pkg, error: result.error! });
      }

      // 진행률 업데이트
      if (this.options.onProgress) {
        this.options.onProgress({
          currentPackage: pkg.name,
          currentIndex: success.length + failed.length,
          totalPackages: packages.length,
          bytesDownloaded: 0,
          totalBytes: 0,
          speed: 0,
          phase: 'downloading',
        });
      }
    };

    // 동시 실행
    while (queue.length > 0 || inProgress.length > 0) {
      // 동시 실행 수 제한
      while (inProgress.length < this.options.concurrency && queue.length > 0) {
        const promise = processNext().then(() => {
          const idx = inProgress.indexOf(promise);
          if (idx > -1) inProgress.splice(idx, 1);
        });
        inProgress.push(promise);
      }

      // 하나라도 완료 대기
      if (inProgress.length > 0) {
        await Promise.race(inProgress);
      }
    }

    return { success, failed, downloadedFiles };
  }
}
