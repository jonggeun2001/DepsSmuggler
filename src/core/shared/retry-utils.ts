/**
 * 재시도 로직을 위한 유틸리티 함수
 */

export interface RetryOptions {
  maxRetries: number;
  delayMs: number;
  shouldRetry?: (error: any) => boolean;
}

/**
 * 지수 백오프를 사용한 재시도 로직
 * @param fn 실행할 비동기 함수
 * @param options 재시도 옵션
 * @returns 함수 실행 결과
 */
export async function retryWithExponentialBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { maxRetries, delayMs, shouldRetry } = options;
  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // 재시도 가능한 에러인지 확인
      if (shouldRetry && !shouldRetry(error)) {
        throw error;
      }

      // 마지막 시도면 에러 throw
      if (attempt === maxRetries) {
        break;
      }

      // 지수 백오프: 1초 -> 2초 -> 4초
      const delay = delayMs * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * HTTP 에러가 재시도 가능한지 확인
 * @param error axios 에러 객체
 * @returns 재시도 가능 여부
 */
export function isRetryableHttpError(error: any): boolean {
  // null이나 undefined 체크
  if (!error) {
    return false;
  }

  // 504 Gateway Timeout, 503 Service Unavailable, 408 Request Timeout
  const retryableCodes = [504, 503, 408];

  // 연결 타임아웃 또는 연결 중단
  if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
    return true;
  }

  // HTTP 상태 코드 확인
  if (
    error.response?.status &&
    retryableCodes.includes(error.response.status)
  ) {
    return true;
  }

  return false;
}
