/**
 * DownloadErrorHandler 단위 테스트
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DownloadErrorHandler,
  createErrorHandler,
  DEFAULT_RETRY_POLICY,
  ErrorCategory,
} from './download-error-handler';

describe('DownloadErrorHandler', () => {
  let handler: DownloadErrorHandler;

  beforeEach(() => {
    handler = new DownloadErrorHandler({
      maxRetries: 3,
      baseDelayMs: 1000,
      backoffMultiplier: 2,
      maxDelayMs: 10000,
    });
  });

  describe('categorizeError', () => {
    it('네트워크 에러를 분류해야 함', () => {
      expect(handler.categorizeError(new Error('ECONNREFUSED'))).toBe('network');
      expect(handler.categorizeError(new Error('ENOTFOUND'))).toBe('network');
      expect(handler.categorizeError(new Error('network error'))).toBe('network');
      expect(handler.categorizeError(new Error('connection refused'))).toBe('network');
    });

    it('타임아웃 에러를 분류해야 함', () => {
      expect(handler.categorizeError(new Error('timeout'))).toBe('timeout');
      expect(handler.categorizeError(new Error('ETIMEDOUT'))).toBe('timeout');
    });

    it('404 에러를 분류해야 함', () => {
      expect(handler.categorizeError(new Error('404 Not Found'))).toBe('notFound');
      expect(handler.categorizeError(new Error('패키지를 찾을 수 없습니다'))).toBe('notFound');
    });

    it('서버 에러를 분류해야 함', () => {
      expect(handler.categorizeError(new Error('500 Internal Server Error'))).toBe('serverError');
      expect(handler.categorizeError(new Error('502 Bad Gateway'))).toBe('serverError');
      expect(handler.categorizeError(new Error('503 Service Unavailable'))).toBe('serverError');
    });

    it('알 수 없는 에러를 분류해야 함', () => {
      expect(handler.categorizeError(new Error('some random error'))).toBe('unknown');
    });
  });

  describe('isRetryable', () => {
    it('네트워크 에러는 재시도 가능', () => {
      expect(handler.isRetryable(new Error('ECONNREFUSED'))).toBe(true);
    });

    it('타임아웃 에러는 재시도 가능', () => {
      expect(handler.isRetryable(new Error('timeout'))).toBe(true);
    });

    it('서버 에러는 재시도 가능', () => {
      expect(handler.isRetryable(new Error('500 Internal Server Error'))).toBe(true);
    });

    it('404 에러는 재시도 불가', () => {
      expect(handler.isRetryable(new Error('404 Not Found'))).toBe(false);
    });

    it('알 수 없는 에러는 재시도 가능', () => {
      expect(handler.isRetryable(new Error('unknown error'))).toBe(true);
    });
  });

  describe('shouldRetry', () => {
    it('재시도 횟수가 최대치 미만이면 true', () => {
      expect(handler.shouldRetry(0)).toBe(true);
      expect(handler.shouldRetry(1)).toBe(true);
      expect(handler.shouldRetry(2)).toBe(true);
    });

    it('재시도 횟수가 최대치 이상이면 false', () => {
      expect(handler.shouldRetry(3)).toBe(false);
      expect(handler.shouldRetry(4)).toBe(false);
    });

    it('재시도 불가능한 에러면 false', () => {
      expect(handler.shouldRetry(0, new Error('404 Not Found'))).toBe(false);
    });

    it('재시도 가능한 에러면 true', () => {
      expect(handler.shouldRetry(0, new Error('timeout'))).toBe(true);
    });
  });

  describe('getRetryDelay', () => {
    it('지수 백오프로 지연 시간을 계산해야 함', () => {
      // baseDelay * (multiplier ^ attempt)
      expect(handler.getRetryDelay(0)).toBe(1000); // 1000 * 2^0 = 1000
      expect(handler.getRetryDelay(1)).toBe(2000); // 1000 * 2^1 = 2000
      expect(handler.getRetryDelay(2)).toBe(4000); // 1000 * 2^2 = 4000
      expect(handler.getRetryDelay(3)).toBe(8000); // 1000 * 2^3 = 8000
    });

    it('최대 지연 시간을 초과하지 않아야 함', () => {
      expect(handler.getRetryDelay(10)).toBe(10000); // maxDelayMs로 제한
    });
  });

  describe('handleError', () => {
    it('재시도 가능하면 retry 액션 반환', () => {
      const result = handler.handleError(new Error('timeout'), 0);

      expect(result.action).toBe('retry');
      expect(result.retryAfterMs).toBe(1000);
      expect(result.retryCount).toBe(1);
    });

    it('최대 재시도 초과 시 fail 액션 반환', () => {
      const result = handler.handleError(new Error('timeout'), 3);

      expect(result.action).toBe('fail');
      expect(result.message).toContain('최대 재시도 횟수');
    });

    it('404 에러는 즉시 fail 액션 반환', () => {
      const result = handler.handleError(new Error('404 Not Found'), 0);

      expect(result.action).toBe('fail');
      expect(result.message).toContain('찾을 수 없습니다');
    });

    it('연속 재시도 시 지연 시간이 증가해야 함', () => {
      const result1 = handler.handleError(new Error('timeout'), 0);
      const result2 = handler.handleError(new Error('timeout'), 1);
      const result3 = handler.handleError(new Error('timeout'), 2);

      expect(result1.retryAfterMs).toBe(1000);
      expect(result2.retryAfterMs).toBe(2000);
      expect(result3.retryAfterMs).toBe(4000);
    });
  });

  describe('getPolicy', () => {
    it('현재 정책을 반환해야 함', () => {
      const policy = handler.getPolicy();

      expect(policy.maxRetries).toBe(3);
      expect(policy.baseDelayMs).toBe(1000);
      expect(policy.backoffMultiplier).toBe(2);
      expect(policy.maxDelayMs).toBe(10000);
    });
  });

  describe('createErrorHandler', () => {
    it('기본 설정으로 인스턴스를 생성해야 함', () => {
      const h = createErrorHandler();
      const policy = h.getPolicy();

      expect(policy.maxRetries).toBe(DEFAULT_RETRY_POLICY.maxRetries);
      expect(policy.baseDelayMs).toBe(DEFAULT_RETRY_POLICY.baseDelayMs);
    });

    it('사용자 설정으로 인스턴스를 생성해야 함', () => {
      const h = createErrorHandler({ maxRetries: 5 });
      const policy = h.getPolicy();

      expect(policy.maxRetries).toBe(5);
    });
  });
});
