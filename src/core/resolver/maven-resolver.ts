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
import { DependencyResolutionSkipper } from '../shared/maven-dedupe-index';
import {
  fetchPom as fetchPomFromCache,
  clearMemoryCache as clearMavenCache,
  MavenCacheOptions,
} from '../shared/maven-cache';

// 분리된 유틸리티 모듈
import {
  resolveProperty,
} from '../shared/maven-pom-utils';
import { MavenBomProcessor } from '../shared/maven-bom-processor';
import { getPackageArtifactKey } from '../shared/dependency-tree-utils';
import { MAVEN_CONSTANTS } from '../constants/maven';
import { isNativeArtifact } from '../shared/maven-utils';
import type { ResolutionSession } from '../shared/internal/resolution-session';
import {
  attachResolutionSession,
  getAttachedResolutionSession,
} from '../shared/internal/resolution-session-registry';

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
  /** 명시적으로 요청한 artifact type. 없으면 원격 POM의 packaging 사용 */
  artifactType?: string;
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
      recordConflict: (coord, winnerVersion) =>
        this.recordConflict(coord, winnerVersion),
      skipper: {
        skipResolution: (coord, depth, parentPath) =>
          this.skipper.skipResolution(coord, depth, parentPath),
        recordResolved: (coord) => this.skipper.recordResolved(coord),
        getResolvedVersion: (groupId, artifactId) =>
          this.skipper.getResolvedVersion(groupId, artifactId),
        getCoordinateManager: () => this.skipper.getCoordinateManager(),
      },
      bomProcessor: {
        processModel: (pom, coord, rootManagement) =>
          this.bomProcessor.processModel(pom, coord, rootManagement),
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
      version: version === 'latest' ? await this.getLatestVersion(groupId, artifactId) : version,
      // 사용자가 UI에서 선택한 classifier 사용
      classifier: opts.classifier,
      type: opts.artifactType,
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
        version: rootCoordinate.version,
        algorithm: opts.algorithm,
      });

      const resolution = await this.resolveBF(rootCoordinate, opts);
      const root = resolution.root;
      const flatList = this.includeRequiredPoms(
        this.flattenDependencies(root),
        resolution.descriptorCoordinates,
      );

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
  ): Promise<{
    root: DependencyNode;
    descriptorCoordinates: Map<string, MavenCoordinate>;
  }> {
    // 컨텍스트 초기화
    const ctx = this.initializeResolutionContext(rootCoordinate, options);

    // 루트 POM 처리 및 의존성 큐잉
    const resolvedProperties = await this.processRootPom(rootCoordinate, ctx);
    await this.queueProcessor.enqueueRootDependencies(rootCoordinate, resolvedProperties, ctx);

    // BFS 큐 처리 (큐 프로세서에 위임)
    await this.queueProcessor.processQueue(ctx);
    await this.queueProcessor.processDescriptorQueue(ctx);

    return {
      root: ctx.rootNode,
      descriptorCoordinates: ctx.descriptorCoordinates,
    };
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
      descriptorQueue: [],
      descriptorContextDepths: new Map(),
      descriptorCoordinates: new Map(),
      descriptorWorkCount: 0,
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

    // 명시한 artifact type은 유지하고, 미지정인 경우에만 packaging으로 보완한다.
    if (!rootCoordinate.type && rootPom.packaging) {
      rootCoordinate.type = rootPom.packaging;
      ctx.rootNode.package.metadata = {
        ...ctx.rootNode.package.metadata,
        ...this.createDependencyNode(rootCoordinate, 'compile').package.metadata,
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
    // Maven 파일명 생성: {artifactId}-{version}[-{classifier}].{type}
    const extension = coordinate.type || 'jar';
    const filename = coordinate.classifier
      ? `${coordinate.artifactId}-${coordinate.version}-${coordinate.classifier}.${extension}`
      : `${coordinate.artifactId}-${coordinate.version}.${extension}`;

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
          filename,
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
    winnerVersion: string
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
    const effectiveRepoUrl = this.getEffectiveRepoUrl();
    return this.sessionGet(
      'pom',
      {
        repoUrl: effectiveRepoUrl,
        groupId: coordinate.groupId,
        artifactId: coordinate.artifactId,
        version: coordinate.version,
      },
      () => fetchPomFromCache(coordinate, this.getPomCacheOptions()),
    );
  }

  /**
   * 여러 POM 병렬 프리페치
   */
  private prefetchPomsParallelInternal(coordinates: MavenCoordinate[]): void {
    const limit = pLimit(this.defaultOptions.parallelThreads ?? 5);

    for (const coordinate of coordinates) {
      void limit(() => this.fetchPomWithCache(coordinate)).catch((error) => {
        logger.debug('Maven POM 프리페치 실패', { coordinate: coordinateToString(coordinate), error });
      });
    }
  }

  /**
   * 최신 버전 조회
   */
  async getLatestVersion(groupId: string, artifactId: string): Promise<string> {
    const effectiveRepoUrl = this.getEffectiveRepoUrl();
    return this.sessionGet(
      'latest-version',
      { repoUrl: effectiveRepoUrl, groupId, artifactId },
      () => this.getLatestVersionUncached(groupId, artifactId, effectiveRepoUrl),
      Boolean,
    );
  }

  private async getLatestVersionUncached(
    groupId: string,
    artifactId: string,
    effectiveRepoUrl: string,
  ): Promise<string> {
    const groupPath = groupId.replace(/\./g, '/');
    const url = `${effectiveRepoUrl}/${groupPath}/${artifactId}/maven-metadata.xml`;

    try {
      const response = await this.axiosInstance.get<string>(url);
      const parsed = this.parser.parse(response.data);
      const version = [
        parsed.metadata?.versioning?.latest,
        parsed.metadata?.versioning?.release,
      ].find((candidate) => typeof candidate === 'string' && candidate.trim());
      if (!version) {
        throw new Error('Maven 메타데이터에 latest 또는 release 버전이 없습니다.');
      }
      return version.trim();
    } catch {
      throw new Error(`버전 조회 실패: ${groupId}:${artifactId}`);
    }
  }

  private getEffectiveRepoUrl(): string {
    return this.cacheOptions.repoUrl ?? this.repoUrl;
  }

  private getPomCacheOptions(): MavenCacheOptions {
    return {
      ...this.cacheOptions,
      memoryTtl: this.cacheOptions.memoryTtl ?? this.defaultOptions.pomCacheTtl,
      repoUrl: this.getEffectiveRepoUrl(),
    };
  }

  private sessionGet<T>(
    operation: 'pom' | 'latest-version',
    context: Record<string, string>,
    producer: () => Promise<T>,
    isCacheable?: (value: T) => boolean,
  ): Promise<T> {
    const session = getAttachedResolutionSession(this);
    if (!session) {
      return producer();
    }

    return session.getOrCreate(
      'maven',
      operation,
      context,
      producer,
      isCacheable ? { isCacheable } : undefined,
    );
  }

  /**
   * 의존성 트리 평탄화
   */
  private flattenDependencies(node: DependencyNode): PackageInfo[] {
    const result: Map<string, PackageInfo> = new Map();
    const visited = new Set<DependencyNode>();
    const pending: DependencyNode[] = [node];

    while (pending.length > 0) {
      const current = pending.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const key = getPackageArtifactKey(current.package);
      if (!result.has(key)) result.set(key, current.package);

      // DFS 순서를 유지하면서 호출 스택과 공유 하위 그래프의 중복 순회를 피한다.
      for (let i = current.dependencies.length - 1; i >= 0; i--) {
        pending.push(current.dependencies[i]);
      }
    }
    return Array.from(result.values());
  }

  /** 해석에 사용한 모델 POM도 오프라인 저장소에 반입한다. 관리 라이브러리는 확장하지 않는다. */
  private includeRequiredPoms(
    packages: PackageInfo[],
    descriptorCoordinates?: Map<string, MavenCoordinate>,
  ): PackageInfo[] {
    const artifacts = new Map(packages.map(pkg => [getPackageArtifactKey(pkg), pkg]));
    const selectedGavs = new Set(
      packages
        .filter(pkg => pkg.type === 'maven')
        .map(pkg => {
          const metadata = pkg.metadata as Record<string, unknown> | undefined;
          const groupId = typeof metadata?.groupId === 'string'
            ? metadata.groupId
            : pkg.name.split(':')[0];
          const artifactId = typeof metadata?.artifactId === 'string'
            ? metadata.artifactId
            : pkg.name.split(':')[1];
          return `${groupId}:${artifactId}:${pkg.version}`;
        }),
    );

    for (const coordinate of descriptorCoordinates?.values() || []) {
      const gav = `${coordinate.groupId}:${coordinate.artifactId}:${coordinate.version}`;
      if (selectedGavs.has(gav)) continue;
      const pomPackage = this.createDependencyNode({ ...coordinate, type: 'pom' }, 'compile').package;
      artifacts.set(getPackageArtifactKey(pomPackage), pomPackage);
    }

    for (const coordinate of this.bomProcessor.getRequiredPoms()) {
      const pomPackage = this.createDependencyNode({ ...coordinate, type: 'pom' }, 'compile').package;
      const key = getPackageArtifactKey(pomPackage);
      if (!artifacts.has(key)) artifacts.set(key, pomPackage);
    }
    return Array.from(artifacts.values());
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
              type: dep.type,
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
    this.cacheOptions = { ...options };
  }

  /**
   * 캐시 옵션 조회
   */
  getCacheOptions(): MavenCacheOptions {
    return { ...this.cacheOptions };
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

/** @internal */
export function createRequestMavenResolver(
  session: ResolutionSession,
): MavenResolver {
  const resolver = new MavenResolver();
  resolver.setCacheOptions(getMavenResolver().getCacheOptions());
  attachResolutionSession(resolver, session);
  return resolver;
}
