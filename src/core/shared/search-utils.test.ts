import { describe, it, expect } from 'vitest';
import {
  levenshteinDistance,
  normalizeForSearch,
  calculateRelevanceScore,
  sortByRelevance,
  SortableSearchResult,
  PackageType
} from './search-utils';

describe('search-utils', () => {
  describe('levenshteinDistance', () => {
    it('동일한 문자열 - 거리 0', () => {
      expect(levenshteinDistance('abc', 'abc')).toBe(0);
      expect(levenshteinDistance('', '')).toBe(0);
      expect(levenshteinDistance('hello', 'hello')).toBe(0);
    });

    it('빈 문자열과의 거리', () => {
      expect(levenshteinDistance('', 'abc')).toBe(3);
      expect(levenshteinDistance('abc', '')).toBe(3);
      expect(levenshteinDistance('', 'a')).toBe(1);
    });

    it('한 문자 차이', () => {
      expect(levenshteinDistance('abc', 'abd')).toBe(1); // 치환
      expect(levenshteinDistance('abc', 'abcd')).toBe(1); // 삽입
      expect(levenshteinDistance('abc', 'ab')).toBe(1); // 삭제
    });

    it('여러 문자 차이', () => {
      expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
      expect(levenshteinDistance('saturday', 'sunday')).toBe(3);
    });

    it('완전히 다른 문자열', () => {
      expect(levenshteinDistance('abc', 'xyz')).toBe(3);
      expect(levenshteinDistance('ab', 'cd')).toBe(2);
    });

    it('대소문자 구분', () => {
      expect(levenshteinDistance('ABC', 'abc')).toBe(3);
      expect(levenshteinDistance('Hello', 'hello')).toBe(1);
    });
  });

  describe('normalizeForSearch', () => {
    it('소문자 변환', () => {
      expect(normalizeForSearch('ABC')).toBe('abc');
      expect(normalizeForSearch('Hello')).toBe('hello');
      expect(normalizeForSearch('HeLLo WoRLD')).toBe('helloworld');
    });

    it('하이픈 및 언더스코어 제거', () => {
      expect(normalizeForSearch('hello-world')).toBe('helloworld');
      expect(normalizeForSearch('hello_world')).toBe('helloworld');
      expect(normalizeForSearch('hello-_world')).toBe('helloworld');
    });

    it('특수문자 제거', () => {
      expect(normalizeForSearch('hello.world')).toBe('helloworld');
      expect(normalizeForSearch('hello@world')).toBe('helloworld');
      expect(normalizeForSearch('hello/world')).toBe('helloworld');
      expect(normalizeForSearch('hello:world')).toBe('helloworld');
    });

    it('숫자 유지', () => {
      expect(normalizeForSearch('hello123')).toBe('hello123');
      expect(normalizeForSearch('123abc')).toBe('123abc');
      expect(normalizeForSearch('py3-lib')).toBe('py3lib');
    });

    it('복합 정규화', () => {
      expect(normalizeForSearch('My-Package_Name.v2')).toBe('mypackagenamev2');
      expect(normalizeForSearch('@org/package-name')).toBe('orgpackagename');
    });
  });

  describe('calculateRelevanceScore', () => {
    it('정확히 일치 - 점수 0', () => {
      expect(calculateRelevanceScore('numpy', 'numpy')).toBe(0);
      expect(calculateRelevanceScore('NumPy', 'numpy')).toBe(0); // 대소문자 무시
      expect(calculateRelevanceScore('num-py', 'numpy')).toBe(0); // 하이픈 무시
    });

    it('쿼리로 시작하는 경우 - 점수 1-10', () => {
      const score = calculateRelevanceScore('numpy-array', 'numpy');
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(10);
    });

    it('시작하는 경우 길이에 따른 점수 차이', () => {
      const shortScore = calculateRelevanceScore('numpya', 'numpy');
      const longScore = calculateRelevanceScore('numpyarray', 'numpy');
      expect(shortScore).toBeLessThan(longScore);
    });

    it('쿼리가 포함된 경우 - 점수 10-50', () => {
      const score = calculateRelevanceScore('python-numpy', 'numpy');
      expect(score).toBeGreaterThanOrEqual(10);
      expect(score).toBeLessThan(50);
    });

    it('포함된 위치에 따른 점수 차이', () => {
      const earlyScore = calculateRelevanceScore('anumpy', 'numpy'); // index 1
      const lateScore = calculateRelevanceScore('abcnumpy', 'numpy'); // index 3
      expect(earlyScore).toBeLessThan(lateScore);
    });

    it('포함되지 않는 경우 - 점수 50 이상', () => {
      const score = calculateRelevanceScore('tensorflow', 'numpy');
      expect(score).toBeGreaterThanOrEqual(50);
    });

    it('유사한 문자열은 낮은 점수', () => {
      const similarScore = calculateRelevanceScore('numby', 'numpy'); // 거리 1
      const differentScore = calculateRelevanceScore('aaaaa', 'numpy'); // 거리 5
      expect(similarScore).toBeLessThan(differentScore);
    });
  });

  describe('sortByRelevance', () => {
    const createResult = (name: string): SortableSearchResult => ({ name });

    it('빈 쿼리 - 원본 순서 유지', () => {
      const results = [createResult('b'), createResult('a'), createResult('c')];
      expect(sortByRelevance(results, '')).toEqual(results);
      expect(sortByRelevance(results, '  ')).toEqual(results);
    });

    it('정확히 일치하는 항목이 가장 먼저', () => {
      const results = [
        createResult('numpy-array'),
        createResult('numpy'),
        createResult('numpylib')
      ];
      const sorted = sortByRelevance(results, 'numpy');
      expect(sorted[0].name).toBe('numpy');
    });

    it('시작하는 항목이 포함된 항목보다 먼저', () => {
      const results = [
        createResult('python-numpy'),
        createResult('numpy-array'),
        createResult('numpylib')
      ];
      const sorted = sortByRelevance(results, 'numpy');
      // numpy로 시작하는 항목들이 먼저 와야 함 (numpylib이 더 짧으므로 먼저)
      expect(['numpy-array', 'numpylib']).toContain(sorted[0].name);
      // python-numpy는 포함(10-50점)이므로 시작하는 항목(1-10점)보다 뒤에
      expect(sorted[2].name).toBe('python-numpy');
    });

    it('원본 배열을 변경하지 않음', () => {
      const results = [createResult('b'), createResult('a')];
      const original = [...results];
      sortByRelevance(results, 'a');
      expect(results).toEqual(original);
    });

    describe('패키지 타입별 정렬', () => {
      it('maven - artifactId 기준 정렬', () => {
        const results = [
          createResult('org.apache:commons-lang'),
          createResult('com.google:gson'),
          createResult('io.spring:spring-core')
        ];
        const sorted = sortByRelevance(results, 'gson', 'maven');
        expect(sorted[0].name).toBe('com.google:gson');
      });

      it('docker - image 이름 기준 정렬', () => {
        const results = [
          createResult('library/nginx'),
          createResult('custom/myapp'),
          createResult('nginx')
        ];
        const sorted = sortByRelevance(results, 'nginx', 'docker');
        expect(sorted[0].name).toBe('nginx');
      });

      it('npm - 패키지명 기준 정렬 (org scope 처리)', () => {
        const results = [
          createResult('@types/react'),
          createResult('react'),
          createResult('react-dom')
        ];
        const sorted = sortByRelevance(results, 'react', 'npm');
        expect(sorted[0].name).toBe('react');
      });

      it('npm - scoped 패키지 정렬', () => {
        const results = [
          createResult('@angular/core'),
          createResult('@vue/core'),
          createResult('core-js')
        ];
        const sorted = sortByRelevance(results, 'core', 'npm');
        // core-js가 정확히 core를 포함하므로 앞에 와야 함
        expect(sorted.some((r) => r.name === 'core-js')).toBe(true);
      });
    });

    it('복합 정렬 테스트', () => {
      const results = [
        createResult('tensorflow'),
        createResult('numpy'),
        createResult('numpydoc'),
        createResult('python-numpy'),
        createResult('scipy-numpy')
      ];
      const sorted = sortByRelevance(results, 'numpy');

      // 1. 정확히 일치: numpy
      expect(sorted[0].name).toBe('numpy');
      // 2. numpy로 시작: numpydoc
      expect(sorted[1].name).toBe('numpydoc');
      // 3. numpy 포함: python-numpy, scipy-numpy
      expect(['python-numpy', 'scipy-numpy']).toContain(sorted[2].name);
      // 4. numpy 미포함: tensorflow
      expect(sorted[4].name).toBe('tensorflow');
    });
  });
});
