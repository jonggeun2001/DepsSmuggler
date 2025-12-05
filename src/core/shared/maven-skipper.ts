/**
 * Maven Dependency Resolution Skipper
 *
 * BF 알고리즘에서 충돌이 예측되는 노드의 해결을 건너뛰어 성능 향상
 * 문서 참고: docs/maven-dependency-resolution.md (섹션 4.3, 4.4, 4.5)
 */

import {
  MavenCoordinate,
  NodeCoordinate,
  SkipResult,
  coordinateToKey,
  coordinateToString,
} from './maven-types';

/**
 * 좌표 관리자 - 노드의 BF 좌표를 추적
 */
export class CoordinateManager {
  /** 깊이별 시퀀스 생성기 */
  private sequenceGen: Map<number, number> = new Map();

  /** 노드별 좌표 저장 */
  private coordinates: Map<string, NodeCoordinate> = new Map();

  /** G:A별 가장 왼쪽(먼저 발견된) 좌표 */
  private leftmostCoordinates: Map<string, NodeCoordinate> = new Map();

  /**
   * 노드에 좌표 생성 및 할당
   */
  createCoordinate(coordinate: MavenCoordinate, depth: number): NodeCoordinate {
    const seq = (this.sequenceGen.get(depth) || 0) + 1;
    this.sequenceGen.set(depth, seq);

    const nodeCoord: NodeCoordinate = { depth, sequence: seq };
    const key = coordinateToString(coordinate);
    this.coordinates.set(key, nodeCoord);

    // G:A 기준 가장 왼쪽 좌표 업데이트
    const gaKey = coordinateToKey(coordinate);
    const existing = this.leftmostCoordinates.get(gaKey);

    if (
      !existing ||
      depth < existing.depth ||
      (depth === existing.depth && seq < existing.sequence)
    ) {
      this.leftmostCoordinates.set(gaKey, nodeCoord);
    }

    return nodeCoord;
  }

  /**
   * 노드의 좌표 가져오기
   */
  getCoordinate(coordinate: MavenCoordinate): NodeCoordinate | undefined {
    return this.coordinates.get(coordinateToString(coordinate));
  }

  /**
   * G:A의 가장 왼쪽 좌표 가져오기
   */
  getLeftmostCoordinate(groupId: string, artifactId: string): NodeCoordinate | undefined {
    return this.leftmostCoordinates.get(`${groupId}:${artifactId}`);
  }

  /**
   * 현재 노드가 해당 G:A에서 가장 왼쪽인지 확인
   * BF 탐색에서 "왼쪽"은 먼저 큐에 들어간 것을 의미
   */
  isLeftmost(
    coordinate: MavenCoordinate,
    currentCoord: NodeCoordinate,
    parentPath: string[]
  ): boolean {
    const gaKey = coordinateToKey(coordinate);
    const leftmost = this.leftmostCoordinates.get(gaKey);

    if (!leftmost) return true;

    // 현재 좌표가 가장 왼쪽 좌표와 같거나 더 왼쪽인지
    if (currentCoord.depth < leftmost.depth) return true;
    if (currentCoord.depth === leftmost.depth) {
      return currentCoord.sequence <= leftmost.sequence;
    }

    // 깊이가 더 깊은 경우, 부모 경로의 좌표를 확인
    if (parentPath.length > 0 && leftmost.depth <= parentPath.length) {
      // 부모 경로상의 해당 깊이 노드가 leftmost보다 왼쪽인지 확인
      const parentAtDepth = parentPath[leftmost.depth - 1];
      if (parentAtDepth) {
        const parentCoord = this.coordinates.get(parentAtDepth);
        if (parentCoord && parentCoord.sequence < leftmost.sequence) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * 상태 초기화
   */
  clear(): void {
    this.sequenceGen.clear();
    this.coordinates.clear();
    this.leftmostCoordinates.clear();
  }
}

/**
 * 캐시 관리자 - 버전 충돌 및 중복 감지
 */
export class CacheManager {
  /** G:A별 해결된 버전 */
  private resolvedVersions: Map<string, string> = new Map();

  /** G:A:V별 해결 여부 */
  private resolvedArtifacts: Set<string> = new Set();

  /**
   * 해결된 버전 기록
   */
  recordResolved(coordinate: MavenCoordinate): void {
    const gaKey = coordinateToKey(coordinate);
    const gavKey = coordinateToString(coordinate);

    // 첫 번째 해결된 버전만 기록 (Nearest Definition)
    if (!this.resolvedVersions.has(gaKey)) {
      this.resolvedVersions.set(gaKey, coordinate.version);
    }

    this.resolvedArtifacts.add(gavKey);
  }

  /**
   * 버전 충돌 여부 확인
   * 같은 G:A에 다른 버전이 이미 해결됨
   */
  isVersionConflict(coordinate: MavenCoordinate): boolean {
    const gaKey = coordinateToKey(coordinate);
    const resolvedVersion = this.resolvedVersions.get(gaKey);

    if (resolvedVersion && resolvedVersion !== coordinate.version) {
      return true;
    }

    return false;
  }

  /**
   * 중복 여부 확인
   * 같은 G:A:V가 이미 해결됨
   */
  isDuplicate(coordinate: MavenCoordinate): boolean {
    const gavKey = coordinateToString(coordinate);
    return this.resolvedArtifacts.has(gavKey);
  }

  /**
   * 해결된 버전 가져오기
   */
  getResolvedVersion(groupId: string, artifactId: string): string | undefined {
    return this.resolvedVersions.get(`${groupId}:${artifactId}`);
  }

  /**
   * 상태 초기화
   */
  clear(): void {
    this.resolvedVersions.clear();
    this.resolvedArtifacts.clear();
  }
}

/**
 * Dependency Resolution Skipper
 *
 * 노드 해결 전에 충돌을 예측하여 불필요한 계산을 방지
 */
export class DependencyResolutionSkipper {
  private coordinateManager: CoordinateManager;
  private cacheManager: CacheManager;

  /** Skipper 통계 */
  private stats = {
    totalProcessed: 0,
    skippedAsVersionConflict: 0,
    skippedAsDuplicate: 0,
    forceResolved: 0,
    resolved: 0,
  };

  constructor(
    coordinateManager?: CoordinateManager,
    cacheManager?: CacheManager
  ) {
    this.coordinateManager = coordinateManager || new CoordinateManager();
    this.cacheManager = cacheManager || new CacheManager();
  }

  /**
   * 노드 해결을 건너뛸지 결정
   *
   * @param coordinate Maven 좌표
   * @param depth 현재 깊이
   * @param parentPath 부모 경로
   * @returns SkipResult
   */
  skipResolution(
    coordinate: MavenCoordinate,
    depth: number,
    parentPath: string[]
  ): SkipResult {
    this.stats.totalProcessed++;

    // 좌표 생성
    const nodeCoord = this.coordinateManager.createCoordinate(coordinate, depth);

    // 1. 버전 충돌 체크 (같은 G:A에 다른 버전이 이미 해결됨)
    if (this.cacheManager.isVersionConflict(coordinate)) {
      this.stats.skippedAsVersionConflict++;
      return {
        skip: true,
        reason: 'version_conflict',
      };
    }

    // 2. 중복 체크 (같은 G:A:V가 이미 해결됨)
    if (this.cacheManager.isDuplicate(coordinate)) {
      // 2a. 현재 노드가 더 왼쪽(먼저 선언)인 경우 - 강제 해결
      if (this.coordinateManager.isLeftmost(coordinate, nodeCoord, parentPath)) {
        this.stats.forceResolved++;
        return {
          skip: false,
          forceResolution: true,
        };
      }

      // 2b. 오른쪽인 경우 - 건너뛰기
      this.stats.skippedAsDuplicate++;
      return {
        skip: true,
        reason: 'duplicate',
      };
    }

    // 3. 새로운 의존성 - 해결 필요
    this.stats.resolved++;
    return {
      skip: false,
    };
  }

  /**
   * 해결된 노드 기록
   */
  recordResolved(coordinate: MavenCoordinate): void {
    this.cacheManager.recordResolved(coordinate);
  }

  /**
   * G:A에 대해 이미 해결된 버전 가져오기
   */
  getResolvedVersion(groupId: string, artifactId: string): string | undefined {
    return this.cacheManager.getResolvedVersion(groupId, artifactId);
  }

  /**
   * 좌표 관리자 가져오기
   */
  getCoordinateManager(): CoordinateManager {
    return this.coordinateManager;
  }

  /**
   * 캐시 관리자 가져오기
   */
  getCacheManager(): CacheManager {
    return this.cacheManager;
  }

  /**
   * 통계 가져오기
   */
  getStats(): typeof this.stats {
    return { ...this.stats };
  }

  /**
   * 상태 초기화
   */
  clear(): void {
    this.coordinateManager.clear();
    this.cacheManager.clear();
    this.stats = {
      totalProcessed: 0,
      skippedAsVersionConflict: 0,
      skippedAsDuplicate: 0,
      forceResolved: 0,
      resolved: 0,
    };
  }
}
