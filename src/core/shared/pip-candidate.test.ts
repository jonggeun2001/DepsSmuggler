import { describe, expect, it } from 'vitest';
import {
  CandidateEvaluator,
  createCandidateFromRelease,
  selectBestCandidateFromAllVersions,
  selectBestCandidateFromReleases,
} from './pip-candidate';
import type { CandidateEvaluatorConfig, PyPIReleaseInfo } from './pip-candidate';

const config: CandidateEvaluatorConfig = {
  pythonVersion: '3.11',
  platform: 'windows',
  arch: 'x86_64',
};
function release(filename: string, extra: Partial<PyPIReleaseInfo> = {}): PyPIReleaseInfo {
  return {
    filename,
    url: `https://files.example/${filename}`,
    size: 100,
    digests: { sha256: 'known-hash' },
    packagetype: filename.endsWith('.whl') ? 'bdist_wheel' : 'sdist',
    python_version: 'py3',
    ...extra,
  };
}
const candidate = (
  version = '1.0',
  filename = `demo-${version}-py3-none-any.whl`,
  extra: Partial<PyPIReleaseInfo> = {}
) => createCandidateFromRelease('Demo-Package', version, release(filename, extra));

describe('pip 설치 후보 평가', () => {
  it('릴리스의 배포 메타데이터와 정규화한 이름을 보존한다', () => {
    const result = candidate('1.0', 'demo-1.0-py3-none-any.whl', {
      requires_python: '>=3.8',
      yanked: true,
      yanked_reason: 'broken release',
    });
    expect(result).toMatchObject({
      name: 'demo_package',
      version: '1.0',
      packageType: 'wheel',
      size: 100,
      hash: 'known-hash',
      requiresPython: '>=3.8',
      isYanked: true,
      yankedReason: 'broken release',
    });
    expect(result.wheelInfo).toBeDefined();
  });

  it('소스 배포와 비어 있는 Python 요구사항을 처리한다', () => {
    expect(candidate('1.0', 'demo-1.0.tar.gz', { requires_python: null })).toMatchObject({
      packageType: 'sdist',
      wheelInfo: undefined,
      requiresPython: undefined,
    });
  });

  it.each([
    ['>=3.11', true],
    ['>=3.12', false],
    ['>3.10', true],
    ['>3.11', false],
    ['<=3.11', true],
    ['<=3.10', false],
    ['<3.12', true],
    ['<3.11', false],
    ['==3.11', true],
    ['==3.10', false],
    ['!=3.10', true],
    ['!=3.11', false],
    ['>=3.8,<3.12', true],
    ['>=3.8,!=3.11', false],
  ])('Python 3.11에 대한 %s 요구사항을 평가한다', (requires_python, applicable) => {
    expect(
      new CandidateEvaluator(config).isApplicable(candidate('1.0', undefined, { requires_python }))
    ).toBe(applicable);
  });

  it('대상 플랫폼과 Python ABI가 다른 wheel을 제외한다', () => {
    const evaluator = new CandidateEvaluator(config);
    expect(
      evaluator.isApplicable(candidate('1.0', 'demo-1.0-cp311-cp311-manylinux_2_17_x86_64.whl'))
    ).toBe(false);
    expect(evaluator.isApplicable(candidate('1.0', 'demo-1.0-cp312-cp312-win_amd64.whl'))).toBe(
      false
    );
    expect(evaluator.isApplicable(candidate('1.0', 'demo-1.0-cp38-abi3-win_amd64.whl'))).toBe(true);
  });

  it('철회된 배포는 기본 제외하고 명시적으로 허용할 수 있다', () => {
    const yanked = candidate('1.0', undefined, { yanked: true });
    expect(new CandidateEvaluator(config).sortBestCandidate([yanked])).toBeNull();
    expect(
      new CandidateEvaluator({ ...config, allowYanked: true }).sortBestCandidate([yanked])
    ).toBe(yanked);
  });

  it.each(['2.0a1', '2.0b1', '2.0rc1', '2.0.dev1'])(
    '시험 배포 %s는 허용 옵션에 따라 제외한다',
    (version) => {
      const prerelease = candidate(version);
      expect(new CandidateEvaluator(config).isApplicable(prerelease)).toBe(false);
      expect(
        new CandidateEvaluator({ ...config, allowPrerelease: true }).isApplicable(prerelease)
      ).toBe(true);
    }
  );

  it('같은 버전에서 네이티브 wheel을 순수 Python wheel 및 소스보다 우선한다', () => {
    const native = candidate('1.0', 'demo-1.0-cp311-cp311-win_amd64.whl');
    const pure = candidate();
    const source = candidate('1.0', 'demo-1.0.tar.gz');
    const input = [source, pure, native];
    const result = new CandidateEvaluator(config).computeBestCandidate(input);
    expect(result.bestCandidate).toBe(native);
    expect(result.applicableCandidates).toEqual([native, pure, source]);
    expect(input).toEqual([source, pure, native]);
    expect(result.allCandidates).toBe(input);
  });

  it('binary 선호를 끄면 더 높은 소스 배포 버전을 선택한다', () => {
    const binary = candidate('1.0');
    const source = candidate('2.0', 'demo-2.0.tar.gz');
    expect(new CandidateEvaluator(config).sortBestCandidate([source, binary])).toBe(binary);
    expect(
      new CandidateEvaluator({ ...config, preferBinary: false }).sortBestCandidate([source, binary])
    ).toBe(source);
  });

  it('허용 해시가 일치하는 후보에 정렬 우선순위를 준다', () => {
    const matching = candidate('1.0');
    const other = candidate('2.0', undefined, { digests: { sha256: 'other-hash' } });
    const evaluator = new CandidateEvaluator({ ...config, allowedHashes: new Set(['known-hash']) });
    expect(evaluator.sortBestCandidate([other, matching])).toBe(matching);
    expect(evaluator.getSortingKey(other).hasAllowedHash).toBe(false);
  });

  it('동일 버전과 태그이면 더 높은 빌드 번호를 선택한다', () => {
    const older = candidate('1.0', 'demo-1.0-1-cp311-cp311-win_amd64.whl');
    const newer = candidate('1.0', 'demo-1.0-2-cp311-cp311-win_amd64.whl');
    expect(new CandidateEvaluator(config).sortBestCandidate([older, newer])).toBe(newer);
  });

  it('입력이 비거나 모든 후보가 제외되면 최적 후보가 없다', () => {
    const evaluator = new CandidateEvaluator(config);
    expect(evaluator.computeBestCandidate([])).toEqual({
      allCandidates: [],
      applicableCandidates: [],
      bestCandidate: null,
    });
    expect(
      evaluator.sortBestCandidate([candidate('1.0', undefined, { requires_python: '>=3.12' })])
    ).toBeNull();
    expect(selectBestCandidateFromReleases('demo', '1.0', [], config)).toBeNull();
  });

  it('버전별 빈 릴리스와 제약 밖 버전을 건너뛰고 선택한다', () => {
    const result = selectBestCandidateFromAllVersions(
      'demo',
      {
        '1.0': [release('demo-1.0-py3-none-any.whl')],
        '1.5': [release('demo-1.5-py3-none-any.whl')],
        '1.9': [],
        '2.0': [release('demo-2.0-py3-none-any.whl')],
      },
      config,
      '>=1.0,<2.0'
    );
    expect(result?.version).toBe('1.5');
    expect(selectBestCandidateFromAllVersions('demo', {}, config)).toBeNull();
  });

  it('버전 제약이 없으면 최신 호환 릴리스를 선택한다', () => {
    const result = selectBestCandidateFromAllVersions(
      'demo',
      {
        '1.0': [release('demo-1.0-py3-none-any.whl')],
        '2.0': [release('demo-2.0-py3-none-any.whl')],
      },
      config
    );
    expect(result?.version).toBe('2.0');
  });
});
