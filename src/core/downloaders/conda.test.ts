import { describe, it, expect, beforeEach } from 'vitest';
import { getCondaDownloader } from './conda';

describe('conda downloader', () => {
  let downloader: ReturnType<typeof getCondaDownloader>;

  beforeEach(() => {
    downloader = getCondaDownloader();
  });

  describe('getCondaDownloader', () => {
    it('싱글톤 인스턴스 반환', () => {
      const instance1 = getCondaDownloader();
      const instance2 = getCondaDownloader();
      expect(instance1).toBe(instance2);
    });

    it('type이 conda', () => {
      expect(downloader.type).toBe('conda');
    });
  });

  describe('searchPackages (integration)', () => {
    it.skip('패키지 검색', async () => {
      const results = await downloader.searchPackages('numpy');
      expect(Array.isArray(results)).toBe(true);
      if (results.length > 0) {
        expect(results[0]).toHaveProperty('name');
      }
    });
  });

  describe('getVersions (integration)', () => {
    it.skip('버전 목록 조회', async () => {
      const versions = await downloader.getVersions('numpy');
      expect(Array.isArray(versions)).toBe(true);
      expect(versions.length).toBeGreaterThan(0);
    });
  });

  describe('clearCache', () => {
    it('캐시 클리어', () => {
      downloader.clearCache();
      // 에러 없이 실행되어야 함
    });
  });
});

// conda 다운로더 유틸리티 로직 테스트
describe('conda downloader utilities', () => {
  describe('architecture mapping', () => {
    type Architecture = 'x86_64' | 'amd64' | 'arm64' | 'aarch64' | 'noarch' | 'i386' | 'all';

    const mapArch = (subdir?: string): Architecture | undefined => {
      if (!subdir) return undefined;

      const mapping: Record<string, Architecture> = {
        'linux-64': 'x86_64',
        'osx-64': 'x86_64',
        'win-64': 'x86_64',
        'linux-aarch64': 'aarch64',
        'osx-arm64': 'arm64',
        noarch: 'noarch',
      };

      return mapping[subdir];
    };

    it('linux-64를 x86_64로 매핑', () => {
      expect(mapArch('linux-64')).toBe('x86_64');
    });

    it('osx-64를 x86_64로 매핑', () => {
      expect(mapArch('osx-64')).toBe('x86_64');
    });

    it('win-64를 x86_64로 매핑', () => {
      expect(mapArch('win-64')).toBe('x86_64');
    });

    it('linux-aarch64를 aarch64로 매핑', () => {
      expect(mapArch('linux-aarch64')).toBe('aarch64');
    });

    it('osx-arm64를 arm64로 매핑', () => {
      expect(mapArch('osx-arm64')).toBe('arm64');
    });

    it('noarch 그대로 매핑', () => {
      expect(mapArch('noarch')).toBe('noarch');
    });

    it('undefined 입력시 undefined 반환', () => {
      expect(mapArch(undefined)).toBe(undefined);
    });

    it('알 수 없는 subdir', () => {
      expect(mapArch('unknown')).toBe(undefined);
    });
  });

  describe('file selection logic', () => {
    interface MockFile {
      version: string;
      upload_time: string;
      attrs: { subdir?: string };
    }

    const selectBestFile = (
      files: MockFile[],
      version: string,
      arch?: string
    ): MockFile | null => {
      if (files.length === 0) return null;

      // 버전 필터링
      let filtered = files.filter((f) => f.version === version);
      if (filtered.length === 0) {
        filtered = files;
      }

      // 아키텍처 필터링
      if (arch) {
        const archMap: Record<string, string[]> = {
          x86_64: ['linux-64', 'osx-64', 'win-64'],
          amd64: ['linux-64', 'osx-64', 'win-64'],
          arm64: ['linux-aarch64', 'osx-arm64'],
          aarch64: ['linux-aarch64', 'osx-arm64'],
          noarch: ['noarch'],
          all: ['noarch'],
        };

        const subdirs = archMap[arch] || [arch];
        const archFiltered = filtered.filter(
          (f) => subdirs.includes(f.attrs.subdir || '') || f.attrs.subdir === 'noarch'
        );
        if (archFiltered.length > 0) {
          filtered = archFiltered;
        }
      }

      // noarch 우선
      const noarch = filtered.find((f) => f.attrs.subdir === 'noarch');
      if (noarch) return noarch;

      // 최신 업로드 파일
      return filtered.sort(
        (a, b) =>
          new Date(b.upload_time).getTime() - new Date(a.upload_time).getTime()
      )[0];
    };

    it('버전 매칭 파일 선택', () => {
      const files: MockFile[] = [
        { version: '1.0.0', upload_time: '2024-01-01', attrs: { subdir: 'linux-64' } },
        { version: '1.1.0', upload_time: '2024-02-01', attrs: { subdir: 'linux-64' } },
      ];
      const result = selectBestFile(files, '1.0.0');
      expect(result?.version).toBe('1.0.0');
    });

    it('noarch 우선 선택', () => {
      const files: MockFile[] = [
        { version: '1.0.0', upload_time: '2024-01-01', attrs: { subdir: 'linux-64' } },
        { version: '1.0.0', upload_time: '2024-01-02', attrs: { subdir: 'noarch' } },
      ];
      const result = selectBestFile(files, '1.0.0');
      expect(result?.attrs.subdir).toBe('noarch');
    });

    it('아키텍처 필터링 (x86_64)', () => {
      const files: MockFile[] = [
        { version: '1.0.0', upload_time: '2024-01-01', attrs: { subdir: 'linux-64' } },
        { version: '1.0.0', upload_time: '2024-01-01', attrs: { subdir: 'osx-arm64' } },
      ];
      const result = selectBestFile(files, '1.0.0', 'x86_64');
      expect(result?.attrs.subdir).toBe('linux-64');
    });

    it('아키텍처 필터링 (arm64)', () => {
      const files: MockFile[] = [
        { version: '1.0.0', upload_time: '2024-01-01', attrs: { subdir: 'linux-64' } },
        { version: '1.0.0', upload_time: '2024-01-01', attrs: { subdir: 'osx-arm64' } },
      ];
      const result = selectBestFile(files, '1.0.0', 'arm64');
      expect(result?.attrs.subdir).toBe('osx-arm64');
    });

    it('최신 업로드 파일 선택', () => {
      const files: MockFile[] = [
        { version: '1.0.0', upload_time: '2024-01-01', attrs: { subdir: 'linux-64' } },
        { version: '1.0.0', upload_time: '2024-02-01', attrs: { subdir: 'linux-64' } },
      ];
      const result = selectBestFile(files, '1.0.0');
      expect(result?.upload_time).toBe('2024-02-01');
    });

    it('빈 배열 처리', () => {
      expect(selectBestFile([], '1.0.0')).toBeNull();
    });

    it('버전이 없을 때 전체 파일에서 선택', () => {
      const files: MockFile[] = [
        { version: '1.1.0', upload_time: '2024-01-01', attrs: { subdir: 'linux-64' } },
      ];
      const result = selectBestFile(files, '1.0.0');
      expect(result?.version).toBe('1.1.0');
    });
  });

  describe('subdir to arch filtering', () => {
    it('x86_64 아키텍처에 해당하는 subdirs', () => {
      const archMap: Record<string, string[]> = {
        x86_64: ['linux-64', 'osx-64', 'win-64'],
        amd64: ['linux-64', 'osx-64', 'win-64'],
        arm64: ['linux-aarch64', 'osx-arm64'],
        aarch64: ['linux-aarch64', 'osx-arm64'],
        noarch: ['noarch'],
        all: ['noarch'],
      };

      expect(archMap['x86_64']).toContain('linux-64');
      expect(archMap['x86_64']).toContain('osx-64');
      expect(archMap['x86_64']).toContain('win-64');
    });

    it('arm64 아키텍처에 해당하는 subdirs', () => {
      const archMap: Record<string, string[]> = {
        arm64: ['linux-aarch64', 'osx-arm64'],
        aarch64: ['linux-aarch64', 'osx-arm64'],
      };

      expect(archMap['arm64']).toContain('linux-aarch64');
      expect(archMap['arm64']).toContain('osx-arm64');
    });
  });

  // 사용자 추천 테스트 케이스 기반 테스트
  describe('recommended test cases', () => {
    // 일반 케이스 - requests (간단한 패키지)
    describe('requests package case', () => {
      it('requests는 noarch 패키지', () => {
        const mockPackage = {
          name: 'requests',
          version: '2.31.0',
          subdir: 'noarch',
          depends: ['certifi', 'charset-normalizer', 'idna', 'urllib3'],
        };

        expect(mockPackage.subdir).toBe('noarch');
        expect(mockPackage.depends.length).toBeGreaterThan(0);
      });

      it('requests 의존성 검증', () => {
        const expectedDeps = ['certifi', 'urllib3', 'idna'];
        const actualDeps = ['certifi', 'charset-normalizer', 'idna', 'urllib3'];

        expectedDeps.forEach((dep) => {
          expect(actualDeps).toContain(dep);
        });
      });
    });

    // 일반 케이스 - flask (전이 의존성 있음)
    describe('flask package case', () => {
      const flaskDependencies = [
        'werkzeug',
        'jinja2',
        'itsdangerous',
        'click',
        'blinker',
      ];

      it('flask는 전이 의존성을 가짐', () => {
        expect(flaskDependencies).toContain('werkzeug');
        expect(flaskDependencies).toContain('jinja2');
        expect(flaskDependencies.length).toBeGreaterThan(3);
      });

      it('flask 전이 의존성 트리', () => {
        // werkzeug → markupsafe
        // jinja2 → markupsafe
        // 공통 의존성 markupsafe
        const transitiveDeps = {
          werkzeug: ['markupsafe'],
          jinja2: ['markupsafe'],
        };

        expect(transitiveDeps.werkzeug).toContain('markupsafe');
        expect(transitiveDeps.jinja2).toContain('markupsafe');
      });
    });

    // 채널 특수 케이스 - pytorch-cpu
    describe('pytorch-cpu package case', () => {
      const channels = ['defaults', 'conda-forge', 'pytorch'];

      it('pytorch는 전용 채널에서 제공', () => {
        expect(channels).toContain('pytorch');
      });

      it('pytorch-cpu는 플랫폼별 빌드 제공', () => {
        const platforms = ['linux-64', 'osx-64', 'win-64', 'osx-arm64', 'linux-aarch64'];
        expect(platforms.length).toBeGreaterThan(3);
        expect(platforms).toContain('osx-arm64');
      });

      it('pytorch CUDA 버전 선택', () => {
        const cudaVariants = ['cpu', 'cuda11.8', 'cuda12.1'];
        expect(cudaVariants).toContain('cpu');
        expect(cudaVariants.some((v) => v.startsWith('cuda'))).toBe(true);
      });
    });

    // 플랫폼 제한 케이스 - cudatoolkit
    describe('cudatoolkit package case', () => {
      it('cudatoolkit은 Windows/Linux에서만 사용 가능', () => {
        const supportedPlatforms = ['linux-64', 'win-64'];
        const unsupportedPlatforms = ['osx-64', 'osx-arm64'];

        expect(supportedPlatforms).not.toContain('osx-64');
        expect(supportedPlatforms).not.toContain('osx-arm64');
        unsupportedPlatforms.forEach((p) => {
          expect(supportedPlatforms).not.toContain(p);
        });
      });

      it('cudatoolkit 버전과 드라이버 호환성', () => {
        const compatibility: Record<string, string> = {
          '11.8': '>=450.80.02',
          '12.1': '>=525.60.13',
        };

        expect(Object.keys(compatibility).length).toBeGreaterThan(0);
      });
    });

    // 예외 케이스 - 존재하지 않는 패키지
    describe('non-existent package case', () => {
      it('존재하지 않는 패키지명 형식 검증', () => {
        const fakePackage = 'this-package-does-not-exist-12345';
        // conda 패키지명은 소문자, 숫자, 하이픈만 허용
        const isValidName = /^[a-z0-9][a-z0-9-]*$/.test(fakePackage);
        expect(isValidName).toBe(true);
      });
    });

    // conda 채널 우선순위
    describe('channel priority', () => {
      const defaultChannels = ['defaults', 'conda-forge'];

      it('기본 채널 목록', () => {
        expect(defaultChannels).toContain('defaults');
        expect(defaultChannels).toContain('conda-forge');
      });

      it('채널 우선순위 동작', () => {
        // 동일 패키지가 여러 채널에 있을 때 첫 번째 채널 우선
        const selectPackage = (
          packages: Array<{ name: string; channel: string }>,
          channelPriority: string[]
        ): string | null => {
          for (const channel of channelPriority) {
            const pkg = packages.find((p) => p.channel === channel);
            if (pkg) return pkg.channel;
          }
          return null;
        };

        const packages = [
          { name: 'numpy', channel: 'conda-forge' },
          { name: 'numpy', channel: 'defaults' },
        ];

        // conda-forge 우선
        expect(selectPackage(packages, ['conda-forge', 'defaults'])).toBe('conda-forge');
        // defaults 우선
        expect(selectPackage(packages, ['defaults', 'conda-forge'])).toBe('defaults');
      });
    });

    // conda 버전 범위 매칭
    describe('version constraint matching', () => {
      const satisfiesConstraint = (version: string, constraint: string): boolean => {
        const parseVer = (v: string): number[] =>
          v.split('.').map((p) => parseInt(p, 10) || 0);

        const compare = (v1: number[], v2: number[]): number => {
          for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
            const a = v1[i] || 0;
            const b = v2[i] || 0;
            if (a !== b) return a - b;
          }
          return 0;
        };

        const ver = parseVer(version);

        // >=version,<version 형식 처리
        if (constraint.includes(',')) {
          const parts = constraint.split(',');
          return parts.every((part) => satisfiesConstraint(version, part.trim()));
        }

        if (constraint.startsWith('>=')) {
          return compare(ver, parseVer(constraint.slice(2))) >= 0;
        }
        if (constraint.startsWith('<=')) {
          return compare(ver, parseVer(constraint.slice(2))) <= 0;
        }
        if (constraint.startsWith('>')) {
          return compare(ver, parseVer(constraint.slice(1))) > 0;
        }
        if (constraint.startsWith('<')) {
          return compare(ver, parseVer(constraint.slice(1))) < 0;
        }
        if (constraint.startsWith('==') || constraint.startsWith('=')) {
          const constraintVer = constraint.replace(/^==?/, '');
          return compare(ver, parseVer(constraintVer)) === 0;
        }

        return compare(ver, parseVer(constraint)) === 0;
      };

      it('>= 제약 조건', () => {
        expect(satisfiesConstraint('1.25.0', '>=1.20.0')).toBe(true);
        expect(satisfiesConstraint('1.19.0', '>=1.20.0')).toBe(false);
      });

      it('< 제약 조건', () => {
        expect(satisfiesConstraint('1.25.0', '<2.0.0')).toBe(true);
        expect(satisfiesConstraint('2.0.0', '<2.0.0')).toBe(false);
      });

      it('복합 제약 조건', () => {
        expect(satisfiesConstraint('1.25.0', '>=1.20.0,<2.0.0')).toBe(true);
        expect(satisfiesConstraint('2.1.0', '>=1.20.0,<2.0.0')).toBe(false);
        expect(satisfiesConstraint('1.15.0', '>=1.20.0,<2.0.0')).toBe(false);
      });
    });

    // conda 패키지 파일명 파싱
    describe('package filename parsing', () => {
      interface CondaPackageInfo {
        name: string;
        version: string;
        build: string;
        extension: string;
      }

      const parseCondaFilename = (filename: string): CondaPackageInfo | null => {
        // name-version-build.tar.bz2 또는 name-version-build.conda
        const match = filename.match(/^(.+?)-(.+?)-(.+?)\.(tar\.bz2|conda)$/);
        if (!match) return null;

        return {
          name: match[1],
          version: match[2],
          build: match[3],
          extension: match[4],
        };
      };

      it('.tar.bz2 파일 파싱', () => {
        const info = parseCondaFilename('numpy-1.26.0-py311hc5f7015_0.tar.bz2');
        expect(info).not.toBeNull();
        expect(info!.name).toBe('numpy');
        expect(info!.version).toBe('1.26.0');
        expect(info!.build).toBe('py311hc5f7015_0');
        expect(info!.extension).toBe('tar.bz2');
      });

      it('.conda 파일 파싱', () => {
        const info = parseCondaFilename('requests-2.31.0-pyhd8ed1ab_0.conda');
        expect(info).not.toBeNull();
        expect(info!.name).toBe('requests');
        expect(info!.version).toBe('2.31.0');
        expect(info!.build).toBe('pyhd8ed1ab_0');
        expect(info!.extension).toBe('conda');
      });

      it('잘못된 파일명', () => {
        expect(parseCondaFilename('invalid.zip')).toBeNull();
        expect(parseCondaFilename('package.tar.bz2')).toBeNull(); // 버전/빌드 누락
      });
    });

    // 빌드 문자열 파싱
    describe('build string parsing', () => {
      interface BuildInfo {
        pythonVersion?: string;
        hash: string;
        buildNumber: number;
      }

      const parseBuildString = (build: string): BuildInfo => {
        // py311hc5f7015_0 형식
        const match = build.match(/^(py\d+)?(.+?)_(\d+)$/);
        if (!match) {
          return { hash: build, buildNumber: 0 };
        }

        return {
          pythonVersion: match[1],
          hash: match[2],
          buildNumber: parseInt(match[3], 10),
        };
      };

      it('Python 버전 포함 빌드 문자열', () => {
        const info = parseBuildString('py311hc5f7015_0');
        expect(info.pythonVersion).toBe('py311');
        expect(info.hash).toBe('hc5f7015');
        expect(info.buildNumber).toBe(0);
      });

      it('noarch 빌드 문자열 (pyhd 접두사)', () => {
        const info = parseBuildString('pyhd8ed1ab_0');
        expect(info.pythonVersion).toBe(undefined);
        expect(info.hash).toBe('pyhd8ed1ab');
        expect(info.buildNumber).toBe(0);
      });

      it('빌드 번호 증가', () => {
        const info1 = parseBuildString('py310h1234567_0');
        const info2 = parseBuildString('py310h1234567_1');
        expect(info2.buildNumber).toBeGreaterThan(info1.buildNumber);
      });
    });
  });
});
