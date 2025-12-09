/**
 * OS Package Downloader
 * YUM, APT, APK 통합 다운로더
 */

import * as path from 'path';
import type {
  OSPackageInfo,
  OSPackageSearchOptions,
  OSPackageDownloadOptions,
  OSDistribution,
  OSArchitecture,
  Repository,
  OSPackageManager,
  OSDownloadProgress,
  DependencyResolutionResult,
  CacheMode,
  OSPackageSearchResult as OSPackageSearchResultType,
} from './types';
import { OSDependencyTree } from './dependency-tree';
import { BaseOSDownloader, type BaseDownloaderOptions } from './base-downloader';
import { YumDownloader } from './yum/downloader';
import { AptDownloader } from './apt/downloader';
import { ApkDownloader } from './apk/downloader';
import { YumDependencyResolver } from './yum/resolver';
import { AptDependencyResolver } from './apt/resolver';
import { ApkDependencyResolver } from './apk/resolver';
import { OSCacheManager, type OSCacheConfig } from './utils/cache-manager';
import { GPGVerifier, type GPGVerifierConfig } from './utils/gpg-verifier';

/**
 * 통합 다운로더 옵션
 */
export interface OSDownloaderOptions {
  /** 캐시 설정 */
  cacheConfig?: Partial<OSCacheConfig>;
  /** GPG 검증 설정 */
  gpgConfig?: Partial<GPGVerifierConfig>;
  /** 동시 다운로드 수 */
  concurrency?: number;
}

/**
 * 검색 결과 (API 응답용)
 */
export interface OSPackageSearchResponse {
  /** 패키지 검색 결과 목록 (이름별 그룹화) */
  packages: OSPackageSearchResultType[];
  /** 전체 개수 (고유 패키지 이름 수) */
  totalCount: number;
  /** 추가 결과 있음 */
  hasMore: boolean;
}

/**
 * 다운로드 결과
 */
export interface OSPackageDownloadResult {
  /** 성공한 패키지 */
  success: OSPackageInfo[];
  /** 실패한 패키지 */
  failed: Array<{ package: OSPackageInfo; error: Error }>;
  /** 건너뛴 패키지 */
  skipped: OSPackageInfo[];
  /** 총 다운로드 크기 */
  totalSize: number;
  /** 출력 디렉토리 */
  outputDir: string;
  /** 의존성 트리 */
  dependencyTree?: OSDependencyTree;
}

/**
 * OS 패키지 통합 다운로더
 */
export class OSPackageDownloader {
  private cacheManager: OSCacheManager;
  private gpgVerifier: GPGVerifier;
  private concurrency: number;

  constructor(options: OSDownloaderOptions = {}) {
    this.cacheManager = new OSCacheManager(options.cacheConfig);
    this.gpgVerifier = new GPGVerifier(options.gpgConfig);
    this.concurrency = options.concurrency || 3;
  }

  /**
   * 패키지 검색
   */
  async search(options: OSPackageSearchOptions): Promise<OSPackageSearchResponse> {
    const resolver = this.getResolver(options.distribution, options.architecture);
    const searchResults = await resolver.searchPackages(options.query, options.matchType);

    // 제한 적용 (고유 패키지 이름 수 기준)
    const limit = options.limit || 100;
    const limited = searchResults.slice(0, limit);

    return {
      packages: limited,
      totalCount: searchResults.length,
      hasMore: searchResults.length > limit,
    };
  }

  /**
   * 의존성 해결
   */
  async resolveDependencies(
    packages: OSPackageInfo[],
    distribution: OSDistribution,
    architecture: OSArchitecture,
    options: {
      includeOptional?: boolean;
      includeRecommends?: boolean;
      onProgress?: (message: string, current: number, total: number) => void;
    } = {}
  ): Promise<DependencyResolutionResult> {
    const activeRepos = [
      ...distribution.defaultRepos.filter((r) => r.enabled),
      ...distribution.extendedRepos.filter((r) => r.enabled),
    ];

    const resolver = this.createResolver(distribution.packageManager, {
      distribution,
      repositories: activeRepos,
      architecture,
      includeOptional: options.includeOptional || false,
      includeRecommends: options.includeRecommends || false,
      onProgress: options.onProgress,
    });

    return resolver.resolveDependencies(packages);
  }

  /**
   * 패키지 다운로드
   */
  async download(options: OSPackageDownloadOptions): Promise<OSPackageDownloadResult> {
    const result: OSPackageDownloadResult = {
      success: [],
      failed: [],
      skipped: [],
      totalSize: 0,
      outputDir: options.outputDir,
    };

    let packagesToDownload = [...options.packages];

    // 의존성 해결
    if (options.resolveDependencies && options.packages.length > 0) {
      const firstPkg = options.packages[0];
      const distribution = this.getDistributionFromPackage(firstPkg);

      if (distribution) {
        const depResult = await this.resolveDependencies(
          options.packages,
          distribution,
          firstPkg.architecture,
          {
            includeOptional: options.includeOptionalDeps,
            onProgress: (msg, cur, tot) => {
              options.onProgress?.({
                currentPackage: msg,
                currentIndex: cur,
                totalPackages: tot,
                bytesDownloaded: 0,
                totalBytes: 0,
                speed: 0,
                phase: 'resolving',
              });
            },
          }
        );

        packagesToDownload = depResult.packages;

        // 의존성 트리 저장
        const tree = new OSDependencyTree();
        depResult.packages.forEach((pkg) => tree.addNode(pkg));
        result.dependencyTree = tree;
      }
    }

    // GPG 키 사전 로드
    if (options.verifyGPG) {
      const repos = new Set(packagesToDownload.map((pkg) => pkg.repository));
      await this.gpgVerifier.preloadRepositoryKeys(Array.from(repos));
    }

    // 패키지 관리자별 그룹화
    const grouped = this.groupByPackageManager(packagesToDownload);

    // 각 그룹별 다운로드
    const entries = Array.from(grouped.entries());
    for (let i = 0; i < entries.length; i++) {
      const [pm, packages] = entries[i];
      const downloader = this.getDownloader(pm, {
        outputDir: options.outputDir,
        distribution: this.getDistributionFromPackage(packages[0])!,
        architecture: packages[0].architecture,
        repositories: [packages[0].repository],
        concurrency: options.concurrency || this.concurrency,
        gpgVerifier: options.verifyGPG ? this.gpgVerifier : undefined,
        onProgress: options.onProgress,
        onError: options.onError,
      });

      const downloadResult = await downloader.downloadPackages(packages);

      result.success.push(...downloadResult.success);
      result.failed.push(...downloadResult.failed);
    }

    // 총 크기 계산
    result.totalSize = result.success.reduce((sum, pkg) => sum + pkg.size, 0);

    return result;
  }

  /**
   * 패키지 관리자별 그룹화
   */
  private groupByPackageManager(
    packages: OSPackageInfo[]
  ): Map<OSPackageManager, OSPackageInfo[]> {
    const grouped = new Map<OSPackageManager, OSPackageInfo[]>();

    for (const pkg of packages) {
      const pm = this.getPackageManagerFromRepo(pkg.repository);
      const list = grouped.get(pm) || [];
      list.push(pkg);
      grouped.set(pm, list);
    }

    return grouped;
  }

  /**
   * 저장소에서 패키지 관리자 추론
   */
  private getPackageManagerFromRepo(repo: Repository): OSPackageManager {
    const url = repo.baseUrl.toLowerCase();

    if (url.includes('centos') || url.includes('rocky') || url.includes('alma') ||
        url.includes('fedora') || url.includes('rhel') || url.includes('repodata')) {
      return 'yum';
    }

    if (url.includes('ubuntu') || url.includes('debian') || url.includes('deb.')) {
      return 'apt';
    }

    if (url.includes('alpine')) {
      return 'apk';
    }

    // 기본값
    return 'yum';
  }

  /**
   * 패키지에서 배포판 정보 추출
   */
  private getDistributionFromPackage(pkg: OSPackageInfo): OSDistribution | null {
    const pm = this.getPackageManagerFromRepo(pkg.repository);

    // 간단한 배포판 정보 생성
    return {
      id: 'detected',
      name: 'Detected Distribution',
      version: '',
      packageManager: pm,
      architectures: [pkg.architecture],
      defaultRepos: [pkg.repository],
      extendedRepos: [],
    };
  }

  /**
   * 다운로더 생성
   */
  private getDownloader(
    pm: OSPackageManager,
    options: BaseDownloaderOptions
  ): BaseOSDownloader {
    switch (pm) {
      case 'yum':
        return new YumDownloader(options);
      case 'apt':
        return new AptDownloader(options);
      case 'apk':
        return new ApkDownloader(options);
      default:
        throw new Error(`Unsupported package manager: ${pm}`);
    }
  }

  /**
   * 리졸버 생성 (검색용)
   */
  private getResolver(distribution: OSDistribution, architecture: OSArchitecture) {
    const activeRepos = [
      ...distribution.defaultRepos.filter((r) => r.enabled),
      ...distribution.extendedRepos.filter((r) => r.enabled),
    ];

    return this.createResolver(distribution.packageManager, {
      distribution,
      repositories: activeRepos,
      architecture,
      includeOptional: false,
      includeRecommends: false,
    });
  }

  /**
   * 리졸버 인스턴스 생성
   */
  private createResolver(
    pm: OSPackageManager,
    options: {
      distribution: OSDistribution;
      repositories: Repository[];
      architecture: OSArchitecture;
      includeOptional: boolean;
      includeRecommends: boolean;
      onProgress?: (message: string, current: number, total: number) => void;
    }
  ) {
    const resolverOptions = {
      distribution: options.distribution,
      repositories: options.repositories,
      architecture: options.architecture,
      includeOptional: options.includeOptional,
      includeRecommends: options.includeRecommends,
      onProgress: options.onProgress,
    };

    switch (pm) {
      case 'yum':
        return new YumDependencyResolver(resolverOptions);
      case 'apt':
        return new AptDependencyResolver(resolverOptions);
      case 'apk':
        return new ApkDependencyResolver(resolverOptions);
      default:
        throw new Error(`Unsupported package manager: ${pm}`);
    }
  }

  /**
   * 캐시 설정 업데이트
   */
  updateCacheConfig(config: Partial<OSCacheConfig>): void {
    this.cacheManager.updateConfig(config);
  }

  /**
   * GPG 설정 업데이트
   */
  updateGPGConfig(config: Partial<GPGVerifierConfig>): void {
    this.gpgVerifier.updateConfig(config);
  }

  /**
   * 캐시 통계 조회
   */
  getCacheStats() {
    return this.cacheManager.getStats();
  }

  /**
   * 캐시 초기화
   */
  async clearCache(): Promise<void> {
    await this.cacheManager.invalidate();
  }
}
