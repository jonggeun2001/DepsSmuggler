/**
 * retry-utils.ts 테스트
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  retryWithExponentialBackoff,
  isRetryableHttpError,
} from './retry-utils';

describe('retryWithExponentialBackoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('첫 시도 성공 시 즉시 반환', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const result = await retryWithExponentialBackoff(fn, {
      maxRetries: 2,
      delayMs: 100,
    });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('재시도 후 성공', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('504'))
      .mockResolvedValue('success');

    const result = await retryWithExponentialBackoff(fn, {
      maxRetries: 2,
      delayMs: 100,
      shouldRetry: () => true,
    });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('최대 재시도 초과 시 에러 throw', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('504'));

    await expect(
      retryWithExponentialBackoff(fn, {
        maxRetries: 2,
        delayMs: 100,
        shouldRetry: () => true,
      })
    ).rejects.toThrow('504');

    expect(fn).toHaveBeenCalledTimes(3); // 초기 + 2회 재시도
  });

  it('재시도 불가능한 에러는 즉시 throw', async () => {
    const fn = vi.fn().mockRejectedValue({ response: { status: 400 } });

    await expect(
      retryWithExponentialBackoff(fn, {
        maxRetries: 2,
        delayMs: 100,
        shouldRetry: isRetryableHttpError,
      })
    ).rejects.toMatchObject({ response: { status: 400 } });

    expect(fn).toHaveBeenCalledTimes(1); // 재시도 없음
  });

  it('지수 백오프 동작 확인', async () => {
    const timings: number[] = [];
    const fn = vi.fn().mockImplementation(async () => {
      timings.push(Date.now());
      throw new Error('504');
    });

    try {
      await retryWithExponentialBackoff(fn, {
        maxRetries: 2,
        delayMs: 100,
        shouldRetry: () => true,
      });
    } catch {
      // 예상된 에러
    }

    expect(fn).toHaveBeenCalledTimes(3);
    expect(timings.length).toBe(3);

    // 1차 재시도: ~100ms 후
    const delay1 = timings[1] - timings[0];
    expect(delay1).toBeGreaterThanOrEqual(90);
    expect(delay1).toBeLessThanOrEqual(200);

    // 2차 재시도: ~200ms 후
    const delay2 = timings[2] - timings[1];
    expect(delay2).toBeGreaterThanOrEqual(180);
    expect(delay2).toBeLessThanOrEqual(300);
  });
});

describe('isRetryableHttpError', () => {
  it('504 Gateway Timeout은 재시도 가능', () => {
    expect(isRetryableHttpError({ response: { status: 504 } })).toBe(true);
  });

  it('503 Service Unavailable은 재시도 가능', () => {
    expect(isRetryableHttpError({ response: { status: 503 } })).toBe(true);
  });

  it('408 Request Timeout은 재시도 가능', () => {
    expect(isRetryableHttpError({ response: { status: 408 } })).toBe(true);
  });

  it('ETIMEDOUT은 재시도 가능', () => {
    expect(isRetryableHttpError({ code: 'ETIMEDOUT' })).toBe(true);
  });

  it('ECONNABORTED는 재시도 가능', () => {
    expect(isRetryableHttpError({ code: 'ECONNABORTED' })).toBe(true);
  });

  it('400 Bad Request는 재시도 불가', () => {
    expect(isRetryableHttpError({ response: { status: 400 } })).toBe(false);
  });

  it('404 Not Found는 재시도 불가', () => {
    expect(isRetryableHttpError({ response: { status: 404 } })).toBe(false);
  });

  it('500 Internal Server Error는 재시도 불가 (목록에 없음)', () => {
    expect(isRetryableHttpError({ response: { status: 500 } })).toBe(false);
  });

  it('에러 객체가 없으면 false', () => {
    expect(isRetryableHttpError({})).toBe(false);
    expect(isRetryableHttpError(null)).toBe(false);
    expect(isRetryableHttpError(undefined)).toBe(false);
  });
});
