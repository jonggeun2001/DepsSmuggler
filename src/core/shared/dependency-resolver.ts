// 공통 의존성 해결 모듈
import { getPipResolver } from '../resolver/pipResolver';
import { getMavenResolver } from '../resolver/mavenResolver';
import { getCondaResolver } from '../resolver/condaResolver';
import { getYumResolver } from '../resolver/yumResolver';
import { DownloadPackage } from './types';
import { DependencyResolutionResult } from '../../types';

/**
 * 고유 ID 생성 함수
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * 의존성 해결 결과 인터페이스
 */
export interface ResolvedPackageList {
  /** 원본 패키지 목록 */
  originalPackages: DownloadPackage[];
  /** 의존성 포함 전체 패키지 목록 */
  allPackages: DownloadPackage[];
  /** 각 패키지의 의존성 트리 */
  dependencyTrees: DependencyResolutionResult[];
  /** 해결 실패한 패키지 목록 */
  failedPackages: { name: string; version: string; error: string }[];
}

/**
 * 의존성 해결 옵션
 */
export interface DependencyResolverOptions {
  /** 최대 의존성 탐색 깊이 (기본값: 5) */
  maxDepth?: number;
  /** 선택적 의존성 포함 여부 (기본값: false) */
  includeOptional?: boolean;
  /** conda 채널 (기본값: 'conda-forge') */
  condaChannel?: string;
  /** yum 저장소 URL */
  yumRepoUrl?: string;
  /** 아키텍처 (기본값: 'x86_64') */
  architecture?: string;
}

/**
 * 패키지 타입별 리졸버 반환
 */
function getResolverByType(type: string) {
  switch (type) {
    case 'pip':
      return getPipResolver();
    case 'conda':
      return getCondaResolver();
    case 'maven':
      return getMavenResolver();
    case 'yum':
      return getYumResolver();
    default:
      return null;
  }
}

/**
 * 패키지 목록의 모든 의존성을 해결합니다.
 *
 * @param packages 장바구니의 패키지 목록
 * @param options 의존성 해결 옵션
 * @returns 원본 패키지와 의존성 포함 전체 패키지 목록
 */
export async function resolveAllDependencies(
  packages: DownloadPackage[],
  options?: DependencyResolverOptions
): Promise<ResolvedPackageList> {
  const resolvedSet = new Map<string, DownloadPackage>();
  const dependencyTrees: DependencyResolutionResult[] = [];
  const failedPackages: { name: string; version: string; error: string }[] = [];

  const maxDepth = options?.maxDepth ?? 5;
  const includeOptional = options?.includeOptional ?? false;
  const condaChannel = options?.condaChannel ?? 'conda-forge';
  const architecture = options?.architecture ?? 'x86_64';

  for (const pkg of packages) {
    // 원본 패키지 추가
    const key = `${pkg.type}:${pkg.name}@${pkg.version}`;
    resolvedSet.set(key, pkg);

    // 타입별 리졸버 선택
    const resolver = getResolverByType(pkg.type);
    if (!resolver) {
      console.warn(`지원하지 않는 패키지 타입: ${pkg.type}`);
      continue;
    }

    try {
      // 패키지 타입별 의존성 해결 옵션 설정
      let resolverOptions: Record<string, unknown> = {
        maxDepth,
        includeOptionalDependencies: includeOptional,
      };

      if (pkg.type === 'conda') {
        resolverOptions = { ...resolverOptions, channel: condaChannel };
      } else if (pkg.type === 'yum') {
        resolverOptions = {
          ...resolverOptions,
          repoUrl: options?.yumRepoUrl,
          architecture,
        };
      }

      const result = await resolver.resolveDependencies(
        pkg.name,
        pkg.version,
        resolverOptions
      );

      dependencyTrees.push(result);

      // 평탄화된 의존성 목록 추가
      for (const depPkg of result.flatList) {
        const depKey = `${depPkg.type}:${depPkg.name}@${depPkg.version}`;
        if (!resolvedSet.has(depKey)) {
          resolvedSet.set(depKey, {
            id: generateId(),
            type: depPkg.type,
            name: depPkg.name,
            version: depPkg.version,
            architecture: depPkg.arch || pkg.architecture,
          });
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`의존성 해결 실패: ${pkg.name}@${pkg.version}`, error);
      failedPackages.push({
        name: pkg.name,
        version: pkg.version,
        error: errorMessage,
      });
      // 실패해도 원본 패키지는 이미 추가되어 있으므로 계속 진행
    }
  }

  return {
    originalPackages: packages,
    allPackages: Array.from(resolvedSet.values()),
    dependencyTrees,
    failedPackages,
  };
}

/**
 * 단일 패키지의 의존성을 해결합니다.
 */
export async function resolveSinglePackageDependencies(
  pkg: DownloadPackage,
  options?: DependencyResolverOptions
): Promise<ResolvedPackageList> {
  return resolveAllDependencies([pkg], options);
}
