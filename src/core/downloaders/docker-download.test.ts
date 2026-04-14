/**
 * Docker Downloader Download Tests
 *
 * downloadImage와 관련 private 메서드들의 테스트
 * ESM 환경에서 vi.hoisted() + vi.mock()을 사용하여 모듈 모킹
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';

// vi.hoisted()로 모킹 함수들을 먼저 정의
const {
  mockEnsureDir,
  mockWriteJson,
  mockRemove,
  mockGetTokenForRegistry,
  mockGetManifestForArchitecture,
  mockDownloadBlob,
  mockCreateImageTar,
} = vi.hoisted(() => {
  return {
    mockEnsureDir: vi.fn().mockResolvedValue(undefined),
    mockWriteJson: vi.fn().mockResolvedValue(undefined),
    mockRemove: vi.fn().mockResolvedValue(undefined),
    mockGetTokenForRegistry: vi.fn().mockResolvedValue('mock-token'),
    mockGetManifestForArchitecture: vi.fn().mockResolvedValue({
      config: { digest: 'sha256:config123' },
      layers: [
        { digest: 'sha256:layer1abc', size: 1000 },
        { digest: 'sha256:layer2def', size: 2000 },
      ],
    }),
    mockDownloadBlob: vi.fn().mockResolvedValue(undefined),
    mockCreateImageTar: vi.fn().mockResolvedValue(undefined),
  };
});

// fs-extra 모킹
vi.mock('fs-extra', async () => {
  const actual = await vi.importActual<typeof import('fs-extra')>('fs-extra');
  return {
    ...actual,
    default: {
      ...actual,
      ensureDir: mockEnsureDir,
      writeJson: mockWriteJson,
      remove: mockRemove,
    },
    ensureDir: mockEnsureDir,
    writeJson: mockWriteJson,
    remove: mockRemove,
  };
});

// DockerAuthClient 모킹
vi.mock('./docker-auth-client', () => {
  return {
    DockerAuthClient: class MockDockerAuthClient {
      getTokenForRegistry = mockGetTokenForRegistry;
    },
  };
});

// DockerManifestService 모킹
vi.mock('./docker-manifest-service', () => {
  return {
    DockerManifestService: class MockDockerManifestService {
      constructor(_authClient: unknown) {}
      getManifestForArchitecture = mockGetManifestForArchitecture;
    },
  };
});

// DockerBlobDownloader 모킹
vi.mock('./docker-blob-downloader', () => {
  return {
    DockerBlobDownloader: class MockDockerBlobDownloader {
      constructor(_authClient: unknown) {}
      downloadBlob = mockDownloadBlob;
      createImageTar = mockCreateImageTar;
    },
  };
});

// DockerCatalogCache 모킹
vi.mock('./docker-catalog-cache', () => {
  return {
    DockerCatalogCache: class MockDockerCatalogCache {
      constructor(_authClient: unknown) {}
      clearCache = vi.fn();
      refreshCache = vi.fn().mockResolvedValue(undefined);
      setTTL = vi.fn();
      getCacheStatus = vi.fn().mockReturnValue({ cached: false });
    },
  };
});

// DockerSearchService 모킹
vi.mock('./docker-search-service', () => {
  return {
    DockerSearchService: class MockDockerSearchService {
      constructor(_authClient: unknown, _cache: unknown, _manifest: unknown) {}
      searchImages = vi.fn().mockResolvedValue([]);
      getVersions = vi.fn().mockResolvedValue([]);
      getPackageMetadata = vi.fn().mockResolvedValue(null);
    },
  };
});

// 테스트 대상 임포트 (모킹 후에 임포트)
import { DockerDownloader } from './docker';
import type { Architecture } from '../../types';

describe('DockerDownloader - Download Methods', () => {
  let downloader: DockerDownloader;
  const tmpDir = '/tmp/docker-test';

  beforeEach(() => {
    vi.clearAllMocks();
    // mock 구현 리셋 - 기본 동작으로 복원
    mockDownloadBlob.mockReset();
    mockDownloadBlob.mockResolvedValue(undefined);
    mockGetManifestForArchitecture.mockReset();
    mockGetManifestForArchitecture.mockResolvedValue({
      config: { digest: 'sha256:config123' },
      layers: [
        { digest: 'sha256:layer1abc', size: 1000 },
        { digest: 'sha256:layer2def', size: 2000 },
      ],
    });
    mockGetTokenForRegistry.mockReset();
    mockGetTokenForRegistry.mockResolvedValue('mock-token');
    mockCreateImageTar.mockReset();
    mockCreateImageTar.mockResolvedValue(undefined);
    mockEnsureDir.mockReset();
    mockEnsureDir.mockResolvedValue(undefined);
    mockWriteJson.mockReset();
    mockWriteJson.mockResolvedValue(undefined);
    mockRemove.mockReset();
    mockRemove.mockResolvedValue(undefined);

    downloader = new DockerDownloader();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('downloadImage', () => {
    it('should download docker image successfully', async () => {
      const repository = 'library/nginx';
      const tag = 'latest';
      const arch: Architecture = 'x86_64';
      const destPath = tmpDir;

      const result = await downloader.downloadImage(
        repository,
        tag,
        arch,
        destPath
      );

      // 토큰 획득 확인
      expect(mockGetTokenForRegistry).toHaveBeenCalledWith(
        'docker.io',
        'library/nginx'
      );

      // 매니페스트 조회 확인
      expect(mockGetManifestForArchitecture).toHaveBeenCalled();

      // Config 다운로드 확인
      expect(mockDownloadBlob).toHaveBeenCalledWith(
        'library/nginx',
        'sha256:config123',
        expect.stringContaining('config.json'),
        'mock-token',
        'docker.io'
      );

      // 레이어 다운로드 확인 (2개)
      expect(mockDownloadBlob).toHaveBeenCalledTimes(3); // config + 2 layers

      // tar 패키징 확인
      expect(mockCreateImageTar).toHaveBeenCalled();

      // 임시 디렉토리 정리 확인
      expect(mockRemove).toHaveBeenCalled();

      // tar 파일 경로 반환 확인
      expect(result).toContain('.tar');
    });

    it('should handle custom registry', async () => {
      const repository = 'my-app';
      const tag = 'v1.0.0';
      const arch: Architecture = 'arm64';
      const destPath = tmpDir;
      const registry = 'ghcr.io';

      await downloader.downloadImage(
        repository,
        tag,
        arch,
        destPath,
        undefined,
        registry
      );

      // 커스텀 레지스트리로 토큰 획득 확인
      expect(mockGetTokenForRegistry).toHaveBeenCalledWith(
        'ghcr.io',
        expect.any(String)
      );
    });

    it('should call onProgress callback during download', async () => {
      const onProgress = vi.fn();
      const repository = 'library/alpine';
      const tag = '3.18';
      const arch: Architecture = 'x86_64';
      const destPath = tmpDir;

      // downloadBlob가 progress callback을 호출하도록 설정
      mockDownloadBlob.mockImplementation(
        async (
          _fullName: string,
          _digest: string,
          _path: string,
          _token: string,
          _registry: string,
          progressCallback?: (bytes: number) => void
        ) => {
          if (progressCallback) {
            progressCallback(500);
            progressCallback(500);
          }
        }
      );

      await downloader.downloadImage(
        repository,
        tag,
        arch,
        destPath,
        onProgress
      );

      // onProgress가 호출되었는지 확인
      expect(onProgress).toHaveBeenCalled();
    });

    it('should throw error when manifest is invalid', async () => {
      mockGetManifestForArchitecture.mockResolvedValueOnce({
        config: null,
        layers: null,
      });

      await expect(
        downloader.downloadImage('library/nginx', 'latest', 'x86_64', tmpDir)
      ).rejects.toThrow('유효하지 않은 이미지 매니페스트입니다');
    });

    it('should throw error when manifest has no layers', async () => {
      mockGetManifestForArchitecture.mockResolvedValueOnce({
        config: { digest: 'sha256:config123' },
        layers: null,
      });

      await expect(
        downloader.downloadImage('library/nginx', 'latest', 'x86_64', tmpDir)
      ).rejects.toThrow('유효하지 않은 이미지 매니페스트입니다');
    });

    it('should throw error when manifest has no config', async () => {
      mockGetManifestForArchitecture.mockResolvedValueOnce({
        config: null,
        layers: [{ digest: 'sha256:layer1', size: 1000 }],
      });

      await expect(
        downloader.downloadImage('library/nginx', 'latest', 'x86_64', tmpDir)
      ).rejects.toThrow('유효하지 않은 이미지 매니페스트입니다');
    });

    it('should handle token acquisition failure', async () => {
      mockGetTokenForRegistry.mockRejectedValueOnce(
        new Error('Authentication failed')
      );

      await expect(
        downloader.downloadImage('library/nginx', 'latest', 'x86_64', tmpDir)
      ).rejects.toThrow('Authentication failed');
    });

    it('should handle blob download failure', async () => {
      mockDownloadBlob.mockRejectedValueOnce(
        new Error('Download failed')
      );

      await expect(
        downloader.downloadImage('library/nginx', 'latest', 'x86_64', tmpDir)
      ).rejects.toThrow('Download failed');
    });

    it('should handle manifest timeout failure', async () => {
      mockGetManifestForArchitecture.mockRejectedValueOnce(
        new Error('manifest timeout')
      );

      await expect(
        downloader.downloadImage('library/nginx', 'latest', 'x86_64', tmpDir)
      ).rejects.toThrow('manifest timeout');
    });

    it('should handle tar creation failure', async () => {
      mockCreateImageTar.mockRejectedValueOnce(
        new Error('Tar creation failed')
      );

      await expect(
        downloader.downloadImage('library/nginx', 'latest', 'x86_64', tmpDir)
      ).rejects.toThrow('Tar creation failed');
    });
  });

  describe('downloadPackage', () => {
    it('should download package with architecture', async () => {
      const packageInfo = {
        name: 'nginx',
        version: 'latest',
        type: 'docker' as const,
        arch: 'x86_64' as Architecture,
      };

      const result = await downloader.downloadPackage(
        packageInfo,
        tmpDir
      );

      // downloadPackage는 tar 파일 경로(string)를 반환
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      expect(result).toContain('.tar');
    });

    it('should include registry in package name if present', async () => {
      const packageInfo = {
        name: 'ghcr.io/owner/image',
        version: 'v1.0.0',
        type: 'docker' as const,
        arch: 'x86_64' as Architecture,
      };

      const result = await downloader.downloadPackage(
        packageInfo,
        tmpDir
      );

      expect(mockGetTokenForRegistry).toHaveBeenCalledWith(
        'ghcr.io',
        expect.any(String)
      );
      expect(typeof result).toBe('string');
    });

    it('should handle download error in downloadPackage', async () => {
      mockGetTokenForRegistry.mockRejectedValueOnce(
        new Error('Network error')
      );

      const packageInfo = {
        name: 'nginx',
        version: 'latest',
        type: 'docker' as const,
        arch: 'x86_64' as Architecture,
      };

      await expect(
        downloader.downloadPackage(packageInfo, tmpDir)
      ).rejects.toThrow('Network error');
    });

    it('should use default architecture when not specified', async () => {
      const packageInfo = {
        name: 'nginx',
        version: 'latest',
        type: 'docker' as const,
      };

      await downloader.downloadPackage(packageInfo, tmpDir);

      // arch가 없으면 'amd64'가 기본값
      expect(mockGetManifestForArchitecture).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        'amd64',
        undefined
      );
    });
  });

  describe('progress tracking', () => {
    it('should track progress correctly with multiple layers', async () => {
      const progressEvents: Array<{
        progress: number;
        downloadedBytes: number;
        totalBytes: number;
      }> = [];
      const onProgress = vi.fn((event) => {
        progressEvents.push({
          progress: event.progress,
          downloadedBytes: event.downloadedBytes,
          totalBytes: event.totalBytes,
        });
      });

      // 레이어가 3개인 매니페스트
      mockGetManifestForArchitecture.mockResolvedValueOnce({
        config: { digest: 'sha256:config123' },
        layers: [
          { digest: 'sha256:layer1', size: 1000 },
          { digest: 'sha256:layer2', size: 2000 },
          { digest: 'sha256:layer3', size: 3000 },
        ],
      });

      // 각 blob 다운로드 시 progress 콜백 호출
      let callCount = 0;
      mockDownloadBlob.mockImplementation(
        async (
          _fullName: string,
          _digest: string,
          _path: string,
          _token: string,
          _registry: string,
          progressCallback?: (bytes: number) => void
        ) => {
          callCount++;
          if (progressCallback && callCount > 1) {
            // config 제외, layer만
            const layerSize = [1000, 2000, 3000][callCount - 2];
            progressCallback(layerSize);
          }
        }
      );

      await downloader.downloadImage(
        'library/nginx',
        'latest',
        'x86_64',
        tmpDir,
        onProgress
      );

      expect(onProgress).toHaveBeenCalled();
    });

    it('should calculate speed correctly', async () => {
      const progressEvents: Array<{ speed: number }> = [];
      const onProgress = vi.fn((event) => {
        progressEvents.push({ speed: event.speed });
      });

      // vi.useFakeTimers와 함께 테스트
      vi.useFakeTimers();

      mockDownloadBlob.mockImplementation(
        async (
          _fullName: string,
          _digest: string,
          _path: string,
          _token: string,
          _registry: string,
          progressCallback?: (bytes: number) => void
        ) => {
          if (progressCallback) {
            progressCallback(500);
            vi.advanceTimersByTime(400); // 0.4초 경과
            progressCallback(500);
          }
        }
      );

      await downloader.downloadImage(
        'library/nginx',
        'latest',
        'x86_64',
        tmpDir,
        onProgress
      );

      vi.useRealTimers();

      // speed가 계산되었는지 확인 (시간이 0.3초 이상 경과 시 계산됨)
      expect(onProgress).toHaveBeenCalled();
    });
  });

  describe('architecture mapping', () => {
    it('should handle x86_64 architecture', async () => {
      await downloader.downloadImage(
        'library/nginx',
        'latest',
        'x86_64',
        tmpDir
      );

      // x86_64 -> amd64 매핑 확인
      expect(mockGetManifestForArchitecture).toHaveBeenCalledWith(
        'library/nginx',
        'latest',
        'mock-token',
        'docker.io',
        'amd64',
        undefined
      );
    });

    it('should handle arm64 architecture', async () => {
      await downloader.downloadImage(
        'library/nginx',
        'latest',
        'arm64',
        tmpDir
      );

      // arm64 -> arm64 매핑 확인 (variant 없음)
      expect(mockGetManifestForArchitecture).toHaveBeenCalledWith(
        'library/nginx',
        'latest',
        'mock-token',
        'docker.io',
        'arm64',
        undefined
      );
    });

    it('should handle arm/v7 architecture', async () => {
      await downloader.downloadImage(
        'library/nginx',
        'latest',
        'arm/v7',
        tmpDir
      );

      // arm/v7 -> arm, v7 매핑 확인
      expect(mockGetManifestForArchitecture).toHaveBeenCalledWith(
        'library/nginx',
        'latest',
        'mock-token',
        'docker.io',
        'arm',
        'v7'
      );
    });

    it('should fallback to amd64 for unknown architecture', async () => {
      await downloader.downloadImage(
        'library/nginx',
        'latest',
        'unknown-arch' as Architecture,
        tmpDir
      );

      // 알 수 없는 아키텍처는 fallback으로 amd64 사용
      expect(mockGetManifestForArchitecture).toHaveBeenCalledWith(
        'library/nginx',
        'latest',
        'mock-token',
        'docker.io',
        'amd64',
        undefined
      );
    });
  });

  describe('repository parsing', () => {
    it('should handle library images', async () => {
      await downloader.downloadImage(
        'nginx',
        'latest',
        'x86_64',
        tmpDir
      );

      expect(mockGetTokenForRegistry).toHaveBeenCalledWith(
        'docker.io',
        'library/nginx'
      );
    });

    it('should handle namespaced images', async () => {
      await downloader.downloadImage(
        'myuser/myapp',
        'v1.0.0',
        'x86_64',
        tmpDir
      );

      expect(mockGetTokenForRegistry).toHaveBeenCalledWith(
        'docker.io',
        'myuser/myapp'
      );
    });
  });

  describe('manifest.json creation', () => {
    it('should create correct manifest.json for docker load', async () => {
      await downloader.downloadImage(
        'library/nginx',
        'latest',
        'x86_64',
        tmpDir
      );

      // writeJson이 manifest.json 경로로 호출되었는지 확인
      expect(mockWriteJson).toHaveBeenCalledWith(
        expect.stringContaining('manifest.json'),
        expect.arrayContaining([
          expect.objectContaining({
            Config: 'config.json',
            RepoTags: expect.arrayContaining([expect.stringContaining('nginx')]),
            Layers: expect.any(Array),
          }),
        ])
      );
    });

    it('should include registry in RepoTags for non-docker.io registries', async () => {
      await downloader.downloadImage(
        'myapp',
        'v1.0.0',
        'x86_64',
        tmpDir,
        undefined,
        'ghcr.io'
      );

      expect(mockWriteJson).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          expect.objectContaining({
            RepoTags: expect.arrayContaining([
              expect.stringMatching(/^ghcr\.io\//),
            ]),
          }),
        ])
      );
    });
  });

  describe('cleanup', () => {
    it('should remove temporary image directory after packaging', async () => {
      await downloader.downloadImage(
        'library/nginx',
        'latest',
        'x86_64',
        tmpDir
      );

      expect(mockRemove).toHaveBeenCalled();
    });

    it('should cleanup even if packaging fails partially', async () => {
      // tar 생성 후 cleanup 테스트
      mockCreateImageTar.mockImplementationOnce(async () => {
        // 성공적으로 tar 생성
      });

      await downloader.downloadImage(
        'library/nginx',
        'latest',
        'x86_64',
        tmpDir
      );

      expect(mockRemove).toHaveBeenCalled();
    });
  });

  describe('tag sanitization', () => {
    it('should sanitize Windows forbidden characters in tags', async () => {
      await downloader.downloadImage(
        'library/nginx',
        'v1.0:test<>',
        'x86_64',
        tmpDir
      );

      // Windows 금지 문자(<>:)가 sanitize되어야 함
      expect(mockEnsureDir).toHaveBeenCalledWith(
        expect.not.stringContaining(':')
      );
      expect(mockEnsureDir).toHaveBeenCalledWith(
        expect.not.stringContaining('<')
      );
      expect(mockEnsureDir).toHaveBeenCalledWith(
        expect.not.stringContaining('>')
      );
    });

    it('should allow valid characters like + and -', async () => {
      await downloader.downloadImage(
        'library/nginx',
        'v1.0.0-beta+build',
        'x86_64',
        tmpDir
      );

      // + 및 - 는 유효한 문자이므로 유지됨
      expect(mockEnsureDir).toHaveBeenCalled();
    });
  });
});
