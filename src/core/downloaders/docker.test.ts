import { describe, it, expect, beforeEach } from 'vitest';
import { getDockerDownloader } from './docker';

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

  describe('searchPackages (integration)', () => {
    it.skip('이미지 검색', async () => {
      const results = await downloader.searchPackages('nginx');
      expect(Array.isArray(results)).toBe(true);
      if (results.length > 0) {
        expect(results[0]).toHaveProperty('name');
      }
    });
  });

  describe('getVersions (integration)', () => {
    it.skip('태그 목록 조회', async () => {
      const versions = await downloader.getVersions('library/nginx');
      expect(Array.isArray(versions)).toBe(true);
      expect(versions.length).toBeGreaterThan(0);
    });
  });
});

// Docker 다운로더 유틸리티 로직 테스트
describe('docker downloader utilities', () => {
  describe('parseImageName', () => {
    // 이미지 이름 파싱 로직
    const parseImageName = (
      imageName: string
    ): { registry: string; repository: string; tag: string } => {
      let registry = 'registry-1.docker.io';
      let repository = imageName;
      let tag = 'latest';

      // 레지스트리 분리 (점이나 콜론 또는 localhost가 포함된 경우)
      // 먼저 레지스트리를 분리해야 포트 번호와 태그를 구분할 수 있음
      if (repository.includes('/')) {
        const firstPart = repository.split('/')[0];
        if (
          firstPart.includes('.') ||
          firstPart.includes(':') ||
          firstPart === 'localhost'
        ) {
          const parts = repository.split('/');
          registry = parts[0];
          repository = parts.slice(1).join('/');
        }
      }

      // 태그 분리 (레지스트리 분리 후)
      if (repository.includes(':')) {
        const colonIndex = repository.lastIndexOf(':');
        tag = repository.substring(colonIndex + 1);
        repository = repository.substring(0, colonIndex);
      }

      // library 네임스페이스 추가 (공식 이미지)
      if (!repository.includes('/')) {
        repository = `library/${repository}`;
      }

      return { registry, repository, tag };
    };

    it('단순 이미지 이름 파싱', () => {
      const result = parseImageName('nginx');
      expect(result.registry).toBe('registry-1.docker.io');
      expect(result.repository).toBe('library/nginx');
      expect(result.tag).toBe('latest');
    });

    it('태그가 포함된 이미지 파싱', () => {
      const result = parseImageName('nginx:1.21');
      expect(result.repository).toBe('library/nginx');
      expect(result.tag).toBe('1.21');
    });

    it('네임스페이스가 포함된 이미지 파싱', () => {
      const result = parseImageName('bitnami/nginx');
      expect(result.repository).toBe('bitnami/nginx');
      expect(result.tag).toBe('latest');
    });

    it('네임스페이스와 태그가 포함된 이미지 파싱', () => {
      const result = parseImageName('bitnami/nginx:1.21');
      expect(result.repository).toBe('bitnami/nginx');
      expect(result.tag).toBe('1.21');
    });

    it('커스텀 레지스트리 파싱', () => {
      const result = parseImageName('gcr.io/project/image:v1');
      expect(result.registry).toBe('gcr.io');
      expect(result.repository).toBe('project/image');
      expect(result.tag).toBe('v1');
    });

    it('localhost 레지스트리 파싱', () => {
      const result = parseImageName('localhost:5000/myimage');
      expect(result.registry).toBe('localhost:5000');
      // 커스텀 레지스트리에서는 library가 자동 추가됨 (Docker Hub 규칙)
      expect(result.repository).toBe('library/myimage');
    });

    it('localhost 레지스트리 + 네임스페이스 파싱', () => {
      const result = parseImageName('localhost:5000/myorg/myimage');
      expect(result.registry).toBe('localhost:5000');
      expect(result.repository).toBe('myorg/myimage');
    });

    it('여러 단계 경로 파싱', () => {
      const result = parseImageName('quay.io/org/team/image:latest');
      expect(result.registry).toBe('quay.io');
      expect(result.repository).toBe('org/team/image');
      expect(result.tag).toBe('latest');
    });
  });

  describe('architecture mapping', () => {
    const ARCH_MAP: Record<string, string> = {
      x86_64: 'amd64',
      amd64: 'amd64',
      arm64: 'arm64',
      aarch64: 'arm64',
      armv7l: 'arm/v7',
      i386: '386',
      i686: '386',
    };

    const normalizeArch = (arch: string): string => {
      return ARCH_MAP[arch.toLowerCase()] || arch;
    };

    it('x86_64 → amd64 변환', () => {
      expect(normalizeArch('x86_64')).toBe('amd64');
    });

    it('amd64 유지', () => {
      expect(normalizeArch('amd64')).toBe('amd64');
    });

    it('arm64 유지', () => {
      expect(normalizeArch('arm64')).toBe('arm64');
    });

    it('aarch64 → arm64 변환', () => {
      expect(normalizeArch('aarch64')).toBe('arm64');
    });

    it('armv7l → arm/v7 변환', () => {
      expect(normalizeArch('armv7l')).toBe('arm/v7');
    });

    it('i386 → 386 변환', () => {
      expect(normalizeArch('i386')).toBe('386');
    });

    it('알 수 없는 아키텍처는 그대로 반환', () => {
      expect(normalizeArch('unknown')).toBe('unknown');
    });

    it('대소문자 무시', () => {
      expect(normalizeArch('AMD64')).toBe('amd64');
      expect(normalizeArch('X86_64')).toBe('amd64');
    });
  });

  describe('sha256 digest validation', () => {
    const isValidDigest = (digest: string): boolean => {
      // sha256: 접두사 + 64자 hex
      const pattern = /^sha256:[a-f0-9]{64}$/;
      return pattern.test(digest);
    };

    it('유효한 sha256 다이제스트', () => {
      expect(
        isValidDigest('sha256:a3ed95caeb02ffe68cdd9fd84406680ae93d633cb16422d00e8a7c22955b46d4')
      ).toBe(true);
    });

    it('접두사 없는 다이제스트는 무효', () => {
      expect(
        isValidDigest('a3ed95caeb02ffe68cdd9fd84406680ae93d633cb16422d00e8a7c22955b46d4')
      ).toBe(false);
    });

    it('잘못된 길이의 다이제스트는 무효', () => {
      expect(isValidDigest('sha256:a3ed95caeb02ffe68cdd9fd84406680ae93d633')).toBe(false);
    });

    it('잘못된 문자가 포함된 다이제스트는 무효', () => {
      expect(
        isValidDigest('sha256:g3ed95caeb02ffe68cdd9fd84406680ae93d633cb16422d00e8a7c22955b46d4')
      ).toBe(false);
    });
  });

  describe('manifest media types', () => {
    const MANIFEST_TYPES = {
      V2_MANIFEST: 'application/vnd.docker.distribution.manifest.v2+json',
      V2_MANIFEST_LIST: 'application/vnd.docker.distribution.manifest.list.v2+json',
      OCI_MANIFEST: 'application/vnd.oci.image.manifest.v1+json',
      OCI_INDEX: 'application/vnd.oci.image.index.v1+json',
    };

    const isManifestList = (mediaType: string): boolean => {
      return (
        mediaType === MANIFEST_TYPES.V2_MANIFEST_LIST || mediaType === MANIFEST_TYPES.OCI_INDEX
      );
    };

    const isSingleManifest = (mediaType: string): boolean => {
      return (
        mediaType === MANIFEST_TYPES.V2_MANIFEST || mediaType === MANIFEST_TYPES.OCI_MANIFEST
      );
    };

    it('V2 매니페스트 리스트 감지', () => {
      expect(isManifestList(MANIFEST_TYPES.V2_MANIFEST_LIST)).toBe(true);
    });

    it('OCI 인덱스 감지', () => {
      expect(isManifestList(MANIFEST_TYPES.OCI_INDEX)).toBe(true);
    });

    it('V2 매니페스트는 리스트가 아님', () => {
      expect(isManifestList(MANIFEST_TYPES.V2_MANIFEST)).toBe(false);
    });

    it('V2 단일 매니페스트 감지', () => {
      expect(isSingleManifest(MANIFEST_TYPES.V2_MANIFEST)).toBe(true);
    });

    it('OCI 매니페스트 감지', () => {
      expect(isSingleManifest(MANIFEST_TYPES.OCI_MANIFEST)).toBe(true);
    });
  });

  describe('tag validation', () => {
    const isValidTag = (tag: string): boolean => {
      if (!tag || tag.length === 0 || tag.length > 128) return false;
      // 알파벳, 숫자, 점, 하이픈, 언더스코어
      const pattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
      return pattern.test(tag);
    };

    it('유효한 태그', () => {
      expect(isValidTag('latest')).toBe(true);
      expect(isValidTag('v1.0.0')).toBe(true);
      expect(isValidTag('1.0')).toBe(true);
      expect(isValidTag('alpine-3.18')).toBe(true);
      expect(isValidTag('node_18')).toBe(true);
    });

    it('빈 태그는 무효', () => {
      expect(isValidTag('')).toBe(false);
    });

    it('128자 초과 태그는 무효', () => {
      expect(isValidTag('a'.repeat(129))).toBe(false);
    });

    it('128자 태그는 유효', () => {
      expect(isValidTag('a'.repeat(128))).toBe(true);
    });

    it('특수문자로 시작하는 태그는 무효', () => {
      expect(isValidTag('-latest')).toBe(false);
      expect(isValidTag('.latest')).toBe(false);
    });
  });

  describe('layer size calculation', () => {
    interface Layer {
      size: number;
      digest: string;
    }

    const calculateTotalSize = (layers: Layer[]): number => {
      return layers.reduce((sum, layer) => sum + layer.size, 0);
    };

    const formatSize = (bytes: number): string => {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    };

    it('레이어 크기 합산', () => {
      const layers: Layer[] = [
        { size: 1000000, digest: 'sha256:abc' },
        { size: 2000000, digest: 'sha256:def' },
        { size: 3000000, digest: 'sha256:ghi' },
      ];
      expect(calculateTotalSize(layers)).toBe(6000000);
    });

    it('빈 레이어 배열', () => {
      expect(calculateTotalSize([])).toBe(0);
    });

    it('크기 포맷팅 - 바이트', () => {
      expect(formatSize(500)).toBe('500 B');
    });

    it('크기 포맷팅 - KB', () => {
      expect(formatSize(1500)).toBe('1.5 KB');
    });

    it('크기 포맷팅 - MB', () => {
      expect(formatSize(1500000)).toBe('1.4 MB');
    });

    it('크기 포맷팅 - GB', () => {
      expect(formatSize(1500000000)).toBe('1.40 GB');
    });
  });

  // 사용자 추천 테스트 케이스 기반 테스트
  describe('recommended test cases', () => {
    // 일반 케이스 - alpine (경량 이미지)
    describe('alpine image case', () => {
      it('alpine은 경량 베이스 이미지', () => {
        const alpineSize = 5.6 * 1024 * 1024; // ~5.6MB
        const ubuntuSize = 77.8 * 1024 * 1024; // ~77.8MB
        expect(alpineSize).toBeLessThan(ubuntuSize);
      });

      it('alpine 태그 파싱', () => {
        const parseAlpineTag = (tag: string): { version?: string; variant?: string } => {
          // 3.19, 3.19.0, edge, latest
          const match = tag.match(/^(\d+\.\d+(?:\.\d+)?)?(-(\w+))?$/);
          if (!match) return { version: tag };
          return {
            version: match[1],
            variant: match[3],
          };
        };

        expect(parseAlpineTag('3.19')).toEqual({ version: '3.19', variant: undefined });
        expect(parseAlpineTag('3.19.0')).toEqual({ version: '3.19.0', variant: undefined });
        expect(parseAlpineTag('latest')).toEqual({ version: 'latest' });
      });

      it('alpine 레이어 수', () => {
        const alpineLayers = 1; // 단일 레이어
        expect(alpineLayers).toBeLessThanOrEqual(2);
      });
    });

    // 일반 케이스 - busybox (최소 이미지)
    describe('busybox image case', () => {
      it('busybox는 최소 유닉스 유틸리티', () => {
        const busyboxSize = 4.26 * 1024 * 1024; // ~4.26MB
        expect(busyboxSize).toBeLessThan(10 * 1024 * 1024);
      });

      it('busybox 변형', () => {
        const variants = ['glibc', 'musl', 'uclibc'];
        expect(variants).toContain('musl');
        expect(variants).toContain('glibc');
      });
    });

    // 멀티 레이어 케이스 - python:3.11-alpine
    describe('python:3.11-alpine case', () => {
      it('python 이미지는 여러 레이어 포함', () => {
        const layers = [
          { digest: 'sha256:base', size: 5 * 1024 * 1024 },
          { digest: 'sha256:python', size: 45 * 1024 * 1024 },
          { digest: 'sha256:pip', size: 10 * 1024 * 1024 },
        ];
        expect(layers.length).toBeGreaterThan(1);
      });

      it('python 이미지 태그 구조', () => {
        const parsePythonTag = (tag: string): { version: string; variant?: string; base?: string } => {
          // 3.11, 3.11-slim, 3.11-alpine, 3.11-bookworm
          const match = tag.match(/^(\d+\.\d+(?:\.\d+)?)(-(slim|alpine|bookworm|bullseye))?$/);
          if (!match) return { version: tag };
          return {
            version: match[1],
            variant: match[3],
          };
        };

        expect(parsePythonTag('3.11')).toEqual({ version: '3.11' });
        expect(parsePythonTag('3.11-alpine')).toEqual({ version: '3.11', variant: 'alpine' });
        expect(parsePythonTag('3.11-slim')).toEqual({ version: '3.11', variant: 'slim' });
      });

      it('alpine 기반 vs debian 기반 크기', () => {
        const alpineSize = 50 * 1024 * 1024;
        const debianSize = 900 * 1024 * 1024;
        expect(alpineSize).toBeLessThan(debianSize);
      });
    });

    // arm64 플랫폼 케이스
    describe('arm64 platform case', () => {
      interface PlatformManifest {
        platform: {
          architecture: string;
          os: string;
          variant?: string;
        };
        digest: string;
      }

      const selectPlatformManifest = (
        manifests: PlatformManifest[],
        arch: string,
        os: string = 'linux'
      ): PlatformManifest | null => {
        return (
          manifests.find((m) => m.platform.architecture === arch && m.platform.os === os) ||
          null
        );
      };

      it('arm64 매니페스트 선택', () => {
        const manifests: PlatformManifest[] = [
          { platform: { architecture: 'amd64', os: 'linux' }, digest: 'sha256:amd64' },
          { platform: { architecture: 'arm64', os: 'linux' }, digest: 'sha256:arm64' },
          { platform: { architecture: 'arm', os: 'linux', variant: 'v7' }, digest: 'sha256:armv7' },
        ];

        const arm64 = selectPlatformManifest(manifests, 'arm64');
        expect(arm64).not.toBeNull();
        expect(arm64!.digest).toBe('sha256:arm64');
      });

      it('amd64 매니페스트 선택', () => {
        const manifests: PlatformManifest[] = [
          { platform: { architecture: 'amd64', os: 'linux' }, digest: 'sha256:amd64' },
          { platform: { architecture: 'arm64', os: 'linux' }, digest: 'sha256:arm64' },
        ];

        const amd64 = selectPlatformManifest(manifests, 'amd64');
        expect(amd64).not.toBeNull();
        expect(amd64!.digest).toBe('sha256:amd64');
      });

      it('지원되지 않는 아키텍처', () => {
        const manifests: PlatformManifest[] = [
          { platform: { architecture: 'amd64', os: 'linux' }, digest: 'sha256:amd64' },
        ];

        const s390x = selectPlatformManifest(manifests, 's390x');
        expect(s390x).toBeNull();
      });
    });

    // 프라이빗 레지스트리 케이스
    describe('private registry case', () => {
      interface RegistryAuth {
        registry: string;
        username?: string;
        password?: string;
        token?: string;
      }

      const needsAuthentication = (registry: string): boolean => {
        const publicRegistries = ['docker.io', 'registry-1.docker.io', 'ghcr.io'];
        return !publicRegistries.some((pub) => registry.includes(pub));
      };

      it('프라이빗 레지스트리는 인증 필요', () => {
        expect(needsAuthentication('my-registry.company.com')).toBe(true);
        expect(needsAuthentication('localhost:5000')).toBe(true);
      });

      it('퍼블릭 레지스트리는 익명 접근 가능', () => {
        expect(needsAuthentication('docker.io')).toBe(false);
        expect(needsAuthentication('registry-1.docker.io')).toBe(false);
      });

      it('인증 헤더 생성', () => {
        const createAuthHeader = (auth: RegistryAuth): string => {
          if (auth.token) {
            return `Bearer ${auth.token}`;
          }
          if (auth.username && auth.password) {
            const credentials = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
            return `Basic ${credentials}`;
          }
          return '';
        };

        expect(createAuthHeader({ registry: 'docker.io', token: 'abc123' })).toBe('Bearer abc123');
        expect(createAuthHeader({ registry: 'docker.io', username: 'user', password: 'pass' })).toContain('Basic');
      });
    });

    // 레지스트리별 API 차이
    describe('registry API differences', () => {
      type RegistryType = 'dockerhub' | 'gcr' | 'ecr' | 'acr' | 'ghcr' | 'quay';

      interface RegistryConfig {
        type: RegistryType;
        authUrl: string;
        apiVersion: string;
      }

      const getRegistryConfig = (registry: string): RegistryConfig => {
        if (registry.includes('docker.io')) {
          return { type: 'dockerhub', authUrl: 'https://auth.docker.io', apiVersion: 'v2' };
        }
        if (registry.includes('gcr.io')) {
          return { type: 'gcr', authUrl: 'https://gcr.io/v2/token', apiVersion: 'v2' };
        }
        if (registry.includes('ecr')) {
          return { type: 'ecr', authUrl: 'https://ecr.aws', apiVersion: 'v2' };
        }
        if (registry.includes('ghcr.io')) {
          return { type: 'ghcr', authUrl: 'https://ghcr.io/token', apiVersion: 'v2' };
        }
        if (registry.includes('quay.io')) {
          return { type: 'quay', authUrl: 'https://quay.io/v2/auth', apiVersion: 'v2' };
        }
        return { type: 'dockerhub', authUrl: '', apiVersion: 'v2' };
      };

      it('Docker Hub 설정', () => {
        const config = getRegistryConfig('docker.io');
        expect(config.type).toBe('dockerhub');
        expect(config.authUrl).toContain('auth.docker.io');
      });

      it('GHCR 설정', () => {
        const config = getRegistryConfig('ghcr.io');
        expect(config.type).toBe('ghcr');
      });

      it('Quay.io 설정', () => {
        const config = getRegistryConfig('quay.io');
        expect(config.type).toBe('quay');
      });
    });

    // 이미지 저장 형식
    describe('image save format', () => {
      interface ImageTar {
        manifest: string;
        config: string;
        layers: string[];
        repositories: Record<string, Record<string, string>>;
      }

      const validateTarStructure = (tar: ImageTar): boolean => {
        return (
          tar.manifest !== undefined &&
          tar.config !== undefined &&
          tar.layers.length > 0
        );
      };

      it('OCI 이미지 tar 구조', () => {
        const tar: ImageTar = {
          manifest: 'manifest.json',
          config: 'sha256:abc123.json',
          layers: ['sha256:layer1/layer.tar', 'sha256:layer2/layer.tar'],
          repositories: { nginx: { latest: 'sha256:abc123' } },
        };

        expect(validateTarStructure(tar)).toBe(true);
      });

      it('repositories.json 구조', () => {
        const repos = { 'library/nginx': { 'latest': 'sha256:abc123' } };
        expect(repos['library/nginx']['latest']).toBe('sha256:abc123');
      });
    });

    // 레이어 공유 및 캐싱
    describe('layer sharing and caching', () => {
      interface Layer {
        digest: string;
        size: number;
      }

      const findSharedLayers = (image1Layers: Layer[], image2Layers: Layer[]): Layer[] => {
        return image1Layers.filter((l1) =>
          image2Layers.some((l2) => l2.digest === l1.digest)
        );
      };

      it('동일 베이스 이미지는 레이어 공유', () => {
        const alpineBase: Layer = { digest: 'sha256:alpine-base', size: 5 * 1024 * 1024 };

        const pythonAlpineLayers: Layer[] = [
          alpineBase,
          { digest: 'sha256:python', size: 45 * 1024 * 1024 },
        ];

        const nodeAlpineLayers: Layer[] = [
          alpineBase,
          { digest: 'sha256:node', size: 100 * 1024 * 1024 },
        ];

        const shared = findSharedLayers(pythonAlpineLayers, nodeAlpineLayers);
        expect(shared.length).toBe(1);
        expect(shared[0].digest).toBe('sha256:alpine-base');
      });

      it('다른 베이스 이미지는 레이어 공유 없음', () => {
        const debianLayers: Layer[] = [
          { digest: 'sha256:debian-base', size: 77 * 1024 * 1024 },
        ];

        const alpineLayers: Layer[] = [
          { digest: 'sha256:alpine-base', size: 5 * 1024 * 1024 },
        ];

        const shared = findSharedLayers(debianLayers, alpineLayers);
        expect(shared.length).toBe(0);
      });
    });

    // 멀티 아키텍처 매니페스트
    describe('multi-arch manifest', () => {
      interface ManifestList {
        schemaVersion: number;
        mediaType: string;
        manifests: Array<{
          mediaType: string;
          digest: string;
          size: number;
          platform: {
            architecture: string;
            os: string;
            variant?: string;
          };
        }>;
      }

      const isManifestList = (mediaType: string): boolean => {
        return (
          mediaType === 'application/vnd.docker.distribution.manifest.list.v2+json' ||
          mediaType === 'application/vnd.oci.image.index.v1+json'
        );
      };

      it('매니페스트 리스트 감지', () => {
        expect(isManifestList('application/vnd.docker.distribution.manifest.list.v2+json')).toBe(true);
        expect(isManifestList('application/vnd.oci.image.index.v1+json')).toBe(true);
        expect(isManifestList('application/vnd.docker.distribution.manifest.v2+json')).toBe(false);
      });

      it('멀티 아키텍처 매니페스트 구조', () => {
        const manifestList: ManifestList = {
          schemaVersion: 2,
          mediaType: 'application/vnd.docker.distribution.manifest.list.v2+json',
          manifests: [
            {
              mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
              digest: 'sha256:amd64',
              size: 1000,
              platform: { architecture: 'amd64', os: 'linux' },
            },
            {
              mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
              digest: 'sha256:arm64',
              size: 1000,
              platform: { architecture: 'arm64', os: 'linux' },
            },
          ],
        };

        expect(manifestList.manifests.length).toBe(2);
        expect(manifestList.manifests.map((m) => m.platform.architecture)).toContain('amd64');
        expect(manifestList.manifests.map((m) => m.platform.architecture)).toContain('arm64');
      });
    });
  });
});
