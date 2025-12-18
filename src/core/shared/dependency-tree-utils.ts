/**
 * 의존성 트리 조작 유틸리티
 */
import { DependencyNode, PackageInfo } from '../../types';

/**
 * DependencyNode 트리를 순회하여 모든 PackageInfo를 평탄화합니다.
 * 중복된 패키지(name@version)는 한 번만 포함됩니다.
 * 반복문 기반으로 구현하여 call stack 문제 방지.
 *
 * @param node 루트 DependencyNode
 * @returns 중복 제거된 PackageInfo 배열
 */
export function flattenDependencyTree(node: DependencyNode): PackageInfo[] {
  const result: Map<string, PackageInfo> = new Map();
  const stack: DependencyNode[] = [node];
  const visited: Set<DependencyNode> = new Set(); // 객체 참조로 순환 방지

  while (stack.length > 0) {
    const current = stack.pop()!;

    // 이미 방문한 노드 객체는 스킵 (순환 참조 방지)
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    const key = `${current.package.name.toLowerCase()}@${current.package.version}`;
    if (!result.has(key)) {
      result.set(key, current.package);
    }

    // 자식 노드들을 스택에 추가
    for (const child of current.dependencies) {
      if (!visited.has(child)) {
        stack.push(child);
      }
    }
  }

  return Array.from(result.values());
}

/**
 * 여러 DependencyNode 트리를 병합하여 평탄화합니다.
 * 반복문 기반으로 구현하여 call stack 문제 방지.
 *
 * @param nodes DependencyNode 배열
 * @returns 중복 제거된 PackageInfo 배열
 */
export function flattenMultipleDependencyTrees(nodes: DependencyNode[]): PackageInfo[] {
  const result: Map<string, PackageInfo> = new Map();
  const stack: DependencyNode[] = [...nodes];
  const visited: Set<DependencyNode> = new Set();

  while (stack.length > 0) {
    const current = stack.pop()!;

    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    const key = `${current.package.name.toLowerCase()}@${current.package.version}`;
    if (!result.has(key)) {
      result.set(key, current.package);
    }

    for (const child of current.dependencies) {
      if (!visited.has(child)) {
        stack.push(child);
      }
    }
  }

  return Array.from(result.values());
}

/**
 * DependencyNode 트리의 깊이를 계산합니다.
 * 반복문 기반 BFS로 구현하여 call stack 문제 방지.
 *
 * @param node 루트 DependencyNode
 * @returns 트리의 최대 깊이
 */
export function getDependencyTreeDepth(node: DependencyNode): number {
  let maxDepth = 0;
  const queue: Array<{ node: DependencyNode; depth: number }> = [{ node, depth: 1 }];
  const visited: Set<DependencyNode> = new Set();

  while (queue.length > 0) {
    const { node: current, depth } = queue.shift()!;

    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    maxDepth = Math.max(maxDepth, depth);

    for (const child of current.dependencies) {
      if (!visited.has(child)) {
        queue.push({ node: child, depth: depth + 1 });
      }
    }
  }

  return maxDepth;
}

/**
 * DependencyNode 트리의 총 노드 수를 계산합니다.
 * 반복문 기반으로 구현하여 call stack 문제 방지.
 *
 * @param node 루트 DependencyNode
 * @returns 총 노드 수 (중복 제외)
 */
export function getDependencyTreeSize(node: DependencyNode): number {
  const stack: DependencyNode[] = [node];
  const visited: Set<DependencyNode> = new Set();

  while (stack.length > 0) {
    const current = stack.pop()!;

    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    for (const child of current.dependencies) {
      if (!visited.has(child)) {
        stack.push(child);
      }
    }
  }

  return visited.size;
}
