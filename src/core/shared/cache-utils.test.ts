/**
 * cache-utils 테스트
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  isCacheValid,
  isCacheEntryValid,
  createCacheEntry,
  pruneExpiredEntries,
  calculateCacheStats,
  normalizeKey,
  createPendingRequestManager,
  isBaseCacheEntry,
  BaseCacheEntry,
  DEFAULT_MEMORY_TTL_MS,
  DEFAULT_DISK_TTL_MS,
  LONG_DISK_TTL_MS,
} from './cache-utils';

describe('cache-utils', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('isCacheValid', () => {
    it('TTL 내의 캐시는 유효', () => {
      const cachedAt = Date.now() - 1000; // 1초 전
      const ttl = 5000; // 5초 TTL
      expect(isCacheValid(cachedAt, ttl)).toBe(true);
    });

    it('TTL 초과한 캐시는 무효', () => {
      const cachedAt = Date.now() - 10000; // 10초 전
      const ttl = 5000; // 5초 TTL
      expect(isCacheValid(cachedAt, ttl)).toBe(false);
    });

    it('정확히 TTL에 도달하면 무효', () => {
      const cachedAt = Date.now() - 5000; // 5초 전
      const ttl = 5000; // 5초 TTL
      expect(isCacheValid(cachedAt, ttl)).toBe(false);
    });

    it('방금 캐시된 항목은 유효', () => {
      const cachedAt = Date.now();
      const ttl = 5000;
      expect(isCacheValid(cachedAt, ttl)).toBe(true);
    });
  });

  describe('isCacheEntryValid', () => {
    it('유효한 캐시 항목 확인', () => {
      const entry: BaseCacheEntry<string> = {
        data: 'test',
        cachedAt: Date.now() - 1000,
        ttl: 5000,
      };
      expect(isCacheEntryValid(entry)).toBe(true);
    });

    it('만료된 캐시 항목 확인', () => {
      const entry: BaseCacheEntry<string> = {
        data: 'test',
        cachedAt: Date.now() - 10000,
        ttl: 5000,
      };
      expect(isCacheEntryValid(entry)).toBe(false);
    });
  });

  describe('createCacheEntry', () => {
    it('기본 캐시 항목 생성', () => {
      const data = { name: 'test' };
      const ttl = 5000;
      const entry = createCacheEntry(data, ttl);

      expect(entry.data).toBe(data);
      expect(entry.ttl).toBe(ttl);
      expect(entry.cachedAt).toBe(Date.now());
      expect(entry.metadata).toBeUndefined();
    });

    it('메타데이터 포함 캐시 항목 생성', () => {
      const data = { name: 'test' };
      const ttl = 5000;
      const metadata = { version: '1.0.0', source: 'api' };
      const entry = createCacheEntry(data, ttl, metadata);

      expect(entry.data).toBe(data);
      expect(entry.metadata).toBe(metadata);
    });
  });

  describe('pruneExpiredEntries', () => {
    it('만료된 항목 제거', () => {
      const cache = new Map<string, BaseCacheEntry<string>>();
      cache.set('fresh', {
        data: 'fresh-data',
        cachedAt: Date.now() - 1000, // 1초 전
        ttl: 5000,
      });
      cache.set('expired', {
        data: 'expired-data',
        cachedAt: Date.now() - 10000, // 10초 전
        ttl: 5000,
      });

      const pruned = pruneExpiredEntries(cache);

      expect(pruned).toBe(1);
      expect(cache.size).toBe(1);
      expect(cache.has('fresh')).toBe(true);
      expect(cache.has('expired')).toBe(false);
    });

    it('TTL 오버라이드 적용', () => {
      const cache = new Map<string, BaseCacheEntry<string>>();
      cache.set('item1', {
        data: 'data1',
        cachedAt: Date.now() - 3000, // 3초 전
        ttl: 10000, // 원래 TTL 10초
      });
      cache.set('item2', {
        data: 'data2',
        cachedAt: Date.now() - 1000, // 1초 전
        ttl: 10000,
      });

      // 2초 TTL로 오버라이드
      const pruned = pruneExpiredEntries(cache, 2000);

      expect(pruned).toBe(1);
      expect(cache.size).toBe(1);
      expect(cache.has('item2')).toBe(true);
    });

    it('빈 캐시에서 아무것도 제거하지 않음', () => {
      const cache = new Map<string, BaseCacheEntry<string>>();
      const pruned = pruneExpiredEntries(cache);
      expect(pruned).toBe(0);
    });
  });

  describe('calculateCacheStats', () => {
    it('캐시 통계 계산', () => {
      const cache = new Map<string, BaseCacheEntry<string>>();
      const oldTime = Date.now() - 5000;
      const newTime = Date.now() - 1000;

      cache.set('old', {
        data: 'old-data',
        cachedAt: oldTime,
        ttl: 10000,
      });
      cache.set('new', {
        data: 'new-data',
        cachedAt: newTime,
        ttl: 10000,
      });

      const stats = calculateCacheStats(cache);

      expect(stats.entries).toBe(2);
      expect(stats.oldestEntry).toBe(oldTime);
      expect(stats.newestEntry).toBe(newTime);
    });

    it('빈 캐시 통계', () => {
      const cache = new Map<string, BaseCacheEntry<string>>();
      const stats = calculateCacheStats(cache);

      expect(stats.entries).toBe(0);
      expect(stats.oldestEntry).toBeNull();
      expect(stats.newestEntry).toBeNull();
    });

    it('단일 항목 캐시 통계', () => {
      const cache = new Map<string, BaseCacheEntry<string>>();
      const time = Date.now();

      cache.set('single', {
        data: 'data',
        cachedAt: time,
        ttl: 5000,
      });

      const stats = calculateCacheStats(cache);

      expect(stats.entries).toBe(1);
      expect(stats.oldestEntry).toBe(time);
      expect(stats.newestEntry).toBe(time);
    });
  });

  describe('normalizeKey', () => {
    it('소문자로 변환', () => {
      expect(normalizeKey('PackageName')).toBe('packagename');
    });

    it('언더스코어를 하이픈으로 변환', () => {
      expect(normalizeKey('package_name')).toBe('package-name');
    });

    it('복합 변환', () => {
      expect(normalizeKey('Package_Name_Test')).toBe('package-name-test');
    });

    it('이미 정규화된 키는 그대로', () => {
      expect(normalizeKey('package-name')).toBe('package-name');
    });
  });

  describe('createPendingRequestManager', () => {
    it('기본 동작 테스트', () => {
      const manager = createPendingRequestManager<string>();

      expect(manager.has('key1')).toBe(false);
      expect(manager.size).toBe(0);
    });

    it('요청 등록 및 확인', async () => {
      const manager = createPendingRequestManager<string>();
      const promise = Promise.resolve('result');

      manager.set('key1', promise);

      expect(manager.has('key1')).toBe(true);
      expect(manager.get('key1')).toBe(promise);
      expect(manager.size).toBe(1);
    });

    it('요청 삭제', () => {
      const manager = createPendingRequestManager<string>();
      manager.set('key1', Promise.resolve('result'));

      manager.delete('key1');

      expect(manager.has('key1')).toBe(false);
    });

    it('전체 초기화', () => {
      const manager = createPendingRequestManager<string>();
      manager.set('key1', Promise.resolve('result1'));
      manager.set('key2', Promise.resolve('result2'));

      manager.clear();

      expect(manager.size).toBe(0);
    });

    it('execute - 새 요청 실행', async () => {
      vi.useRealTimers();
      const manager = createPendingRequestManager<string>();
      const fetcher = vi.fn().mockResolvedValue('result');
      const onComplete = vi.fn();

      const result = await manager.execute('key1', fetcher, onComplete);

      expect(result).toBe('result');
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledWith('result');
      expect(manager.has('key1')).toBe(false); // 완료 후 삭제됨
    });

    it('execute - 중복 요청 방지', async () => {
      vi.useRealTimers();
      const manager = createPendingRequestManager<string>();
      let resolveFirst: (value: string) => void;
      const firstPromise = new Promise<string>((resolve) => {
        resolveFirst = resolve;
      });
      const fetcher = vi.fn().mockReturnValue(firstPromise);

      // 첫 번째 요청 시작 (pending)
      const result1Promise = manager.execute('key1', fetcher);

      // 두 번째 요청 (같은 키)
      const result2Promise = manager.execute('key1', fetcher);

      // fetcher는 한 번만 호출되어야 함
      expect(fetcher).toHaveBeenCalledTimes(1);

      // 첫 번째 요청 완료
      resolveFirst!('result');

      const [result1, result2] = await Promise.all([result1Promise, result2Promise]);

      expect(result1).toBe('result');
      expect(result2).toBe('result');
    });

    it('execute - null 결과 처리', async () => {
      vi.useRealTimers();
      const manager = createPendingRequestManager<string>();
      const fetcher = vi.fn().mockResolvedValue(null);
      const onComplete = vi.fn();

      const result = await manager.execute('key1', fetcher, onComplete);

      expect(result).toBeNull();
      expect(onComplete).not.toHaveBeenCalled(); // null일 때는 콜백 호출 안 함
    });

    it('execute - 에러 발생 시 pending에서 제거', async () => {
      vi.useRealTimers();
      const manager = createPendingRequestManager<string>();
      const error = new Error('fetch failed');
      const fetcher = vi.fn().mockRejectedValue(error);

      await expect(manager.execute('key1', fetcher)).rejects.toThrow('fetch failed');
      expect(manager.has('key1')).toBe(false); // 에러 후에도 삭제됨
    });
  });

  describe('isBaseCacheEntry', () => {
    it('유효한 캐시 항목 인식', () => {
      const entry = {
        data: 'test',
        cachedAt: Date.now(),
        ttl: 5000,
      };
      expect(isBaseCacheEntry(entry)).toBe(true);
    });

    it('null은 캐시 항목이 아님', () => {
      expect(isBaseCacheEntry(null)).toBe(false);
    });

    it('undefined는 캐시 항목이 아님', () => {
      expect(isBaseCacheEntry(undefined)).toBe(false);
    });

    it('data 없으면 캐시 항목이 아님', () => {
      const entry = {
        cachedAt: Date.now(),
        ttl: 5000,
      };
      expect(isBaseCacheEntry(entry)).toBe(false);
    });

    it('cachedAt 없으면 캐시 항목이 아님', () => {
      const entry = {
        data: 'test',
        ttl: 5000,
      };
      expect(isBaseCacheEntry(entry)).toBe(false);
    });

    it('ttl 없으면 캐시 항목이 아님', () => {
      const entry = {
        data: 'test',
        cachedAt: Date.now(),
      };
      expect(isBaseCacheEntry(entry)).toBe(false);
    });

    it('cachedAt이 숫자가 아니면 캐시 항목이 아님', () => {
      const entry = {
        data: 'test',
        cachedAt: '2025-01-15',
        ttl: 5000,
      };
      expect(isBaseCacheEntry(entry)).toBe(false);
    });
  });

  describe('상수', () => {
    it('DEFAULT_MEMORY_TTL_MS는 5분', () => {
      expect(DEFAULT_MEMORY_TTL_MS).toBe(5 * 60 * 1000);
    });

    it('DEFAULT_DISK_TTL_MS는 1시간', () => {
      expect(DEFAULT_DISK_TTL_MS).toBe(60 * 60 * 1000);
    });

    it('LONG_DISK_TTL_MS는 24시간', () => {
      expect(LONG_DISK_TTL_MS).toBe(24 * 60 * 60 * 1000);
    });
  });
});
