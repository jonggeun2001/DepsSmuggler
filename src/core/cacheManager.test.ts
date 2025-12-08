import { describe, it, expect, beforeEach } from 'vitest';
import { getCacheManager, initializeCacheManager } from './cacheManager';

describe('cacheManager', () => {
  describe('getCacheManager', () => {
    it('싱글톤 인스턴스 반환', () => {
      const instance1 = getCacheManager();
      const instance2 = getCacheManager();
      expect(instance1).toBe(instance2);
    });
  });

  describe('initializeCacheManager', () => {
    it('초기화 후 인스턴스 반환', async () => {
      const manager = await initializeCacheManager();
      expect(manager).toBeDefined();
    });
  });
});

// 캐시 매니저 유틸리티 로직 테스트
describe('cacheManager utilities', () => {
  describe('cache key generation', () => {
    // 캐시 키 생성 로직
    const generateCacheKey = (
      packageType: string,
      packageName: string,
      version: string,
      arch?: string
    ): string => {
      const parts = [packageType, packageName, version];
      if (arch) {
        parts.push(arch);
      }
      return parts.join(':');
    };

    const parseCacheKey = (
      key: string
    ): { type: string; name: string; version: string; arch?: string } | null => {
      const parts = key.split(':');
      if (parts.length < 3) return null;
      return {
        type: parts[0],
        name: parts[1],
        version: parts[2],
        arch: parts[3],
      };
    };

    it('기본 캐시 키 생성', () => {
      expect(generateCacheKey('pip', 'requests', '2.28.0')).toBe('pip:requests:2.28.0');
    });

    it('아키텍처 포함 캐시 키 생성', () => {
      expect(generateCacheKey('yum', 'httpd', '2.4.6', 'x86_64')).toBe('yum:httpd:2.4.6:x86_64');
    });

    it('캐시 키 파싱', () => {
      const result = parseCacheKey('pip:requests:2.28.0');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('pip');
      expect(result!.name).toBe('requests');
      expect(result!.version).toBe('2.28.0');
    });

    it('아키텍처 포함 캐시 키 파싱', () => {
      const result = parseCacheKey('yum:httpd:2.4.6:x86_64');
      expect(result!.arch).toBe('x86_64');
    });

    it('잘못된 캐시 키 파싱', () => {
      const result = parseCacheKey('invalid');
      expect(result).toBeNull();
    });
  });

  describe('file name sanitization', () => {
    const sanitizeFileName = (name: string): string => {
      // 파일명에 사용할 수 없는 문자 제거/변환
      return name
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_{2,}/g, '_')
        .replace(/^_+|_+$/g, '');
    };

    it('슬래시 변환', () => {
      expect(sanitizeFileName('org/project/name')).toBe('org_project_name');
    });

    it('콜론 변환', () => {
      expect(sanitizeFileName('org:project:name')).toBe('org_project_name');
    });

    it('공백 변환', () => {
      expect(sanitizeFileName('my package name')).toBe('my_package_name');
    });

    it('연속 언더스코어 정리', () => {
      expect(sanitizeFileName('name//path')).toBe('name_path');
    });

    it('앞뒤 언더스코어 제거', () => {
      expect(sanitizeFileName('/name/')).toBe('name');
    });

    it('특수문자 제거', () => {
      expect(sanitizeFileName('name<>:"|?*test')).toBe('name_test');
    });
  });

  describe('checksum validation', () => {
    const isValidChecksum = (checksum: string, algorithm: 'sha256' | 'sha1' | 'md5'): boolean => {
      const lengths: Record<string, number> = {
        sha256: 64,
        sha1: 40,
        md5: 32,
      };
      const expectedLength = lengths[algorithm];
      if (!expectedLength) return false;
      return checksum.length === expectedLength && /^[a-f0-9]+$/i.test(checksum);
    };

    it('유효한 sha256', () => {
      expect(isValidChecksum('a'.repeat(64), 'sha256')).toBe(true);
    });

    it('유효한 sha1', () => {
      expect(isValidChecksum('a'.repeat(40), 'sha1')).toBe(true);
    });

    it('유효한 md5', () => {
      expect(isValidChecksum('a'.repeat(32), 'md5')).toBe(true);
    });

    it('잘못된 길이', () => {
      expect(isValidChecksum('a'.repeat(50), 'sha256')).toBe(false);
    });

    it('잘못된 문자', () => {
      expect(isValidChecksum('g'.repeat(64), 'sha256')).toBe(false);
    });
  });

  describe('cache entry structure', () => {
    interface CacheEntry {
      key: string;
      filePath: string;
      size: number;
      checksum: string;
      algorithm: string;
      createdAt: Date;
      lastAccessedAt: Date;
      accessCount: number;
    }

    const createCacheEntry = (
      key: string,
      filePath: string,
      size: number,
      checksum: string
    ): CacheEntry => {
      const now = new Date();
      return {
        key,
        filePath,
        size,
        checksum,
        algorithm: 'sha256',
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 0,
      };
    };

    const updateAccessTime = (entry: CacheEntry): CacheEntry => {
      return {
        ...entry,
        lastAccessedAt: new Date(),
        accessCount: entry.accessCount + 1,
      };
    };

    it('캐시 엔트리 생성', () => {
      const entry = createCacheEntry('pip:requests:2.28.0', '/cache/file.whl', 1000, 'abc');
      expect(entry.key).toBe('pip:requests:2.28.0');
      expect(entry.size).toBe(1000);
      expect(entry.accessCount).toBe(0);
    });

    it('접근 시간 업데이트', () => {
      const entry = createCacheEntry('pip:requests:2.28.0', '/cache/file.whl', 1000, 'abc');
      const updated = updateAccessTime(entry);
      expect(updated.accessCount).toBe(1);
      expect(updated.lastAccessedAt.getTime()).toBeGreaterThanOrEqual(entry.lastAccessedAt.getTime());
    });
  });

  describe('cache size management', () => {
    const bytesToGB = (bytes: number): number => {
      return bytes / (1024 * 1024 * 1024);
    };

    const gbToBytes = (gb: number): number => {
      return gb * 1024 * 1024 * 1024;
    };

    const formatCacheSize = (bytes: number): string => {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    };

    it('바이트를 GB로 변환', () => {
      expect(bytesToGB(1073741824)).toBe(1);
    });

    it('GB를 바이트로 변환', () => {
      expect(gbToBytes(1)).toBe(1073741824);
    });

    it('캐시 크기 포맷팅 - 바이트', () => {
      expect(formatCacheSize(500)).toBe('500 B');
    });

    it('캐시 크기 포맷팅 - KB', () => {
      expect(formatCacheSize(1500)).toBe('1.5 KB');
    });

    it('캐시 크기 포맷팅 - MB', () => {
      expect(formatCacheSize(1500000)).toBe('1.4 MB');
    });

    it('캐시 크기 포맷팅 - GB', () => {
      expect(formatCacheSize(1500000000)).toBe('1.40 GB');
    });
  });

  describe('LRU eviction logic', () => {
    interface CacheEntry {
      key: string;
      size: number;
      lastAccessedAt: Date;
    }

    const sortByLRU = (entries: CacheEntry[]): CacheEntry[] => {
      return [...entries].sort(
        (a, b) => a.lastAccessedAt.getTime() - b.lastAccessedAt.getTime()
      );
    };

    const selectForEviction = (
      entries: CacheEntry[],
      targetBytes: number
    ): CacheEntry[] => {
      const sorted = sortByLRU(entries);
      const toEvict: CacheEntry[] = [];
      let freedBytes = 0;

      for (const entry of sorted) {
        if (freedBytes >= targetBytes) break;
        toEvict.push(entry);
        freedBytes += entry.size;
      }

      return toEvict;
    };

    it('LRU 정렬', () => {
      const now = Date.now();
      const entries: CacheEntry[] = [
        { key: 'b', size: 100, lastAccessedAt: new Date(now - 1000) },
        { key: 'a', size: 100, lastAccessedAt: new Date(now - 2000) },
        { key: 'c', size: 100, lastAccessedAt: new Date(now) },
      ];
      const sorted = sortByLRU(entries);
      expect(sorted[0].key).toBe('a');
      expect(sorted[1].key).toBe('b');
      expect(sorted[2].key).toBe('c');
    });

    it('삭제 대상 선택', () => {
      const now = Date.now();
      const entries: CacheEntry[] = [
        { key: 'a', size: 500, lastAccessedAt: new Date(now - 3000) },
        { key: 'b', size: 300, lastAccessedAt: new Date(now - 2000) },
        { key: 'c', size: 200, lastAccessedAt: new Date(now - 1000) },
      ];
      const toEvict = selectForEviction(entries, 700);
      expect(toEvict.length).toBe(2);
      expect(toEvict[0].key).toBe('a');
      expect(toEvict[1].key).toBe('b');
    });

    it('필요한 만큼만 삭제', () => {
      const now = Date.now();
      const entries: CacheEntry[] = [
        { key: 'a', size: 1000, lastAccessedAt: new Date(now - 2000) },
        { key: 'b', size: 500, lastAccessedAt: new Date(now - 1000) },
      ];
      const toEvict = selectForEviction(entries, 800);
      expect(toEvict.length).toBe(1);
      expect(toEvict[0].key).toBe('a');
    });
  });

  describe('manifest structure', () => {
    interface CacheManifest {
      version: string;
      createdAt: string;
      entries: Record<
        string,
        {
          filePath: string;
          size: number;
          checksum: string;
          createdAt: string;
          lastAccessedAt: string;
        }
      >;
      totalSize: number;
    }

    const createEmptyManifest = (): CacheManifest => {
      return {
        version: '1.0',
        createdAt: new Date().toISOString(),
        entries: {},
        totalSize: 0,
      };
    };

    const calculateTotalSize = (manifest: CacheManifest): number => {
      return Object.values(manifest.entries).reduce((sum, entry) => sum + entry.size, 0);
    };

    it('빈 매니페스트 생성', () => {
      const manifest = createEmptyManifest();
      expect(manifest.version).toBe('1.0');
      expect(Object.keys(manifest.entries).length).toBe(0);
      expect(manifest.totalSize).toBe(0);
    });

    it('총 크기 계산', () => {
      const manifest: CacheManifest = {
        version: '1.0',
        createdAt: new Date().toISOString(),
        entries: {
          key1: {
            filePath: '/a',
            size: 1000,
            checksum: 'abc',
            createdAt: '',
            lastAccessedAt: '',
          },
          key2: {
            filePath: '/b',
            size: 2000,
            checksum: 'def',
            createdAt: '',
            lastAccessedAt: '',
          },
        },
        totalSize: 3000,
      };
      expect(calculateTotalSize(manifest)).toBe(3000);
    });
  });

  describe('cache path resolution', () => {
    const DEFAULT_CACHE_DIR = '.depssmuggler/cache';

    const resolveCachePath = (basePath: string, key: string): string => {
      const sanitizedKey = key.replace(/[<>:"/\\|?*]/g, '_');
      return `${basePath}/${DEFAULT_CACHE_DIR}/${sanitizedKey}`;
    };

    const getPackageCacheDir = (basePath: string, packageType: string): string => {
      return `${basePath}/${DEFAULT_CACHE_DIR}/${packageType}`;
    };

    it('캐시 경로 해석', () => {
      expect(resolveCachePath('/home/user', 'pip:requests:2.28.0')).toBe(
        '/home/user/.depssmuggler/cache/pip_requests_2.28.0'
      );
    });

    it('패키지 타입별 캐시 디렉토리', () => {
      expect(getPackageCacheDir('/home/user', 'pip')).toBe('/home/user/.depssmuggler/cache/pip');
    });
  });

  describe('cache statistics', () => {
    interface CacheStats {
      totalSize: number;
      entryCount: number;
      hitCount: number;
      missCount: number;
      hitRate: number;
    }

    const calculateHitRate = (hits: number, misses: number): number => {
      const total = hits + misses;
      if (total === 0) return 0;
      return hits / total;
    };

    const createStats = (
      entries: Array<{ size: number }>,
      hits: number,
      misses: number
    ): CacheStats => {
      const totalSize = entries.reduce((sum, e) => sum + e.size, 0);
      return {
        totalSize,
        entryCount: entries.length,
        hitCount: hits,
        missCount: misses,
        hitRate: calculateHitRate(hits, misses),
      };
    };

    it('히트율 계산', () => {
      expect(calculateHitRate(80, 20)).toBe(0.8);
    });

    it('히트율 0% (모두 미스)', () => {
      expect(calculateHitRate(0, 100)).toBe(0);
    });

    it('히트율 100% (모두 히트)', () => {
      expect(calculateHitRate(100, 0)).toBe(1);
    });

    it('히트 0, 미스 0', () => {
      expect(calculateHitRate(0, 0)).toBe(0);
    });

    it('통계 생성', () => {
      const stats = createStats([{ size: 1000 }, { size: 2000 }], 50, 50);
      expect(stats.totalSize).toBe(3000);
      expect(stats.entryCount).toBe(2);
      expect(stats.hitRate).toBe(0.5);
    });
  });
});
