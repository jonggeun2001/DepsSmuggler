/**
 * 의존성 트리 조작 유틸리티
 */
import { DependencyNode, PackageInfo } from '../../types';

/**
 * DependencyNode 트리를 순회하여 모든 PackageInfo를 평탄화합니다.
 * 중복된 패키지(name@version)는 한 번만 포함됩니다.
 *
 * @param node 루트 DependencyNode
 * @returns 중복 제거된 PackageInfo 배열
 */
export function flattenDependencyTree(node: DependencyNode): PackageInfo[] {
  const result: Map<string, PackageInfo> = new Map();

  const traverse = (n: DependencyNode) => {
    const key = `${n.package.name.toLowerCase()}@${n.package.version}`;
    if (!result.has(key)) {
      result.set(key, n.package);
      n.dependencies.forEach(traverse);
    }
  };

  traverse(node);
  return Array.from(result.values());
}

/**
 * 여러 DependencyNode 트리를 병합하여 평탄화합니다.
 *
 * @param nodes DependencyNode 배열
 * @returns 중복 제거된 PackageInfo 배열
 */
export function flattenMultipleDependencyTrees(nodes: DependencyNode[]): PackageInfo[] {
  const result: Map<string, PackageInfo> = new Map();

  const traverse = (n: DependencyNode) => {
    const key = `${n.package.name.toLowerCase()}@${n.package.version}`;
    if (!result.has(key)) {
      result.set(key, n.package);
      n.dependencies.forEach(traverse);
    }
  };

  nodes.forEach(traverse);
  return Array.from(result.values());
}

/**
 * DependencyNode 트리의 깊이를 계산합니다.
 *
 * @param node 루트 DependencyNode
 * @returns 트리의 최대 깊이
 */
export function getDependencyTreeDepth(node: DependencyNode): number {
  if (node.dependencies.length === 0) {
    return 1;
  }

  const childDepths = node.dependencies.map((child) => getDependencyTreeDepth(child));
  return 1 + Math.max(...childDepths);
}

/**
 * DependencyNode 트리의 총 노드 수를 계산합니다.
 *
 * @param node 루트 DependencyNode
 * @returns 총 노드 수
 */
export function getDependencyTreeSize(node: DependencyNode): number {
  let count = 1;
  for (const child of node.dependencies) {
    count += getDependencyTreeSize(child);
  }
  return count;
}
