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
  fetchPomWithCache: (coordinate: MavenCoordinate) => Promise<any>;
  /** POM 병렬 프리페치 */
  prefetchPomsParallel: (coordinates: MavenCoordinate[]) => void;
  /** 의존성 포함 여부 체크 */
  shouldIncludeDependency: (dep: any, includeOptional: boolean) => boolean;
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
    processParentPom: (pom: any, coordinate: MavenCoordinate) => Promise<Record<string, string>>;
  };
}

/**
 * Maven 큐 프로세서
 *
 * BFS 방식의 의존성 탐색 큐 처리를 담당
 */
export class MavenQueueProcessor {
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
    let pom: any;
    try {
      pom = await this.deps.fetchPomWithCache(coordinate);
    } catch (error) {
      logger.warn('POM 로드 실패', {
        coordinate: coordinateToString(coordinate),
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    // packaging 타입 업데이트
    if (pom.packaging) {
      coordinate.type = pom.packaging;
      node.package.metadata = {
        ...node.package.metadata,
        type: pom.packaging,
      };
    }

    // properties 체인 구축
    const childProperties = await this.deps.bomProcessor.processParentPom(pom, coordinate);

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
        ctx.dependencyManagement
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
        managedVersion: !!ctx.dependencyManagement.get(coordinateToKey(depCoordinate)),
      });
    }

    // POM 병렬 프리페치
    if (childCoordinates.length > 0) {
      this.deps.prefetchPomsParallel(childCoordinates);
    }
  }
}
