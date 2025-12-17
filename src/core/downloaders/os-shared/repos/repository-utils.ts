/**
 * 저장소 관련 유틸리티 함수
 */

import type {
  OSDistribution,
  Repository,
  OSPackageManager,
  OSArchitecture,
} from '../types';

/**
 * 아키텍처 정규화 (다른 표기법을 통일)
 */
export function normalizeArchitecture(arch: string): OSArchitecture {
  const archMap: Record<string, OSArchitecture> = {
    // 64비트 x86
    x86_64: 'x86_64',
    amd64: 'amd64',
    x64: 'x86_64',
    // 64비트 ARM
    aarch64: 'aarch64',
    arm64: 'arm64',
    // 32비트 x86
    i686: 'i686',
    i386: 'i386',
    i586: 'i686',
    x86: 'i686',
    // 32비트 ARM
    armv7l: 'armv7l',
    armhf: 'armhf',
    armv7: 'armv7l',
    arm: 'armhf',
    // 아키텍처 무관
    noarch: 'noarch',
    all: 'all',
    any: 'noarch',
  };

  return archMap[arch.toLowerCase()] || (arch as OSArchitecture);
}

/**
 * 아키텍처 호환성 확인 (noarch/all은 모든 아키텍처와 호환)
 */
export function isArchitectureCompatible(
  packageArch: OSArchitecture,
  targetArch: OSArchitecture
): boolean {
  // 아키텍처 무관 패키지는 모든 아키텍처에서 사용 가능
  if (packageArch === 'noarch' || packageArch === 'all') {
    return true;
  }

  // 동일 아키텍처
  if (packageArch === targetArch) {
    return true;
  }

  // 동일 계열 아키텍처 (x86_64 <-> amd64, aarch64 <-> arm64 등)
  const equivalentArchs: OSArchitecture[][] = [
    ['x86_64', 'amd64'],
    ['aarch64', 'arm64'],
    ['i686', 'i386'],
    ['armv7l', 'armhf'],
  ];

  for (const group of equivalentArchs) {
    if (group.includes(packageArch) && group.includes(targetArch)) {
      return true;
    }
  }

  return false;
}

/**
 * 저장소 URL에서 변수 치환 ($basearch, $releasever 등)
 */
export function resolveRepoUrl(
  baseUrl: string,
  arch: OSArchitecture,
  distribution: OSDistribution
): string {
  // 아키텍처 이름 정규화 (yum/rpm은 x86_64, apt/deb은 amd64 사용)
  let resolvedArch = arch;
  if (distribution.packageManager === 'yum' && arch === 'amd64') {
    resolvedArch = 'x86_64';
  } else if (distribution.packageManager === 'apt' && arch === 'x86_64') {
    resolvedArch = 'amd64';
  }

  return baseUrl
    .replace(/\$basearch/g, resolvedArch)
    .replace(/\$releasever/g, distribution.version)
    .replace(/\$arch/g, resolvedArch);
}

/**
 * 사용자 정의 저장소 생성
 */
export function createCustomRepository(
  id: string,
  name: string,
  baseUrl: string,
  options: Partial<Omit<Repository, 'id' | 'name' | 'baseUrl'>> = {}
): Repository {
  return {
    id,
    name,
    baseUrl,
    enabled: options.enabled ?? true,
    gpgCheck: options.gpgCheck ?? false,
    gpgKeyUrl: options.gpgKeyUrl,
    priority: options.priority ?? 99,
    isOfficial: false,
  };
}

// 배포판 조회 함수들을 위한 참조 (순환 참조 방지를 위해 런타임에 주입)
let distributionsRef: OSDistribution[] = [];
let recommendationsRef: { id: string; distributions: string[] }[] = [];

/**
 * 배포판 및 추천 목록 참조 설정 (index.ts에서 호출)
 */
export function setDistributionsRef(
  distributions: OSDistribution[],
  recommendations: { id: string; distributions: string[] }[]
): void {
  distributionsRef = distributions;
  recommendationsRef = recommendations;
}

/**
 * 배포판 ID로 배포판 정보 가져오기
 */
export function getDistributionById(id: string): OSDistribution | undefined {
  return distributionsRef.find((dist) => dist.id === id);
}

/**
 * 패키지 관리자별 배포판 목록 가져오기
 */
export function getDistributionsByPackageManager(
  packageManager: OSPackageManager
): OSDistribution[] {
  return distributionsRef.filter((dist) => dist.packageManager === packageManager);
}

/**
 * 용도별 추천 배포판 가져오기
 */
export function getRecommendedDistributions(useCase: string): OSDistribution[] {
  const recommendation = recommendationsRef.find((r) => r.id === useCase);
  if (!recommendation) return [];
  return recommendation.distributions
    .map((id) => getDistributionById(id))
    .filter((dist): dist is OSDistribution => dist !== undefined);
}
