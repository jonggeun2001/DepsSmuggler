import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CacheManager,
  ArtifactCacheManager,
  getCacheManager,
  initializeCacheManager,
} from './cache-manager';
import { sanitizeCacheKey } from './shared/filename-utils';

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

const createCacheKeyForTest = (packageInfo: {
  type: string;
  name: string;
  version: string;
  arch?: string;
}): string => {
  const keyParts = [
    packageInfo.type,
    packageInfo.name,
    packageInfo.version,
    packageInfo.arch || 'noarch',
  ];
  const hash = crypto
    .createHash('sha256')
    .update(keyParts.join('-'))
    .digest('hex')
    .slice(0, 16);

  return `${packageInfo.type}-${sanitizeCacheKey(packageInfo.name, 50)}-${hash}`;
};

describe('cacheManager', () => {
  it('CacheManager shim은 ArtifactCacheManager를 re-export한다', () => {
    expect(CacheManager).toBe(ArtifactCacheManager);
  });

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

describe('ArtifactCacheManager 클래스', () => {
  let cacheManager: ArtifactCacheManager;
  let testCacheDir: string;

  beforeEach(() => {
    testCacheDir = path.join(os.tmpdir(), `cache-test-${Date.now()}`);
    cacheManager = new ArtifactCacheManager({
      cacheDir: testCacheDir,
      maxSizeGB: 1,
      enabled: true,
    });
  });

  describe('생성자 및 기본 설정', () => {
    it('기본 옵션으로 인스턴스 생성', () => {
      const manager = new ArtifactCacheManager();
      expect(manager.isEnabled()).toBe(true);
    });

    it('사용자 정의 옵션으로 인스턴스 생성', () => {
      const manager = new ArtifactCacheManager({
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

      const disabledManager = new ArtifactCacheManager({
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
describe('ArtifactCacheManager 매니페스트 및 캐시 조작', () => {
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

      const manager = new ArtifactCacheManager({ cacheDir: testCacheDir, enabled: true });
      await manager.initialize();

      const size = await manager.getCacheSize();
      expect(size).toBe(5000);
    });

    it('손상된 매니페스트는 새 매니페스트로 대체', async () => {
      const fs = await import('fs-extra');

      vi.mocked(fs.pathExists).mockResolvedValue(true as never);
      vi.mocked(fs.readJson).mockRejectedValue(new Error('JSON parse error') as never);

      const manager = new ArtifactCacheManager({ cacheDir: testCacheDir, enabled: true });
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

      const manager = new ArtifactCacheManager({
        cacheDir: testCacheDir,
        maxSizeGB: 1,
        enabled: true,
      });

      const packageInfo = { type: 'pip', name: 'requests', version: '2.28.0' } as const;
      const filePath = '/tmp/test-file.whl';

      // addToCache 호출 (비동기로 스트림 이벤트 발생)
      const addPromise = manager.addToCache(packageInfo, filePath);

      // 스트림 이벤트 시뮬레이션
      setImmediate(() => {
        mockStream.emit('data', Buffer.from('test data'));
        mockStream.emit('end');
        mockStream.emit('close');
      });

      await addPromise;

      expect(fs.copy).toHaveBeenCalled();
      expect(fs.writeJson).toHaveBeenCalled();
      expect(await manager.getCacheCount()).toBe(1);
    });

    it('매니페스트 저장 실패를 호출자에게 그대로 전달', async () => {
      const fs = await import('fs-extra');
      const { EventEmitter } = await import('events');

      const mockStream = new EventEmitter();
      vi.mocked(fs.createReadStream).mockReturnValue(mockStream as never);
      vi.mocked(fs.pathExists).mockResolvedValue(false as never);
      vi.mocked(fs.stat).mockResolvedValue({ size: 2000 } as never);
      vi.mocked(fs.writeJson).mockRejectedValueOnce(new Error('disk full') as never);

      const manager = new ArtifactCacheManager({
        cacheDir: testCacheDir,
        maxSizeGB: 1,
        enabled: true,
      });

      const packageInfo = { type: 'pip' as const, name: 'requests', version: '2.28.0' };
      const addPromise = manager.addToCache(packageInfo, '/tmp/test-file.whl');

      setImmediate(() => {
        mockStream.emit('data', Buffer.from('test data'));
        mockStream.emit('end');
        mockStream.emit('close');
      });

      await expect(addPromise).rejects.toThrow('disk full');
      expect(fs.copy).toHaveBeenCalled();
      expect(fs.writeJson).toHaveBeenCalled();
    });
  });

  describe('체크섬 검증 실패', () => {
    it('캐시 삭제가 실패해도 매니페스트 엔트리는 정리한다', async () => {
      const fs = await import('fs-extra');
      const { EventEmitter } = await import('events');

      const packageInfo = {
        type: 'pip' as const,
        name: 'requests',
        version: '2.28.0',
      };
      const cachedFilePath = path.join(testCacheDir, 'pip-requests-test', 'file.whl');
      const cacheKey = createCacheKeyForTest(packageInfo);
      const existingManifest = {
        version: '1.0',
        entries: [
          [
            cacheKey,
            {
              packageInfo,
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
      vi.mocked(fs.remove).mockRejectedValueOnce(new Error('permission denied') as never);

      const mockStream = new EventEmitter();
      vi.mocked(fs.createReadStream).mockReturnValue(mockStream as never);

      const manager = new ArtifactCacheManager({ cacheDir: testCacheDir, enabled: true });
      await manager.initialize();

      const resultPromise = manager.getCachedFile(packageInfo);

      setImmediate(() => {
        mockStream.emit('data', Buffer.from('test'));
        mockStream.emit('end');
        mockStream.emit('close');
      });

      await expect(resultPromise).resolves.toBeNull();
      expect(fs.remove).toHaveBeenCalledWith(path.dirname(cachedFilePath));
      await expect(manager.getCacheCount()).resolves.toBe(0);
      expect(fs.writeJson).toHaveBeenCalled();
    });
  });
});
