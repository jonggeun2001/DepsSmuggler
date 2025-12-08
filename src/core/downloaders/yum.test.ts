import { describe, it, expect, beforeEach } from 'vitest';
import { getYumDownloader } from './yum';

describe('yum downloader', () => {
  let downloader: ReturnType<typeof getYumDownloader>;

  beforeEach(() => {
    downloader = getYumDownloader();
  });

  describe('getYumDownloader', () => {
    it('싱글톤 인스턴스 반환', () => {
      const instance1 = getYumDownloader();
      const instance2 = getYumDownloader();
      expect(instance1).toBe(instance2);
    });

    it('type이 yum', () => {
      expect(downloader.type).toBe('yum');
    });
  });

  describe('searchPackages (integration)', () => {
    it.skip('패키지 검색', async () => {
      const results = await downloader.searchPackages('httpd');
      expect(Array.isArray(results)).toBe(true);
      if (results.length > 0) {
        expect(results[0]).toHaveProperty('name');
      }
    });
  });

  describe('getVersions (integration)', () => {
    it.skip('버전 목록 조회', async () => {
      const versions = await downloader.getVersions('httpd');
      expect(Array.isArray(versions)).toBe(true);
    });
  });
});

// Yum 다운로더 유틸리티 로직 테스트
describe('yum downloader utilities', () => {
  describe('version formatting', () => {
    // RPM 버전 포맷팅 로직
    const formatVersion = (
      epoch: number | undefined,
      version: string,
      release: string
    ): string => {
      let result = version;
      if (epoch && epoch > 0) {
        result = `${epoch}:${version}`;
      }
      if (release) {
        result = `${result}-${release}`;
      }
      return result;
    };

    it('기본 버전 포맷팅', () => {
      expect(formatVersion(undefined, '2.4.6', '45.el7')).toBe('2.4.6-45.el7');
    });

    it('epoch 포함 버전 포맷팅', () => {
      expect(formatVersion(1, '2.4.6', '45.el7')).toBe('1:2.4.6-45.el7');
    });

    it('epoch 0은 생략', () => {
      expect(formatVersion(0, '2.4.6', '45.el7')).toBe('2.4.6-45.el7');
    });

    it('release 없는 버전', () => {
      expect(formatVersion(undefined, '2.4.6', '')).toBe('2.4.6');
    });
  });

  describe('RPM version comparison', () => {
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

      // epoch 비교
      if (pv1.epoch !== pv2.epoch) {
        return pv1.epoch - pv2.epoch;
      }

      // version 비교
      const versionCmp = compareVersionParts(pv1.version, pv2.version);
      if (versionCmp !== 0) return versionCmp;

      // release 비교
      return compareVersionParts(pv1.release, pv2.release);
    };

    it('동일 버전 비교', () => {
      expect(compareRpmVersions('2.4.6-45.el7', '2.4.6-45.el7')).toBe(0);
    });

    it('major 버전 비교', () => {
      expect(compareRpmVersions('3.0.0-1.el7', '2.4.6-45.el7')).toBeGreaterThan(0);
    });

    it('minor 버전 비교', () => {
      expect(compareRpmVersions('2.5.0-1.el7', '2.4.6-45.el7')).toBeGreaterThan(0);
    });

    it('release 비교', () => {
      expect(compareRpmVersions('2.4.6-46.el7', '2.4.6-45.el7')).toBeGreaterThan(0);
    });

    it('epoch 비교', () => {
      expect(compareRpmVersions('1:2.0.0-1.el7', '2.4.6-45.el7')).toBeGreaterThan(0);
    });

    it('epoch 없는 버전과 있는 버전 비교', () => {
      expect(compareRpmVersions('1:1.0.0-1.el7', '99.0.0-1.el7')).toBeGreaterThan(0);
    });
  });

  describe('architecture validation', () => {
    const VALID_ARCHES = ['x86_64', 'i686', 'i386', 'aarch64', 'armv7hl', 'noarch', 'src'];

    const isValidArch = (arch: string): boolean => {
      return VALID_ARCHES.includes(arch.toLowerCase());
    };

    it('유효한 아키텍처', () => {
      expect(isValidArch('x86_64')).toBe(true);
      expect(isValidArch('noarch')).toBe(true);
      expect(isValidArch('aarch64')).toBe(true);
    });

    it('유효하지 않은 아키텍처', () => {
      expect(isValidArch('invalid')).toBe(false);
      expect(isValidArch('arm64')).toBe(false); // aarch64로 표기해야 함
    });
  });

  describe('package name parsing', () => {
    // RPM 파일명 파싱 로직
    const parseRpmFilename = (
      filename: string
    ): { name: string; version: string; release: string; arch: string } | null => {
      // 패턴: name-version-release.arch.rpm
      const match = filename.match(/^(.+)-([^-]+)-([^-]+)\.([^.]+)\.rpm$/);
      if (!match) return null;

      return {
        name: match[1],
        version: match[2],
        release: match[3],
        arch: match[4],
      };
    };

    it('일반 RPM 파일명 파싱', () => {
      const result = parseRpmFilename('httpd-2.4.6-45.el7.centos.x86_64.rpm');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('httpd');
      expect(result!.version).toBe('2.4.6');
      expect(result!.release).toBe('45.el7.centos');
      expect(result!.arch).toBe('x86_64');
    });

    it('noarch 패키지 파싱', () => {
      const result = parseRpmFilename('python-setuptools-0.9.8-7.el7.noarch.rpm');
      expect(result).not.toBeNull();
      expect(result!.arch).toBe('noarch');
    });

    it('하이픈이 포함된 패키지명 파싱', () => {
      const result = parseRpmFilename('mod_ssl-2.4.6-45.el7.centos.x86_64.rpm');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('mod_ssl');
    });

    it('잘못된 형식 처리', () => {
      const result = parseRpmFilename('invalid-filename.txt');
      expect(result).toBeNull();
    });
  });

  describe('repository URL handling', () => {
    const DEFAULT_REPOS = [
      'https://mirror.centos.org/centos/7/os/x86_64/',
      'https://mirror.centos.org/centos/7/updates/x86_64/',
      'https://mirror.centos.org/centos/7/extras/x86_64/',
    ];

    const buildRepoDataUrl = (baseUrl: string): string => {
      const url = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
      return `${url}repodata/repomd.xml`;
    };

    const buildPrimaryUrl = (baseUrl: string, primaryPath: string): string => {
      const url = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
      return `${url}${primaryPath}`;
    };

    it('repomd.xml URL 생성', () => {
      expect(buildRepoDataUrl('https://mirror.centos.org/centos/7/os/x86_64')).toBe(
        'https://mirror.centos.org/centos/7/os/x86_64/repodata/repomd.xml'
      );
    });

    it('trailing slash 처리', () => {
      expect(buildRepoDataUrl('https://mirror.centos.org/centos/7/os/x86_64/')).toBe(
        'https://mirror.centos.org/centos/7/os/x86_64/repodata/repomd.xml'
      );
    });

    it('primary.xml URL 생성', () => {
      expect(
        buildPrimaryUrl(
          'https://mirror.centos.org/centos/7/os/x86_64',
          'repodata/primary.xml.gz'
        )
      ).toBe('https://mirror.centos.org/centos/7/os/x86_64/repodata/primary.xml.gz');
    });
  });

  describe('checksum verification', () => {
    const CHECKSUM_TYPES = ['sha256', 'sha1', 'md5'];

    const isValidChecksumType = (type: string): boolean => {
      return CHECKSUM_TYPES.includes(type.toLowerCase());
    };

    const isValidChecksumValue = (type: string, value: string): boolean => {
      const expectedLength: Record<string, number> = {
        sha256: 64,
        sha1: 40,
        md5: 32,
      };

      const len = expectedLength[type.toLowerCase()];
      if (!len) return false;

      return value.length === len && /^[a-f0-9]+$/i.test(value);
    };

    it('유효한 체크섬 타입', () => {
      expect(isValidChecksumType('sha256')).toBe(true);
      expect(isValidChecksumType('SHA256')).toBe(true);
      expect(isValidChecksumType('sha1')).toBe(true);
      expect(isValidChecksumType('md5')).toBe(true);
    });

    it('유효하지 않은 체크섬 타입', () => {
      expect(isValidChecksumType('sha512')).toBe(false);
      expect(isValidChecksumType('crc32')).toBe(false);
    });

    it('유효한 sha256 체크섬 값', () => {
      expect(isValidChecksumValue('sha256', 'a'.repeat(64))).toBe(true);
    });

    it('유효한 sha1 체크섬 값', () => {
      expect(isValidChecksumValue('sha1', 'a'.repeat(40))).toBe(true);
    });

    it('유효한 md5 체크섬 값', () => {
      expect(isValidChecksumValue('md5', 'a'.repeat(32))).toBe(true);
    });

    it('잘못된 길이의 체크섬 값', () => {
      expect(isValidChecksumValue('sha256', 'a'.repeat(32))).toBe(false);
    });

    it('잘못된 문자가 포함된 체크섬 값', () => {
      expect(isValidChecksumValue('sha256', 'g'.repeat(64))).toBe(false);
    });
  });

  describe('dependency parsing', () => {
    // RPM 의존성 파싱 로직
    interface RpmDependency {
      name: string;
      flags?: string;
      epoch?: number;
      version?: string;
      release?: string;
    }

    const parseDependency = (depStr: string): RpmDependency => {
      // 패턴: name [operator version[-release]]
      const match = depStr.match(/^(\S+)(?:\s*(>=|<=|=|>|<)\s*(\S+))?$/);
      if (!match) {
        return { name: depStr };
      }

      const result: RpmDependency = { name: match[1] };

      if (match[2] && match[3]) {
        result.flags = match[2];
        const verMatch = match[3].match(/^(?:(\d+):)?([^-]+)(?:-(.+))?$/);
        if (verMatch) {
          if (verMatch[1]) result.epoch = parseInt(verMatch[1], 10);
          result.version = verMatch[2];
          if (verMatch[3]) result.release = verMatch[3];
        }
      }

      return result;
    };

    it('단순 의존성 파싱', () => {
      const result = parseDependency('glibc');
      expect(result.name).toBe('glibc');
      expect(result.flags).toBeUndefined();
    });

    it('버전 조건 의존성 파싱', () => {
      const result = parseDependency('glibc >= 2.17');
      expect(result.name).toBe('glibc');
      expect(result.flags).toBe('>=');
      expect(result.version).toBe('2.17');
    });

    it('release 포함 의존성 파싱', () => {
      const result = parseDependency('openssl = 1.0.2k-19.el7');
      expect(result.name).toBe('openssl');
      expect(result.flags).toBe('=');
      expect(result.version).toBe('1.0.2k');
      expect(result.release).toBe('19.el7');
    });

    it('epoch 포함 의존성 파싱', () => {
      const result = parseDependency('libcurl >= 1:7.29.0');
      expect(result.name).toBe('libcurl');
      expect(result.epoch).toBe(1);
      expect(result.version).toBe('7.29.0');
    });
  });
});
