import { describe, it, expect } from 'vitest';
import {
  parseMatchSpec,
  parseCondaVersion,
  compareCondaVersions,
  matchesVersionSpec,
  matchesBuildSpec,
  matchesSpec,
  MatchSpec
} from './conda-matchspec';

describe('conda-matchspec', () => {
  describe('parseMatchSpec', () => {
    it('패키지명만', () => {
      const result = parseMatchSpec('numpy');
      expect(result.name).toBe('numpy');
      expect(result.version).toBeUndefined();
      expect(result.build).toBeUndefined();
    });

    it('패키지명과 버전 (공백 구분)', () => {
      const result = parseMatchSpec('numpy 1.8*');
      expect(result.name).toBe('numpy');
      expect(result.version).toBe('1.8*');
    });

    it('패키지명, 버전, 빌드 (공백 구분)', () => {
      const result = parseMatchSpec('numpy 1.8.1 py39_0');
      expect(result.name).toBe('numpy');
      expect(result.version).toBe('1.8.1');
      expect(result.build).toBe('py39_0');
    });

    it('= 구분자 형식', () => {
      const result = parseMatchSpec('numpy=1.8.1=py39_0');
      expect(result.name).toBe('numpy');
      expect(result.version).toBe('1.8.1');
      expect(result.build).toBe('py39_0');
    });

    it('채널 포함', () => {
      const result = parseMatchSpec('conda-forge::numpy');
      expect(result.channel).toBe('conda-forge');
      expect(result.name).toBe('numpy');
    });

    it('채널과 subdir 포함', () => {
      const result = parseMatchSpec('conda-forge/linux-64::numpy');
      expect(result.channel).toBe('conda-forge');
      expect(result.subdir).toBe('linux-64');
      expect(result.name).toBe('numpy');
    });

    it('버전 비교 연산자', () => {
      expect(parseMatchSpec('numpy >=1.8').version).toBe('>=1.8');
      expect(parseMatchSpec('numpy <2.0').version).toBe('<2.0');
      expect(parseMatchSpec('numpy >=1.8,<2').version).toBe('>=1.8,<2');
    });

    it('와일드카드 빌드 스펙', () => {
      const result = parseMatchSpec('pytorch=1.8.*=*cuda*');
      expect(result.name).toBe('pytorch');
      expect(result.version).toBe('1.8.*');
      expect(result.build).toBe('*cuda*');
    });
  });

  describe('parseCondaVersion', () => {
    it('기본 버전 파싱', () => {
      const parts = parseCondaVersion('1.2.3');
      // epoch(0) + 1 + 2 + 3
      expect(parts.length).toBeGreaterThanOrEqual(4);
      expect(parts[1]).toEqual({ type: 'num', value: 1 });
      expect(parts[2]).toEqual({ type: 'num', value: 2 });
      expect(parts[3]).toEqual({ type: 'num', value: 3 });
    });

    it('epoch 파싱', () => {
      const parts = parseCondaVersion('1!2.0.0');
      expect(parts[0]).toEqual({ type: 'num', value: 1 }); // epoch
      expect(parts[1]).toEqual({ type: 'num', value: 2 });
    });

    it('프리릴리스 태그 파싱', () => {
      const alpha = parseCondaVersion('1.0a1');
      expect(alpha.some(p => p.type === 'alpha')).toBe(true);

      const beta = parseCondaVersion('1.0b1');
      expect(beta.some(p => p.type === 'beta')).toBe(true);

      const rc = parseCondaVersion('1.0rc1');
      expect(rc.some(p => p.type === 'rc')).toBe(true);
    });

    it('dev 및 post 태그', () => {
      const dev = parseCondaVersion('1.0.dev1');
      expect(dev.some(p => p.type === 'dev')).toBe(true);

      const post = parseCondaVersion('1.0.post1');
      expect(post.some(p => p.type === 'post')).toBe(true);
    });

    it('local 버전 무시', () => {
      const parts = parseCondaVersion('1.0.0+local123');
      // +local123 부분은 무시됨
      expect(parts.length).toBe(4); // epoch + 1 + 0 + 0
    });
  });

  describe('compareCondaVersions', () => {
    it('동일 버전', () => {
      expect(compareCondaVersions('1.0.0', '1.0.0')).toBe(0);
      expect(compareCondaVersions('2.5.3', '2.5.3')).toBe(0);
    });

    it('major 버전 비교', () => {
      expect(compareCondaVersions('2.0.0', '1.0.0')).toBeGreaterThan(0);
      expect(compareCondaVersions('1.0.0', '2.0.0')).toBeLessThan(0);
    });

    it('minor 버전 비교', () => {
      expect(compareCondaVersions('1.2.0', '1.1.0')).toBeGreaterThan(0);
      expect(compareCondaVersions('1.1.0', '1.2.0')).toBeLessThan(0);
    });

    it('patch 버전 비교', () => {
      expect(compareCondaVersions('1.0.2', '1.0.1')).toBeGreaterThan(0);
      expect(compareCondaVersions('1.0.1', '1.0.2')).toBeLessThan(0);
    });

    it('프리릴리스 순서: dev < alpha < beta < rc < 정식', () => {
      expect(compareCondaVersions('1.0.dev1', '1.0a1')).toBeLessThan(0);
      expect(compareCondaVersions('1.0a1', '1.0b1')).toBeLessThan(0);
      expect(compareCondaVersions('1.0b1', '1.0rc1')).toBeLessThan(0);
      expect(compareCondaVersions('1.0rc1', '1.0.0')).toBeLessThan(0);
    });

    it('post 릴리스는 정식보다 높음', () => {
      expect(compareCondaVersions('1.0.post1', '1.0.0')).toBeGreaterThan(0);
    });

    it('epoch 비교', () => {
      expect(compareCondaVersions('1!1.0.0', '2.0.0')).toBeGreaterThan(0);
      expect(compareCondaVersions('2!1.0.0', '1!2.0.0')).toBeGreaterThan(0);
    });

    it('버전 자릿수가 다른 경우', () => {
      expect(compareCondaVersions('1.0', '1.0.0')).toBe(0);
      expect(compareCondaVersions('1.0.0.0', '1.0')).toBe(0);
    });
  });

  describe('matchesVersionSpec', () => {
    it('와일드카드 * (모든 버전)', () => {
      expect(matchesVersionSpec('1.0.0', '*')).toBe(true);
      expect(matchesVersionSpec('2.5.3', '*')).toBe(true);
      expect(matchesVersionSpec('1.0.0', '')).toBe(true);
    });

    it('버전 와일드카드', () => {
      expect(matchesVersionSpec('1.8.0', '1.8.*')).toBe(true);
      expect(matchesVersionSpec('1.8.99', '1.8.*')).toBe(true);
      expect(matchesVersionSpec('1.9.0', '1.8.*')).toBe(false);
    });

    it('>= 연산자', () => {
      expect(matchesVersionSpec('1.5.0', '>=1.0.0')).toBe(true);
      expect(matchesVersionSpec('1.0.0', '>=1.0.0')).toBe(true);
      expect(matchesVersionSpec('0.9.0', '>=1.0.0')).toBe(false);
    });

    it('<= 연산자', () => {
      expect(matchesVersionSpec('1.0.0', '<=2.0.0')).toBe(true);
      expect(matchesVersionSpec('2.0.0', '<=2.0.0')).toBe(true);
      expect(matchesVersionSpec('2.1.0', '<=2.0.0')).toBe(false);
    });

    it('> 연산자', () => {
      expect(matchesVersionSpec('1.5.0', '>1.0.0')).toBe(true);
      expect(matchesVersionSpec('1.0.0', '>1.0.0')).toBe(false);
    });

    it('< 연산자', () => {
      expect(matchesVersionSpec('0.9.0', '<1.0.0')).toBe(true);
      expect(matchesVersionSpec('1.0.0', '<1.0.0')).toBe(false);
    });

    it('== 연산자', () => {
      expect(matchesVersionSpec('1.0.0', '==1.0.0')).toBe(true);
      expect(matchesVersionSpec('1.0.1', '==1.0.0')).toBe(false);
      expect(matchesVersionSpec('1.8.5', '==1.8.*')).toBe(true);
    });

    it('!= 연산자', () => {
      expect(matchesVersionSpec('1.0.1', '!=1.0.0')).toBe(true);
      expect(matchesVersionSpec('1.0.0', '!=1.0.0')).toBe(false);
    });

    it('AND 조건 (콤마 구분)', () => {
      expect(matchesVersionSpec('1.5.0', '>=1.0.0,<2.0.0')).toBe(true);
      expect(matchesVersionSpec('2.0.0', '>=1.0.0,<2.0.0')).toBe(false);
      expect(matchesVersionSpec('0.5.0', '>=1.0.0,<2.0.0')).toBe(false);
    });

    it('OR 조건 (파이프 구분)', () => {
      expect(matchesVersionSpec('1.5.0', '1.5.0|2.0.0')).toBe(true);
      expect(matchesVersionSpec('2.0.0', '1.5.0|2.0.0')).toBe(true);
      expect(matchesVersionSpec('3.0.0', '1.5.0|2.0.0')).toBe(false);
    });

    it('복합 조건', () => {
      // (>=1.0,<1.5) OR (>=2.0,<2.5)
      expect(matchesVersionSpec('1.2.0', '>=1.0,<1.5|>=2.0,<2.5')).toBe(true);
      expect(matchesVersionSpec('2.2.0', '>=1.0,<1.5|>=2.0,<2.5')).toBe(true);
      expect(matchesVersionSpec('1.7.0', '>=1.0,<1.5|>=2.0,<2.5')).toBe(false);
    });
  });

  describe('matchesBuildSpec', () => {
    it('빈 스펙 또는 * (모든 빌드)', () => {
      expect(matchesBuildSpec('py39_0', '*')).toBe(true);
      expect(matchesBuildSpec('py39_0', '')).toBe(true);
    });

    it('정확한 빌드 매칭', () => {
      expect(matchesBuildSpec('py39_0', 'py39_0')).toBe(true);
      expect(matchesBuildSpec('py39_0', 'py38_0')).toBe(false);
    });

    it('와일드카드 빌드 매칭', () => {
      expect(matchesBuildSpec('py39_cuda11_0', '*cuda*')).toBe(true);
      expect(matchesBuildSpec('py39_cpu_0', '*cuda*')).toBe(false);
    });

    it('접두사 와일드카드', () => {
      expect(matchesBuildSpec('py39_0', 'py39*')).toBe(true);
      expect(matchesBuildSpec('py38_0', 'py39*')).toBe(false);
    });

    it('접미사 와일드카드', () => {
      expect(matchesBuildSpec('py39_cuda11_0', '*_0')).toBe(true);
      expect(matchesBuildSpec('py39_cuda11_1', '*_0')).toBe(false);
    });
  });

  describe('matchesSpec', () => {
    it('이름만 비교', () => {
      const spec: MatchSpec = { name: 'numpy' };
      expect(matchesSpec({ name: 'numpy', version: '1.0.0' }, spec)).toBe(true);
      expect(matchesSpec({ name: 'pandas', version: '1.0.0' }, spec)).toBe(false);
    });

    it('이름 대소문자 무시', () => {
      const spec: MatchSpec = { name: 'NumPy' };
      expect(matchesSpec({ name: 'numpy', version: '1.0.0' }, spec)).toBe(true);
      expect(matchesSpec({ name: 'NUMPY', version: '1.0.0' }, spec)).toBe(true);
    });

    it('이름과 버전 비교', () => {
      const spec: MatchSpec = { name: 'numpy', version: '>=1.0.0,<2.0.0' };
      expect(matchesSpec({ name: 'numpy', version: '1.5.0' }, spec)).toBe(true);
      expect(matchesSpec({ name: 'numpy', version: '2.5.0' }, spec)).toBe(false);
    });

    it('이름, 버전, 빌드 비교', () => {
      const spec: MatchSpec = { name: 'numpy', version: '1.8.*', build: '*cuda*' };
      expect(matchesSpec({ name: 'numpy', version: '1.8.1', build: 'py39_cuda11' }, spec)).toBe(true);
      expect(matchesSpec({ name: 'numpy', version: '1.8.1', build: 'py39_cpu' }, spec)).toBe(false);
      expect(matchesSpec({ name: 'numpy', version: '1.9.0', build: 'py39_cuda11' }, spec)).toBe(false);
    });

    it('빌드 없는 패키지와 빌드 스펙', () => {
      const spec: MatchSpec = { name: 'numpy', build: '*cuda*' };
      // 패키지에 빌드가 없으면 빌드 조건 무시
      expect(matchesSpec({ name: 'numpy', version: '1.0.0' }, spec)).toBe(true);
    });
  });
});
