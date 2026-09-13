/**
 * OS Resolver 공통 유틸리티
 * yum, apt, apk resolver에서 공통으로 사용하는 함수들
 */

import type {
  OSPackageInfo,
  OSPackageSearchResult,
} from '../downloaders/os-shared/types';
import type { DependencyResolverOptions } from '../downloaders/os-shared/base-resolver';
import { getRepositoryIdentity } from '../downloaders/os-shared/repository-identity';
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
  let wildcardRegex: RegExp | undefined;
  return packages.filter((pkg) => {
    switch (matchType) {
      case 'exact':
        return pkg.name === query;
      case 'partial':
        return pkg.name.includes(query);
      case 'wildcard': {
        wildcardRegex ??= new RegExp(
          '^' + query.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
        );
        return wildcardRegex.test(pkg.name);
      }
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
 * 설정 스냅샷이 같을 때만 재사용하고 요청별 signal/callback은 분리한다.
 */
export function createResolverFactory<T>(
  ResolverClass: new (options: DependencyResolverOptions) => T,
  name: string
): (options?: DependencyResolverOptions) => T {
  let instance: T | null = null;
  let cacheKey: string | null = null;
  let cachedCacheManager: DependencyResolverOptions['cacheManager'];

  return (options?: DependencyResolverOptions): T => {
    if (!options) {
      throw new Error(`${name} requires DependencyResolverOptions`);
    }

    // Repositories are mutable input data. Keep a resolver's loaded metadata and
    // configuration attached to the same snapshot after the caller edits options.
    const distribution = options.distribution;
    const snapshot: DependencyResolverOptions = {
      ...options,
      repositories: options.repositories.map(repo => ({ ...repo })),
      distribution: {
        ...distribution,
        architectures: [...distribution.architectures],
        defaultRepos: distribution.defaultRepos.map(repo => ({ ...repo })),
        extendedRepos: distribution.extendedRepos.map(repo => ({ ...repo })),
      },
    };

    if (snapshot.abortSignal || snapshot.onProgress) {
      return new ResolverClass(snapshot);
    }

    const currentKey = JSON.stringify({
      distribution: {
        id: snapshot.distribution.id,
        name: snapshot.distribution.name,
        version: snapshot.distribution.version,
        codename: snapshot.distribution.codename ?? null,
        packageManager: snapshot.distribution.packageManager,
        architectures: snapshot.distribution.architectures,
        defaultRepos: snapshot.distribution.defaultRepos.map(getRepositoryIdentity),
        extendedRepos: snapshot.distribution.extendedRepos.map(getRepositoryIdentity),
      },
      architecture: snapshot.architecture,
      includeOptional: snapshot.includeOptional,
      includeRecommends: snapshot.includeRecommends,
      repositories: snapshot.repositories.map(getRepositoryIdentity),
    });

    if (!instance || cacheKey !== currentKey || cachedCacheManager !== snapshot.cacheManager) {
      instance = new ResolverClass(snapshot);
      cacheKey = currentKey;
      cachedCacheManager = snapshot.cacheManager;
    }

    return instance;
  };
}
