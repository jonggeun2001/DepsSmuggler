/**
 * OS Resolver 공통 유틸리티
 * yum, apt, apk resolver에서 공통으로 사용하는 함수들
 */

import type {
  OSPackageInfo,
  OSPackageSearchResult,
} from '../downloaders/os-shared/types';
import type { DependencyResolverOptions } from '../downloaders/os-shared/base-resolver';
import { compareVersions } from '../shared/version-utils';

export type { DependencyResolverOptions };

/**
 * 쿼리와 일치하는 패키지 필터링
 */
export function matchPackagesByQuery(
  packages: OSPackageInfo[],
  query: string,
  matchType: 'exact' | 'partial' | 'wildcard' = 'partial'
): OSPackageInfo[] {
  return packages.filter((pkg) => {
    switch (matchType) {
      case 'exact':
        return pkg.name === query;
      case 'partial':
        return pkg.name.includes(query);
      case 'wildcard':
        const regex = new RegExp(
          '^' + query.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
        );
        return regex.test(pkg.name);
      default:
        return false;
    }
  });
}

/**
 * 패키지를 이름별로 그룹화
 */
export function groupPackagesByName(
  packages: OSPackageInfo[]
): Map<string, OSPackageInfo[]> {
  const grouped = new Map<string, OSPackageInfo[]>();
  for (const pkg of packages) {
    const existing = grouped.get(pkg.name) || [];
    existing.push(pkg);
    grouped.set(pkg.name, existing);
  }
  return grouped;
}

/**
 * 버전을 최신순으로 정렬 (내림차순)
 */
export function sortVersionsDescending(packages: OSPackageInfo[]): OSPackageInfo[] {
  return [...packages].sort((a, b) => {
    const versionA = String(a.version || '');
    const versionB = String(b.version || '');
    try {
      return compareVersions(versionB, versionA);
    } catch {
      return versionB.localeCompare(versionA);
    }
  });
}

/**
 * 그룹화된 패키지를 OSPackageSearchResult 형태로 변환
 */
export function convertToSearchResults(
  groupedPackages: Map<string, OSPackageInfo[]>
): OSPackageSearchResult[] {
  const results: OSPackageSearchResult[] = [];

  for (const [name, versions] of groupedPackages) {
    const sortedVersions = sortVersionsDescending(versions);
    results.push({
      name,
      versions: sortedVersions,
      latest: sortedVersions[0],
    });
  }

  // 패키지 이름순으로 정렬
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 패키지 검색 공통 로직
 * loadMetadata 후에 호출해야 함
 */
export function searchPackagesCommon(
  allPackages: OSPackageInfo[],
  query: string,
  matchType: 'exact' | 'partial' | 'wildcard' = 'partial'
): OSPackageSearchResult[] {
  const matchingPackages = matchPackagesByQuery(allPackages, query, matchType);
  const groupedByName = groupPackagesByName(matchingPackages);
  return convertToSearchResults(groupedByName);
}

/**
 * Resolver 싱글톤 팩토리 생성
 * 배포판 ID가 변경되면 새 인스턴스를 생성
 */
export function createResolverFactory<T>(
  ResolverClass: new (options: DependencyResolverOptions) => T,
  name: string
): (options?: DependencyResolverOptions) => T {
  let instance: T | null = null;
  let cacheKey: string | null = null;

  return (options?: DependencyResolverOptions): T => {
    if (!options) {
      throw new Error(`${name} requires DependencyResolverOptions`);
    }

    const bypassCache = Boolean(options.abortSignal) || Boolean(options.onProgress);
    const currentKey = JSON.stringify({
      distributionId: options.distribution?.id ?? null,
      architecture: options.architecture,
      includeOptional: options.includeOptional,
      includeRecommends: options.includeRecommends,
      repositories: options.repositories.map((repo) => repo.id),
    });

    if (bypassCache) {
      return new ResolverClass(options);
    }

    if (!instance || cacheKey !== currentKey) {
      instance = new ResolverClass(options);
      cacheKey = currentKey;
    }

    return instance;
  };
}
