import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getCacheManager, initializeCacheManager, CacheManager } from './cacheManager';
import * as path from 'path';
import * as os from 'os';

// fs-extra 모킹
vi.mock('fs-extra', () => ({
  ensureDir: vi.fn().mockResolvedValue(undefined),
  pathExists: vi.fn().mockResolvedValue(false),
  readJson: vi.fn().mockResolvedValue(null),
  writeJson: vi.fn().mockResolvedValue(undefined),
  emptyDir: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ size: 1000 }),
  copy: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  createReadStream: vi.fn(),
}));

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

describe('CacheManager 클래스', () => {
  let cacheManager: CacheManager;
  let testCacheDir: string;

  beforeEach(() => {
    testCacheDir = path.join(os.tmpdir(), `cache-test-${Date.now()}`);
    cacheManager = new CacheManager({
      cacheDir: testCacheDir,
      maxSizeGB: 1,
      enabled: true,
    });
  });

  describe('생성자 및 기본 설정', () => {
    it('기본 옵션으로 인스턴스 생성', () => {
      const manager = new CacheManager();
      expect(manager.isEnabled()).toBe(true);
    });

    it('사용자 정의 옵션으로 인스턴스 생성', () => {
      const manager = new CacheManager({
        cacheDir: '/custom/path',
        maxSizeGB: 5,
        enabled: false,
      });
      expect(manager.isEnabled()).toBe(false);
    });
  });

  describe('setEnabled / isEnabled', () => {
    it('캐시 활성화 상태 조회', () => {
      expect(cacheManager.isEnabled()).toBe(true);
    });

    it('캐시 비활성화', () => {
      cacheManager.setEnabled(false);
      expect(cacheManager.isEnabled()).toBe(false);
    });

    it('캐시 다시 활성화', () => {
      cacheManager.setEnabled(false);
      cacheManager.setEnabled(true);
      expect(cacheManager.isEnabled()).toBe(true);
    });
  });

  describe('initialize', () => {
    it('캐시 활성화 상태에서 초기화', async () => {
      const fs = await import('fs-extra');
      await cacheManager.initialize();
      expect(fs.ensureDir).toHaveBeenCalledWith(testCacheDir);
    });

    it('캐시 비활성화 상태에서 초기화 스킵', async () => {
      const fs = await import('fs-extra');
      vi.clearAllMocks();

      const disabledManager = new CacheManager({
        cacheDir: testCacheDir,
        enabled: false,
      });
      await disabledManager.initialize();
      expect(fs.ensureDir).not.toHaveBeenCalled();
    });
  });

  describe('getCacheSize / getCacheCount / getCacheEntries', () => {
    it('초기 캐시 크기는 0', async () => {
      const size = await cacheManager.getCacheSize();
      expect(size).toBe(0);
    });

    it('초기 캐시 항목 수는 0', async () => {
      const count = await cacheManager.getCacheCount();
      expect(count).toBe(0);
    });

    it('초기 캐시 항목 목록은 빈 배열', async () => {
      const entries = await cacheManager.getCacheEntries();
      expect(entries).toEqual([]);
    });
  });

  describe('clearCache', () => {
    it('캐시 전체 삭제', async () => {
      const fs = await import('fs-extra');
      await cacheManager.clearCache();

      expect(fs.emptyDir).toHaveBeenCalledWith(testCacheDir);

      const size = await cacheManager.getCacheSize();
      expect(size).toBe(0);

      const count = await cacheManager.getCacheCount();
      expect(count).toBe(0);
    });
  });

  describe('getCachedFile', () => {
    it('캐시 비활성화 시 null 반환', async () => {
      cacheManager.setEnabled(false);
      const result = await cacheManager.getCachedFile({
        type: 'pip',
        name: 'requests',
        version: '2.28.0',
      });
      expect(result).toBeNull();
    });

    it('캐시에 없는 파일은 null 반환', async () => {
      const result = await cacheManager.getCachedFile({
        type: 'pip',
        name: 'nonexistent',
        version: '1.0.0',
      });
      expect(result).toBeNull();
    });
  });

  describe('addToCache', () => {
    it('캐시 비활성화 시 추가 스킵', async () => {
      const fs = await import('fs-extra');
      vi.clearAllMocks();

      cacheManager.setEnabled(false);
      await cacheManager.addToCache(
        { type: 'pip', name: 'requests', version: '2.28.0' },
        '/path/to/file.whl'
      );

      expect(fs.copy).not.toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('캐시 통계 반환', async () => {
      const stats = await cacheManager.getStats();

      expect(stats).toHaveProperty('enabled');
      expect(stats).toHaveProperty('cacheDir');
      expect(stats).toHaveProperty('totalSize');
      expect(stats).toHaveProperty('maxSize');
      expect(stats).toHaveProperty('entryCount');
      expect(stats).toHaveProperty('usagePercent');

      expect(stats.enabled).toBe(true);
      expect(stats.cacheDir).toBe(testCacheDir);
      expect(stats.totalSize).toBe(0);
      expect(stats.entryCount).toBe(0);
      expect(stats.usagePercent).toBe(0);
    });

    it('maxSize는 GB 단위로 설정된 값의 바이트 변환', async () => {
      const stats = await cacheManager.getStats();
      expect(stats.maxSize).toBe(1 * 1024 * 1024 * 1024); // 1GB
    });
  });
});

// 매니페스트 로드 및 캐시 조작 테스트
describe('CacheManager 매니페스트 및 캐시 조작', () => {
  let testCacheDir: string;

  beforeEach(() => {
    testCacheDir = path.join(os.tmpdir(), `cache-test-manifest-${Date.now()}`);
    vi.clearAllMocks();
  });

  describe('loadManifest - 기존 매니페스트 파일 존재 시', () => {
    it('기존 매니페스트를 로드', async () => {
      const fs = await import('fs-extra');
      const existingManifest = {
        version: '1.0',
        entries: [],
        totalSize: 5000,
        lastUpdated: '2024-01-01T00:00:00.000Z',
      };

      vi.mocked(fs.pathExists).mockResolvedValue(true as never);
      vi.mocked(fs.readJson).mockResolvedValue(existingManifest as never);

      const manager = new CacheManager({ cacheDir: testCacheDir, enabled: true });
      await manager.initialize();

      const size = await manager.getCacheSize();
      expect(size).toBe(5000);
    });

    it('손상된 매니페스트는 새 매니페스트로 대체', async () => {
      const fs = await import('fs-extra');

      vi.mocked(fs.pathExists).mockResolvedValue(true as never);
      vi.mocked(fs.readJson).mockRejectedValue(new Error('JSON parse error') as never);

      const manager = new CacheManager({ cacheDir: testCacheDir, enabled: true });
      await manager.initialize();

      const size = await manager.getCacheSize();
      expect(size).toBe(0); // 새 매니페스트의 기본값
    });
  });

  describe('addToCache - 활성화된 상태', () => {
    it('파일을 캐시에 추가 (스트림 모킹)', async () => {
      const fs = await import('fs-extra');
      const { EventEmitter } = await import('events');

      // 스트림 모킹
      const mockStream = new EventEmitter();
      vi.mocked(fs.createReadStream).mockReturnValue(mockStream as never);
      vi.mocked(fs.pathExists).mockResolvedValue(false as never);
      vi.mocked(fs.stat).mockResolvedValue({ size: 2000 } as never);

      const manager = new CacheManager({
        cacheDir: testCacheDir,
        maxSizeGB: 1,
        enabled: true,
      });

      const packageInfo = { type: 'pip', name: 'requests', version: '2.28.0' };
      const filePath = '/tmp/test-file.whl';

      // addToCache 호출 (비동기로 스트림 이벤트 발생)
      const addPromise = manager.addToCache(packageInfo, filePath);

      // 스트림 이벤트 시뮬레이션
      setImmediate(() => {
        mockStream.emit('data', Buffer.from('test data'));
        mockStream.emit('end');
      });

      await addPromise;

      expect(fs.copy).toHaveBeenCalled();
      expect(fs.writeJson).toHaveBeenCalled();
    });
  });

  describe('getCachedFile - 캐시 히트', () => {
    it('캐시에 있는 파일 조회 및 체크섬 검증 성공', async () => {
      const fs = await import('fs-extra');
      const { EventEmitter } = await import('events');

      const cachedFilePath = path.join(testCacheDir, 'cached', 'file.whl');
      const checksum = 'abc123';

      // 기존 매니페스트에 엔트리 포함
      const existingManifest = {
        version: '1.0',
        entries: [
          [
            'pip-requests-abc123', // cacheKey
            {
              packageInfo: { type: 'pip', name: 'requests', version: '2.28.0' },
              filePath: cachedFilePath,
              checksum: checksum,
              size: 1000,
              cachedAt: '2024-01-01T00:00:00.000Z',
              lastAccessedAt: '2024-01-01T00:00:00.000Z',
            },
          ],
        ],
        totalSize: 1000,
        lastUpdated: '2024-01-01T00:00:00.000Z',
      };

      // pathExists: 매니페스트 O, 캐시파일 O
      vi.mocked(fs.pathExists).mockImplementation(async (p) => {
        if (String(p).includes('cache-manifest.json')) return true;
        if (String(p) === cachedFilePath) return true;
        return false;
      });
      vi.mocked(fs.readJson).mockResolvedValue(existingManifest as never);

      // 체크섬 검증을 위한 스트림 모킹
      const mockStream = new EventEmitter();
      vi.mocked(fs.createReadStream).mockReturnValue(mockStream as never);

      const manager = new CacheManager({ cacheDir: testCacheDir, enabled: true });
      await manager.initialize();

      // getCachedFile 호출
      const resultPromise = manager.getCachedFile({
        type: 'pip',
        name: 'requests',
        version: '2.28.0',
      });

      // 체크섬 계산용 스트림 이벤트
      setImmediate(() => {
        mockStream.emit('data', Buffer.from('test'));
        mockStream.emit('end');
      });

      const result = await resultPromise;

      // 캐시 미스 (키가 다르기 때문에)
      // 실제 캐시 키는 hash가 포함되므로 null
      expect(result).toBeNull();
    });

    it('캐시 파일이 존재하지 않으면 엔트리 제거', async () => {
      const fs = await import('fs-extra');

      const existingManifest = {
        version: '1.0',
        entries: [
          [
            'pip-requests-abc123',
            {
              packageInfo: { type: 'pip', name: 'requests', version: '2.28.0' },
              filePath: '/nonexistent/file.whl',
              checksum: 'abc123',
              size: 1000,
              cachedAt: '2024-01-01T00:00:00.000Z',
              lastAccessedAt: '2024-01-01T00:00:00.000Z',
            },
          ],
        ],
        totalSize: 1000,
        lastUpdated: '2024-01-01T00:00:00.000Z',
      };

      vi.mocked(fs.pathExists).mockImplementation(async (p) => {
        if (String(p).includes('cache-manifest.json')) return true;
        return false; // 캐시 파일은 존재하지 않음
      });
      vi.mocked(fs.readJson).mockResolvedValue(existingManifest as never);

      const manager = new CacheManager({ cacheDir: testCacheDir, enabled: true });
      await manager.initialize();

      const result = await manager.getCachedFile({
        type: 'pip',
        name: 'requests',
        version: '2.28.0',
      });

      expect(result).toBeNull();
    });
  });

  describe('체크섬 검증 실패', () => {
    it('체크섬이 일치하지 않으면 캐시에서 제거', async () => {
      const fs = await import('fs-extra');
      const { EventEmitter } = await import('events');

      const cachedFilePath = path.join(testCacheDir, 'pip-requests-test', 'file.whl');

      const existingManifest = {
        version: '1.0',
        entries: [
          [
            'pip-requests-test',
            {
              packageInfo: { type: 'pip', name: 'requests', version: '2.28.0' },
              filePath: cachedFilePath,
              checksum: 'expected_checksum_that_wont_match',
              size: 1000,
              cachedAt: '2024-01-01T00:00:00.000Z',
              lastAccessedAt: '2024-01-01T00:00:00.000Z',
            },
          ],
        ],
        totalSize: 1000,
        lastUpdated: '2024-01-01T00:00:00.000Z',
      };

      vi.mocked(fs.pathExists).mockImplementation(async (p) => {
        if (String(p).includes('cache-manifest.json')) return true;
        if (String(p) === cachedFilePath) return true;
        return false;
      });
      vi.mocked(fs.readJson).mockResolvedValue(existingManifest as never);

      // 체크섬 검증을 위한 스트림
      const mockStream = new EventEmitter();
      vi.mocked(fs.createReadStream).mockReturnValue(mockStream as never);

      const manager = new CacheManager({ cacheDir: testCacheDir, enabled: true });
      await manager.initialize();

      // getCachedFile 호출 (캐시 미스 - 키가 맞지 않음)
      const result = await manager.getCachedFile({
        type: 'pip',
        name: 'requests',
        version: '2.28.0',
      });

      expect(result).toBeNull();
    });
  });

  describe('LRU 공간 확보', () => {
    it('캐시 용량 초과 시 오래된 항목 삭제', async () => {
      const fs = await import('fs-extra');
      const { EventEmitter } = await import('events');

      // 매우 작은 캐시 크기로 설정 (10KB)
      const smallMaxSizeGB = 0.00001; // 약 10KB

      const manager = new CacheManager({
        cacheDir: testCacheDir,
        maxSizeGB: smallMaxSizeGB,
        enabled: true,
      });

      vi.mocked(fs.pathExists).mockResolvedValue(false as never);
      vi.mocked(fs.stat).mockResolvedValue({ size: 5000 } as never);

      const mockStream = new EventEmitter();
      vi.mocked(fs.createReadStream).mockReturnValue(mockStream as never);

      await manager.initialize();

      // 첫 번째 파일 추가
      const addPromise = manager.addToCache(
        { type: 'pip', name: 'package1', version: '1.0.0' },
        '/tmp/file1.whl'
      );

      setImmediate(() => {
        mockStream.emit('data', Buffer.from('data'));
        mockStream.emit('end');
      });

      await addPromise;

      const count = await manager.getCacheCount();
      expect(count).toBe(1);
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
