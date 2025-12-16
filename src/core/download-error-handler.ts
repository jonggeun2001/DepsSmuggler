/**
 * 다운로드 에러 핸들러
 * 에러 처리, 재시도 정책, 백오프 로직을 담당
 */

import { DOWNLOAD_CONSTANTS } from './constants/download';

/**
 * 재시도 정책
 */
export interface RetryPolicy {
  /** 최대 재시도 횟수 */
  maxRetries: number;
  /** 기본 재시도 지연 시간 (ms) */
  baseDelayMs: number;
  /** 백오프 배수 (지수 백오프용) */
  backoffMultiplier: number;
  /** 최대 지연 시간 (ms) */
  maxDelayMs: number;
}

/**
 * 에러 처리 결과
 */
export interface ErrorHandleResult {
  /** 처리 액션 */
  action: 'retry' | 'fail' | 'skip';
  /** 결과 메시지 */
  message: string;
  /** 재시도 대기 시간 (ms, action이 'retry'일 때만) */
  retryAfterMs?: number;
  /** 재시도 횟수 */
  retryCount: number;
}

/**
 * 에러 분류
 */
export type ErrorCategory = 'network' | 'timeout' | 'notFound' | 'serverError' | 'unknown';

/**
 * 기본 재시도 정책
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: DOWNLOAD_CONSTANTS.MAX_RETRIES,
  baseDelayMs: DOWNLOAD_CONSTANTS.RETRY_DELAY_MS,
  backoffMultiplier: 1.5,
  maxDelayMs: 30000,
};

/**
 * 다운로드 에러 핸들러
 *
 * 사용 예:
 * ```typescript
 * const handler = new DownloadErrorHandler();
 * const result = handler.handleError(error, currentRetryCount);
 * if (result.action === 'retry') {
 *   await delay(result.retryAfterMs);
 *   // retry download
 * }
 * ```
 */
export class DownloadErrorHandler {
  private readonly policy: RetryPolicy;

  constructor(policy: Partial<RetryPolicy> = {}) {
    this.policy = { ...DEFAULT_RETRY_POLICY, ...policy };
  }

  /**
   * 에러 분류
   */
  categorizeError(error: Error): ErrorCategory {
    const message = error.message.toLowerCase();

    // 네트워크 에러
    if (
      message.includes('econnrefused') ||
      message.includes('enotfound') ||
      message.includes('network') ||
      message.includes('connection')
    ) {
      return 'network';
    }

    // 타임아웃
    if (message.includes('timeout') || message.includes('etimedout')) {
      return 'timeout';
    }

    // 404 Not Found
    if (message.includes('404') || message.includes('not found') || message.includes('찾을 수 없')) {
      return 'notFound';
    }

    // 5xx 서버 에러
    if (message.includes('500') || message.includes('502') || message.includes('503')) {
      return 'serverError';
    }

    return 'unknown';
  }

  /**
   * 재시도 가능 여부 확인
   */
  isRetryable(error: Error): boolean {
    const category = this.categorizeError(error);
    // notFound는 재시도해도 의미 없음
    return category !== 'notFound';
  }

  /**
   * 재시도 가능 여부 확인 (횟수 기반)
   */
  shouldRetry(currentRetryCount: number, error?: Error): boolean {
    if (currentRetryCount >= this.policy.maxRetries) {
      return false;
    }

    if (error && !this.isRetryable(error)) {
      return false;
    }

    return true;
  }

  /**
   * 재시도 지연 시간 계산 (지수 백오프)
   */
  getRetryDelay(attemptNumber: number): number {
    // 지수 백오프: baseDelay * (multiplier ^ attempt)
    const delay = this.policy.baseDelayMs * Math.pow(this.policy.backoffMultiplier, attemptNumber);
    return Math.min(delay, this.policy.maxDelayMs);
  }

  /**
   * 에러 처리
   */
  handleError(error: Error, currentRetryCount: number): ErrorHandleResult {
    const category = this.categorizeError(error);
    const canRetry = this.shouldRetry(currentRetryCount, error);

    if (!canRetry) {
      // 재시도 불가 - 실패 처리
      if (category === 'notFound') {
        return {
          action: 'fail',
          message: `패키지를 찾을 수 없습니다: ${error.message}`,
          retryCount: currentRetryCount,
        };
      }

      return {
        action: 'fail',
        message: `최대 재시도 횟수(${this.policy.maxRetries})를 초과했습니다: ${error.message}`,
        retryCount: currentRetryCount,
      };
    }

    // 재시도
    const retryAfterMs = this.getRetryDelay(currentRetryCount);
    return {
      action: 'retry',
      message: `재시도 ${currentRetryCount + 1}/${this.policy.maxRetries} (${retryAfterMs}ms 후)`,
      retryAfterMs,
      retryCount: currentRetryCount + 1,
    };
  }

  /**
   * 현재 재시도 정책 조회
   */
  getPolicy(): Readonly<RetryPolicy> {
    return { ...this.policy };
  }
}

// 편의 함수: 기본 설정의 DownloadErrorHandler 생성
export function createErrorHandler(policy?: Partial<RetryPolicy>): DownloadErrorHandler {
  return new DownloadErrorHandler(policy);
}
