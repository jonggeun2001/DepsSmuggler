/**
 * CacheManager 단위 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CacheManager, createMemoryCache, createDiskCache } from './cache-manager';

describe('CacheManager', () => {
  describe('메모리 캐시', () => {
    let cache: CacheManager<string>;

    beforeEach(() => {
      cache = createMemoryCache<string>('test', 5000); // 5초 TTL
    });

    afterEach(() => {
      cache.clear();
    });

    it('set/get으로 값을 저장하고 가져올 수 있어야 함', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('존재하지 않는 키는 undefined를 반환해야 함', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('has로 키 존재 여부를 확인할 수 있어야 함', () => {
      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);
      expect(cache.has('nonexistent')).toBe(false);
    });

    it('delete로 항목을 삭제할 수 있어야 함', () => {
      cache.set('key1', 'value1');
      expect(cache.delete('key1')).toBe(true);
      expect(cache.get('key1')).toBeUndefined();
    });

    it('clear로 모든 항목을 삭제할 수 있어야 함', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.clear();
      expect(cache.size).toBe(0);
    });

    it('size로 항목 수를 확인할 수 있어야 함', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      expect(cache.size).toBe(2);
    });

    it('TTL이 만료되면 undefined를 반환해야 함', async () => {
      const shortCache = createMemoryCache<string>('short', 50); // 50ms TTL
      shortCache.set('key1', 'value1');
      expect(shortCache.get('key1')).toBe('value1');

      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(shortCache.get('key1')).toBeUndefined();
    });

    it('maxSize를 초과하면 가장 오래된 항목이 제거되어야 함', () => {
      const limitedCache = createMemoryCache<string>('limited', 5000, 2);
      limitedCache.set('key1', 'value1');
      limitedCache.set('key2', 'value2');
      limitedCache.set('key3', 'value3');

      expect(limitedCache.size).toBe(2);
      expect(limitedCache.get('key1')).toBeUndefined(); // 가장 오래된 항목 제거됨
      expect(limitedCache.get('key2')).toBe('value2');
      expect(limitedCache.get('key3')).toBe('value3');
    });
  });

  describe('통계', () => {
    let cache: CacheManager<string>;

    beforeEach(() => {
      cache = createMemoryCache<string>('test', 5000);
    });

    afterEach(() => {
      cache.clear();
    });

    it('getStats로 캐시 통계를 조회할 수 있어야 함', () => {
      cache.set('key1', 'value1');
      cache.get('key1'); // hit
      cache.get('nonexistent'); // miss

      const stats = cache.getStats();
      expect(stats.name).toBe('test');
      expect(stats.memoryEntries).toBe(1);
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });
  });

  describe('getOrFetch', () => {
    let cache: CacheManager<string>;

    beforeEach(() => {
      cache = createMemoryCache<string>('test', 5000);
    });

    afterEach(() => {
      cache.clear();
    });

    it('캐시에 없으면 fetcher를 호출해야 함', async () => {
      const fetcher = vi.fn().mockResolvedValue('fetched-value');

      const result = await cache.getOrFetch('key1', fetcher);

      expect(result.data).toBe('fetched-value');
      expect(result.fromCache).toBe(false);
      expect(result.cacheType).toBe('network');
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('캐시에 있으면 fetcher를 호출하지 않아야 함', async () => {
      cache.set('key1', 'cached-value');
      const fetcher = vi.fn().mockResolvedValue('fetched-value');

      const result = await cache.getOrFetch('key1', fetcher);

      expect(result.data).toBe('cached-value');
      expect(result.fromCache).toBe(true);
      expect(result.cacheType).toBe('memory');
      expect(fetcher).not.toHaveBeenCalled();
    });

    it('forceRefresh=true면 캐시를 무시하고 fetcher를 호출해야 함', async () => {
      cache.set('key1', 'cached-value');
      const fetcher = vi.fn().mockResolvedValue('new-value');

      const result = await cache.getOrFetch('key1', fetcher, { forceRefresh: true });

      expect(result.data).toBe('new-value');
      expect(result.fromCache).toBe(false);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('동시 요청 시 fetcher는 1번만 호출되어야 함', async () => {
      let resolvePromise: (value: string) => void;
      const slowPromise = new Promise<string>((resolve) => {
        resolvePromise = resolve;
      });
      const fetcher = vi.fn().mockReturnValue(slowPromise);

      // 동시에 두 번 호출
      const promise1 = cache.getOrFetch('key1', fetcher);
      const promise2 = cache.getOrFetch('key1', fetcher);

      // Promise 해결
      resolvePromise!('value');

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1.data).toBe('value');
      expect(result2.data).toBe('value');
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  });

  describe('prune', () => {
    it('만료된 항목을 정리해야 함', async () => {
      const cache = createMemoryCache<string>('test', 50); // 50ms TTL
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      await new Promise((resolve) => setTimeout(resolve, 60));

      const pruned = cache.prune();
      expect(pruned).toBe(2);
      expect(cache.size).toBe(0);
    });
  });

  describe('순회', () => {
    let cache: CacheManager<string>;

    beforeEach(() => {
      cache = createMemoryCache<string>('test', 5000);
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
    });

    afterEach(() => {
      cache.clear();
    });

    it('keys()로 모든 키를 순회할 수 있어야 함', () => {
      const keys = Array.from(cache.keys());
      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
    });

    it('values()로 모든 값을 순회할 수 있어야 함', () => {
      const values = Array.from(cache.values());
      expect(values).toContain('value1');
      expect(values).toContain('value2');
    });

    it('forEach로 순회할 수 있어야 함', () => {
      const entries: [string, string][] = [];
      cache.forEach((value, key) => entries.push([key, value]));

      expect(entries).toContainEqual(['key1', 'value1']);
      expect(entries).toContainEqual(['key2', 'value2']);
    });
  });

  describe('디스크 캐시', () => {
    const testDir = path.join(os.tmpdir(), 'cache-manager-test-' + Date.now());
    let cache: CacheManager<{ name: string; value: number }>;

    beforeEach(() => {
      cache = createDiskCache<{ name: string; value: number }>(
        'disk-test',
        5000,
        testDir,
        { diskTtlMs: 10000 }
      );
    });

    afterEach(() => {
      cache.clear();
      // 테스트 디렉토리 정리
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true });
      }
    });

    it('디스크에 캐시가 저장되어야 함', () => {
      cache.set('test-key', { name: 'test', value: 42 });

      // 파일이 생성되었는지 확인
      expect(fs.existsSync(testDir)).toBe(true);
      const files = fs.readdirSync(testDir);
      expect(files.length).toBeGreaterThan(0);
    });

    it('디스크 캐시에서 읽을 수 있어야 함', () => {
      cache.set('test-key', { name: 'test', value: 42 });

      // 새 캐시 인스턴스 생성 (메모리 캐시 비움)
      const newCache = createDiskCache<{ name: string; value: number }>(
        'disk-test',
        5000,
        testDir
      );

      // 디스크에서 읽기
      const result = newCache.getFromDisk('test-key');
      expect(result).toEqual({ name: 'test', value: 42 });
    });

    it('delete로 디스크 캐시도 삭제되어야 함', () => {
      cache.set('test-key', { name: 'test', value: 42 });
      cache.delete('test-key');

      const files = fs.existsSync(testDir) ? fs.readdirSync(testDir) : [];
      const hasFile = files.some((f) => f.includes('test-key'));
      expect(hasFile).toBe(false);
    });
  });

  describe('복합 객체 캐싱', () => {
    interface TestData {
      id: number;
      items: string[];
      nested: { a: number; b: string };
    }

    let cache: CacheManager<TestData>;

    beforeEach(() => {
      cache = createMemoryCache<TestData>('complex', 5000);
    });

    afterEach(() => {
      cache.clear();
    });

    it('복합 객체를 저장하고 가져올 수 있어야 함', () => {
      const data: TestData = {
        id: 1,
        items: ['a', 'b', 'c'],
        nested: { a: 10, b: 'hello' },
      };

      cache.set('complex-key', data);
      const result = cache.get('complex-key');

      expect(result).toEqual(data);
    });
  });
});
