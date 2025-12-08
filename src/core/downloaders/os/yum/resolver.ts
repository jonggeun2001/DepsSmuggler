/**
 * YUM/RPM Dependency Resolver
 * RHEL/CentOS 계열 의존성 해결기
 */

import type { OSPackageInfo, PackageDependency, Repository } from '../types';
import { BaseOSDependencyResolver, type DependencyResolverOptions } from '../base-resolver';
import { YumMetadataParser } from './metadata-parser';
import { isArchitectureCompatible } from '../repositories';

/**
 * YUM 의존성 해결기
 */
export class YumDependencyResolver extends BaseOSDependencyResolver {
  private parsers: Map<string, YumMetadataParser> = new Map();
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
      try {
        const parser = new YumMetadataParser(repo, this.options.architecture);
        this.parsers.set(repo.id, parser);

        // repomd.xml 파싱
        const repomd = await parser.parseRepomd();
        if (!repomd.primary) {
          console.warn(`No primary metadata found for ${repo.name}`);
          continue;
        }

        // primary.xml 파싱
        const packages = await parser.parsePrimary(repomd.primary.location);

        // 아키텍처 필터링
        const compatiblePackages = packages.filter((pkg) =>
          isArchitectureCompatible(pkg.architecture, this.options.architecture)
        );

        this.allPackages.push(...compatiblePackages);

        // provides 맵 구축
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
    // 버전 제거 (예: "libfoo.so.1()(64bit)" -> "libfoo.so.1")
    const baseName = provide.split('(')[0];

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
   * API에서 의존성 가져오기 (YUM은 API 없음, null 반환)
   */
  protected async fetchDependenciesFromAPI(
    _pkg: OSPackageInfo
  ): Promise<PackageDependency[] | null> {
    // YUM/RPM은 공개 API가 없으므로 항상 메타데이터 사용
    return null;
  }

  /**
   * 메타데이터에서 의존성 가져오기
   */
  protected async fetchDependenciesFromMetadata(
    pkg: OSPackageInfo
  ): Promise<PackageDependency[]> {
    // 패키지에 이미 의존성 정보가 있음
    const deps = pkg.dependencies || [];

    // 권장 의존성 추가
    if (this.options.includeRecommends && pkg.recommends) {
      for (const rec of pkg.recommends) {
        deps.push({ name: rec, isOptional: true });
      }
    }

    return deps;
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

    // 3. 라이브러리 패턴 검색 (예: libfoo.so.1()(64bit))
    if (dep.name.includes('.so')) {
      const libName = dep.name.split('(')[0];
      const byLib = this.providesMap.get(libName);
      if (byLib) {
        for (const pkg of byLib) {
          if (!candidates.find((c) => this.getPackageKey(c) === this.getPackageKey(pkg))) {
            candidates.push(pkg);
          }
        }
      }
    }

    return candidates;
  }

  /**
   * 패키지 검색
   */
  async searchPackages(
    query: string,
    matchType: 'exact' | 'partial' | 'wildcard' = 'partial'
  ): Promise<OSPackageInfo[]> {
    await this.loadMetadata();

    return this.allPackages.filter((pkg) => {
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
}
