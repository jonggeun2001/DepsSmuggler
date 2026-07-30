import { describe, expect, it } from 'vitest';
import {
  comparePep440Versions,
  isPep440PreRelease,
  isPep440VersionCompatible,
} from './pip-version';

describe('PEP 440 버전 유틸리티', () => {
  it('rc 번호와 안정 릴리스 순서를 비교한다', () => {
    expect(comparePep440Versions('1.0.0rc10', '1.0.0rc2')).toBeGreaterThan(0);
    expect(comparePep440Versions('1.0.0', '1.0.0rc1')).toBeGreaterThan(0);
  });

  it('post 개발 릴리스를 안정 릴리스와 post 릴리스 사이에 정렬한다', () => {
    expect(comparePep440Versions('1.0.post1.dev1', '1.0')).toBeGreaterThan(0);
    expect(comparePep440Versions('1.0.post1.dev1', '1.0.post1')).toBeLessThan(0);
    expect(isPep440PreRelease('1.0.post1.dev1')).toBe(true);
  });

  it('프리릴리스가 포함된 범위의 후보를 평가한다', () => {
    expect(isPep440VersionCompatible('1.0rc10', '>=1.0rc1,<1.0')).toBe(true);
  });
});
