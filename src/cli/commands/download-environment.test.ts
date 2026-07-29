import { describe, expect, it } from 'vitest';
import type { Architecture, PackageType, TargetOS } from '../../types';
import {
  hasExplicitTargetEnvironment,
  validateDownloadEnvironmentOptions,
  type CliDownloadEnvironmentOptions,
} from './download-environment';

function createOptions(
  overrides: Partial<{
    type: PackageType;
    arch: string;
    targetOS: string;
    pythonVersion: string;
    cudaVersion: string;
    condaChannel: string;
    classifier: string;
  }> = {},
): CliDownloadEnvironmentOptions {
  return {
    type: 'pip',
    arch: 'x86_64',
    targetOS: 'any',
    condaChannel: 'conda-forge',
    ...overrides,
  } as CliDownloadEnvironmentOptions;
}

describe('validateDownloadEnvironmentOptions', () => {
  it.each([
    createOptions(),
    createOptions({ type: 'pip', targetOS: 'linux', pythonVersion: '3.12' }),
    createOptions({
      type: 'conda',
      targetOS: 'windows',
      pythonVersion: '3.11',
      cudaVersion: '12.4',
      condaChannel: 'pytorch',
    }),
    createOptions({ type: 'maven', targetOS: 'macos', classifier: 'natives-osx' }),
  ])('유효한 대상 환경 옵션을 허용한다', (options) => {
    expect(() => validateDownloadEnvironmentOptions(options)).not.toThrow();
  });

  it.each([
    ['invalid-arch', createOptions({ arch: 'sparc64' }), '지원하지 않는 아키텍처'],
    [
      'pip-unsupported-arch',
      createOptions({ type: 'pip', arch: 'i386' }),
      'pip 대상 다운로드에서 지원하지 않는 아키텍처',
    ],
    [
      'conda-unsupported-arch',
      createOptions({ type: 'conda', arch: 'arm/v7' }),
      'conda 대상 다운로드에서 지원하지 않는 아키텍처',
    ],
    ['invalid-os', createOptions({ targetOS: 'freebsd' }), '지원하지 않는 대상 OS'],
    [
      'python-type',
      createOptions({ type: 'npm', pythonVersion: '3.12' }),
      '--python-version 옵션은 pip 또는 conda',
    ],
    ['python-empty', createOptions({ pythonVersion: '' }), '--python-version은 major.minor'],
    ['python-format', createOptions({ pythonVersion: '3.12.1' }), '--python-version은 major.minor'],
    [
      'cuda-type',
      createOptions({ type: 'pip', cudaVersion: '12.4' }),
      '--cuda-version 옵션은 conda',
    ],
    [
      'cuda-empty',
      createOptions({ type: 'conda', cudaVersion: '' }),
      '--cuda-version은 major.minor',
    ],
    [
      'cuda-format',
      createOptions({ type: 'conda', cudaVersion: 'cuda12' }),
      '--cuda-version은 major.minor',
    ],
    [
      'classifier-type',
      createOptions({ type: 'pip', classifier: 'sources' }),
      '--classifier 옵션은 maven',
    ],
    [
      'classifier-empty',
      createOptions({ type: 'maven', classifier: '   ' }),
      '--classifier는 비어 있을 수 없습니다',
    ],
    [
      'target-os-type',
      createOptions({ type: 'npm', targetOS: 'linux' }),
      '--target-os 옵션은 pip, conda 또는 maven',
    ],
    [
      'channel-type',
      createOptions({ type: 'pip', condaChannel: 'pytorch' }),
      '--conda-channel 옵션은 conda',
    ],
    [
      'maven-target-without-classifier',
      createOptions({ type: 'maven', targetOS: 'linux' }),
      'Maven 대상 OS/아키텍처를 지정하려면 --classifier',
    ],
    [
      'maven-architecture-without-classifier',
      createOptions({ type: 'maven', arch: 'arm64' }),
      'Maven 대상 OS/아키텍처를 지정하려면 --classifier',
    ],
  ])('%s 조합을 거부한다', (_name, options, message) => {
    expect(() => validateDownloadEnvironmentOptions(options)).toThrow(message);
  });

  it.each([
    createOptions({ type: 'npm', arch: 'i386' }),
    createOptions({ type: 'docker', arch: 'arm/v7' }),
  ])('pip/conda 외 타입의 기존 아키텍처는 계속 허용한다', (options) => {
    expect(() => validateDownloadEnvironmentOptions(options)).not.toThrow();
  });
});

describe('hasExplicitTargetEnvironment', () => {
  it('기본값만 있으면 명시적 대상 환경이 아니라고 판단한다', () => {
    expect(hasExplicitTargetEnvironment(createOptions())).toBe(false);
  });

  it.each([
    { targetOS: 'linux' as TargetOS },
    { pythonVersion: '3.12' },
    { cudaVersion: '12.4', type: 'conda' as PackageType },
    { condaChannel: 'pytorch', type: 'conda' as PackageType },
    { classifier: 'sources', type: 'maven' as PackageType },
  ])('기본값이 아닌 대상 환경 옵션을 감지한다: %o', (overrides) => {
    expect(hasExplicitTargetEnvironment(createOptions(overrides))).toBe(true);
  });

  it('기본값이 아닌 아키텍처만 지정해도 대상 환경으로 판단한다', () => {
    expect(
      hasExplicitTargetEnvironment(
        createOptions({ arch: 'arm64' as Architecture }),
      ),
    ).toBe(true);
  });
});
