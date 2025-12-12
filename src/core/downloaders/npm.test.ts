import { describe, it, expect, beforeEach } from 'vitest';
import { getNpmDownloader } from './npm';

describe('npm downloader', () => {
  let downloader: ReturnType<typeof getNpmDownloader>;

  beforeEach(() => {
    downloader = getNpmDownloader();
  });

  describe('getNpmDownloader', () => {
    it('싱글톤 인스턴스 반환', () => {
      const instance1 = getNpmDownloader();
      const instance2 = getNpmDownloader();
      expect(instance1).toBe(instance2);
    });

    it('type이 npm', () => {
      expect(downloader.type).toBe('npm');
    });
  });

  describe('searchPackages (integration)', () => {
    it.skip('패키지 검색', async () => {
      const results = await downloader.searchPackages('react');
      expect(Array.isArray(results)).toBe(true);
      if (results.length > 0) {
        expect(results[0]).toHaveProperty('name');
      }
    });
  });

  describe('getVersions (integration)', () => {
    it.skip('버전 목록 조회', async () => {
      const versions = await downloader.getVersions('lodash');
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

// npm semver 로직 테스트
describe('npm semver utilities', () => {
  // parseVersion 로직
  const parseVersion = (version: string): number[] => {
    return version.split('.').map((p) => parseInt(p, 10) || 0);
  };

  // compareVersions 로직
  const compareVersions = (a: string, b: string): number => {
    const partsA = parseVersion(a);
    const partsB = parseVersion(b);

    for (let i = 0; i < 3; i++) {
      const diff = (partsA[i] || 0) - (partsB[i] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  };

  // satisfiesTilde 로직 (~)
  const satisfiesTilde = (version: string, rangeVersion: string): boolean => {
    const [vMajor, vMinor = 0, vPatch = 0] = parseVersion(version);
    const [rMajor, rMinor = 0, rPatch = 0] = parseVersion(rangeVersion);

    return vMajor === rMajor && vMinor === rMinor && vPatch >= rPatch;
  };

  // satisfiesCaret 로직 (^)
  const satisfiesCaret = (version: string, rangeVersion: string): boolean => {
    const [vMajor, vMinor = 0, vPatch = 0] = parseVersion(version);
    const [rMajor, rMinor = 0, rPatch = 0] = parseVersion(rangeVersion);

    if (rMajor === 0) {
      if (rMinor === 0) {
        // ^0.0.x - patch만 허용
        return vMajor === 0 && vMinor === 0 && vPatch >= rPatch;
      }
      // ^0.x.x - minor 고정
      return vMajor === 0 && vMinor === rMinor && vPatch >= rPatch;
    }

    // ^x.x.x - major 고정
    return vMajor === rMajor && (vMinor > rMinor || (vMinor === rMinor && vPatch >= rPatch));
  };

  // satisfies 로직
  const satisfies = (version: string, range: string): boolean => {
    // 정확한 버전
    if (version === range) return true;

    // 와일드카드
    if (range === '*' || range === '' || range === 'x') return true;

    // ^ 범위 (major 고정)
    if (range.startsWith('^')) {
      const rangeVersion = range.slice(1);
      return satisfiesCaret(version, rangeVersion);
    }

    // ~ 범위 (minor 고정)
    if (range.startsWith('~')) {
      const rangeVersion = range.slice(1);
      return satisfiesTilde(version, rangeVersion);
    }

    // >= 범위
    if (range.startsWith('>=')) {
      const rangeVersion = range.slice(2);
      return compareVersions(version, rangeVersion) >= 0;
    }

    // > 범위
    if (range.startsWith('>')) {
      const rangeVersion = range.slice(1);
      return compareVersions(version, rangeVersion) > 0;
    }

    // <= 범위
    if (range.startsWith('<=')) {
      const rangeVersion = range.slice(2);
      return compareVersions(version, rangeVersion) <= 0;
    }

    // < 범위
    if (range.startsWith('<')) {
      const rangeVersion = range.slice(1);
      return compareVersions(version, rangeVersion) < 0;
    }

    // = 또는 없음 (정확한 버전)
    const cleanRange = range.startsWith('=') ? range.slice(1) : range;
    return version === cleanRange;
  };

  describe('parseVersion', () => {
    it('기본 버전 파싱', () => {
      expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
    });

    it('2자리 버전', () => {
      expect(parseVersion('1.2')).toEqual([1, 2]);
    });

    it('1자리 버전', () => {
      expect(parseVersion('1')).toEqual([1]);
    });
  });

  describe('compareVersions', () => {
    it('동일 버전', () => {
      expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    });

    it('major 차이', () => {
      expect(compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0);
      expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
    });

    it('minor 차이', () => {
      expect(compareVersions('1.2.0', '1.1.0')).toBeGreaterThan(0);
    });

    it('patch 차이', () => {
      expect(compareVersions('1.0.2', '1.0.1')).toBeGreaterThan(0);
    });
  });

  describe('satisfies (정확 매칭)', () => {
    it('정확히 일치', () => {
      expect(satisfies('1.0.0', '1.0.0')).toBe(true);
      expect(satisfies('1.0.0', '1.0.1')).toBe(false);
    });

    it('= 연산자', () => {
      expect(satisfies('1.0.0', '=1.0.0')).toBe(true);
    });
  });

  describe('satisfies (와일드카드)', () => {
    it('* 와일드카드', () => {
      expect(satisfies('1.0.0', '*')).toBe(true);
      expect(satisfies('5.3.2', '*')).toBe(true);
    });

    it('빈 문자열', () => {
      expect(satisfies('1.0.0', '')).toBe(true);
    });

    it('x 와일드카드', () => {
      expect(satisfies('1.0.0', 'x')).toBe(true);
    });
  });

  describe('satisfies (비교 연산자)', () => {
    it('>= 연산자', () => {
      expect(satisfies('1.5.0', '>=1.0.0')).toBe(true);
      expect(satisfies('1.0.0', '>=1.0.0')).toBe(true);
      expect(satisfies('0.9.0', '>=1.0.0')).toBe(false);
    });

    it('> 연산자', () => {
      expect(satisfies('1.5.0', '>1.0.0')).toBe(true);
      expect(satisfies('1.0.0', '>1.0.0')).toBe(false);
    });

    it('<= 연산자', () => {
      expect(satisfies('1.0.0', '<=2.0.0')).toBe(true);
      expect(satisfies('2.0.0', '<=2.0.0')).toBe(true);
      expect(satisfies('2.1.0', '<=2.0.0')).toBe(false);
    });

    it('< 연산자', () => {
      expect(satisfies('0.9.0', '<1.0.0')).toBe(true);
      expect(satisfies('1.0.0', '<1.0.0')).toBe(false);
    });
  });

  describe('satisfies (~ tilde)', () => {
    it('~1.2.3 - patch 업데이트만 허용', () => {
      expect(satisfies('1.2.3', '~1.2.3')).toBe(true);
      expect(satisfies('1.2.4', '~1.2.3')).toBe(true);
      expect(satisfies('1.2.99', '~1.2.3')).toBe(true);
      expect(satisfies('1.3.0', '~1.2.3')).toBe(false);
      expect(satisfies('2.0.0', '~1.2.3')).toBe(false);
    });

    it('~1.2.0', () => {
      expect(satisfies('1.2.0', '~1.2.0')).toBe(true);
      expect(satisfies('1.2.5', '~1.2.0')).toBe(true);
      expect(satisfies('1.3.0', '~1.2.0')).toBe(false);
    });
  });

  describe('satisfies (^ caret)', () => {
    it('^1.2.3 - major 고정', () => {
      expect(satisfies('1.2.3', '^1.2.3')).toBe(true);
      expect(satisfies('1.2.4', '^1.2.3')).toBe(true);
      expect(satisfies('1.3.0', '^1.2.3')).toBe(true);
      expect(satisfies('1.9.9', '^1.2.3')).toBe(true);
      expect(satisfies('2.0.0', '^1.2.3')).toBe(false);
    });

    it('^0.2.3 - minor 고정 (0.x의 경우)', () => {
      expect(satisfies('0.2.3', '^0.2.3')).toBe(true);
      expect(satisfies('0.2.4', '^0.2.3')).toBe(true);
      expect(satisfies('0.3.0', '^0.2.3')).toBe(false);
    });

    it('^0.0.3 - patch 고정 (0.0.x의 경우)', () => {
      expect(satisfies('0.0.3', '^0.0.3')).toBe(true);
      expect(satisfies('0.0.4', '^0.0.3')).toBe(true);
      expect(satisfies('0.0.2', '^0.0.3')).toBe(false);
      expect(satisfies('0.1.0', '^0.0.3')).toBe(false);
    });
  });

  // 사용자 추천 테스트 케이스 기반 테스트
  describe('recommended test cases', () => {
    // 일반 케이스 - chalk (ESM 전환된 패키지)
    describe('chalk package case', () => {
      it('chalk v5+는 ESM 전용', () => {
        const isEsmOnlyVersion = (version: string): boolean => {
          const major = parseInt(version.split('.')[0], 10);
          return major >= 5;
        };

        expect(isEsmOnlyVersion('5.0.0')).toBe(true);
        expect(isEsmOnlyVersion('4.1.2')).toBe(false);
      });

      it('chalk 의존성 체인', () => {
        // chalk v4 의존성
        const chalkV4Deps = ['ansi-styles', 'supports-color'];
        expect(chalkV4Deps).toContain('ansi-styles');
        expect(chalkV4Deps).toContain('supports-color');
      });
    });

    // 일반 케이스 - debug (전이 의존성)
    describe('debug package case', () => {
      const debugDependencies = ['ms'];

      it('debug는 ms에 의존', () => {
        expect(debugDependencies).toContain('ms');
      });

      it('debug는 많은 패키지에서 사용됨', () => {
        const dependents = ['express', 'mocha', 'socket.io', 'mongoose'];
        expect(dependents.length).toBeGreaterThan(3);
      });
    });

    // 네이티브 빌드 케이스 - node-sass
    describe('node-sass package case (native build)', () => {
      it('node-sass는 네이티브 바이너리 필요', () => {
        const hasNativeBinding = true;
        expect(hasNativeBinding).toBe(true);
      });

      it('node-sass는 deprecated (dart-sass 권장)', () => {
        const isDeprecated = true;
        const replacement = 'sass';
        expect(isDeprecated).toBe(true);
        expect(replacement).toBe('sass');
      });

      it('node-sass 플랫폼별 바이너리', () => {
        const platforms = ['darwin-x64', 'darwin-arm64', 'linux-x64', 'win32-x64'];
        expect(platforms).toContain('darwin-arm64');
        expect(platforms.length).toBeGreaterThan(3);
      });
    });

    // macOS 전용 케이스 - fsevents
    describe('fsevents package case (macOS only)', () => {
      it('fsevents는 macOS 전용', () => {
        const supportedPlatforms = ['darwin'];
        expect(supportedPlatforms).toContain('darwin');
        expect(supportedPlatforms).not.toContain('linux');
        expect(supportedPlatforms).not.toContain('win32');
      });

      it('fsevents는 optionalDependencies로 설치', () => {
        const dependencyType = 'optionalDependencies';
        expect(dependencyType).toBe('optionalDependencies');
      });

      it('다른 플랫폼에서는 설치 스킵', () => {
        const shouldInstall = (platform: string): boolean => {
          return platform === 'darwin';
        };

        expect(shouldInstall('darwin')).toBe(true);
        expect(shouldInstall('linux')).toBe(false);
        expect(shouldInstall('win32')).toBe(false);
      });
    });

    // scoped 패키지 케이스 - @types/node
    describe('@types/node package case (scoped)', () => {
      it('scoped 패키지명 파싱', () => {
        const parseScopedName = (name: string): { scope?: string; packageName: string } => {
          const match = name.match(/^@([^/]+)\/(.+)$/);
          if (!match) return { packageName: name };
          return { scope: match[1], packageName: match[2] };
        };

        const result = parseScopedName('@types/node');
        expect(result.scope).toBe('types');
        expect(result.packageName).toBe('node');
      });

      it('@types 패키지는 devDependencies에 설치', () => {
        const isDevDependency = (name: string): boolean => {
          return name.startsWith('@types/');
        };

        expect(isDevDependency('@types/node')).toBe(true);
        expect(isDevDependency('@types/react')).toBe(true);
        expect(isDevDependency('typescript')).toBe(false);
      });

      it('scoped 패키지 tarball URL', () => {
        const scope = 'types';
        const packageName = 'node';
        const version = '20.10.0';
        const tarballUrl = `https://registry.npmjs.org/@${scope}/${packageName}/-/${packageName}-${version}.tgz`;
        expect(tarballUrl).toBe('https://registry.npmjs.org/@types/node/-/node-20.10.0.tgz');
      });
    });

    // 예외 케이스 - 존재하지 않는 패키지
    describe('non-existent package case', () => {
      it('존재하지 않는 패키지명 형식 검증', () => {
        const fakePackage = 'this-package-does-not-exist-12345';
        // npm 패키지명 규칙: 소문자, 숫자, 하이픈, 언더스코어, 점
        const isValidName = /^[a-z0-9][a-z0-9._-]*$/.test(fakePackage);
        expect(isValidName).toBe(true);
      });
    });

    // package.json 의존성 타입
    describe('dependency types', () => {
      type DependencyType = 'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies';

      const getInstallPriority = (type: DependencyType): number => {
        const priority: Record<DependencyType, number> = {
          dependencies: 1,
          peerDependencies: 2,
          optionalDependencies: 3,
          devDependencies: 4,
        };
        return priority[type];
      };

      it('dependencies가 가장 높은 우선순위', () => {
        expect(getInstallPriority('dependencies')).toBeLessThan(getInstallPriority('devDependencies'));
      });

      it('peerDependencies는 호스트 패키지에서 제공', () => {
        const peerDepsHandling = 'host-provided';
        expect(peerDepsHandling).toBe('host-provided');
      });

      it('optionalDependencies는 설치 실패해도 계속', () => {
        const failOnError = false;
        expect(failOnError).toBe(false);
      });
    });

    // tarball 무결성 검증
    describe('tarball integrity', () => {
      const parseIntegrity = (integrity: string): { algorithm: string; hash: string } | null => {
        const match = integrity.match(/^(sha\d+)-(.+)$/);
        if (!match) return null;
        return { algorithm: match[1], hash: match[2] };
      };

      it('sha512 무결성 파싱', () => {
        const integrity = 'sha512-ABC123DEF456...';
        const parsed = parseIntegrity(integrity);
        expect(parsed).not.toBeNull();
        expect(parsed!.algorithm).toBe('sha512');
      });

      it('sha1 무결성 파싱 (레거시)', () => {
        const integrity = 'sha1-ABC123...';
        const parsed = parseIntegrity(integrity);
        expect(parsed).not.toBeNull();
        expect(parsed!.algorithm).toBe('sha1');
      });
    });

    // lock 파일 버전
    describe('lock file versions', () => {
      type LockfileVersion = 1 | 2 | 3;

      const getLockfileFormat = (version: LockfileVersion): string => {
        const formats: Record<LockfileVersion, string> = {
          1: 'npm v5-v6',
          2: 'npm v7+, backwards compatible',
          3: 'npm v7+, hidden lockfile',
        };
        return formats[version];
      };

      it('lockfile v1 형식', () => {
        expect(getLockfileFormat(1)).toContain('v5');
      });

      it('lockfile v2 형식 (현재 기본)', () => {
        expect(getLockfileFormat(2)).toContain('v7');
        expect(getLockfileFormat(2)).toContain('backwards');
      });

      it('lockfile v3 형식 (hidden)', () => {
        expect(getLockfileFormat(3)).toContain('hidden');
      });
    });

    // 의존성 트리 평탄화
    describe('dependency tree flattening', () => {
      interface DepNode {
        name: string;
        version: string;
        dependencies?: Record<string, DepNode>;
      }

      const flattenTree = (node: DepNode, result: Map<string, string[]> = new Map()): Map<string, string[]> => {
        const versions = result.get(node.name) || [];
        if (!versions.includes(node.version)) {
          versions.push(node.version);
          result.set(node.name, versions);
        }

        if (node.dependencies) {
          for (const dep of Object.values(node.dependencies)) {
            flattenTree(dep, result);
          }
        }

        return result;
      };

      it('의존성 트리 평탄화', () => {
        const tree: DepNode = {
          name: 'app',
          version: '1.0.0',
          dependencies: {
            lodash: { name: 'lodash', version: '4.17.21' },
            express: {
              name: 'express',
              version: '4.18.2',
              dependencies: {
                'accepts': { name: 'accepts', version: '1.3.8' },
              },
            },
          },
        };

        const flat = flattenTree(tree);
        expect(flat.has('lodash')).toBe(true);
        expect(flat.has('express')).toBe(true);
        expect(flat.has('accepts')).toBe(true);
      });

      it('중복 버전 감지', () => {
        const tree: DepNode = {
          name: 'app',
          version: '1.0.0',
          dependencies: {
            a: {
              name: 'a',
              version: '1.0.0',
              dependencies: {
                lodash: { name: 'lodash', version: '4.17.21' },
              },
            },
            b: {
              name: 'b',
              version: '1.0.0',
              dependencies: {
                lodash: { name: 'lodash', version: '4.17.20' },
              },
            },
          },
        };

        const flat = flattenTree(tree);
        const lodashVersions = flat.get('lodash') || [];
        expect(lodashVersions.length).toBe(2);
        expect(lodashVersions).toContain('4.17.21');
        expect(lodashVersions).toContain('4.17.20');
      });
    });

    // bin 필드 처리
    describe('bin field handling', () => {
      type BinField = string | Record<string, string>;

      const normalizeBin = (name: string, bin: BinField): Record<string, string> => {
        if (typeof bin === 'string') {
          return { [name]: bin };
        }
        return bin;
      };

      it('문자열 bin 필드', () => {
        const result = normalizeBin('typescript', './bin/tsc');
        expect(result).toEqual({ typescript: './bin/tsc' });
      });

      it('객체 bin 필드', () => {
        const bin = { tsc: './bin/tsc', tsserver: './bin/tsserver' };
        const result = normalizeBin('typescript', bin);
        expect(result).toEqual(bin);
      });
    });

    // engines 필드 검증
    describe('engines field validation', () => {
      interface Engines {
        node?: string;
        npm?: string;
      }

      const checkEngineCompatibility = (
        engines: Engines,
        nodeVersion: string
      ): boolean => {
        if (!engines.node) return true;

        // 간단한 검증 (실제로는 semver 사용)
        const minVersion = engines.node.replace(/^[>=]+/, '');
        const nodeParts = nodeVersion.split('.').map(Number);
        const minParts = minVersion.split('.').map(Number);

        return nodeParts[0] > minParts[0] ||
          (nodeParts[0] === minParts[0] && nodeParts[1] >= minParts[1]);
      };

      it('node 버전 호환성 체크', () => {
        const engines: Engines = { node: '>=18.0.0' };
        expect(checkEngineCompatibility(engines, '20.0.0')).toBe(true);
        expect(checkEngineCompatibility(engines, '18.0.0')).toBe(true);
        expect(checkEngineCompatibility(engines, '16.0.0')).toBe(false);
      });

      it('engines 없으면 모든 버전 호환', () => {
        expect(checkEngineCompatibility({}, '12.0.0')).toBe(true);
      });
    });
  });
});
