/**
 * APK Dependency Resolver
 * Alpine Linux 의존성 해결기 (플랫 구조)
 */

import { searchPackagesCommon, createResolverFactory } from './os-resolver-utils';
import { BaseOSDependencyResolver, type DependencyResolverOptions } from '../downloaders/os-shared/base-resolver';
import { OsPackageCache } from '../downloaders/os-shared/cache-manager';
import { isArchitectureCompatible } from '../downloaders/os-shared/repositories';
import { ApkMetadataParser } from '../shared/apk-metadata-parser';
import type { OSPackageInfo, PackageDependency, OSPackageSearchResult } from '../downloaders/os-shared/types';

/**
 * APK 의존성 해결기
 */
export class ApkDependencyResolver extends BaseOSDependencyResolver {
  private parsers: Map<string, ApkMetadataParser> = new Map();
  private allPackages: OSPackageInfo[] = [];
  private providesMap: Map<string, OSPackageInfo[]> = new Map();

  constructor(options: DependencyResolverOptions) {
    super(options);
  }

  /**
   * 메타데이터 로드
   */
  protected async loadMetadata(): Promise<void> {
    if (this.allPackages.length > 0) {
      return; // 이미 로드됨
    }

    const activeRepos = this.options.repositories.filter((r) => r.enabled);

    for (const repo of activeRepos) {
      this.throwIfAborted();
      try {
        const parser = new ApkMetadataParser(
          repo,
          this.options.architecture,
          this.options.abortSignal
        );
        this.parsers.set(repo.id, parser);
        const cacheKey = OsPackageCache.createKey(
          'apk',
          repo,
          this.options.architecture,
          'apkindex'
        );
        let packages = await this.options.cacheManager?.get<OSPackageInfo[]>(cacheKey);

        if (!packages) {
          packages = await parser.parseIndex();
          await this.options.cacheManager?.set(cacheKey, packages);
        }

        // 아키텍처 필터링
        const compatiblePackages = packages.filter((pkg) =>
          isArchitectureCompatible(pkg.architecture, this.options.architecture)
        );

        this.allPackages.push(...compatiblePackages);

        // 캐시 구축
        for (const pkg of compatiblePackages) {
          // 패키지 이름으로 등록
          this.addToPackageCache(pkg.name, pkg);

          // provides 등록
          if (pkg.provides) {
            for (const provide of pkg.provides) {
              this.addToProvidesCache(provide, pkg);
            }
          }
        }

        this.options.onProgress?.(
          `Loaded ${compatiblePackages.length} packages from ${repo.name}`,
          0,
          0
        );
      } catch (error) {
        if ((error as { name?: string })?.name === 'AbortError') {
          throw error;
        }
        console.error(`Failed to load metadata from ${repo.name}:`, error);
      }
    }
  }

  /**
   * 패키지 캐시에 추가
   */
  private addToPackageCache(name: string, pkg: OSPackageInfo): void {
    const existing = this.metadataCache.packages.get(name) || [];
    existing.push(pkg);
    this.metadataCache.packages.set(name, existing);
  }

  /**
   * provides 캐시에 추가
   */
  private addToProvidesCache(provide: string, pkg: OSPackageInfo): void {
    // 버전 정보 제거 (예: "so:libssl.so.3=3.0.0" -> "so:libssl.so.3")
    const baseName = provide.split('=')[0];

    const existing = this.providesMap.get(baseName) || [];
    existing.push(pkg);
    this.providesMap.set(baseName, existing);

    // 전체 이름으로도 등록
    if (provide !== baseName) {
      const fullExisting = this.providesMap.get(provide) || [];
      fullExisting.push(pkg);
      this.providesMap.set(provide, fullExisting);
    }
  }

  /**
   * API에서 의존성 가져오기 (APK는 API 없음, null 반환)
   */
  protected async fetchDependenciesFromAPI(
    _pkg: OSPackageInfo
  ): Promise<PackageDependency[] | null> {
    // APK는 공개 API가 없으므로 항상 메타데이터 사용
    return null;
  }

  /**
   * 메타데이터에서 의존성 가져오기
   */
  protected async fetchDependenciesFromMetadata(
    pkg: OSPackageInfo
  ): Promise<PackageDependency[]> {
    return pkg.dependencies || [];
  }

  /**
   * 의존성을 만족하는 패키지 찾기
   */
  protected async findPackagesForDependency(
    dep: PackageDependency
  ): Promise<OSPackageInfo[]> {
    const candidates: OSPackageInfo[] = [];

    // 1. 패키지 이름으로 검색
    const byName = this.metadataCache.packages.get(dep.name);
    if (byName) {
      candidates.push(...byName);
    }

    // 2. provides로 검색
    const byProvides = this.providesMap.get(dep.name);
    if (byProvides) {
      for (const pkg of byProvides) {
        if (!candidates.find((c) => this.getPackageKey(c) === this.getPackageKey(pkg))) {
          candidates.push(pkg);
        }
      }
    }

    // 3. so: 의존성 처리 (예: so:libc.musl-x86_64.so.1)
    if (dep.name.startsWith('so:')) {
      const soName = dep.name;
      const bySo = this.providesMap.get(soName);
      if (bySo) {
        for (const pkg of bySo) {
          if (!candidates.find((c) => this.getPackageKey(c) === this.getPackageKey(pkg))) {
            candidates.push(pkg);
          }
        }
      }
    }

    // 4. cmd: 의존성 처리 (예: cmd:sh)
    if (dep.name.startsWith('cmd:')) {
      const cmdName = dep.name;
      const byCmd = this.providesMap.get(cmdName);
      if (byCmd) {
        for (const pkg of byCmd) {
          if (!candidates.find((c) => this.getPackageKey(c) === this.getPackageKey(pkg))) {
            candidates.push(pkg);
          }
        }
      }
    }

    return candidates;
  }

  /**
   * 패키지 검색 (이름별 그룹화)
   */
  async searchPackages(
    query: string,
    matchType: 'exact' | 'partial' | 'wildcard' = 'partial'
  ): Promise<OSPackageSearchResult[]> {
    await this.loadMetadata();
    return searchPackagesCommon(this.allPackages, query, matchType);
  }
}

// 싱글톤 팩토리 (배포판 ID별로 캐싱)
export const getApkResolver = createResolverFactory(
  ApkDependencyResolver,
  'ApkDependencyResolver'
);

// 기존 ApkResolver export (호환성 유지를 위해 ApkDependencyResolver를 ApkResolver로도 export)
export { ApkDependencyResolver as ApkResolver };
