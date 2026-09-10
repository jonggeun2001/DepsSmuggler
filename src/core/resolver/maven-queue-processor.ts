/**
 * Maven Queue Processor
 *
 * BFS 기반 의존성 해결의 큐 처리 로직을 담당
 * MavenResolver에서 분리된 모듈
 */

import { DependencyNode, DependencyScope } from '../../types';
import logger from '../../utils/logger';
import {
  MavenCoordinate,
  PomDependency,
  PomProject,
  DependencyProcessingContext,
  coordinateToString,
  coordinateToKey,
  matchesExclusion,
  transitScope,
} from '../shared/maven-types';
import {
  extractDependencies,
  extractExclusions,
  resolveDependencyCoordinate,
} from '../shared/maven-pom-utils';

/**
 * BFS 의존성 해결 컨텍스트
 */
export interface MavenResolutionContext {
  /** 노드 저장소 (G:A:V -> DependencyNode) */
  nodeMap: Map<string, DependencyNode>;
  /** BFS 처리 큐 */
  queue: DependencyProcessingContext[];
  /** 충돌로 선택되지 않은 descriptor를 수집하는 별도 큐 */
  descriptorQueue: DependencyProcessingContext[];
  /** descriptor 컨텍스트별 가장 얕은 처리 깊이 */
  descriptorContextDepths: Map<string, number>;
  /** 최종 저장소에 필요한 descriptor 좌표 (classifier 제외 G:A:V) */
  descriptorCoordinates: Map<string, MavenCoordinate>;
  /** descriptor 탐색 작업 수 */
  descriptorWorkCount: number;
  /** 최대 탐색 깊이 */
  maxDepth: number;
  /** optional 의존성 포함 여부 */
  includeOptional: boolean;
  /** dependencyManagement 버전 맵 */
  dependencyManagement: Map<string, string>;
  /** 루트 노드 */
  rootNode: DependencyNode;
  /** 루트 좌표 키 */
  rootKey: string;
}

/**
 * 큐 프로세서에 필요한 의존성 인터페이스
 */
export interface QueueProcessorDependencies {
  /** POM 가져오기 (캐시 포함) */
  fetchPomWithCache: (coordinate: MavenCoordinate) => Promise<PomProject>;
  /** POM 병렬 프리페치 */
  prefetchPomsParallel: (coordinates: MavenCoordinate[]) => void;
  /** 의존성 포함 여부 체크 */
  shouldIncludeDependency: (dep: PomDependency, includeOptional: boolean) => boolean;
  /** 의존성 노드 생성 */
  createDependencyNode: (coordinate: MavenCoordinate, scope: DependencyScope) => DependencyNode;
  /** 충돌 기록 */
  recordConflict: (coordinate: MavenCoordinate, winnerVersion: string, parentPath: string[]) => void;
  /** Skipper 관련 */
  skipper: {
    skipResolution: (
      coordinate: MavenCoordinate,
      depth: number,
      parentPath: string[]
    ) => { skip: boolean; reason?: string; forceResolution?: boolean };
    recordResolved: (coordinate: MavenCoordinate) => void;
    getResolvedVersion: (groupId: string, artifactId: string) => string | undefined;
    getCoordinateManager: () => { createCoordinate: (coordinate: MavenCoordinate, depth: number) => void };
  };
  /** BOM 프로세서 */
  bomProcessor: {
    processModel: (
      pom: PomProject,
      coordinate: MavenCoordinate,
      rootManagement: Map<string, string>
    ) => Promise<{ properties: Record<string, string>; dependencyManagement: Map<string, string> }>;
  };
}

/**
 * Maven 큐 프로세서
 *
 * BFS 방식의 의존성 탐색 큐 처리를 담당
 */
export class MavenQueueProcessor {
  private static readonly MAX_DESCRIPTOR_CONTEXTS = 10000;

  constructor(private deps: QueueProcessorDependencies) {}

  /**
   * 큐 처리 메인 루프
   */
  async processQueue(ctx: MavenResolutionContext): Promise<void> {
    while (ctx.queue.length > 0) {
      const item = ctx.queue.shift()!;
      await this.processQueueItem(item, ctx);
    }
  }

  /**
   * 일반 dependency graph가 확정된 뒤, conflict loser의 POM과 하위
   * descriptor만 수집한다. 이 단계에서는 skipper 상태를 건드리지 않는다.
   */
  async processDescriptorQueue(ctx: MavenResolutionContext): Promise<void> {
    while (ctx.descriptorQueue.length > 0) {
      const item = ctx.descriptorQueue.shift()!;
      await this.processDescriptorItem(item, ctx);
    }
  }

  /**
   * 큐 아이템 처리
   */
  private async processQueueItem(
    item: DependencyProcessingContext,
    ctx: MavenResolutionContext
  ): Promise<void> {
    const { coordinate, parentPath, depth, scope, exclusions } = item;

    // 최대 깊이 체크
    if (depth > ctx.maxDepth) return;

    // Exclusion 체크
    if (matchesExclusion(coordinate, exclusions)) {
      logger.debug('의존성 제외됨 (exclusion)', { coordinate: coordinateToString(coordinate) });
      return;
    }

    // Skipper로 건너뛰기 여부 결정
    const skipResult = this.deps.skipper.skipResolution(coordinate, depth, parentPath);

    if (skipResult.skip) {
      if (skipResult.reason === 'version_conflict') {
        const winnerVersion = this.deps.skipper.getResolvedVersion(
          coordinate.groupId,
          coordinate.artifactId
        );
        this.deps.recordConflict(coordinate, winnerVersion || '', parentPath);
        this.enqueueDescriptor({ ...item }, ctx);
      }
      return;
    }

    // 노드 생성 또는 가져오기
    const nodeKey = coordinateToString(coordinate);
    let node = ctx.nodeMap.get(nodeKey);

    if (!node) {
      node = this.deps.createDependencyNode(coordinate, scope);
      ctx.nodeMap.set(nodeKey, node);
    }

    // 부모 노드에 자식 추가
    this.addChildToParent(nodeKey, node, parentPath, ctx);

    // 강제 해결이면 자식 탐색 건너뛰기
    if (skipResult.forceResolution) return;

    // 해결됨으로 기록
    this.deps.skipper.recordResolved(coordinate);

    // 자식 의존성 처리
    await this.enqueueChildDependencies(coordinate, node, parentPath, scope, exclusions, ctx);
  }

  /**
   * 부모 노드에 자식 추가
   */
  private addChildToParent(
    nodeKey: string,
    node: DependencyNode,
    parentPath: string[],
    ctx: MavenResolutionContext
  ): void {
    const parentKey = parentPath[parentPath.length - 1];
    const parentNode = ctx.nodeMap.get(parentKey);

    if (
      parentNode &&
      !parentNode.dependencies.some(
        (d) =>
          coordinateToString({
            groupId: d.package.metadata?.groupId as string,
            artifactId: d.package.metadata?.artifactId as string,
            version: d.package.version,
          }) === nodeKey
      )
    ) {
      parentNode.dependencies.push(node);
    }
  }

  /**
   * 루트 의존성 큐에 추가
   */
  async enqueueRootDependencies(
    rootCoordinate: MavenCoordinate,
    resolvedProperties: Record<string, string>,
    ctx: MavenResolutionContext
  ): Promise<void> {
    const rootPom = await this.deps.fetchPomWithCache(rootCoordinate);
    const rootDependencies = extractDependencies(rootPom, rootCoordinate, true);

    // 루트 좌표 등록
    this.deps.skipper.getCoordinateManager().createCoordinate(rootCoordinate, 0);
    this.deps.skipper.recordResolved(rootCoordinate);

    const coordinatesToPrefetch: MavenCoordinate[] = [];
    let sequence = 0;

    for (const dep of rootDependencies) {
      if (!this.deps.shouldIncludeDependency(dep, ctx.includeOptional)) continue;

      const depCoordinate = resolveDependencyCoordinate(
        dep,
        resolvedProperties,
        ctx.dependencyManagement
      );
      if (!depCoordinate) continue;

      coordinatesToPrefetch.push(depCoordinate);
      sequence++;

      ctx.queue.push({
        coordinate: depCoordinate,
        parentPath: [ctx.rootKey],
        depth: 1,
        nodeCoordinate: { depth: 1, sequence },
        scope: (dep.scope as DependencyScope) || 'compile',
        originalScope: (dep.scope as DependencyScope) || 'compile',
        exclusions: extractExclusions(dep),
        managedVersion: !!ctx.dependencyManagement.get(coordinateToKey(depCoordinate)),
      });
    }

    // POM 병렬 프리페치
    if (coordinatesToPrefetch.length > 0) {
      this.deps.prefetchPomsParallel(coordinatesToPrefetch);
    }
  }

  /**
   * 자식 의존성 큐에 추가
   */
  private async enqueueChildDependencies(
    coordinate: MavenCoordinate,
    node: DependencyNode,
    parentPath: string[],
    parentScope: DependencyScope,
    exclusions: Set<string>,
    ctx: MavenResolutionContext
  ): Promise<void> {
    // POM 로드
    let pom: PomProject;
    try {
      pom = await this.deps.fetchPomWithCache(coordinate);
    } catch (error) {
      throw new Error(
        `필수 POM 조회 실패: ${coordinateToString(coordinate)} - ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // dependency에 명시한 type을 우선하고, packaging으로 보완하면 파일명도 갱신한다.
    if (!coordinate.type && pom.packaging) {
      coordinate.type = pom.packaging;
      node.package.metadata = {
        ...node.package.metadata,
        ...this.deps.createDependencyNode(coordinate, node.scope || 'compile').package.metadata,
      };
    }

    // 루트 관리 버전을 유지하면서 이 POM의 관리 버전을 형제에게 누출하지 않는다.
    const { properties: childProperties, dependencyManagement: childManagement } =
      await this.deps.bomProcessor.processModel(pom, coordinate, ctx.dependencyManagement);

    // 하위 의존성 처리
    const dependencies = extractDependencies(pom, coordinate);
    const nodeKey = coordinateToString(coordinate);
    const newPath = [...parentPath, nodeKey];
    const childCoordinates: MavenCoordinate[] = [];
    let childSequence = 0;

    for (const dep of dependencies) {
      if (!this.deps.shouldIncludeDependency(dep, ctx.includeOptional)) continue;

      const depCoordinate = resolveDependencyCoordinate(
        dep,
        childProperties,
        childManagement
      );
      if (!depCoordinate) continue;

      // Scope 전이 계산
      const depOriginalScope = (dep.scope as DependencyScope) || 'compile';
      const transitedScope = transitScope(parentScope, depOriginalScope);
      if (!transitedScope) continue;

      // Exclusion 병합
      const mergedExclusions = new Set([...exclusions, ...extractExclusions(dep)]);
      childCoordinates.push(depCoordinate);
      childSequence++;

      ctx.queue.push({
        coordinate: depCoordinate,
        parentPath: newPath,
        depth: parentPath.length + 1,
        nodeCoordinate: { depth: parentPath.length + 1, sequence: childSequence },
        scope: transitedScope,
        originalScope: depOriginalScope,
        exclusions: mergedExclusions,
        managedVersion: !!childManagement.get(coordinateToKey(depCoordinate)),
      });
    }

    // POM 병렬 프리페치
    if (childCoordinates.length > 0) {
      this.deps.prefetchPomsParallel(childCoordinates);
    }
  }

  private descriptorCoordinateKey(coordinate: MavenCoordinate): string {
    return `${coordinate.groupId}:${coordinate.artifactId}:${coordinate.version}`;
  }

  private descriptorContextKey(item: DependencyProcessingContext): string {
    const exclusions = [...item.exclusions].sort().join(',');
    return `${this.descriptorCoordinateKey(item.coordinate)}|${item.scope}|${exclusions}`;
  }

  private descriptorPathContains(
    coordinate: MavenCoordinate,
    parentPath: string[],
  ): boolean {
    const prefix = this.descriptorCoordinateKey(coordinate);
    return parentPath.some((path) => path === prefix || path.startsWith(`${prefix}:`));
  }

  private enqueueDescriptor(
    item: DependencyProcessingContext,
    ctx: MavenResolutionContext,
  ): void {
    if (item.depth > ctx.maxDepth) return;
    if (matchesExclusion(item.coordinate, item.exclusions)) return;

    if (this.descriptorPathContains(item.coordinate, item.parentPath)) return;

    const contextKey = this.descriptorContextKey(item);
    const previousDepth = ctx.descriptorContextDepths.get(contextKey);
    if (previousDepth !== undefined && previousDepth <= item.depth) return;

    ctx.descriptorWorkCount += 1;
    if (ctx.descriptorWorkCount > MavenQueueProcessor.MAX_DESCRIPTOR_CONTEXTS) {
      throw new Error('Maven descriptor 의존성 해결 작업 수가 제한을 초과했습니다.');
    }

    ctx.descriptorContextDepths.set(contextKey, item.depth);
    ctx.descriptorQueue.push(item);
  }

  private async processDescriptorItem(
    item: DependencyProcessingContext,
    ctx: MavenResolutionContext,
  ): Promise<void> {
    const { coordinate, depth, parentPath, scope, exclusions } = item;
    if (depth > ctx.maxDepth || matchesExclusion(coordinate, exclusions)) return;

    const descriptorKey = this.descriptorCoordinateKey(coordinate);
    ctx.descriptorCoordinates.set(descriptorKey, {
      groupId: coordinate.groupId,
      artifactId: coordinate.artifactId,
      version: coordinate.version,
      type: 'pom',
    });

    let pom: PomProject;
    try {
      pom = await this.deps.fetchPomWithCache(coordinate);
    } catch (error) {
      throw new Error(
        `필수 descriptor POM 조회 실패: ${coordinateToString(coordinate)} - ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const { properties, dependencyManagement } = await this.deps.bomProcessor.processModel(
      pom,
      coordinate,
      ctx.dependencyManagement,
    );
    const currentPath = [...parentPath, coordinateToString(coordinate)];
    const dependencies = extractDependencies(pom, coordinate);
    let childSequence = 0;

    for (const dep of dependencies) {
      if (!this.deps.shouldIncludeDependency(dep, ctx.includeOptional)) continue;

      const depCoordinate = resolveDependencyCoordinate(dep, properties, dependencyManagement);
      if (!depCoordinate) continue;

      const depOriginalScope = (dep.scope as DependencyScope) || 'compile';
      const transitedScope = transitScope(scope, depOriginalScope);
      if (!transitedScope) continue;

      childSequence += 1;
      if (this.descriptorPathContains(depCoordinate, currentPath)) continue;

      this.enqueueDescriptor({
        coordinate: depCoordinate,
        parentPath: currentPath,
        depth: depth + 1,
        nodeCoordinate: { depth: depth + 1, sequence: childSequence },
        scope: transitedScope,
        originalScope: depOriginalScope,
        exclusions: new Set([...exclusions, ...extractExclusions(dep)]),
        managedVersion: !!dependencyManagement.get(coordinateToKey(depCoordinate)),
      }, ctx);
    }
  }
}
