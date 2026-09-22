import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getDockerDownloader, DockerDownloader } from './docker';

describe('docker downloader', () => {
  let downloader: ReturnType<typeof getDockerDownloader>;

  beforeEach(() => {
    downloader = getDockerDownloader();
  });

  describe('getDockerDownloader', () => {
    it('싱글톤 인스턴스 반환', () => {
      const instance1 = getDockerDownloader();
      const instance2 = getDockerDownloader();
      expect(instance1).toBe(instance2);
    });

    it('type이 docker', () => {
      expect(downloader.type).toBe('docker');
    });
  });

});

// DockerDownloader 클래스 메서드 테스트 (모킹)
describe('DockerDownloader 클래스 메서드 테스트', () => {
  let downloader: DockerDownloader;

  beforeEach(() => {
    vi.clearAllMocks();
    downloader = new DockerDownloader();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('searchPackages', () => {
    it('searchService에 위임', async () => {
      const mockSearchService = {
        searchPackages: vi.fn().mockResolvedValue([
          { name: 'nginx', version: 'latest', type: 'docker' },
          { name: 'alpine', version: 'latest', type: 'docker' },
        ]),
        getVersions: vi.fn(),
        getPackageMetadata: vi.fn(),
      };
      (downloader as any).searchService = mockSearchService;

      const results = await downloader.searchPackages('nginx');

      expect(mockSearchService.searchPackages).toHaveBeenCalledWith('nginx', 'docker.io');
      expect(results.length).toBe(2);
    });

    it('커스텀 레지스트리로 검색', async () => {
      const mockSearchService = {
        searchPackages: vi.fn().mockResolvedValue([]),
        getVersions: vi.fn(),
        getPackageMetadata: vi.fn(),
      };
      (downloader as any).searchService = mockSearchService;

      await downloader.searchPackages('myimage', 'gcr.io');

      expect(mockSearchService.searchPackages).toHaveBeenCalledWith('myimage', 'gcr.io');
    });
  });

  describe('getVersions', () => {
    it('searchService에 위임', async () => {
      const mockSearchService = {
        searchPackages: vi.fn(),
        getVersions: vi.fn().mockResolvedValue(['latest', '1.25.3', '1.25.2']),
        getPackageMetadata: vi.fn(),
      };
      (downloader as any).searchService = mockSearchService;

      const versions = await downloader.getVersions('library/nginx');

      expect(mockSearchService.getVersions).toHaveBeenCalledWith('library/nginx', 'docker.io');
      expect(versions).toContain('latest');
      expect(versions).toContain('1.25.3');
    });
  });

  describe('getPackageMetadata', () => {
    it('searchService에 위임', async () => {
      const mockSearchService = {
        searchPackages: vi.fn(),
        getVersions: vi.fn(),
        getPackageMetadata: vi.fn().mockResolvedValue({
          name: 'nginx',
          version: 'latest',
          type: 'docker',
          metadata: { size: 50000000 },
        }),
      };
      (downloader as any).searchService = mockSearchService;

      const metadata = await downloader.getPackageMetadata('nginx', 'latest');

      expect(mockSearchService.getPackageMetadata).toHaveBeenCalledWith('nginx', 'latest');
      expect(metadata.name).toBe('nginx');
    });
  });

  describe('clearCatalogCache', () => {
    it('catalogCache에 위임', () => {
      const mockCatalogCache = {
        clearCatalogCache: vi.fn(),
        getCatalogCacheStatus: vi.fn(),
        setCatalogCacheTTL: vi.fn(),
        refreshCatalogCache: vi.fn(),
      };
      (downloader as any).catalogCache = mockCatalogCache;

      downloader.clearCatalogCache();

      expect(mockCatalogCache.clearCatalogCache).toHaveBeenCalled();
    });
  });

  describe('getCatalogCacheStatus', () => {
    it('catalogCache에 위임', () => {
      const mockCatalogCache = {
        clearCatalogCache: vi.fn(),
        getCatalogCacheStatus: vi.fn().mockReturnValue([{
          registry: 'docker.io',
          repositoryCount: 50,
          fetchedAt: 1,
          expiresAt: 2,
          isExpired: false,
        }]),
        setCatalogCacheTTL: vi.fn(),
        refreshCatalogCache: vi.fn(),
      };
      (downloader as any).catalogCache = mockCatalogCache;

      const status = downloader.getCatalogCacheStatus();

      expect(mockCatalogCache.getCatalogCacheStatus).toHaveBeenCalled();
      expect(status).toEqual([expect.objectContaining({
        registry: 'docker.io',
        repositoryCount: 50,
        isExpired: false,
      })]);
    });
  });

  describe('setCatalogCacheTTL', () => {
    it('catalogCache에 위임', () => {
      const mockCatalogCache = {
        clearCatalogCache: vi.fn(),
        getCatalogCacheStatus: vi.fn(),
        setCatalogCacheTTL: vi.fn(),
        refreshCatalogCache: vi.fn(),
      };
      (downloader as any).catalogCache = mockCatalogCache;

      downloader.setCatalogCacheTTL(600000);

      expect(mockCatalogCache.setCatalogCacheTTL).toHaveBeenCalledWith(600000);
    });
  });

  describe('refreshCatalogCache', () => {
    it('catalogCache에 위임', async () => {
      const mockCatalogCache = {
        clearCatalogCache: vi.fn(),
        getCatalogCacheStatus: vi.fn(),
        setCatalogCacheTTL: vi.fn(),
        refreshCatalogCache: vi.fn().mockResolvedValue(undefined),
      };
      (downloader as any).catalogCache = mockCatalogCache;

      await downloader.refreshCatalogCache('docker.io');

      expect(mockCatalogCache.refreshCatalogCache).toHaveBeenCalledWith('docker.io');
    });
  });

  describe('verifyChecksum', () => {
    it('blobDownloader에 위임', async () => {
      const mockBlobDownloader = {
        verifyChecksum: vi.fn().mockResolvedValue(true),
        downloadBlob: vi.fn(),
      };
      (downloader as any).blobDownloader = mockBlobDownloader;

      const result = await downloader.verifyChecksum('/path/to/file', 'sha256:abc123');

      expect(mockBlobDownloader.verifyChecksum).toHaveBeenCalledWith('/path/to/file', 'sha256:abc123');
      expect(result).toBe(true);
    });

    it('체크섬 불일치', async () => {
      const mockBlobDownloader = {
        verifyChecksum: vi.fn().mockResolvedValue(false),
        downloadBlob: vi.fn(),
      };
      (downloader as any).blobDownloader = mockBlobDownloader;

      const result = await downloader.verifyChecksum('/path/to/file', 'sha256:wrong');

      expect(result).toBe(false);
    });
  });

  describe('downloadPackage', () => {
    it('downloadImage를 호출', async () => {
      const mockDownloadImage = vi.fn().mockResolvedValue('/path/to/image.tar');
      (downloader as any).downloadImage = mockDownloadImage;

      const result = await downloader.downloadPackage(
        { name: 'nginx', version: 'latest', type: 'docker' },
        '/dest'
      );

      expect(mockDownloadImage).toHaveBeenCalledWith(
        'nginx',
        'latest',
        'amd64',
        '/dest',
        undefined,
        'docker.io',
        undefined
      );
      expect(result).toBe('/path/to/image.tar');
    });

    it('아키텍처 지정', async () => {
      const mockDownloadImage = vi.fn().mockResolvedValue('/path/to/image.tar');
      (downloader as any).downloadImage = mockDownloadImage;

      await downloader.downloadPackage(
        { name: 'nginx', version: 'latest', type: 'docker', arch: 'arm64' },
        '/dest'
      );

      expect(mockDownloadImage).toHaveBeenCalledWith(
        'nginx',
        'latest',
        'arm64',
        '/dest',
        undefined,
        'docker.io',
        undefined
      );
    });

    it('커스텀 레지스트리', async () => {
      const mockDownloadImage = vi.fn().mockResolvedValue('/path/to/image.tar');
      (downloader as any).downloadImage = mockDownloadImage;

      await downloader.downloadPackage(
        {
          name: 'gcr.io/project/myimage',
          version: 'v1.0',
          type: 'docker',
          metadata: { registry: 'gcr.io' },
        },
        '/dest'
      );

      expect(mockDownloadImage).toHaveBeenCalledWith(
        'gcr.io/project/myimage',
        'v1.0',
        'amd64',
        '/dest',
        undefined,
        'gcr.io',
        undefined
      );
    });

    it('전달된 download controls를 downloadImage에 전달', async () => {
      const mockDownloadImage = vi.fn().mockResolvedValue('/path/to/image.tar');
      (downloader as any).downloadImage = mockDownloadImage;
      const controller = new AbortController();
      const controls = { signal: controller.signal, shouldPause: () => false };

      await downloader.downloadPackage(
        { name: 'nginx', version: 'latest', type: 'docker' },
        '/dest',
        undefined,
        controls
      );

      expect(mockDownloadImage).toHaveBeenCalledWith(
        'nginx', 'latest', 'amd64', '/dest', undefined, 'docker.io', controls
      );
    });
  });
});

// Docker 에러 처리 테스트
describe('DockerDownloader 에러 처리', () => {
  let downloader: DockerDownloader;

  beforeEach(() => {
    downloader = new DockerDownloader();
  });

  describe('logDownloadError', () => {
    it('에러 로깅 함수 존재', () => {
      expect(typeof (downloader as any).logDownloadError).toBe('function');
    });

    it('Error 객체 처리', () => {
      expect(() => {
        (downloader as any).logDownloadError(
          new Error('Network Error'),
          'library/nginx',
          'latest',
          'amd64',
          'docker.io'
        );
      }).not.toThrow();
    });

    it('문자열 에러 처리', () => {
      expect(() => {
        (downloader as any).logDownloadError(
          'Connection refused',
          'library/nginx',
          'latest',
          'amd64',
          'docker.io'
        );
      }).not.toThrow();
    });
  });
});

// createProgressTracker 테스트
describe('DockerDownloader createProgressTracker', () => {
  let downloader: DockerDownloader;

  beforeEach(() => {
    downloader = new DockerDownloader();
  });

  describe('createProgressTracker', () => {
    it('총 크기 계산', () => {
      const layers = [
        { size: 1000000 },
        { size: 2000000 },
        { size: 3000000 },
      ];
      const ctx = {
        registry: 'docker.io',
        repository: 'library/nginx',
        tag: 'latest',
        arch: 'amd64' as const,
        destPath: '/dest',
      };

      const tracker = (downloader as any).createProgressTracker(layers, ctx);

      expect(tracker.totalSize).toBe(6000000);
      expect(tracker.downloadedSize).toBe(0);
    });

    it('update 콜백 호출', () => {
      const layers = [{ size: 1000000 }];
      const ctx = {
        registry: 'docker.io',
        repository: 'library/nginx',
        tag: 'latest',
        arch: 'amd64' as const,
        destPath: '/dest',
      };
      const progressCallback = vi.fn();

      const tracker = (downloader as any).createProgressTracker(layers, ctx, progressCallback);
      tracker.update(500000);

      expect(tracker.downloadedSize).toBe(500000);
    });

    it('진행률 업데이트', () => {
      const layers = [{ size: 1000000 }];
      const ctx = {
        registry: 'docker.io',
        repository: 'library/nginx',
        tag: 'latest',
        arch: 'amd64' as const,
        destPath: '/dest',
      };
      const progressCallback = vi.fn();

      const tracker = (downloader as any).createProgressTracker(layers, ctx, progressCallback);
      tracker.update(1000000);

      expect(tracker.downloadedSize).toBe(1000000);
      expect(progressCallback).toHaveBeenCalledWith(expect.objectContaining({
        progress: 100,
        downloadedBytes: 1000000,
        totalBytes: 1000000,
      }));
    });
  });
});

// Docker 타입 테스트
describe('Docker 타입 정의', () => {
  it('type이 docker', () => {
    const downloader = new DockerDownloader();
    expect(downloader.type).toBe('docker');
  });
});
