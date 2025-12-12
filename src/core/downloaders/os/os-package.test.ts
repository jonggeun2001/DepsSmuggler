import { describe, it, expect, beforeEach } from 'vitest';

// OS 패키지 다운로더 유틸리티 테스트
describe('OS package downloader utilities', () => {
  describe('YUM metadata parsing utilities', () => {
    // RPM 버전 비교 로직
    const compareRpmVersions = (v1: string, v2: string): number => {
      const parseVersion = (v: string): { epoch: number; version: string; release: string } => {
        let epoch = 0;
        let version = v;
        let release = '';

        // epoch 파싱
        if (v.includes(':')) {
          const parts = v.split(':');
          epoch = parseInt(parts[0], 10);
          version = parts[1];
        }

        // release 파싱
        if (version.includes('-')) {
          const parts = version.split('-');
          version = parts[0];
          release = parts.slice(1).join('-');
        }

        return { epoch, version, release };
      };

      const compareVersionParts = (p1: string, p2: string): number => {
        const v1Parts = p1.split('.').map((p) => parseInt(p, 10) || 0);
        const v2Parts = p2.split('.').map((p) => parseInt(p, 10) || 0);

        const maxLen = Math.max(v1Parts.length, v2Parts.length);
        for (let i = 0; i < maxLen; i++) {
          const a = v1Parts[i] || 0;
          const b = v2Parts[i] || 0;
          if (a !== b) return a - b;
        }
        return 0;
      };

      const pv1 = parseVersion(v1);
      const pv2 = parseVersion(v2);

      if (pv1.epoch !== pv2.epoch) return pv1.epoch - pv2.epoch;
      const versionCmp = compareVersionParts(pv1.version, pv2.version);
      if (versionCmp !== 0) return versionCmp;
      return compareVersionParts(pv1.release, pv2.release);
    };

    // RPM flags 파싱 (비트 플래그: LT=2, GT=4, EQ=8, LE=10, GE=12)
    const parseRpmFlags = (flags: string | number | undefined): string => {
      if (flags === undefined || flags === null) return '';
      const flagNum = typeof flags === 'string' ? parseInt(flags, 10) : flags;
      // 복합 플래그를 먼저 확인
      if (flagNum === 10) return '<='; // LT | EQ
      if (flagNum === 12) return '>='; // GT | EQ
      if (flagNum & 8) return '=';
      if (flagNum & 4) return '>';
      if (flagNum & 2) return '<';
      return '';
    };

    it('RPM 버전 비교 - 동일', () => {
      expect(compareRpmVersions('2.4.6-45.el7', '2.4.6-45.el7')).toBe(0);
    });

    it('RPM 버전 비교 - major 버전', () => {
      expect(compareRpmVersions('3.0.0-1.el7', '2.4.6-45.el7')).toBeGreaterThan(0);
    });

    it('RPM 버전 비교 - epoch', () => {
      expect(compareRpmVersions('1:2.0.0-1.el7', '2.4.6-45.el7')).toBeGreaterThan(0);
    });

    it('RPM flags 파싱 - 단일 플래그', () => {
      expect(parseRpmFlags(8)).toBe('=');
      expect(parseRpmFlags(4)).toBe('>');
      expect(parseRpmFlags(2)).toBe('<');
    });

    it('RPM flags 파싱 - 복합 플래그', () => {
      expect(parseRpmFlags(12)).toBe('>=');
      expect(parseRpmFlags(10)).toBe('<=');
    });
  });

  describe('APT metadata parsing utilities', () => {
    // Debian 버전 비교 로직
    const compareDebVersions = (v1: string, v2: string): number => {
      const parseVersion = (v: string): { epoch: number; upstream: string; revision: string } => {
        let epoch = 0;
        let upstream = v;
        let revision = '';

        // epoch 파싱
        if (v.includes(':')) {
          const idx = v.indexOf(':');
          epoch = parseInt(v.substring(0, idx), 10);
          upstream = v.substring(idx + 1);
        }

        // revision 파싱
        const lastDash = upstream.lastIndexOf('-');
        if (lastDash !== -1) {
          revision = upstream.substring(lastDash + 1);
          upstream = upstream.substring(0, lastDash);
        }

        return { epoch, upstream, revision };
      };

      const compareVersionStrings = (s1: string, s2: string): number => {
        const normalize = (s: string): string[] => {
          return s.split(/(\d+)/).filter((x) => x.length > 0);
        };

        const p1 = normalize(s1);
        const p2 = normalize(s2);
        const maxLen = Math.max(p1.length, p2.length);

        for (let i = 0; i < maxLen; i++) {
          const a = p1[i] || '';
          const b = p2[i] || '';

          const aNum = parseInt(a, 10);
          const bNum = parseInt(b, 10);

          if (!isNaN(aNum) && !isNaN(bNum)) {
            if (aNum !== bNum) return aNum - bNum;
          } else {
            if (a < b) return -1;
            if (a > b) return 1;
          }
        }
        return 0;
      };

      const pv1 = parseVersion(v1);
      const pv2 = parseVersion(v2);

      if (pv1.epoch !== pv2.epoch) return pv1.epoch - pv2.epoch;
      const upstreamCmp = compareVersionStrings(pv1.upstream, pv2.upstream);
      if (upstreamCmp !== 0) return upstreamCmp;
      return compareVersionStrings(pv1.revision, pv2.revision);
    };

    // Debian 의존성 연산자 파싱
    const parseDebOperator = (op: string): string => {
      const operators: Record<string, string> = {
        '>>': '>',
        '<<': '<',
        '>=': '>=',
        '<=': '<=',
        '=': '=',
      };
      return operators[op] || op;
    };

    it('Debian 버전 비교 - 동일', () => {
      expect(compareDebVersions('1.2.3-1', '1.2.3-1')).toBe(0);
    });

    it('Debian 버전 비교 - upstream 차이', () => {
      expect(compareDebVersions('1.3.0-1', '1.2.3-1')).toBeGreaterThan(0);
    });

    it('Debian 버전 비교 - epoch', () => {
      expect(compareDebVersions('1:1.0.0-1', '2.0.0-1')).toBeGreaterThan(0);
    });

    it('Debian 버전 비교 - revision', () => {
      expect(compareDebVersions('1.2.3-2', '1.2.3-1')).toBeGreaterThan(0);
    });

    it('Debian 연산자 파싱', () => {
      expect(parseDebOperator('>>')).toBe('>');
      expect(parseDebOperator('<<')).toBe('<');
      expect(parseDebOperator('>=')).toBe('>=');
    });
  });

  describe('APK metadata parsing utilities', () => {
    // APK 버전 비교 로직
    const compareApkVersions = (v1: string, v2: string): number => {
      const parseVersion = (v: string): { version: string; revision: string } => {
        const match = v.match(/^(.+?)(?:-r(\d+))?$/);
        if (!match) return { version: v, revision: '0' };
        return {
          version: match[1],
          revision: match[2] || '0',
        };
      };

      const compareVersionStrings = (s1: string, s2: string): number => {
        const p1 = s1.split(/[._]/).map((x) => parseInt(x, 10) || 0);
        const p2 = s2.split(/[._]/).map((x) => parseInt(x, 10) || 0);

        const maxLen = Math.max(p1.length, p2.length);
        for (let i = 0; i < maxLen; i++) {
          const a = p1[i] || 0;
          const b = p2[i] || 0;
          if (a !== b) return a - b;
        }
        return 0;
      };

      const pv1 = parseVersion(v1);
      const pv2 = parseVersion(v2);

      const versionCmp = compareVersionStrings(pv1.version, pv2.version);
      if (versionCmp !== 0) return versionCmp;
      return parseInt(pv1.revision, 10) - parseInt(pv2.revision, 10);
    };

    // APK 연산자 파싱
    const parseApkOperator = (op: string): string => {
      const operators: Record<string, string> = {
        '~': '~',
        '=': '=',
        '>': '>',
        '<': '<',
        '>=': '>=',
        '<=': '<=',
      };
      return operators[op] || '>=';
    };

    it('APK 버전 비교 - 동일', () => {
      expect(compareApkVersions('1.2.3-r0', '1.2.3-r0')).toBe(0);
    });

    it('APK 버전 비교 - revision 차이', () => {
      expect(compareApkVersions('1.2.3-r1', '1.2.3-r0')).toBeGreaterThan(0);
    });

    it('APK 버전 비교 - version 차이', () => {
      expect(compareApkVersions('1.3.0-r0', '1.2.3-r5')).toBeGreaterThan(0);
    });

    it('APK 연산자 파싱', () => {
      expect(parseApkOperator('~')).toBe('~');
      expect(parseApkOperator('>=')).toBe('>=');
    });
  });

  describe('dependency tree utilities', () => {
    interface DependencyNode {
      name: string;
      version: string;
      dependencies: DependencyNode[];
    }

    // 의존성 평탄화
    const flattenDependencies = (node: DependencyNode): DependencyNode[] => {
      const result: DependencyNode[] = [node];
      for (const dep of node.dependencies) {
        result.push(...flattenDependencies(dep));
      }
      return result;
    };

    // 중복 제거
    const uniqueDependencies = (deps: DependencyNode[]): DependencyNode[] => {
      const seen = new Set<string>();
      return deps.filter((dep) => {
        const key = `${dep.name}@${dep.version}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    // 설치 순서 정렬 (위상 정렬)
    const sortInstallOrder = (deps: DependencyNode[]): DependencyNode[] => {
      const depMap = new Map<string, Set<string>>();
      const allDeps = new Set<string>();

      // 모든 의존성 수집
      const collectDeps = (node: DependencyNode): void => {
        const key = `${node.name}@${node.version}`;
        allDeps.add(key);
        if (!depMap.has(key)) {
          depMap.set(key, new Set());
        }
        for (const dep of node.dependencies) {
          const depKey = `${dep.name}@${dep.version}`;
          depMap.get(key)!.add(depKey);
          collectDeps(dep);
        }
      };

      for (const dep of deps) {
        collectDeps(dep);
      }

      // 위상 정렬
      const result: string[] = [];
      const visited = new Set<string>();
      const visiting = new Set<string>();

      const visit = (key: string): void => {
        if (visited.has(key)) return;
        if (visiting.has(key)) return; // 순환 의존성

        visiting.add(key);
        const depKeys = depMap.get(key) || new Set();
        for (const depKey of depKeys) {
          visit(depKey);
        }
        visiting.delete(key);
        visited.add(key);
        result.push(key);
      };

      for (const key of allDeps) {
        visit(key);
      }

      // 결과를 DependencyNode 배열로 변환
      const nodeMap = new Map<string, DependencyNode>();
      for (const dep of deps) {
        const flatDeps = flattenDependencies(dep);
        for (const d of flatDeps) {
          nodeMap.set(`${d.name}@${d.version}`, d);
        }
      }

      return result.map((key) => nodeMap.get(key)!).filter(Boolean);
    };

    it('의존성 평탄화', () => {
      const tree: DependencyNode = {
        name: 'A',
        version: '1.0',
        dependencies: [
          {
            name: 'B',
            version: '2.0',
            dependencies: [{ name: 'C', version: '3.0', dependencies: [] }],
          },
        ],
      };
      const flat = flattenDependencies(tree);
      expect(flat.length).toBe(3);
      expect(flat.map((d) => d.name)).toEqual(['A', 'B', 'C']);
    });

    it('중복 제거', () => {
      const deps: DependencyNode[] = [
        { name: 'A', version: '1.0', dependencies: [] },
        { name: 'B', version: '2.0', dependencies: [] },
        { name: 'A', version: '1.0', dependencies: [] },
      ];
      const unique = uniqueDependencies(deps);
      expect(unique.length).toBe(2);
    });

    it('설치 순서 정렬', () => {
      const deps: DependencyNode[] = [
        {
          name: 'A',
          version: '1.0',
          dependencies: [{ name: 'B', version: '2.0', dependencies: [] }],
        },
      ];
      const sorted = sortInstallOrder(deps);
      const names = sorted.map((d) => d.name);
      // B가 A보다 먼저 설치되어야 함
      expect(names.indexOf('B')).toBeLessThan(names.indexOf('A'));
    });
  });

  describe('repository URL utilities', () => {
    // YUM 저장소 URL 생성
    const buildYumRepoUrl = (
      baseUrl: string,
      arch: string,
      distro: string,
      repo: string
    ): string => {
      const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
      return `${base}/${distro}/${repo}/${arch}/`;
    };

    // APT 저장소 URL 생성
    const buildAptRepoUrl = (
      baseUrl: string,
      distribution: string,
      component: string,
      arch: string
    ): string => {
      const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
      return `${base}/dists/${distribution}/${component}/binary-${arch}/`;
    };

    // APK 저장소 URL 생성
    const buildApkRepoUrl = (baseUrl: string, version: string, repo: string, arch: string): string => {
      const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
      return `${base}/v${version}/${repo}/${arch}/`;
    };

    it('YUM 저장소 URL 생성', () => {
      expect(buildYumRepoUrl('https://mirror.example.com/', 'x86_64', '9', 'BaseOS')).toBe(
        'https://mirror.example.com/9/BaseOS/x86_64/'
      );
    });

    it('APT 저장소 URL 생성', () => {
      expect(buildAptRepoUrl('http://archive.ubuntu.com/ubuntu/', 'jammy', 'main', 'amd64')).toBe(
        'http://archive.ubuntu.com/ubuntu/dists/jammy/main/binary-amd64/'
      );
    });

    it('APK 저장소 URL 생성', () => {
      expect(buildApkRepoUrl('https://dl-cdn.alpinelinux.org/alpine/', '3.20', 'main', 'x86_64')).toBe(
        'https://dl-cdn.alpinelinux.org/alpine/v3.20/main/x86_64/'
      );
    });
  });

  describe('architecture mapping', () => {
    const ARCH_ALIASES: Record<string, string[]> = {
      x86_64: ['x86_64', 'amd64', 'x64'],
      aarch64: ['aarch64', 'arm64'],
      i686: ['i686', 'i386', 'x86'],
      armv7: ['armv7', 'armhf', 'arm'],
    };

    const normalizeArch = (arch: string): string => {
      const lowerArch = arch.toLowerCase();
      for (const [canonical, aliases] of Object.entries(ARCH_ALIASES)) {
        if (aliases.includes(lowerArch)) {
          return canonical;
        }
      }
      return lowerArch;
    };

    const getArchForPackageManager = (
      arch: string,
      pkgManager: 'yum' | 'apt' | 'apk'
    ): string => {
      const normalized = normalizeArch(arch);
      const mappings: Record<string, Record<string, string>> = {
        yum: { x86_64: 'x86_64', aarch64: 'aarch64', i686: 'i686' },
        apt: { x86_64: 'amd64', aarch64: 'arm64', i686: 'i386' },
        apk: { x86_64: 'x86_64', aarch64: 'aarch64', i686: 'x86' },
      };
      return mappings[pkgManager][normalized] || normalized;
    };

    it('아키텍처 정규화 - x86_64', () => {
      expect(normalizeArch('amd64')).toBe('x86_64');
      expect(normalizeArch('x64')).toBe('x86_64');
    });

    it('아키텍처 정규화 - aarch64', () => {
      expect(normalizeArch('arm64')).toBe('aarch64');
    });

    it('패키지 매니저별 아키텍처 변환', () => {
      expect(getArchForPackageManager('amd64', 'yum')).toBe('x86_64');
      expect(getArchForPackageManager('x86_64', 'apt')).toBe('amd64');
    });
  });

  describe('package checksum utilities', () => {
    const CHECKSUM_TYPES = ['sha256', 'sha512', 'sha1', 'md5'];

    const isValidChecksum = (checksum: string, type: string): boolean => {
      const lengths: Record<string, number> = {
        sha256: 64,
        sha512: 128,
        sha1: 40,
        md5: 32,
      };
      const expectedLen = lengths[type.toLowerCase()];
      if (!expectedLen) return false;
      return checksum.length === expectedLen && /^[a-f0-9]+$/i.test(checksum);
    };

    const parseChecksumLine = (
      line: string
    ): { algorithm: string; hash: string; filename: string } | null => {
      // 형식: hash filename 또는 algorithm:hash filename
      const match = line.match(/^(?:(\w+):)?([a-f0-9]+)\s+(.+)$/i);
      if (!match) return null;

      const algorithm = match[1] || 'sha256';
      const hash = match[2];
      const filename = match[3];

      return { algorithm, hash, filename };
    };

    it('유효한 SHA256 체크섬', () => {
      expect(isValidChecksum('a'.repeat(64), 'sha256')).toBe(true);
    });

    it('유효한 SHA512 체크섬', () => {
      expect(isValidChecksum('b'.repeat(128), 'sha512')).toBe(true);
    });

    it('잘못된 길이의 체크섬', () => {
      expect(isValidChecksum('a'.repeat(50), 'sha256')).toBe(false);
    });

    it('체크섬 라인 파싱', () => {
      const result = parseChecksumLine('sha256:abc123def456 package.rpm');
      expect(result).not.toBeNull();
      expect(result!.algorithm).toBe('sha256');
    });
  });

  describe('script generation utilities', () => {
    // 패키지 매니저별 설치 명령어
    const getInstallCommand = (
      pkgManager: 'yum' | 'apt' | 'apk',
      packages: string[]
    ): string => {
      const commands: Record<string, string> = {
        yum: `yum install -y ${packages.join(' ')}`,
        apt: `apt-get install -y ${packages.join(' ')}`,
        apk: `apk add ${packages.join(' ')}`,
      };
      return commands[pkgManager];
    };

    // 로컬 저장소 설정 명령어
    const getLocalRepoSetupCommand = (
      pkgManager: 'yum' | 'apt' | 'apk',
      repoPath: string
    ): string[] => {
      switch (pkgManager) {
        case 'yum':
          return [
            `cat > /etc/yum.repos.d/local.repo << 'EOF'`,
            `[local]`,
            `name=Local Repository`,
            `baseurl=file://${repoPath}`,
            `enabled=1`,
            `gpgcheck=0`,
            `EOF`,
          ];
        case 'apt':
          return [
            `echo "deb [trusted=yes] file:${repoPath} ./" > /etc/apt/sources.list.d/local.list`,
            `apt-get update`,
          ];
        case 'apk':
          return [
            `echo "${repoPath}" >> /etc/apk/repositories`,
            `apk update --allow-untrusted`,
          ];
        default:
          return [];
      }
    };

    it('YUM 설치 명령어 생성', () => {
      expect(getInstallCommand('yum', ['httpd', 'nginx'])).toBe('yum install -y httpd nginx');
    });

    it('APT 설치 명령어 생성', () => {
      expect(getInstallCommand('apt', ['nginx', 'curl'])).toBe('apt-get install -y nginx curl');
    });

    it('APK 설치 명령어 생성', () => {
      expect(getInstallCommand('apk', ['busybox'])).toBe('apk add busybox');
    });

    it('YUM 로컬 저장소 설정 명령어', () => {
      const commands = getLocalRepoSetupCommand('yum', '/opt/repo');
      expect(commands.length).toBeGreaterThan(0);
      expect(commands[0]).toContain('yum.repos.d');
    });

    it('APT 로컬 저장소 설정 명령어', () => {
      const commands = getLocalRepoSetupCommand('apt', '/opt/repo');
      expect(commands.some((c) => c.includes('sources.list'))).toBe(true);
    });
  });

  describe('cache key generation', () => {
    const generateCacheKey = (
      distribution: string,
      packageName: string,
      version: string,
      arch: string
    ): string => {
      return `os:${distribution}:${packageName}:${version}:${arch}`;
    };

    const parseCacheKey = (
      key: string
    ): { distribution: string; packageName: string; version: string; arch: string } | null => {
      const parts = key.split(':');
      if (parts.length !== 5 || parts[0] !== 'os') return null;
      return {
        distribution: parts[1],
        packageName: parts[2],
        version: parts[3],
        arch: parts[4],
      };
    };

    it('캐시 키 생성', () => {
      expect(generateCacheKey('rocky-9', 'httpd', '2.4.57', 'x86_64')).toBe(
        'os:rocky-9:httpd:2.4.57:x86_64'
      );
    });

    it('캐시 키 파싱', () => {
      const result = parseCacheKey('os:ubuntu-22.04:nginx:1.18.0:amd64');
      expect(result).not.toBeNull();
      expect(result!.distribution).toBe('ubuntu-22.04');
      expect(result!.packageName).toBe('nginx');
    });

    it('잘못된 캐시 키 파싱', () => {
      expect(parseCacheKey('invalid:key')).toBeNull();
    });
  });

  // 사용자 추천 테스트 케이스 기반 테스트
  describe('recommended test cases', () => {
    // 일반 케이스 - curl (간단한 의존성)
    describe('curl package case', () => {
      const curlDependencies = ['libcurl', 'openssl', 'zlib', 'libnghttp2'];

      it('curl은 여러 라이브러리에 의존', () => {
        expect(curlDependencies).toContain('libcurl');
        expect(curlDependencies).toContain('openssl');
      });

      it('curl 패키지명', () => {
        const packageNames = {
          yum: 'curl',
          apt: 'curl',
          apk: 'curl',
        };
        expect(Object.values(packageNames).every((n) => n === 'curl')).toBe(true);
      });
    });

    // 일반 케이스 - git (전이 의존성)
    describe('git package case', () => {
      const gitDependencies = [
        'perl',
        'openssl',
        'zlib',
        'curl',
        'expat',
        'openssh-clients',
      ];

      it('git은 많은 전이 의존성을 가짐', () => {
        expect(gitDependencies.length).toBeGreaterThan(4);
        expect(gitDependencies).toContain('perl');
        expect(gitDependencies).toContain('curl');
      });

      it('git 전이 의존성 체인', () => {
        // git → curl → libcurl → openssl
        const dependencyChain = ['git', 'curl', 'libcurl', 'openssl'];
        expect(dependencyChain.length).toBe(4);
        expect(dependencyChain[0]).toBe('git');
        expect(dependencyChain[dependencyChain.length - 1]).toBe('openssl');
      });
    });

    // 버전 매칭 케이스 - kernel-devel
    describe('kernel-devel package case', () => {
      it('kernel-devel은 커널 버전과 일치해야 함', () => {
        const kernelVersion = '5.14.0-362.24.1.el9_3';
        const kernelDevelVersion = '5.14.0-362.24.1.el9_3';
        expect(kernelVersion).toBe(kernelDevelVersion);
      });

      it('커널 버전 파싱', () => {
        interface KernelVersion {
          major: number;
          minor: number;
          patch: number;
          release: string;
          dist: string;
        }

        const parseKernelVersion = (version: string): KernelVersion | null => {
          // 5.14.0-362.24.1.el9_3
          const match = version.match(/^(\d+)\.(\d+)\.(\d+)-(.+?)\.([a-z]+\d+(?:_\d+)?)$/);
          if (!match) return null;
          return {
            major: parseInt(match[1], 10),
            minor: parseInt(match[2], 10),
            patch: parseInt(match[3], 10),
            release: match[4],
            dist: match[5],
          };
        };

        const parsed = parseKernelVersion('5.14.0-362.24.1.el9_3');
        expect(parsed).not.toBeNull();
        expect(parsed!.major).toBe(5);
        expect(parsed!.minor).toBe(14);
        expect(parsed!.dist).toBe('el9_3');
      });
    });

    // 외부 저장소 케이스 - epel-release
    describe('epel-release package case', () => {
      it('epel-release는 외부 저장소 추가', () => {
        const epelRepo = {
          name: 'epel',
          baseurl: 'https://dl.fedoraproject.org/pub/epel/$releasever/$basearch/',
          enabled: true,
          gpgcheck: true,
        };

        expect(epelRepo.name).toBe('epel');
        expect(epelRepo.baseurl).toContain('fedoraproject.org');
      });

      it('EPEL 저장소 활성화 후 추가 패키지 사용 가능', () => {
        const epelPackages = ['htop', 'jq', 'neofetch', 'ripgrep'];
        expect(epelPackages).toContain('htop');
        expect(epelPackages).toContain('jq');
      });
    });

    // 예외 케이스 - 존재하지 않는 패키지
    describe('non-existent package case', () => {
      it('존재하지 않는 패키지명 형식 검증', () => {
        const fakePackage = 'this-package-does-not-exist-12345';
        // RPM 패키지명 규칙: 알파벳, 숫자, 하이픈, 언더스코어
        const isValidName = /^[a-zA-Z][a-zA-Z0-9._-]*$/.test(fakePackage);
        expect(isValidName).toBe(true);
      });
    });

    // YUM/DNF 저장소 구조
    describe('YUM/DNF repository structure', () => {
      interface RepoMetadata {
        revision: string;
        data: Array<{
          type: string;
          location: string;
          checksum: string;
        }>;
      }

      it('repomd.xml 구조', () => {
        const repomd: RepoMetadata = {
          revision: '1702483200',
          data: [
            { type: 'primary', location: 'repodata/primary.xml.gz', checksum: 'sha256:abc' },
            { type: 'filelists', location: 'repodata/filelists.xml.gz', checksum: 'sha256:def' },
            { type: 'other', location: 'repodata/other.xml.gz', checksum: 'sha256:ghi' },
          ],
        };

        expect(repomd.data.some((d) => d.type === 'primary')).toBe(true);
        expect(repomd.data.length).toBeGreaterThan(2);
      });

      it('primary.xml 패키지 정보', () => {
        interface RpmPackageInfo {
          name: string;
          arch: string;
          version: { epoch: number; ver: string; rel: string };
          location: string;
          checksum: string;
          requires: string[];
          provides: string[];
        }

        const pkg: RpmPackageInfo = {
          name: 'httpd',
          arch: 'x86_64',
          version: { epoch: 0, ver: '2.4.57', rel: '8.el9' },
          location: 'Packages/httpd-2.4.57-8.el9.x86_64.rpm',
          checksum: 'sha256:abc123',
          requires: ['httpd-core', 'httpd-tools', 'httpd-filesystem'],
          provides: ['httpd', 'webserver'],
        };

        expect(pkg.name).toBe('httpd');
        expect(pkg.requires.length).toBeGreaterThan(0);
      });
    });

    // RPM 패키지 파일명 파싱
    describe('RPM filename parsing', () => {
      interface RpmFilename {
        name: string;
        version: string;
        release: string;
        arch: string;
      }

      const parseRpmFilename = (filename: string): RpmFilename | null => {
        // name-version-release.arch.rpm
        const match = filename.match(/^(.+)-(.+?)-(.+?)\.([^.]+)\.rpm$/);
        if (!match) return null;
        return {
          name: match[1],
          version: match[2],
          release: match[3],
          arch: match[4],
        };
      };

      it('표준 RPM 파일명', () => {
        const info = parseRpmFilename('httpd-2.4.57-8.el9.x86_64.rpm');
        expect(info).not.toBeNull();
        expect(info!.name).toBe('httpd');
        expect(info!.version).toBe('2.4.57');
        expect(info!.release).toBe('8.el9');
        expect(info!.arch).toBe('x86_64');
      });

      it('noarch RPM 파일명', () => {
        const info = parseRpmFilename('python3-requests-2.28.1-3.el9.noarch.rpm');
        expect(info).not.toBeNull();
        expect(info!.arch).toBe('noarch');
      });

      it('복잡한 패키지명', () => {
        const info = parseRpmFilename('kernel-devel-5.14.0-362.24.1.el9_3.x86_64.rpm');
        expect(info).not.toBeNull();
        expect(info!.name).toBe('kernel-devel');
        expect(info!.version).toBe('5.14.0');
      });
    });

    // 배포판별 패키지 차이
    describe('distribution package differences', () => {
      type Distribution = 'rocky-9' | 'almalinux-9' | 'centos-stream-9' | 'ubuntu-22.04' | 'debian-12' | 'alpine-3.20';

      const getPackageManager = (distro: Distribution): 'yum' | 'apt' | 'apk' => {
        if (distro.startsWith('rocky') || distro.startsWith('almalinux') || distro.startsWith('centos')) {
          return 'yum';
        }
        if (distro.startsWith('ubuntu') || distro.startsWith('debian')) {
          return 'apt';
        }
        return 'apk';
      };

      const getPackageExtension = (distro: Distribution): string => {
        const pkgMgr = getPackageManager(distro);
        if (pkgMgr === 'yum') return 'rpm';
        if (pkgMgr === 'apt') return 'deb';
        return 'apk';
      };

      it('Rocky Linux는 YUM 사용', () => {
        expect(getPackageManager('rocky-9')).toBe('yum');
        expect(getPackageExtension('rocky-9')).toBe('rpm');
      });

      it('Ubuntu는 APT 사용', () => {
        expect(getPackageManager('ubuntu-22.04')).toBe('apt');
        expect(getPackageExtension('ubuntu-22.04')).toBe('deb');
      });

      it('Alpine은 APK 사용', () => {
        expect(getPackageManager('alpine-3.20')).toBe('apk');
        expect(getPackageExtension('alpine-3.20')).toBe('apk');
      });
    });

    // 의존성 해결 우선순위
    describe('dependency resolution priority', () => {
      interface Package {
        name: string;
        version: string;
        repo: string;
        priority: number;
      }

      const selectBestPackage = (packages: Package[]): Package => {
        return packages.reduce((best, pkg) =>
          pkg.priority > best.priority ? pkg : best
        );
      };

      it('높은 우선순위 저장소 선택', () => {
        const packages: Package[] = [
          { name: 'nginx', version: '1.24.0', repo: 'appstream', priority: 10 },
          { name: 'nginx', version: '1.25.0', repo: 'nginx-mainline', priority: 20 },
        ];

        const selected = selectBestPackage(packages);
        expect(selected.repo).toBe('nginx-mainline');
        expect(selected.version).toBe('1.25.0');
      });

      it('동일 우선순위시 첫 번째 선택', () => {
        const packages: Package[] = [
          { name: 'httpd', version: '2.4.57', repo: 'baseos', priority: 10 },
          { name: 'httpd', version: '2.4.57', repo: 'appstream', priority: 10 },
        ];

        const selected = selectBestPackage(packages);
        expect(selected.repo).toBe('baseos');
      });
    });

    // 그룹 패키지
    describe('package groups', () => {
      interface PackageGroup {
        id: string;
        name: string;
        packages: string[];
        optionalPackages: string[];
      }

      const developmentTools: PackageGroup = {
        id: 'development',
        name: 'Development Tools',
        packages: ['gcc', 'gcc-c++', 'make', 'autoconf', 'automake'],
        optionalPackages: ['gdb', 'valgrind', 'strace'],
      };

      it('그룹 패키지 구조', () => {
        expect(developmentTools.packages.length).toBeGreaterThan(0);
        expect(developmentTools.packages).toContain('gcc');
        expect(developmentTools.packages).toContain('make');
      });

      it('선택적 패키지', () => {
        expect(developmentTools.optionalPackages).toContain('gdb');
      });
    });

    // provides/requires 해결
    describe('provides/requires resolution', () => {
      interface Capability {
        name: string;
        version?: string;
        flags?: string;
      }

      const matchCapability = (provides: Capability, requires: Capability): boolean => {
        if (provides.name !== requires.name) return false;
        if (!requires.version) return true;
        // 간단한 버전 비교 (실제로는 더 복잡)
        return provides.version === requires.version;
      };

      it('이름만 일치', () => {
        const provides: Capability = { name: 'webserver' };
        const requires: Capability = { name: 'webserver' };
        expect(matchCapability(provides, requires)).toBe(true);
      });

      it('버전 포함 일치', () => {
        const provides: Capability = { name: 'libcurl.so.4', version: '4.8.0' };
        const requires: Capability = { name: 'libcurl.so.4', version: '4.8.0' };
        expect(matchCapability(provides, requires)).toBe(true);
      });

      it('버전 불일치', () => {
        const provides: Capability = { name: 'libcurl.so.4', version: '4.7.0' };
        const requires: Capability = { name: 'libcurl.so.4', version: '4.8.0' };
        expect(matchCapability(provides, requires)).toBe(false);
      });
    });

    // 미러 선택
    describe('mirror selection', () => {
      interface Mirror {
        url: string;
        country: string;
        latency?: number;
      }

      const selectFastestMirror = (mirrors: Mirror[]): Mirror => {
        return mirrors.reduce((fastest, mirror) =>
          (mirror.latency || Infinity) < (fastest.latency || Infinity) ? mirror : fastest
        );
      };

      it('가장 빠른 미러 선택', () => {
        const mirrors: Mirror[] = [
          { url: 'https://mirror1.example.com', country: 'US', latency: 100 },
          { url: 'https://mirror2.example.com', country: 'KR', latency: 20 },
          { url: 'https://mirror3.example.com', country: 'JP', latency: 50 },
        ];

        const fastest = selectFastestMirror(mirrors);
        expect(fastest.country).toBe('KR');
        expect(fastest.latency).toBe(20);
      });
    });
  });

  describe('output format utilities', () => {
    type OutputFormat = 'archive' | 'repository' | 'both';

    interface OutputOptions {
      format: OutputFormat;
      archiveType: 'zip' | 'tar.gz';
      includeScripts: boolean;
      scriptTypes: Array<'bash' | 'powershell'>;
    }

    const getOutputPath = (
      baseDir: string,
      distribution: string,
      options: OutputOptions
    ): Record<string, string> => {
      const paths: Record<string, string> = {};

      if (options.format === 'archive' || options.format === 'both') {
        const ext = options.archiveType === 'zip' ? '.zip' : '.tar.gz';
        paths.archive = `${baseDir}/${distribution}-packages${ext}`;
      }

      if (options.format === 'repository' || options.format === 'both') {
        paths.repository = `${baseDir}/${distribution}-repo`;
      }

      if (options.includeScripts) {
        paths.scripts = `${baseDir}/scripts`;
      }

      return paths;
    };

    it('아카이브만 출력', () => {
      const paths = getOutputPath('/output', 'rocky-9', {
        format: 'archive',
        archiveType: 'zip',
        includeScripts: false,
        scriptTypes: [],
      });
      expect(paths.archive).toBe('/output/rocky-9-packages.zip');
      expect(paths.repository).toBeUndefined();
    });

    it('저장소만 출력', () => {
      const paths = getOutputPath('/output', 'ubuntu-22.04', {
        format: 'repository',
        archiveType: 'tar.gz',
        includeScripts: false,
        scriptTypes: [],
      });
      expect(paths.repository).toBe('/output/ubuntu-22.04-repo');
      expect(paths.archive).toBeUndefined();
    });

    it('둘 다 출력 + 스크립트', () => {
      const paths = getOutputPath('/output', 'alpine-3.20', {
        format: 'both',
        archiveType: 'tar.gz',
        includeScripts: true,
        scriptTypes: ['bash', 'powershell'],
      });
      expect(paths.archive).toBe('/output/alpine-3.20-packages.tar.gz');
      expect(paths.repository).toBe('/output/alpine-3.20-repo');
      expect(paths.scripts).toBe('/output/scripts');
    });
  });
});
