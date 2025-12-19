/**
 * Base OS Dependency Resolver
 * 하이브리드 방식 의존성 해결기 기본 클래스
 */

import type {
  OSPackageInfo,
  PackageDependency,
  Repository,
  OSDistribution,
  OSArchitecture,
  DependencyResolutionResult,
  CacheManager,
  VersionOperator,
} from './types';
import { OSDependencyTree } from './dependency-tree';
import { isArchitectureCompatible } from './repositories';
import logger from '../../../utils/logger';

/**
 * 의존성 해결기 옵션
 */
export interface DependencyResolverOptions {
  /** 대상 배포판 */
  distribution: OSDistribution;
  /** 사용할 저장소 목록 */
  repositories: Repository[];
  /** 대상 아키텍처 */
  architecture: OSArchitecture;
  /** 캐시 관리자 (선택) */
  cacheManager?: CacheManager;
  /** 선택적 의존성 포함 여부 */
  includeOptional: boolean;
  /** 권장 의존성 포함 여부 */
  includeRecommends: boolean;
  /** 진행 콜백 */
  onProgress?: (message: string, current: number, total: number) => void;
}

/**
 * 패키지 메타데이터 캐시
 */
export interface PackageMetadataCache {
  /** 패키지 이름 → 패키지 정보 목록 */
  packages: Map<string, OSPackageInfo[]>;
  /** 제공(provides) 이름 → 패키지 정보 목록 */
  provides: Map<string, OSPackageInfo[]>;
  /** 캐시 시간 */
  timestamp: number;
}

/**
 * 기본 OS 의존성 해결기
 */
export abstract class BaseOSDependencyResolver {
  protected options: DependencyResolverOptions;
  protected metadataCache: PackageMetadataCache;
  protected resolvedPackages: Set<string> = new Set();

  constructor(options: DependencyResolverOptions) {
    this.options = options;
    this.metadataCache = {
      packages: new Map(),
      provides: new Map(),
      timestamp: Date.now(),
    };
  }

  /**
   * 패키지 키 생성
   */
  protected getPackageKey(pkg: OSPackageInfo): string {
    return `${pkg.name}-${pkg.version}-${pkg.architecture}`;
  }

  /**
   * 의존성 해결 (메인 엔트리)
   */
  async resolveDependencies(packages: OSPackageInfo[]): Promise<DependencyResolutionResult> {
    const tree = new OSDependencyTree();
    this.resolvedPackages.clear();

    // 메타데이터 로드
    await this.loadMetadata();

    // 각 패키지의 의존성 해결
    const totalPackages = packages.length;
    for (let i = 0; i < packages.length; i++) {
      const pkg = packages[i];
      this.options.onProgress?.(
        `Resolving dependencies for ${pkg.name}`,
        i + 1,
        totalPackages
      );

      await this.resolvePackageDependencies(pkg, tree);
    }

    // 결과 생성
    const allPackages = tree.getInstallOrder();
    const missing = tree.getMissingDependencies();
    const conflicts = tree.getConflicts();

    return {
      packages: allPackages,
      unresolved: missing.map((m) => m.dependency),
      conflicts: conflicts.map((c) => ({
        package: c.packageName,
        versions: c.versions,
      })),
      warnings: this.generateWarnings(tree),
    };
  }

  /**
   * 단일 패키지의 의존성 해결 (BFS - 순환 의존성 방지)
   */
  protected async resolvePackageDependencies(
    pkg: OSPackageInfo,
    tree: OSDependencyTree
  ): Promise<void> {
    logger.debug(`[BFS] resolvePackageDependencies 시작: ${pkg.name}@${pkg.version}`);

    // BFS 큐: 처리할 패키지 목록
    const queue: OSPackageInfo[] = [pkg];
    // 처리 중인 패키지 추적 (순환 의존성 방지)
    const processing = new Set<string>();
    // 최대 반복 횟수 (무한 루프 방지)
    const MAX_ITERATIONS = 10000;
    let iterations = 0;

    while (queue.length > 0 && iterations < MAX_ITERATIONS) {
      iterations++;
      const currentPkg = queue.shift()!;
      const pkgKey = this.getPackageKey(currentPkg);

      logger.debug(`[BFS] iteration=${iterations}, queue=${queue.length}, pkg=${currentPkg.name}, key=${pkgKey}`);

      // 이미 해결된 패키지면 스킵
      if (this.resolvedPackages.has(pkgKey)) {
        logger.debug(`[BFS] 스킵 (이미 해결됨): ${pkgKey}`);
        continue;
      }

      // 순환 의존성 체크: 이미 처리 중이면 스킵
      if (processing.has(pkgKey)) {
        logger.debug(`[BFS] 스킵 (처리 중): ${pkgKey}`);
        continue;
      }

      processing.add(pkgKey);
      this.resolvedPackages.add(pkgKey);
      tree.addNode(currentPkg);

      // 의존성 가져오기
      const dependencies = await this.fetchDependencies(currentPkg);

      for (const dep of dependencies) {
        // 선택적 의존성 필터링
        if (dep.isOptional && !this.options.includeOptional) {
          continue;
        }

        // 의존성을 만족하는 패키지 찾기
        const candidates = await this.findPackagesForDependency(dep);

        if (candidates.length === 0) {
          // 누락된 의존성
          tree.addMissingDependency(currentPkg, dep, 'not_found');
          continue;
        }

        // 버전 조건을 만족하는 패키지 필터링
        const matchingPackages = this.filterByVersion(candidates, dep);

        if (matchingPackages.length === 0) {
          tree.addMissingDependency(currentPkg, dep, 'version_mismatch');
          continue;
        }

        // 아키텍처 호환 패키지 필터링
        const compatiblePackages = matchingPackages.filter((p) =>
          isArchitectureCompatible(p.architecture, this.options.architecture)
        );

        if (compatiblePackages.length === 0) {
          tree.addMissingDependency(currentPkg, dep, 'architecture_mismatch');
          continue;
        }

        // 여러 버전이 있으면 충돌로 기록 (모든 버전 다운로드)
        if (compatiblePackages.length > 1) {
          const uniqueVersions = this.getUniqueVersions(compatiblePackages);
          if (uniqueVersions.length > 1) {
            tree.addConflict(dep.name, uniqueVersions, [
              { package: currentPkg, requiredVersion: dep.version },
            ]);
          }
        }

        // 최선의 패키지 선택 (최신 버전)
        const bestMatch = this.selectBestMatch(compatiblePackages);
        const bestMatchKey = this.getPackageKey(bestMatch);

        // 엣지 추가
        tree.addEdge(currentPkg, bestMatch, dep);

        // 아직 처리되지 않은 패키지만 큐에 추가
        if (!this.resolvedPackages.has(bestMatchKey) && !processing.has(bestMatchKey)) {
          queue.push(bestMatch);
        }
      }
    }

    if (iterations >= MAX_ITERATIONS) {
      logger.warn(`의존성 해결 최대 반복 횟수 도달 (${MAX_ITERATIONS})`);
    }
  }

  /**
   * 의존성 가져오기 (하이브리드: API 우선, 메타데이터 폴백)
   */
  protected async fetchDependencies(pkg: OSPackageInfo): Promise<PackageDependency[]> {
    // 먼저 API 시도
    const apiDeps = await this.fetchDependenciesFromAPI(pkg);
    if (apiDeps !== null) {
      return apiDeps;
    }

    // API 실패 시 메타데이터에서 가져오기
    return this.fetchDependenciesFromMetadata(pkg);
  }

  /**
   * 버전 조건으로 패키지 필터링
   */
  protected filterByVersion(
    packages: OSPackageInfo[],
    dep: PackageDependency
  ): OSPackageInfo[] {
    if (!dep.version || !dep.operator) {
      return packages;
    }

    return packages.filter((pkg) =>
      this.compareVersionWithOperator(pkg.version, dep.operator!, dep.version!)
    );
  }

  /**
   * 버전 비교
   */
  protected compareVersionWithOperator(
    pkgVersion: string,
    operator: VersionOperator,
    requiredVersion: string
  ): boolean {
    const cmp = this.compareVersionStrings(pkgVersion, requiredVersion);

    switch (operator) {
      case '=':
        return cmp === 0;
      case '<':
      case '<<':
        return cmp < 0;
      case '>':
      case '>>':
        return cmp > 0;
      case '<=':
        return cmp <= 0;
      case '>=':
        return cmp >= 0;
      default:
        return true;
    }
  }

  /**
   * 버전 문자열 비교
   */
  protected compareVersionStrings(a: string, b: string): number {
    // 문자열이 아닌 경우 문자열로 변환
    const strA = typeof a === 'string' ? a : String(a ?? '');
    const strB = typeof b === 'string' ? b : String(b ?? '');

    // epoch 분리
    const parseEpoch = (ver: string) => {
      const match = ver.match(/^(\d+):/);
      return match
        ? { epoch: parseInt(match[1], 10), rest: ver.substring(match[0].length) }
        : { epoch: 0, rest: ver };
    };

    const verA = parseEpoch(strA);
    const verB = parseEpoch(strB);

    if (verA.epoch !== verB.epoch) {
      return verA.epoch - verB.epoch;
    }

    // 버전 파트 비교
    const partsA = verA.rest.split(/[.\-_~+]/);
    const partsB = verB.rest.split(/[.\-_~+]/);
    const maxLen = Math.max(partsA.length, partsB.length);

    for (let i = 0; i < maxLen; i++) {
      const partA = partsA[i] || '0';
      const partB = partsB[i] || '0';

      const numA = parseInt(partA, 10);
      const numB = parseInt(partB, 10);

      if (!isNaN(numA) && !isNaN(numB)) {
        if (numA !== numB) return numA - numB;
      } else {
        const cmp = partA.localeCompare(partB);
        if (cmp !== 0) return cmp;
      }
    }

    return 0;
  }

  /**
   * 고유 버전 패키지만 추출
   */
  protected getUniqueVersions(packages: OSPackageInfo[]): OSPackageInfo[] {
    const versionMap = new Map<string, OSPackageInfo>();
    for (const pkg of packages) {
      const key = `${pkg.version}-${pkg.release || ''}`;
      if (!versionMap.has(key)) {
        versionMap.set(key, pkg);
      }
    }
    return Array.from(versionMap.values());
  }

  /**
   * 최선의 패키지 선택 (최신 버전)
   */
  protected selectBestMatch(packages: OSPackageInfo[]): OSPackageInfo {
    return packages.sort((a, b) =>
      this.compareVersionStrings(b.version, a.version)
    )[0];
  }

  /**
   * 경고 메시지 생성
   */
  protected generateWarnings(tree: OSDependencyTree): string[] {
    const warnings: string[] = [];

    const missing = tree.getMissingDependencies();
    if (missing.length > 0) {
      warnings.push(`${missing.length} dependencies could not be resolved`);
    }

    const conflicts = tree.getConflicts();
    if (conflicts.length > 0) {
      warnings.push(`${conflicts.length} version conflicts detected (all versions will be downloaded)`);
    }

    const stats = tree.getStats();
    if (stats.maxDepth > 10) {
      warnings.push(`Deep dependency tree detected (depth: ${stats.maxDepth})`);
    }

    return warnings;
  }

  /**
   * 메타데이터 로드 (서브클래스에서 구현)
   */
  protected abstract loadMetadata(): Promise<void>;

  /**
   * API에서 의존성 가져오기 (서브클래스에서 구현)
   */
  protected abstract fetchDependenciesFromAPI(
    pkg: OSPackageInfo
  ): Promise<PackageDependency[] | null>;

  /**
   * 메타데이터에서 의존성 가져오기 (서브클래스에서 구현)
   */
  protected abstract fetchDependenciesFromMetadata(
    pkg: OSPackageInfo
  ): Promise<PackageDependency[]>;

  /**
   * 의존성을 만족하는 패키지 찾기 (서브클래스에서 구현)
   */
  protected abstract findPackagesForDependency(
    dep: PackageDependency
  ): Promise<OSPackageInfo[]>;
}
