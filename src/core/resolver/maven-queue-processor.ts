/**
 * Maven Queue Processor
 *
 * BFS 기반 의존성 해결의 큐 처리 로직을 담당
 * MavenResolver에서 분리된 모듈
 */

import { DependencyNode, DependencyScope } from '../../types';
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
import { extractExclusions, resolveDependencyCoordinate } from '../shared/maven-pom-utils';

/**
 * BFS 의존성 해결 컨텍스트
 */
export interface MavenResolutionContext {
  /** 노드 저장소 (GAV/type/classifier -> DependencyNode) */
  nodeMap: Map<string, DependencyNode>;
  /** BFS 처리 큐 */
  queue: DependencyProcessingContext[];
  /** 아티팩트·scope·exclusion 컨텍스트별 가장 얕은 처리 깊이 */
  contextDepths: Map<string, number>;
  /** 의존성 탐색 작업 수 */
  workCount: number;
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
  recordConflict: (coordinate: MavenCoordinate, firstVersion: string, parentPath: string[]) => void;
  /** Skipper 관련 */
  skipper: {
    recordResolved: (coordinate: MavenCoordinate) => void;
    getResolvedVersion: (groupId: string, artifactId: string) => string | undefined;
    getCoordinateManager: () => {
      createCoordinate: (coordinate: MavenCoordinate, depth: number) => void;
    };
  };
  /** BOM 프로세서 */
  bomProcessor: {
    processModel: (
      pom: PomProject,
      coordinate: MavenCoordinate,
      rootManagement: Map<string, string>
    ) => Promise<{
      properties: Record<string, string>;
      dependencyManagement: Map<string, string>;
      dependencies: PomDependency[];
    }>;
  };
}

/**
 * Maven 큐 프로세서
 *
 * BFS 방식의 의존성 탐색 큐 처리를 담당
 */
export class MavenQueueProcessor {
  private static readonly MAX_DEPENDENCY_CONTEXTS = 10000;

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

    // 모든 버전을 보존한다. 경로상 순환과 동일 탐색 컨텍스트만 중복 제거한다.
    const nodeKey = this.artifactKey(coordinate);
    if (parentPath.includes(nodeKey)) return;

    const firstVersion = this.deps.skipper.getResolvedVersion(
      coordinate.groupId,
      coordinate.artifactId
    );
    if (firstVersion && firstVersion !== coordinate.version) {
      this.deps.recordConflict(coordinate, firstVersion, parentPath);
    }

    // 노드 생성 또는 가져오기
    let node = ctx.nodeMap.get(nodeKey);

    if (!node) {
      node = this.deps.createDependencyNode(coordinate, scope);
      ctx.nodeMap.set(nodeKey, node);
    }

    // 부모 노드에 자식 추가
    this.addChildToParent(node, parentPath, ctx);

    const contextKey = JSON.stringify([nodeKey, scope, [...exclusions].sort()]);
    const previousDepth = ctx.contextDepths.get(contextKey);
    if (previousDepth !== undefined && previousDepth <= depth) return;
    if (++ctx.workCount > MavenQueueProcessor.MAX_DEPENDENCY_CONTEXTS) {
      throw new Error('Maven 의존성 해결 작업 수가 제한을 초과했습니다.');
    }
    ctx.contextDepths.set(contextKey, depth);

    // 해결됨으로 기록
    this.deps.skipper.recordResolved(coordinate);

    // 자식 의존성 처리
    await this.enqueueChildDependencies(
      coordinate,
      nodeKey,
      node,
      parentPath,
      depth,
      scope,
      exclusions,
      ctx
    );
  }

  /**
   * 부모 노드에 자식 추가
   */
  private addChildToParent(
    node: DependencyNode,
    parentPath: string[],
    ctx: MavenResolutionContext
  ): void {
    const parentKey = parentPath[parentPath.length - 1];
    const parentNode = ctx.nodeMap.get(parentKey);

    if (parentNode && !parentNode.dependencies.includes(node)) {
      parentNode.dependencies.push(node);
    }
  }

  /**
   * 루트 의존성 큐에 추가
   */
  async enqueueRootDependencies(
    rootCoordinate: MavenCoordinate,
    resolvedProperties: Record<string, string>,
    rootDependencies: PomDependency[],
    ctx: MavenResolutionContext
  ): Promise<void> {
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
    nodeKey: string,
    node: DependencyNode,
    parentPath: string[],
    depth: number,
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
      node.package.metadata = {
        ...node.package.metadata,
        ...this.deps.createDependencyNode(
          { ...coordinate, type: pom.packaging },
          node.scope || 'compile'
        ).package.metadata,
      };
    }

    // 각 POM 자체의 버전도 보존한다. 루트 관리 버전은 별도 후보로 추가한다.
    const {
      properties: childProperties,
      dependencyManagement: childManagement,
      dependencies,
    } = await this.deps.bomProcessor.processModel(pom, coordinate, new Map());

    // 하위 의존성 처리
    const newPath = [...parentPath, nodeKey];
    const childCoordinates: MavenCoordinate[] = [];
    let childSequence = 0;

    for (const dep of dependencies) {
      if (!this.deps.shouldIncludeDependency(dep, ctx.includeOptional)) continue;

      // 현재 엣지의 exclusions는 다음 자손부터 적용한다.
      const declared = resolveDependencyCoordinate(dep, childProperties, childManagement);
      const managedVersion = ctx.dependencyManagement.get(`${dep.groupId}:${dep.artifactId}`);
      const managed = managedVersion
        ? resolveDependencyCoordinate(
            { ...dep, version: managedVersion },
            childProperties,
            ctx.dependencyManagement
          )
        : null;
      const coordinates = [declared, managed]
        .filter((candidate): candidate is MavenCoordinate => candidate !== null)
        .filter(
          (candidate, index, candidates) =>
            !matchesExclusion(candidate, exclusions) &&
            candidates.findIndex(
              (other) => this.artifactKey(other) === this.artifactKey(candidate)
            ) === index
        );
      if (coordinates.length === 0) continue;

      // Scope 전이 계산
      const depOriginalScope = (dep.scope as DependencyScope) || 'compile';
      const transitedScope = transitScope(parentScope, depOriginalScope);
      if (!transitedScope) continue;

      // Exclusion 병합
      const mergedExclusions = new Set([...exclusions, ...extractExclusions(dep)]);
      for (const depCoordinate of coordinates) {
        childCoordinates.push(depCoordinate);
        childSequence++;

        ctx.queue.push({
          coordinate: depCoordinate,
          parentPath: newPath,
          depth: depth + 1,
          nodeCoordinate: { depth: depth + 1, sequence: childSequence },
          scope: transitedScope,
          originalScope: depOriginalScope,
          exclusions: mergedExclusions,
          managedVersion: !!managedVersion,
        });
      }
    }

    // POM 병렬 프리페치
    if (childCoordinates.length > 0) {
      this.deps.prefetchPomsParallel(childCoordinates);
    }
  }

  /** GAV뿐 아니라 type과 classifier도 서로 다른 반출 아티팩트다. */
  artifactKey(coordinate: MavenCoordinate): string {
    return JSON.stringify([
      coordinate.groupId,
      coordinate.artifactId,
      coordinate.version,
      coordinate.type || 'jar',
      coordinate.classifier || '',
    ]);
  }
}
