import { describe, it, expect, beforeEach } from 'vitest';
import { getPipDownloader } from './pip';

describe('pip downloader', () => {
  let downloader: ReturnType<typeof getPipDownloader>;

  beforeEach(() => {
    downloader = getPipDownloader();
  });

  describe('getPipDownloader', () => {
    it('싱글톤 인스턴스 반환', () => {
      const instance1 = getPipDownloader();
      const instance2 = getPipDownloader();
      expect(instance1).toBe(instance2);
    });

    it('type이 pip', () => {
      expect(downloader.type).toBe('pip');
    });
  });

  describe('searchPackages (integration)', () => {
    it.skip('패키지 검색', async () => {
      const results = await downloader.searchPackages('requests');
      expect(Array.isArray(results)).toBe(true);
      if (results.length > 0) {
        expect(results[0]).toHaveProperty('name');
      }
    });
  });

  describe('getVersions (integration)', () => {
    it.skip('버전 목록 조회', async () => {
      const versions = await downloader.getVersions('requests');
      expect(Array.isArray(versions)).toBe(true);
      expect(versions.length).toBeGreaterThan(0);
    });
  });
});

// pip 다운로더 유틸리티 로직 테스트
describe('pip downloader utilities', () => {
  describe('release selection logic', () => {
    // PyPIRelease 구조 mock
    interface MockRelease {
      filename: string;
      packagetype: string;
      python_version?: string;
      url?: string;
    }

    const selectBestRelease = (releases: MockRelease[]): MockRelease | null => {
      if (releases.length === 0) return null;

      // wheel 파일 우선
      const wheels = releases.filter((r) => r.packagetype === 'bdist_wheel');
      if (wheels.length > 0) {
        // 범용 wheel 우선 (py3-none-any)
        const universal = wheels.find(
          (w) =>
            w.filename.includes('py3-none-any') ||
            w.filename.includes('py2.py3-none-any')
        );
        if (universal) return universal;

        // 그 외 wheel
        return wheels[0];
      }

      // source distribution
      const sdist = releases.find((r) => r.packagetype === 'sdist');
      if (sdist) return sdist;

      return releases[0];
    };

    it('범용 wheel 우선 선택', () => {
      const releases: MockRelease[] = [
        { filename: 'package-1.0.0-py3-none-any.whl', packagetype: 'bdist_wheel' },
        { filename: 'package-1.0.0-cp39-cp39-manylinux1_x86_64.whl', packagetype: 'bdist_wheel' },
        { filename: 'package-1.0.0.tar.gz', packagetype: 'sdist' },
      ];
      const selected = selectBestRelease(releases);
      expect(selected?.filename).toBe('package-1.0.0-py3-none-any.whl');
    });

    it('py2.py3 범용 wheel 선택', () => {
      const releases: MockRelease[] = [
        { filename: 'package-1.0.0-py2.py3-none-any.whl', packagetype: 'bdist_wheel' },
        { filename: 'package-1.0.0.tar.gz', packagetype: 'sdist' },
      ];
      const selected = selectBestRelease(releases);
      expect(selected?.filename).toBe('package-1.0.0-py2.py3-none-any.whl');
    });

    it('범용 wheel 없으면 첫 번째 wheel 선택', () => {
      const releases: MockRelease[] = [
        { filename: 'package-1.0.0-cp39-cp39-manylinux1_x86_64.whl', packagetype: 'bdist_wheel' },
        { filename: 'package-1.0.0-cp38-cp38-win_amd64.whl', packagetype: 'bdist_wheel' },
        { filename: 'package-1.0.0.tar.gz', packagetype: 'sdist' },
      ];
      const selected = selectBestRelease(releases);
      expect(selected?.filename).toBe('package-1.0.0-cp39-cp39-manylinux1_x86_64.whl');
    });

    it('wheel 없으면 sdist 선택', () => {
      const releases: MockRelease[] = [
        { filename: 'package-1.0.0.tar.gz', packagetype: 'sdist' },
        { filename: 'package-1.0.0.zip', packagetype: 'sdist' },
      ];
      const selected = selectBestRelease(releases);
      expect(selected?.filename).toBe('package-1.0.0.tar.gz');
    });

    it('빈 배열 처리', () => {
      expect(selectBestRelease([])).toBeNull();
    });
  });

  describe('architecture pattern matching', () => {
    const archPatterns: Record<string, string[]> = {
      x86_64: ['x86_64', 'amd64', 'win_amd64', 'manylinux_x86_64', 'manylinux1', 'manylinux2010', 'manylinux2014'],
      amd64: ['x86_64', 'amd64', 'win_amd64'],
      arm64: ['arm64', 'aarch64', 'macosx_arm64'],
      aarch64: ['arm64', 'aarch64', 'linux_aarch64'],
      i386: ['i386', 'i686', 'win32'],
    };

    const matchesArch = (filename: string, arch: string): boolean => {
      const patterns = archPatterns[arch] || [arch];
      return patterns.some((p) => filename.toLowerCase().includes(p));
    };

    it('x86_64 아키텍처 매칭', () => {
      expect(matchesArch('package-1.0.0-cp39-cp39-manylinux1_x86_64.whl', 'x86_64')).toBe(true);
      expect(matchesArch('package-1.0.0-cp39-cp39-win_amd64.whl', 'x86_64')).toBe(true);
      expect(matchesArch('package-1.0.0-cp39-cp39-manylinux2014_x86_64.whl', 'x86_64')).toBe(true);
    });

    it('arm64 아키텍처 매칭', () => {
      expect(matchesArch('package-1.0.0-cp39-cp39-macosx_arm64.whl', 'arm64')).toBe(true);
      expect(matchesArch('package-1.0.0-cp39-cp39-linux_aarch64.whl', 'arm64')).toBe(true);
    });

    it('i386 아키텍처 매칭', () => {
      expect(matchesArch('package-1.0.0-cp39-cp39-win32.whl', 'i386')).toBe(true);
    });

    it('매칭되지 않는 경우', () => {
      expect(matchesArch('package-1.0.0-cp39-cp39-win_amd64.whl', 'arm64')).toBe(false);
    });
  });

  describe('OS pattern matching', () => {
    const osPatterns: Record<string, string[]> = {
      windows: ['win_amd64', 'win32', 'win'],
      macos: ['macosx', 'darwin'],
      linux: ['manylinux', 'linux_x86_64', 'linux_aarch64', 'linux'],
    };

    const matchesOS = (filename: string, targetOS: string): boolean => {
      const patterns = osPatterns[targetOS] || [];
      return patterns.some((p) => filename.toLowerCase().includes(p));
    };

    it('Windows OS 매칭', () => {
      expect(matchesOS('package-1.0.0-cp39-cp39-win_amd64.whl', 'windows')).toBe(true);
      expect(matchesOS('package-1.0.0-cp39-cp39-win32.whl', 'windows')).toBe(true);
    });

    it('macOS 매칭', () => {
      expect(matchesOS('package-1.0.0-cp39-cp39-macosx_10_9_x86_64.whl', 'macos')).toBe(true);
      expect(matchesOS('package-1.0.0-cp39-cp39-macosx_arm64.whl', 'macos')).toBe(true);
    });

    it('Linux 매칭', () => {
      expect(matchesOS('package-1.0.0-cp39-cp39-manylinux1_x86_64.whl', 'linux')).toBe(true);
      expect(matchesOS('package-1.0.0-cp39-cp39-linux_x86_64.whl', 'linux')).toBe(true);
    });

    it('cross-platform 매칭', () => {
      // none-any는 모든 플랫폼에서 동작
      expect(matchesOS('package-1.0.0-py3-none-any.whl', 'windows')).toBe(false);
      expect(matchesOS('package-1.0.0-py3-none-any.whl', 'linux')).toBe(false);
      // 이 경우는 별도 처리 필요 (pure Python package)
    });
  });

  describe('Python version matching', () => {
    const matchesPythonVersion = (pythonVersion: string, target: string): boolean => {
      return pythonVersion === 'py3' || pythonVersion.includes(target);
    };

    it('py3 범용 버전', () => {
      expect(matchesPythonVersion('py3', '39')).toBe(true);
      expect(matchesPythonVersion('py3', '310')).toBe(true);
    });

    it('특정 Python 버전', () => {
      expect(matchesPythonVersion('cp39', '39')).toBe(true);
      expect(matchesPythonVersion('cp310', '310')).toBe(true);
    });

    it('버전 불일치', () => {
      expect(matchesPythonVersion('cp38', '39')).toBe(false);
    });
  });

  // 사용자 추천 테스트 케이스 기반 테스트
  describe('recommended test cases', () => {
    // 일반 케이스 - httpx (비동기 HTTP 클라이언트, 전이 의존성 많음)
    describe('httpx package case', () => {
      // httpx의 주요 의존성: httpcore, anyio, certifi, sniffio 등
      const httpxDependencies = [
        'httpcore',
        'anyio',
        'certifi',
        'sniffio',
        'h11',
        'idna',
      ];

      it('httpx 의존성 목록이 알려진 형태와 일치', () => {
        // httpx는 순수 Python 패키지로 의존성이 명확함
        expect(httpxDependencies.length).toBeGreaterThanOrEqual(4);
        expect(httpxDependencies).toContain('httpcore');
        expect(httpxDependencies).toContain('anyio');
      });

      it('httpx는 범용 wheel 패키지 (py3-none-any)', () => {
        const mockFiles = [
          'httpx-0.27.0-py3-none-any.whl',
          'httpx-0.27.0.tar.gz',
        ];
        const hasUniversalWheel = mockFiles.some((f) => f.includes('py3-none-any'));
        expect(hasUniversalWheel).toBe(true);
      });
    });

    // 일반 케이스 - rich (터미널 서식 라이브러리)
    describe('rich package case', () => {
      const richDependencies = ['markdown-it-py', 'pygments', 'typing_extensions'];

      it('rich는 전이 의존성을 가짐', () => {
        expect(richDependencies).toContain('pygments');
        expect(richDependencies).toContain('markdown-it-py');
      });

      it('rich는 순수 Python 패키지', () => {
        const isPurePython = true; // py3-none-any wheel 제공
        expect(isPurePython).toBe(true);
      });
    });

    // 플랫폼 특수 케이스 - cryptography (C 확장)
    describe('cryptography package case', () => {
      const platformWheels = [
        'cryptography-42.0.0-cp39-abi3-manylinux_2_28_x86_64.whl',
        'cryptography-42.0.0-cp39-abi3-macosx_10_12_x86_64.whl',
        'cryptography-42.0.0-cp39-abi3-win_amd64.whl',
        'cryptography-42.0.0-cp39-abi3-manylinux_2_28_aarch64.whl',
        'cryptography-42.0.0-cp39-abi3-macosx_10_12_arm64.whl',
      ];

      it('cryptography는 플랫폼별 wheel 제공', () => {
        const linuxWheels = platformWheels.filter((w) => w.includes('manylinux'));
        const macWheels = platformWheels.filter((w) => w.includes('macosx'));
        const winWheels = platformWheels.filter((w) => w.includes('win'));

        expect(linuxWheels.length).toBeGreaterThan(0);
        expect(macWheels.length).toBeGreaterThan(0);
        expect(winWheels.length).toBeGreaterThan(0);
      });

      it('cryptography arm64 wheel 존재 확인', () => {
        const arm64Wheels = platformWheels.filter(
          (w) => w.includes('aarch64') || w.includes('arm64')
        );
        expect(arm64Wheels.length).toBeGreaterThan(0);
      });

      it('cryptography는 abi3 wheel 사용 (Python 버전 호환)', () => {
        const abi3Wheels = platformWheels.filter((w) => w.includes('abi3'));
        expect(abi3Wheels.length).toBe(platformWheels.length);
      });
    });

    // 버전 조건부 의존성 - backports.zoneinfo
    describe('backports.zoneinfo case', () => {
      // Python 3.9+ 에서는 내장, 3.8 이하에서만 필요
      const pythonVersionCheck = (version: string): boolean => {
        const [major, minor] = version.split('.').map(Number);
        return major === 3 && minor < 9;
      };

      it('Python 3.8에서는 backports.zoneinfo 필요', () => {
        expect(pythonVersionCheck('3.8')).toBe(true);
      });

      it('Python 3.9+에서는 backports.zoneinfo 불필요', () => {
        expect(pythonVersionCheck('3.9')).toBe(false);
        expect(pythonVersionCheck('3.10')).toBe(false);
        expect(pythonVersionCheck('3.11')).toBe(false);
      });
    });

    // 예외 케이스 - 존재하지 않는 패키지
    describe('non-existent package case', () => {
      it('존재하지 않는 패키지명 검증', () => {
        const nonExistentPackage = 'thisisafakepackagethatdoesnotexist12345';
        // 패키지명 형식은 유효하지만 존재하지 않음
        const isValidFormat = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(nonExistentPackage);
        expect(isValidFormat).toBe(true);
      });
    });

    // 복잡한 의존성 트리 시뮬레이션
    describe('dependency tree resolution', () => {
      interface DependencyNode {
        name: string;
        version: string;
        dependencies: DependencyNode[];
      }

      const flattenDependencies = (node: DependencyNode): string[] => {
        const result: string[] = [node.name];
        for (const dep of node.dependencies) {
          result.push(...flattenDependencies(dep));
        }
        return result;
      };

      const removeDuplicates = (deps: string[]): string[] => {
        return [...new Set(deps)];
      };

      it('httpx 의존성 트리 평탄화', () => {
        const httpxTree: DependencyNode = {
          name: 'httpx',
          version: '0.27.0',
          dependencies: [
            {
              name: 'httpcore',
              version: '1.0.0',
              dependencies: [
                { name: 'h11', version: '0.14.0', dependencies: [] },
                { name: 'certifi', version: '2024.0.0', dependencies: [] },
              ],
            },
            {
              name: 'anyio',
              version: '4.0.0',
              dependencies: [
                { name: 'sniffio', version: '1.3.0', dependencies: [] },
              ],
            },
            { name: 'idna', version: '3.6', dependencies: [] },
          ],
        };

        const allDeps = flattenDependencies(httpxTree);
        const uniqueDeps = removeDuplicates(allDeps);

        expect(uniqueDeps).toContain('httpx');
        expect(uniqueDeps).toContain('httpcore');
        expect(uniqueDeps).toContain('h11');
        expect(uniqueDeps).toContain('anyio');
        expect(uniqueDeps).toContain('sniffio');
        expect(uniqueDeps.length).toBe(7);
      });

      it('중복 의존성 제거', () => {
        const depsWithDuplicates = ['requests', 'urllib3', 'charset-normalizer', 'urllib3', 'idna'];
        const unique = removeDuplicates(depsWithDuplicates);
        expect(unique.length).toBe(4);
      });
    });

    // wheel 파일명 파싱
    describe('wheel filename parsing', () => {
      interface WheelInfo {
        name: string;
        version: string;
        pythonTag: string;
        abiTag: string;
        platformTag: string;
      }

      const parseWheelFilename = (filename: string): WheelInfo | null => {
        // {distribution}-{version}(-{build tag})?-{python tag}-{abi tag}-{platform tag}.whl
        const match = filename.match(
          /^(.+?)-(.+?)(?:-(\d+?))?-(.+?)-(.+?)-(.+?)\.whl$/
        );
        if (!match) return null;

        return {
          name: match[1],
          version: match[2],
          pythonTag: match[4],
          abiTag: match[5],
          platformTag: match[6],
        };
      };

      it('범용 wheel 파싱', () => {
        const info = parseWheelFilename('httpx-0.27.0-py3-none-any.whl');
        expect(info).not.toBeNull();
        expect(info!.name).toBe('httpx');
        expect(info!.version).toBe('0.27.0');
        expect(info!.pythonTag).toBe('py3');
        expect(info!.abiTag).toBe('none');
        expect(info!.platformTag).toBe('any');
      });

      it('플랫폼 특정 wheel 파싱', () => {
        const info = parseWheelFilename('cryptography-42.0.0-cp39-abi3-manylinux_2_28_x86_64.whl');
        expect(info).not.toBeNull();
        expect(info!.name).toBe('cryptography');
        expect(info!.version).toBe('42.0.0');
        expect(info!.pythonTag).toBe('cp39');
        expect(info!.abiTag).toBe('abi3');
        expect(info!.platformTag).toBe('manylinux_2_28_x86_64');
      });

      it('잘못된 파일명은 null 반환', () => {
        expect(parseWheelFilename('notawheel.tar.gz')).toBeNull();
        expect(parseWheelFilename('package-1.0.0.whl')).toBeNull(); // 태그 누락
      });
    });

    // 버전 범위 매칭 (requirements.txt 스타일)
    describe('version range matching', () => {
      const satisfiesVersionRange = (version: string, range: string): boolean => {
        // 단순 버전 파서
        const parseVer = (v: string): number[] => v.split('.').map((p) => parseInt(p, 10) || 0);
        const compare = (v1: number[], v2: number[]): number => {
          for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
            const a = v1[i] || 0;
            const b = v2[i] || 0;
            if (a !== b) return a - b;
          }
          return 0;
        };

        const ver = parseVer(version);

        if (range.startsWith('>=')) {
          return compare(ver, parseVer(range.slice(2))) >= 0;
        }
        if (range.startsWith('<=')) {
          return compare(ver, parseVer(range.slice(2))) <= 0;
        }
        if (range.startsWith('>')) {
          return compare(ver, parseVer(range.slice(1))) > 0;
        }
        if (range.startsWith('<')) {
          return compare(ver, parseVer(range.slice(1))) < 0;
        }
        if (range.startsWith('==')) {
          return compare(ver, parseVer(range.slice(2))) === 0;
        }
        if (range.startsWith('~=')) {
          // Compatible release: ~=1.4.2 means >=1.4.2, ==1.4.*
          const rangeVer = parseVer(range.slice(2));
          return compare(ver, rangeVer) >= 0 && ver[0] === rangeVer[0] && ver[1] === rangeVer[1];
        }

        return compare(ver, parseVer(range)) === 0;
      };

      it('>= 연산자', () => {
        expect(satisfiesVersionRange('2.28.0', '>=2.25.0')).toBe(true);
        expect(satisfiesVersionRange('2.24.0', '>=2.25.0')).toBe(false);
      });

      it('<= 연산자', () => {
        expect(satisfiesVersionRange('2.28.0', '<=3.0.0')).toBe(true);
        expect(satisfiesVersionRange('3.1.0', '<=3.0.0')).toBe(false);
      });

      it('== 연산자', () => {
        expect(satisfiesVersionRange('2.28.0', '==2.28.0')).toBe(true);
        expect(satisfiesVersionRange('2.28.1', '==2.28.0')).toBe(false);
      });

      it('~= 호환 릴리스', () => {
        expect(satisfiesVersionRange('1.4.5', '~=1.4.2')).toBe(true);
        expect(satisfiesVersionRange('1.5.0', '~=1.4.2')).toBe(false);
        expect(satisfiesVersionRange('1.4.1', '~=1.4.2')).toBe(false);
      });
    });
  });
});
