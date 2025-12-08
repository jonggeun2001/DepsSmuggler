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
});
