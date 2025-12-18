/**
 * Maven Dependency Resolver
 *
 * BF(Breadth-First) + Skipper 알고리즘 기반 의존성 해결
 * 문서 참고: docs/maven-dependency-resolution.md
 */

import axios, { AxiosInstance } from 'axios';
import { XMLParser } from 'fast-xml-parser';
import pLimit from 'p-limit';
import {
  IResolver,
  PackageInfo,
  DependencyNode,
  DependencyResolutionResult,
  DependencyConflict,
  DependencyScope,
  ResolverOptions,
} from '../../types';
import logger from '../../utils/logger';
import {
  PomProject,
  PomDependency,
  MavenCoordinate,
  coordinateToString,
  coordinateToKey,
} from '../shared/maven-types';
import {
  MavenQueueProcessor,
  MavenResolutionContext,
  QueueProcessorDependencies,
} from './maven-queue-processor';
import { DependencyResolutionSkipper } from '../shared/maven-skipper';
import {
  fetchPom as fetchPomFromCache,
  prefetchPomsParallel,
  clearMemoryCache as clearMavenCache,
  MavenCacheOptions,
} from '../shared/maven-cache';

// 분리된 유틸리티 모듈
import {
  extractDependencies,
  extractExclusions,
  resolveVersionRange,
  resolveProperty,
  resolveDependencyCoordinate,
} from '../shared/maven-pom-utils';
import { MavenBomProcessor } from '../shared/maven-bom-processor';
import { MAVEN_CONSTANTS } from '../constants/maven';
import { isNativeArtifact } from '../shared/maven-utils';

/** Maven Resolver 옵션 */
export interface MavenResolverOptions extends ResolverOptions {
  /** 알고리즘 선택 ('bf' | 'df', 기본값: 'bf') */
  algorithm?: 'bf' | 'df';
  /** 병렬 POM 다운로드 스레드 수 (기본값: 5) */
  parallelThreads?: number;
  /** POM 캐시 TTL (ms, 기본값: 5분) */
  pomCacheTtl?: number;
  /** 대상 OS (네이티브 라이브러리 classifier 자동 설정용) - deprecated, use classifier instead */
  targetOS?: string;
  /** 대상 아키텍처 (네이티브 라이브러리 classifier 자동 설정용) - deprecated, use classifier instead */
  targetArchitecture?: string;
  /** 사용자 지정 classifier (예: natives-linux, linux-x86_64) */
  classifier?: string;
}

// MavenResolutionContext는 maven-queue-processor.ts에서 import됨

/**
 * Maven 의존성 해결기
 *
 * 핵심 의존성 해결 로직만 담당
 * POM 파싱 및 BOM 처리는 분리된 모듈 사용
 */
export class MavenResolver implements IResolver {
  readonly type = 'maven' as const;
  private readonly repoUrl = 'https://repo1.maven.org/maven2';
  private parser: XMLParser;
  private axiosInstance: AxiosInstance;

  /** 충돌 목록 */
  private conflicts: DependencyConflict[] = [];

  /** Skipper 인스턴스 */
  private skipper: DependencyResolutionSkipper;

  /** BOM 처리기 */
  private bomProcessor: MavenBomProcessor;

  /** 큐 프로세서 */
  private queueProcessor!: MavenQueueProcessor;

  /** 캐시 옵션 */
  private cacheOptions: MavenCacheOptions = {};

  /** 기본 옵션 */
  private defaultOptions: MavenResolverOptions = {
    algorithm: 'bf',
    parallelThreads: 5,
    pomCacheTtl: MAVEN_CONSTANTS.CACHE_TTL_MS,
    maxDepth: MAVEN_CONSTANTS.DEFAULT_MAX_DEPTH,
    includeOptionalDependencies: false,
  };

  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      parseTagValue: false, // 버전 등의 값이 숫자로 변환되지 않도록 (4.0 -> 4 방지)
    });

    this.axiosInstance = axios.create({
      timeout: MAVEN_CONSTANTS.API_TIMEOUT_MS,
      headers: {
        'User-Agent': 'DepsSmuggler/1.0',
      },
    });

    this.skipper = new DependencyResolutionSkipper();

    // BOM 처리기 초기화 (fetchPom 함수 주입)
    this.bomProcessor = new MavenBomProcessor((coord) => this.fetchPomWithCache(coord));

    // 큐 프로세서 초기화 (의존성 주입)
    this.initQueueProcessor();
  }

  /**
   * 큐 프로세서 초기화
   */
  private initQueueProcessor(): void {
    const deps: QueueProcessorDependencies = {
      fetchPomWithCache: (coord) => this.fetchPomWithCache(coord),
      prefetchPomsParallel: (coords) => this.prefetchPomsParallelInternal(coords),
      shouldIncludeDependency: (dep, includeOptional) =>
        this.shouldIncludeDependency(dep, includeOptional),
      createDependencyNode: (coord, scope) => this.createDependencyNode(coord, scope),
      recordConflict: (coord, winnerVersion, parentPath) =>
        this.recordConflict(coord, winnerVersion, parentPath),
      skipper: {
        skipResolution: (coord, depth, parentPath) =>
          this.skipper.skipResolution(coord, depth, parentPath),
        recordResolved: (coord) => this.skipper.recordResolved(coord),
        getResolvedVersion: (groupId, artifactId) =>
          this.skipper.getResolvedVersion(groupId, artifactId),
        getCoordinateManager: () => this.skipper.getCoordinateManager(),
      },
      bomProcessor: {
        processParentPom: (pom, coord) => this.bomProcessor.processParentPom(pom, coord),
      },
    };
    this.queueProcessor = new MavenQueueProcessor(deps);
  }

  /**
   * 의존성 해결 (진입점)
   */
  async resolveDependencies(
    packageName: string,
    version: string,
    options?: MavenResolverOptions
  ): Promise<DependencyResolutionResult> {
    const opts = { ...this.defaultOptions, ...options };
    const [groupId, artifactId] = packageName.split(':');

    if (!groupId || !artifactId) {
      throw new Error(`잘못된 패키지명 형식: ${packageName} (groupId:artifactId 형식 필요)`);
    }

    // 상태 초기화
    this.conflicts = [];
    this.bomProcessor.clearDependencyManagement();
    this.skipper.clear();

    const rootCoordinate: MavenCoordinate = {
      groupId,
      artifactId,
      version,
      // 사용자가 UI에서 선택한 classifier 사용
      classifier: opts.classifier,
    };

    // 네이티브 패키지이고 classifier가 없으면 경고만 표시 (자동 생성하지 않음)
    // 각 라이브러리마다 classifier 형식이 다르므로 (LWJGL: natives-linux, Netty: linux-x86_64)
    // 자동 생성 대신 UI에서 사용자가 직접 선택하도록 함
    if (isNativeArtifact(groupId, artifactId) && !rootCoordinate.classifier) {
      logger.warn('네이티브 패키지이지만 classifier가 지정되지 않음. 기본 JAR만 해결됩니다.', {
        package: packageName,
        hint: 'UI에서 classifier를 선택하세요',
      });
    } else if (rootCoordinate.classifier) {
      logger.info('사용자 지정 classifier 사용', {
        package: packageName,
        classifier: rootCoordinate.classifier,
      });
    }

    try {
      logger.info('Maven 의존성 해결 시작', {
        package: packageName,
        version,
        algorithm: opts.algorithm,
      });

      const root = await this.resolveBF(rootCoordinate, opts);
      const flatList = this.flattenDependencies(root);

      // 패키지 크기 조회 (병렬 HEAD 요청)
      const flatListWithSizes = await this.fetchPackageSizes(flatList);
      const totalSize = flatListWithSizes.reduce(
        (sum, pkg) => sum + ((pkg.metadata?.size as number) || 0),
        0
      );

      const stats = this.skipper.getStats();
      logger.info('Maven 의존성 해결 완료', {
        package: packageName,
        totalDependencies: flatListWithSizes.length,
        totalSize,
        conflicts: this.conflicts.length,
        skipperStats: stats,
      });

      return {
        root,
        flatList: flatListWithSizes,
        conflicts: this.conflicts,
        totalSize,
      };
    } catch (error) {
      logger.error('Maven 의존성 해결 실패', { packageName, version, error });
      throw error;
    }
  }

  /**
   * BF(너비 우선) 알고리즘으로 의존성 해결
   *
   * 분할된 메서드들을 조합하여 BFS 탐색 수행
   */
  private async resolveBF(
    rootCoordinate: MavenCoordinate,
    options: MavenResolverOptions
  ): Promise<DependencyNode> {
    // 컨텍스트 초기화
    const ctx = this.initializeResolutionContext(rootCoordinate, options);

    // 루트 POM 처리 및 의존성 큐잉
    const resolvedProperties = await this.processRootPom(rootCoordinate, ctx);
    await this.queueProcessor.enqueueRootDependencies(rootCoordinate, resolvedProperties, ctx);

    // BFS 큐 처리 (큐 프로세서에 위임)
    await this.queueProcessor.processQueue(ctx);

    return ctx.rootNode;
  }

  /**
   * 해결 컨텍스트 초기화
   *
   * 노드맵, 큐, 옵션 등 공유 상태 설정
   */
  private initializeResolutionContext(
    rootCoordinate: MavenCoordinate,
    options: MavenResolverOptions
  ): MavenResolutionContext {
    const rootNode = this.createDependencyNode(rootCoordinate, 'compile');
    const rootKey = coordinateToString(rootCoordinate);
    const nodeMap = new Map<string, DependencyNode>();
    nodeMap.set(rootKey, rootNode);

    return {
      nodeMap,
      queue: [],
      maxDepth: options.maxDepth ?? MAVEN_CONSTANTS.DEFAULT_MAX_DEPTH,
      includeOptional: options.includeOptionalDependencies ?? false,
      dependencyManagement: this.bomProcessor.getDependencyManagement(),
      rootNode,
      rootKey,
    };
  }

  /**
   * 루트 POM 처리
   *
   * POM 로드, packaging 타입 설정, properties 체인 구축
   */
  private async processRootPom(
    rootCoordinate: MavenCoordinate,
    ctx: MavenResolutionContext
  ): Promise<Record<string, string>> {
    const rootPom = await this.fetchPomWithCache(rootCoordinate);

    // packaging 타입 설정
    if (rootPom.packaging) {
      rootCoordinate.type = rootPom.packaging;
      ctx.rootNode.package.metadata = {
        ...ctx.rootNode.package.metadata,
        type: rootPom.packaging,
      };
    }

    // Parent POM 처리 및 properties 체인 구축
    const resolvedProperties = await this.bomProcessor.processParentPom(rootPom, rootCoordinate);

    // dependencyManagement 처리
    await this.bomProcessor.processDependencyManagement(rootPom, resolvedProperties);

    return resolvedProperties;
  }

  // 큐 처리 로직은 MavenQueueProcessor로 분리됨 (maven-queue-processor.ts)

  /**
   * DependencyNode 생성
   */
  private createDependencyNode(
    coordinate: MavenCoordinate,
    scope: DependencyScope
  ): DependencyNode {
    return {
      package: {
        type: 'maven',
        name: `${coordinate.groupId}:${coordinate.artifactId}`,
        version: coordinate.version,
        metadata: {
          groupId: coordinate.groupId,
          artifactId: coordinate.artifactId,
          classifier: coordinate.classifier,
          type: coordinate.type,
        },
      },
      dependencies: [],
      scope,
    };
  }

  /**
   * 의존성 포함 여부 결정
   */
  private shouldIncludeDependency(dep: PomDependency, includeOptional: boolean): boolean {
    const scope = dep.scope as DependencyScope;

    // test, provided, system scope는 전이적 의존성에서 제외
    if (scope === 'test' || scope === 'provided' || scope === 'system') {
      return false;
    }

    // optional 처리
    if (dep.optional === 'true' || dep.optional === true) {
      return includeOptional;
    }

    return true;
  }

  /**
   * 충돌 기록
   */
  private recordConflict(
    coordinate: MavenCoordinate,
    winnerVersion: string,
    path: string[]
  ): void {
    const packageName = coordinateToKey(coordinate);

    // 이미 기록된 충돌인지 확인
    const existing = this.conflicts.find(
      (c) => c.packageName === packageName && c.versions.includes(coordinate.version)
    );

    if (existing) {
      if (!existing.versions.includes(coordinate.version)) {
        existing.versions.push(coordinate.version);
      }
    } else {
      this.conflicts.push({
        type: 'version',
        packageName,
        versions: [coordinate.version, winnerVersion].filter((v) => v),
        resolvedVersion: winnerVersion,
      });
    }
  }

  /**
   * POM 캐시와 함께 조회 (공유 캐시 모듈 사용)
   */
  private async fetchPomWithCache(coordinate: MavenCoordinate): Promise<PomProject> {
    return fetchPomFromCache(coordinate, {
      repoUrl: this.repoUrl,
      memoryTtl: this.defaultOptions.pomCacheTtl,
      ...this.cacheOptions,
    });
  }

  /**
   * 여러 POM 병렬 프리페치
   */
  private prefetchPomsParallelInternal(coordinates: MavenCoordinate[]): void {
    prefetchPomsParallel(coordinates, {
      repoUrl: this.repoUrl,
      memoryTtl: this.defaultOptions.pomCacheTtl,
      batchSize: this.defaultOptions.parallelThreads,
      ...this.cacheOptions,
    });
  }

  /**
   * 최신 버전 조회
   */
  async getLatestVersion(groupId: string, artifactId: string): Promise<string> {
    const groupPath = groupId.replace(/\./g, '/');
    const url = `${this.repoUrl}/${groupPath}/${artifactId}/maven-metadata.xml`;

    try {
      const response = await this.axiosInstance.get<string>(url);
      const parsed = this.parser.parse(response.data);
      return (
        parsed.metadata?.versioning?.latest || parsed.metadata?.versioning?.release || ''
      );
    } catch {
      throw new Error(`버전 조회 실패: ${groupId}:${artifactId}`);
    }
  }

  /**
   * 의존성 트리 평탄화
   */
  private flattenDependencies(node: DependencyNode): PackageInfo[] {
    const result: Map<string, PackageInfo> = new Map();

    const traverse = (n: DependencyNode, path: string[]) => {
      const key = `${n.package.name}@${n.package.version}`;

      // 순환 참조 방지
      if (path.includes(key)) {
        return;
      }

      if (!result.has(key)) {
        result.set(key, n.package);
      }

      const newPath = [...path, key];
      for (const child of n.dependencies) {
        traverse(child, newPath);
      }
    };

    traverse(node, []);
    return Array.from(result.values());
  }

  /**
   * 패키지 크기 조회 (병렬 HEAD 요청)
   */
  private async fetchPackageSizes(packages: PackageInfo[]): Promise<PackageInfo[]> {
    const limit = pLimit(15); // 동시 15개 요청
    const startTime = Date.now();

    logger.debug('Maven 패키지 크기 조회 시작', { count: packages.length });

    const results = await Promise.all(
      packages.map((pkg) =>
        limit(async () => {
          try {
            const [groupId, artifactId] = pkg.name.split(':');
            const version = pkg.version;
            const type = (pkg.metadata?.type as string) || 'jar';

            // POM-only 패키지는 pom 파일 크기 조회
            const extension = type === 'pom' ? 'pom' : 'jar';
            const groupPath = groupId.replace(/\./g, '/');
            const fileName = `${artifactId}-${version}.${extension}`;
            const url = `${this.repoUrl}/${groupPath}/${artifactId}/${version}/${fileName}`;

            const response = await this.axiosInstance.head(url, { timeout: MAVEN_CONSTANTS.HEAD_REQUEST_TIMEOUT_MS });
            const size = parseInt(response.headers['content-length'] || '0', 10);

            return {
              ...pkg,
              metadata: {
                ...pkg.metadata,
                size,
              },
            };
          } catch {
            // 크기 조회 실패 시 0으로 설정 (다운로드에는 영향 없음)
            return {
              ...pkg,
              metadata: {
                ...pkg.metadata,
                size: 0,
              },
            };
          }
        })
      )
    );

    const elapsed = Date.now() - startTime;
    const totalSize = results.reduce(
      (sum, pkg) => sum + ((pkg.metadata?.size as number) || 0),
      0
    );
    logger.debug('Maven 패키지 크기 조회 완료', {
      count: packages.length,
      totalSize,
      elapsed: `${elapsed}ms`,
    });

    return results;
  }

  /**
   * pom.xml 텍스트 파싱
   */
  async parseFromText(content: string): Promise<PackageInfo[]> {
    try {
      const parsed = this.parser.parse(content);
      const pom = parsed.project as PomProject;
      const packages: PackageInfo[] = [];

      // dependencyManagement 처리
      this.bomProcessor.clearDependencyManagement();
      await this.bomProcessor.processDependencyManagement(pom, pom.properties);

      const dependencyManagement = this.bomProcessor.getDependencyManagement();

      // 프로젝트 자체
      const projectGroupId = pom.groupId || pom.parent?.groupId;
      const projectVersion = pom.version || pom.parent?.version;

      if (projectGroupId && pom.artifactId && projectVersion) {
        packages.push({
          type: 'maven',
          name: `${projectGroupId}:${pom.artifactId}`,
          version: projectVersion,
          metadata: {
            groupId: projectGroupId,
            artifactId: pom.artifactId,
          },
        });
      }

      // Dependencies
      const deps = pom.dependencies?.dependency;
      if (deps) {
        const dependencies = Array.isArray(deps) ? deps : [deps];

        for (const dep of dependencies) {
          const scope = dep.scope as DependencyScope;
          if (scope === 'test') continue;

          let version = resolveProperty(dep.version || '', pom.properties);
          if (!version) {
            version = dependencyManagement.get(`${dep.groupId}:${dep.artifactId}`) || 'LATEST';
          }

          packages.push({
            type: 'maven',
            name: `${dep.groupId}:${dep.artifactId}`,
            version,
            metadata: {
              groupId: dep.groupId,
              artifactId: dep.artifactId,
              scope: dep.scope,
            },
          });
        }
      }

      return packages;
    } catch (error) {
      logger.error('pom.xml 파싱 실패', { error });
      throw error;
    }
  }

  /**
   * POM 캐시 클리어
   */
  clearCache(): void {
    clearMavenCache();
  }

  /**
   * 캐시 옵션 설정
   */
  setCacheOptions(options: MavenCacheOptions): void {
    this.cacheOptions = options;
  }

  /**
   * Skipper 통계 가져오기
   */
  getSkipperStats(): ReturnType<DependencyResolutionSkipper['getStats']> {
    return this.skipper.getStats();
  }
}

// 싱글톤 인스턴스
let mavenResolverInstance: MavenResolver | null = null;

export function getMavenResolver(): MavenResolver {
  if (!mavenResolverInstance) {
    mavenResolverInstance = new MavenResolver();
  }
  return mavenResolverInstance;
}
