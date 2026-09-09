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

const APK_INDEX_CACHE_SCHEMA_VERSION = 1;

interface ApkIndexCacheEnvelope {
  schemaVersion: typeof APK_INDEX_CACHE_SCHEMA_VERSION;
  packages: OSPackageInfo[];
}

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
        const cached = await this.options.cacheManager?.get<unknown>(cacheKey);
        let packages = this.readCacheEnvelope(cached);

        if (!packages) {
          packages = await parser.parseIndex();
          await this.options.cacheManager?.set(cacheKey, {
            schemaVersion: APK_INDEX_CACHE_SCHEMA_VERSION,
            packages,
          } satisfies ApkIndexCacheEnvelope);
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
    const isCapability = /^(so|cmd|pc):/.test(dep.name);

    // 1. 패키지 이름으로 검색
    if (!isCapability) {
      const byName = this.metadataCache.packages.get(dep.name);
      if (byName) {
        candidates.push(...byName);
      }
    }
    const candidateKeys = new Set(candidates.map((pkg) => this.getPackageKey(pkg)));

    // 2. provides로 검색
    const byProvides = this.providesMap.get(dep.name);
    if (byProvides) {
      for (const pkg of byProvides) {
        const key = this.getPackageKey(pkg);
        if (!candidateKeys.has(key)) {
          candidates.push(pkg);
          candidateKeys.add(key);
        }
      }
    }

    // so:/cmd: 접두사도 위의 동일 provides 키 조회에 포함된다.

    return candidates;
  }

  /**
   * capability 버전은 패키지 버전이 아니라 provides 항목의 버전으로 비교한다.
   */
  protected filterByVersion(
    packages: OSPackageInfo[],
    dep: PackageDependency
  ): OSPackageInfo[] {
    const requiredVersion = dep.version;
    const operator = dep.operator;
    if (!/^(so|cmd|pc):/.test(dep.name) || !requiredVersion || !operator) {
      return super.filterByVersion(packages, dep);
    }

    return packages.filter((pkg) =>
      (pkg.provides || []).some((provide) => {
        const [providedName, providedVersion] = provide.split('=', 2);
        return providedName === dep.name &&
          providedVersion !== undefined && providedVersion.length > 0 &&
          this.compareVersionWithOperator(providedVersion, operator, requiredVersion);
      })
    );
  }

  /**
   * APK dependencies may be satisfied by alternative provider names. Keep one provider name,
   * while retaining all matching versions of that selected package name for
   * the shared conflict/all-version policy.
   */
  protected override selectCandidatesForDependency(
    packages: OSPackageInfo[],
    _dep: PackageDependency
  ): OSPackageInfo[] {
    const selectedName = this.selectBestMatch([...packages]).name;
    return packages.filter((pkg) => pkg.name === selectedName);
  }

  private readCacheEnvelope(cached: unknown): OSPackageInfo[] | null {
    if (!cached || typeof cached !== 'object') {
      return null;
    }

    const envelope = cached as Partial<ApkIndexCacheEnvelope>;
    return envelope.schemaVersion === APK_INDEX_CACHE_SCHEMA_VERSION &&
      Array.isArray(envelope.packages)
      ? envelope.packages
      : null;
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
