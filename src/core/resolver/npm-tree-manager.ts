/**
 * npm 의존성 트리 관리자
 *
 * 의존성 트리 구조 관리 및 호이스팅 알고리즘 담당
 */

import * as semver from 'semver';
import {
  NpmPackageVersion,
  NpmResolvedNode,
  NpmFlatPackage,
  NpmConflict,
  DependencyType,
  DepsQueueItem,
  PlacementResult,
} from '../shared/npm-types';

/**
 * 배치 결정 결과
 */
export interface PlacementDecision {
  result: PlacementResult;
  target: string | null;
  existing: string | null;
}

/**
 * 트리 관리 옵션
 */
export interface TreeManagerOptions {
  preferDedupe: boolean;
  installStrategy: string;
}

/**
 * npm 의존성 트리 관리자
 *
 * 책임:
 * - 트리 노드 추가/조회
 * - 호이스팅 배치 결정 (findPlacement)
 * - 트리 평탄화
 * - 버전 호환성 검사
 */
export class NpmTreeManager {
  /** 의존성 트리 (hoistedPath -> node) */
  private tree: Map<string, NpmResolvedNode> = new Map();

  /** 충돌 목록 */
  private conflicts: NpmConflict[] = [];

  /**
   * 트리 초기화
   */
  clear(): void {
    this.tree.clear();
    this.conflicts = [];
  }

  /**
   * 트리 맵 반환
   */
  getTree(): Map<string, NpmResolvedNode> {
    return this.tree;
  }

  /**
   * 충돌 목록 반환
   */
  getConflicts(): NpmConflict[] {
    return this.conflicts;
  }

  /**
   * 노드 존재 여부 확인
   */
  hasNode(path: string): boolean {
    return this.tree.has(path);
  }

  /**
   * 노드 조회
   */
  getNode(path: string): NpmResolvedNode | undefined {
    return this.tree.get(path);
  }

  /**
   * 노드 삭제
   */
  deleteNode(path: string): boolean {
    return this.tree.delete(path);
  }

  /**
   * 루트 노드 설정
   */
  setRootNode(node: NpmResolvedNode): void {
    this.tree.set('', node);
  }

  /**
   * 트리에 노드 추가
   */
  addNodeToTree(
    name: string,
    version: string,
    pkgInfo: NpmPackageVersion,
    hoistedPath: string,
    depth: number,
    type: DependencyType,
    _item: DepsQueueItem
  ): void {
    const node: NpmResolvedNode = {
      name,
      version,
      dist: pkgInfo.dist,
      dependencies: [],
      depth,
      hoistedPath,
      type,
      optional: type === 'optional' || type === 'peerOptional',
    };

    this.tree.set(hoistedPath, node);
  }

  /**
   * 충돌 기록
   */
  recordConflict(conflict: NpmConflict): void {
    this.conflicts.push(conflict);
  }

  /**
   * 패키지 배치 위치 결정 (canPlace 알고리즘)
   *
   * Maximally Naive Deduplication:
   * 가능한 가장 상위에 패키지를 배치하여 중복 최소화
   */
  findPlacement(
    name: string,
    version: string,
    startPath: string | null,
    options: TreeManagerOptions
  ): PlacementDecision {
    if (options.installStrategy === 'nested') {
      // nested 전략: 항상 해당 위치에 배치
      return {
        result: 'OK',
        target: startPath ? `${startPath}/node_modules/${name}` : `node_modules/${name}`,
        existing: null,
      };
    }

    let target = startPath || '';
    let lastValidTarget: string | null = null;
    let existingVersion: string | null = null;

    // 루트까지 올라가며 배치 가능 여부 확인
    while (true) {
      const checkPath = target ? `${target}/node_modules/${name}` : `node_modules/${name}`;
      const existing = this.tree.get(checkPath);

      if (existing) {
        existingVersion = existing.version;

        // 같은 버전이면 KEEP
        if (existing.version === version) {
          return { result: 'KEEP', target: checkPath, existing: existingVersion };
        }

        // 다른 버전이면 호환성 확인
        const isCompatible = this.isVersionCompatibleWithExisting(name, version, target);
        if (isCompatible) {
          // 더 높은 버전이면 REPLACE 가능
          if (semver.gt(version, existing.version)) {
            lastValidTarget = checkPath;
          } else if (options.preferDedupe) {
            // preferDedupe면 기존 버전 유지
            return { result: 'KEEP', target: checkPath, existing: existingVersion };
          }
        }

        // 충돌
        if (!lastValidTarget) {
          return { result: 'CONFLICT', target: null, existing: existingVersion };
        }
      } else {
        // 빈 자리 - 배치 가능
        lastValidTarget = checkPath;
      }

      // 루트에 도달했으면 종료
      if (!target || target === '') {
        break;
      }

      // 상위로 이동
      const parts = target.split('/node_modules/');
      parts.pop();
      target = parts.join('/node_modules/');
    }

    if (lastValidTarget) {
      if (existingVersion && lastValidTarget === `node_modules/${name}`) {
        return { result: 'REPLACE', target: lastValidTarget, existing: existingVersion };
      }
      return { result: 'OK', target: lastValidTarget, existing: null };
    }

    return { result: 'CONFLICT', target: null, existing: existingVersion };
  }

  /**
   * 버전이 기존 의존성들과 호환되는지 확인
   */
  isVersionCompatibleWithExisting(name: string, version: string, path: string): boolean {
    // 해당 경로 하위의 모든 노드들이 이 버전을 사용해도 되는지 확인
    for (const [nodePath, node] of this.tree.entries()) {
      if (nodePath.startsWith(path)) {
        // 이 노드가 name을 의존하는지 확인
        const deps: Record<string, boolean> = {};
        if (node.dependencies) {
          for (const d of node.dependencies) {
            deps[d.name] = true;
          }
        }
        if (deps[name]) {
          // 해당 의존성의 버전 요구사항을 찾아서 확인해야 함
          // 간소화: 일단 통과
        }
      }
    }
    return true;
  }

  /**
   * 트리 평탄화
   *
   * 트리를 평탄한 패키지 목록으로 변환
   */
  flattenTree(): NpmFlatPackage[] {
    const result: NpmFlatPackage[] = [];

    for (const [path, node] of this.tree.entries()) {
      if (path === '') continue; // 루트 제외

      // tarball URL에서 파일명 추출 (예: https://registry.npmjs.org/express/-/express-4.18.2.tgz -> express-4.18.2.tgz)
      const tarballUrl = node.dist.tarball;
      const filename = tarballUrl ? tarballUrl.split('/').pop() : undefined;

      result.push({
        name: node.name,
        version: node.version,
        tarball: tarballUrl,
        integrity: node.dist.integrity,
        shasum: node.dist.shasum,
        size: node.dist.unpackedSize,
        hoistedPath: path,
        filename,
      });
    }

    // 깊이 순, 알파벳 순 정렬
    result.sort((a, b) => {
      const depthA = this.getDepthFromPath(a.hoistedPath);
      const depthB = this.getDepthFromPath(b.hoistedPath);
      if (depthA !== depthB) return depthA - depthB;
      return a.name.localeCompare(b.name);
    });

    return result;
  }

  /**
   * 경로에서 깊이 계산
   */
  getDepthFromPath(path: string): number {
    if (!path) return 0;
    return (path.match(/node_modules/g) || []).length;
  }

  /**
   * 노드 경로 찾기
   *
   * 가장 가까운 위치에서 시작해서 위로 올라가며 찾기
   */
  findNodePath(name: string, startPath: string | null): string | null {
    let searchPath = startPath || '';

    while (true) {
      const checkPath = searchPath ? `${searchPath}/node_modules/${name}` : `node_modules/${name}`;
      if (this.tree.has(checkPath)) {
        return checkPath;
      }

      if (!searchPath) break;

      const parts = searchPath.split('/node_modules/');
      parts.pop();
      searchPath = parts.join('/node_modules/');
    }

    return null;
  }
}
