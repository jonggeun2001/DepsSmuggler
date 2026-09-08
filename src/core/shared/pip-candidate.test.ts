import { describe, expect, it, vi } from 'vitest';
import { CandidateEvaluator, type InstallationCandidate } from './pip-candidate';
import { parseWheelFilename } from './pip-wheel';

function createCandidates(): InstallationCandidate[] {
  return Array.from({ length: 40 }, (_, index) => {
    const filename = `sample-${1 + index % 4}-${index % 3 ? 'py3-none-any' : 'cp312-cp312-manylinux_2_17_x86_64'}.whl`;
    return {
      name: 'sample', version: String(1 + index % 4), filename, url: filename,
      packageType: 'wheel', wheelInfo: parseWheelFilename(filename)!,
      hash: index % 5 ? 'other' : 'allowed', isYanked: index % 7 === 0,
    };
  });
}

describe('CandidateEvaluator sort cost', () => {
  it.each([true, false])('binary 선호=%s에서 기존 비교 순서와 후보 객체를 유지한다', (preferBinary) => {
    const evaluator = new CandidateEvaluator({
      pythonVersion: '3.12', platform: 'linux', arch: 'x86_64', preferBinary,
      allowedHashes: new Set(['allowed']), allowYanked: true,
    });
    const candidates = createCandidates();
    candidates.push({ name: 'sample', version: '5', filename: 'sample-5.tar.gz', url: 'sdist', packageType: 'sdist' });
    const snapshot = [...candidates];
    const expected = candidates.filter((candidate) => evaluator.isApplicable(candidate)).sort((a, b) =>
      evaluator.compareSortingKeys(evaluator.getSortingKey(a), evaluator.getSortingKey(b))
    );
    const keySpy = vi.spyOn(evaluator, 'getSortingKey');

    const actual = evaluator.getApplicableCandidates(candidates);

    expect(actual).toHaveLength(expected.length);
    actual.forEach((candidate, index) => expect(candidate).toBe(expected[index]));
    expect(candidates).toEqual(snapshot);
    expect(keySpy.mock.calls.length).toBeLessThanOrEqual(candidates.length);
  });

  it('다음 호출에서는 바뀐 후보 값을 다시 평가한다', () => {
    const evaluator = new CandidateEvaluator({ pythonVersion: '3.12', platform: 'linux', arch: 'x86_64' });
    const candidates = createCandidates().slice(1, 3);
    expect(evaluator.sortBestCandidate(candidates)).toBe(candidates[1]);
    candidates[0].version = '100';
    expect(evaluator.sortBestCandidate(candidates)).toBe(candidates[0]);
    expect(evaluator.sortBestCandidate([])).toBeNull();
  });
});
