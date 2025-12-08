/**
 * APT/DEB Dependency Resolver
 * Ubuntu/Debian 계열 의존성 해결기
 */

import type { OSPackageInfo, PackageDependency, Repository } from '../types';
import { BaseOSDependencyResolver, type DependencyResolverOptions } from '../base-resolver';
import { AptMetadataParser } from './metadata-parser';
import { isArchitectureCompatible } from '../repositories';

/**
 * APT 의존성 해결기
 */
export class AptDependencyResolver extends BaseOSDependencyResolver {
  private parsers: Map<string, AptMetadataParser> = new Map();
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

    // 각 저장소의 각 컴포넌트 로드
    for (const repo of activeRepos) {
      // URL에서 컴포넌트 추출 (예: main, universe, restricted)
      const components = this.extractComponents(repo);

      for (const component of components) {
        try {
          const parser = new AptMetadataParser(
            repo,
            component,
            this.options.architecture
          );

          const key = `${repo.id}-${component}`;
          this.parsers.set(key, parser);

          // Packages.gz 파싱
          const packages = await parser.parsePackages();

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
            `Loaded ${compatiblePackages.length} packages from ${repo.name}/${component}`,
            0,
            0
          );
        } catch (error) {
          console.warn(`Failed to load ${component} from ${repo.name}:`, error);
        }
      }
    }
  }

  /**
   * 저장소 URL에서 컴포넌트 추출
   */
  private extractComponents(repo: Repository): string[] {
    // URL 패턴에서 컴포넌트 추출
    // 예: http://archive.ubuntu.com/ubuntu/dists/jammy/main/
    const match = repo.baseUrl.match(/dists\/[^/]+\/([^/]+)/);
    if (match) {
      return [match[1]];
    }

    // 기본 컴포넌트
    return ['main'];
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
    // 버전 및 아키텍처 정보 제거
    const baseName = provide.split(/[\s(]/)[0].trim();

    const existing = this.providesMap.get(baseName) || [];
    existing.push(pkg);
    this.providesMap.set(baseName, existing);
  }

  /**
   * API에서 의존성 가져오기 (APT는 API 없음, null 반환)
   */
  protected async fetchDependenciesFromAPI(
    _pkg: OSPackageInfo
  ): Promise<PackageDependency[] | null> {
    // APT는 공개 API가 없으므로 항상 메타데이터 사용
    return null;
  }

  /**
   * 메타데이터에서 의존성 가져오기
   */
  protected async fetchDependenciesFromMetadata(
    pkg: OSPackageInfo
  ): Promise<PackageDependency[]> {
    const deps = [...(pkg.dependencies || [])];

    // 권장 의존성 추가
    if (this.options.includeRecommends && pkg.recommends) {
      for (const rec of pkg.recommends) {
        deps.push({ name: rec, isOptional: true });
      }
    }

    // 제안 의존성 추가 (선택적)
    if (this.options.includeOptional && pkg.suggests) {
      for (const sug of pkg.suggests) {
        deps.push({ name: sug, isOptional: true });
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

    // 2. provides로 검색 (virtual packages)
    const byProvides = this.providesMap.get(dep.name);
    if (byProvides) {
      for (const pkg of byProvides) {
        if (!candidates.find((c) => this.getPackageKey(c) === this.getPackageKey(pkg))) {
          candidates.push(pkg);
        }
      }
    }

    // 3. 아키텍처 접미사 처리 (예: libc6:amd64)
    if (dep.name.includes(':')) {
      const [baseName] = dep.name.split(':');
      const byBaseName = this.metadataCache.packages.get(baseName);
      if (byBaseName) {
        for (const pkg of byBaseName) {
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
