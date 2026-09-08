import { describe, expect, it, vi } from 'vitest';
import { matchPackagesByQuery } from './os-resolver-utils';
import type { OSPackageInfo } from '../downloaders/os-shared/types';

const packages = ['libssl', 'libxml', 'curl', 'libssl'].map((name) => ({ name } as OSPackageInfo));

describe('OS package query matching', () => {
  it('검색 모드별 순서와 중복을 유지한다', () => {
    expect(matchPackagesByQuery(packages, 'libssl', 'exact')).toEqual([packages[0], packages[3]]);
    expect(matchPackagesByQuery(packages, 'lib', 'partial')).toEqual([packages[0], packages[1], packages[3]]);
    expect(matchPackagesByQuery(packages, 'lib???', 'wildcard')).toEqual([packages[0], packages[1], packages[3]]);
    expect(matchPackagesByQuery(packages, 'lib(ssl|xml)', 'wildcard')).toEqual([packages[0], packages[1], packages[3]]);
  });

  it('빈 목록에서는 잘못된 패턴도 평가하지 않고, 후보가 있으면 기존 오류를 유지한다', () => {
    expect(matchPackagesByQuery([], '[', 'wildcard')).toEqual([]);
    expect(() => matchPackagesByQuery(packages, '[', 'wildcard')).toThrow(SyntaxError);
  });

  it('와일드카드 정규식은 검색당 한 번만 생성한다', () => {
    const OriginalRegExp = RegExp;
    const constructor = vi.fn(function (pattern: string, flags?: string) {
      return new OriginalRegExp(pattern, flags);
    });
    vi.stubGlobal('RegExp', constructor);
    try {
      matchPackagesByQuery(packages, 'lib*', 'wildcard');
      expect(constructor).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
