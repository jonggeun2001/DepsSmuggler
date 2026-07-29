import type { Architecture, PackageType, TargetOS } from '../../types';

const SUPPORTED_ARCHITECTURES = new Set<Architecture>([
  'x86_64',
  'amd64',
  'arm64',
  'aarch64',
  'i386',
  'i686',
  'noarch',
  'all',
  'arm/v7',
  '386',
]);
const SUPPORTED_TARGET_OSES = new Set<TargetOS>([
  'any',
  'linux',
  'windows',
  'macos',
]);
const TARGET_OS_PACKAGE_TYPES = new Set<PackageType>([
  'pip',
  'conda',
  'maven',
]);
const TARGET_ARTIFACT_PACKAGE_TYPES = new Set<PackageType>(['pip', 'conda']);
const TARGET_ARTIFACT_ARCHITECTURES = new Set<Architecture>([
  'x86_64',
  'amd64',
  'arm64',
  'aarch64',
]);
const PYTHON_PACKAGE_TYPES = new Set<PackageType>(['pip', 'conda']);
const VERSION_PATTERN = /^\d+\.\d+$/;

export interface CliDownloadEnvironmentOptions {
  type: PackageType;
  arch: Architecture;
  targetOS: TargetOS;
  pythonVersion?: string;
  cudaVersion?: string;
  condaChannel: string;
  classifier?: string;
}

export function validateDownloadEnvironmentOptions(
  options: CliDownloadEnvironmentOptions,
): void {
  if (!SUPPORTED_ARCHITECTURES.has(options.arch)) {
    throw new Error(`지원하지 않는 아키텍처입니다: ${options.arch}`);
  }

  if (
    TARGET_ARTIFACT_PACKAGE_TYPES.has(options.type) &&
    !TARGET_ARTIFACT_ARCHITECTURES.has(options.arch)
  ) {
    throw new Error(
      `${options.type} 대상 다운로드에서 지원하지 않는 아키텍처입니다: ${options.arch}`,
    );
  }

  if (!SUPPORTED_TARGET_OSES.has(options.targetOS)) {
    throw new Error(`지원하지 않는 대상 OS입니다: ${options.targetOS}`);
  }

  if (
    options.targetOS !== 'any' &&
    !TARGET_OS_PACKAGE_TYPES.has(options.type)
  ) {
    throw new Error(
      '--target-os 옵션은 pip, conda 또는 maven 다운로드에서만 사용할 수 있습니다.',
    );
  }

  if (
    options.pythonVersion !== undefined &&
    !PYTHON_PACKAGE_TYPES.has(options.type)
  ) {
    throw new Error(
      '--python-version 옵션은 pip 또는 conda 다운로드에서만 사용할 수 있습니다.',
    );
  }

  if (
    options.pythonVersion !== undefined &&
    !VERSION_PATTERN.test(options.pythonVersion)
  ) {
    throw new Error('--python-version은 major.minor 형식이어야 합니다.');
  }

  if (options.cudaVersion !== undefined && options.type !== 'conda') {
    throw new Error(
      '--cuda-version 옵션은 conda 다운로드에서만 사용할 수 있습니다.',
    );
  }

  if (
    options.cudaVersion !== undefined &&
    !VERSION_PATTERN.test(options.cudaVersion)
  ) {
    throw new Error('--cuda-version은 major.minor 형식이어야 합니다.');
  }

  if (options.classifier !== undefined && options.type !== 'maven') {
    throw new Error(
      '--classifier 옵션은 maven 다운로드에서만 사용할 수 있습니다.',
    );
  }

  if (
    options.classifier !== undefined &&
    options.classifier.trim().length === 0
  ) {
    throw new Error('--classifier는 비어 있을 수 없습니다.');
  }

  if (
    options.type === 'maven' &&
    options.targetOS !== 'any' &&
    options.classifier === undefined
  ) {
    throw new Error(
      'Maven 대상 OS를 지정하려면 --classifier를 함께 지정해야 합니다.',
    );
  }

  if (options.condaChannel !== 'conda-forge' && options.type !== 'conda') {
    throw new Error(
      '--conda-channel 옵션은 conda 다운로드에서만 사용할 수 있습니다.',
    );
  }
}

export function hasExplicitTargetEnvironment(
  options: CliDownloadEnvironmentOptions,
): boolean {
  return (
    options.targetOS !== 'any' ||
    options.pythonVersion !== undefined ||
    options.cudaVersion !== undefined ||
    options.condaChannel !== 'conda-forge' ||
    options.classifier !== undefined
  );
}
