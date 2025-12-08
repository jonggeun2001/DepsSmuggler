import { describe, it, expect } from 'vitest';
import {
  compareVersions,
  isVersionCompatible,
  sortVersionsDescending,
  sortVersionsAscending,
  findLatestCompatibleVersion
} from './version-utils';

describe('version-utils', () => {
  describe('compareVersions', () => {
    it('동일 버전 비교 - 0 반환', () => {
      expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
      expect(compareVersions('2.5.3', '2.5.3')).toBe(0);
    });

    it('major 버전이 다른 경우', () => {
      expect(compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0);
      expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
    });

    it('minor 버전이 다른 경우', () => {
      expect(compareVersions('1.2.0', '1.1.0')).toBeGreaterThan(0);
      expect(compareVersions('1.1.0', '1.2.0')).toBeLessThan(0);
    });

    it('patch 버전이 다른 경우', () => {
      expect(compareVersions('1.0.2', '1.0.1')).toBeGreaterThan(0);
      expect(compareVersions('1.0.1', '1.0.2')).toBeLessThan(0);
    });

    it('버전 자릿수가 다른 경우', () => {
      expect(compareVersions('1.0.0', '1.0')).toBe(0);
      expect(compareVersions('1.0.1', '1.0')).toBeGreaterThan(0);
      expect(compareVersions('1.0', '1.0.1')).toBeLessThan(0);
    });

    it('pre-release 태그가 있는 버전 비교', () => {
      // rc, alpha 등이 제거되고 숫자만 비교
      expect(compareVersions('1.0.0', '1.0.0rc1')).toBe(0);
      expect(compareVersions('1.0.0alpha', '1.0.0beta')).toBe(0);
    });

    it('긴 버전 번호 비교', () => {
      expect(compareVersions('1.2.3.4', '1.2.3.3')).toBeGreaterThan(0);
      expect(compareVersions('1.2.3.4.5', '1.2.3.4.6')).toBeLessThan(0);
    });

    it('숫자와 문자가 섞인 버전', () => {
      expect(compareVersions('1.2', '1.2')).toBe(0);
      expect(compareVersions('10.0', '2.0')).toBeGreaterThan(0);
    });
  });

  describe('isVersionCompatible', () => {
    describe('>= 연산자', () => {
      it('이상 조건 충족', () => {
        expect(isVersionCompatible('1.5.0', '>=1.0.0')).toBe(true);
        expect(isVersionCompatible('1.0.0', '>=1.0.0')).toBe(true);
      });

      it('이상 조건 미충족', () => {
        expect(isVersionCompatible('0.9.0', '>=1.0.0')).toBe(false);
      });
    });

    describe('<= 연산자', () => {
      it('이하 조건 충족', () => {
        expect(isVersionCompatible('1.0.0', '<=2.0.0')).toBe(true);
        expect(isVersionCompatible('2.0.0', '<=2.0.0')).toBe(true);
      });

      it('이하 조건 미충족', () => {
        expect(isVersionCompatible('2.1.0', '<=2.0.0')).toBe(false);
      });
    });

    describe('> 연산자', () => {
      it('초과 조건 충족', () => {
        expect(isVersionCompatible('1.5.0', '>1.0.0')).toBe(true);
      });

      it('초과 조건 미충족 (같은 경우)', () => {
        expect(isVersionCompatible('1.0.0', '>1.0.0')).toBe(false);
      });
    });

    describe('< 연산자', () => {
      it('미만 조건 충족', () => {
        expect(isVersionCompatible('0.9.0', '<1.0.0')).toBe(true);
      });

      it('미만 조건 미충족 (같은 경우)', () => {
        expect(isVersionCompatible('1.0.0', '<1.0.0')).toBe(false);
      });
    });

    describe('== 연산자', () => {
      it('정확한 매칭', () => {
        expect(isVersionCompatible('1.0.0', '==1.0.0')).toBe(true);
        expect(isVersionCompatible('1.0.1', '==1.0.0')).toBe(false);
      });

      it('와일드카드 매칭', () => {
        expect(isVersionCompatible('1.0.5', '==1.0.*')).toBe(true);
        expect(isVersionCompatible('1.1.0', '==1.0.*')).toBe(false);
        expect(isVersionCompatible('2.5.3', '==2.*')).toBe(true);
      });
    });

    describe('!= 연산자', () => {
      it('불일치 조건 충족', () => {
        expect(isVersionCompatible('1.0.1', '!=1.0.0')).toBe(true);
      });

      it('불일치 조건 미충족', () => {
        expect(isVersionCompatible('1.0.0', '!=1.0.0')).toBe(false);
      });
    });

    describe('~= 연산자 (호환 릴리스)', () => {
      it('호환 릴리스 조건 충족', () => {
        expect(isVersionCompatible('2.1.5', '~=2.1')).toBe(true);
        expect(isVersionCompatible('2.1.0', '~=2.1')).toBe(true);
      });

      it('호환 릴리스 조건 미충족', () => {
        expect(isVersionCompatible('2.0.5', '~=2.1')).toBe(false);
        expect(isVersionCompatible('3.0.0', '~=2.1')).toBe(false);
      });
    });

    describe('복합 조건 (AND - 콤마 구분)', () => {
      it('범위 조건 충족', () => {
        expect(isVersionCompatible('1.5.0', '>=1.0.0,<2.0.0')).toBe(true);
        expect(isVersionCompatible('1.0.0', '>=1.0.0,<2.0.0')).toBe(true);
      });

      it('범위 조건 미충족', () => {
        expect(isVersionCompatible('2.0.0', '>=1.0.0,<2.0.0')).toBe(false);
        expect(isVersionCompatible('0.5.0', '>=1.0.0,<2.0.0')).toBe(false);
      });
    });

    describe('OR 조건 (파이프 구분)', () => {
      it('OR 조건 중 하나 충족', () => {
        expect(isVersionCompatible('1.5.0', '>=1.0.0|>=3.0.0')).toBe(true);
        expect(isVersionCompatible('3.5.0', '>=1.0.0|>=3.0.0')).toBe(true);
      });
    });

    describe('와일드카드', () => {
      it('와일드카드 패턴 매칭', () => {
        expect(isVersionCompatible('2.5.0', '2.*')).toBe(true);
        expect(isVersionCompatible('3.0.0', '2.*')).toBe(false);
      });
    });
  });

  describe('sortVersionsDescending', () => {
    it('버전을 내림차순으로 정렬', () => {
      const versions = ['1.0.0', '2.0.0', '1.5.0', '3.0.0'];
      expect(sortVersionsDescending(versions)).toEqual(['3.0.0', '2.0.0', '1.5.0', '1.0.0']);
    });

    it('원본 배열을 변경하지 않음', () => {
      const versions = ['1.0.0', '2.0.0'];
      const sorted = sortVersionsDescending(versions);
      expect(versions).toEqual(['1.0.0', '2.0.0']);
      expect(sorted).toEqual(['2.0.0', '1.0.0']);
    });

    it('빈 배열 처리', () => {
      expect(sortVersionsDescending([])).toEqual([]);
    });

    it('단일 요소 배열', () => {
      expect(sortVersionsDescending(['1.0.0'])).toEqual(['1.0.0']);
    });
  });

  describe('sortVersionsAscending', () => {
    it('버전을 오름차순으로 정렬', () => {
      const versions = ['2.0.0', '1.0.0', '1.5.0', '3.0.0'];
      expect(sortVersionsAscending(versions)).toEqual(['1.0.0', '1.5.0', '2.0.0', '3.0.0']);
    });

    it('원본 배열을 변경하지 않음', () => {
      const versions = ['2.0.0', '1.0.0'];
      const sorted = sortVersionsAscending(versions);
      expect(versions).toEqual(['2.0.0', '1.0.0']);
      expect(sorted).toEqual(['1.0.0', '2.0.0']);
    });
  });

  describe('findLatestCompatibleVersion', () => {
    const versions = ['1.0.0', '1.5.0', '2.0.0', '2.5.0', '3.0.0'];

    it('조건에 맞는 최신 버전 찾기', () => {
      expect(findLatestCompatibleVersion(versions, '>=1.0.0,<2.0.0')).toBe('1.5.0');
      expect(findLatestCompatibleVersion(versions, '>=2.0.0')).toBe('3.0.0');
    });

    it('정확한 버전 매칭', () => {
      expect(findLatestCompatibleVersion(versions, '==2.0.0')).toBe('2.0.0');
    });

    it('매칭되는 버전이 없는 경우', () => {
      expect(findLatestCompatibleVersion(versions, '>=4.0.0')).toBeNull();
      expect(findLatestCompatibleVersion(versions, '<1.0.0')).toBeNull();
    });

    it('빈 버전 배열', () => {
      expect(findLatestCompatibleVersion([], '>=1.0.0')).toBeNull();
    });

    it('와일드카드 패턴', () => {
      expect(findLatestCompatibleVersion(versions, '2.*')).toBe('2.5.0');
    });
  });
});
