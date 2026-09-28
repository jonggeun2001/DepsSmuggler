import { getPackageArtifactKey } from '../../core/shared/dependency-tree-utils';
import type { DependencyNode, PackageType } from '../../types';
import type { RawNodeDatum } from 'react-d3-tree';

export const INITIAL_TREE_NODE_LIMIT = 200;

interface ArtifactNode {
  original: DependencyNode;
  children: Map<string, DependencyNode>;
}
export interface DependencyGraph {
  rootKey: string;
  artifacts: Map<string, ArtifactNode>;
  edgeCount: number;
}
export interface DisplayTreeNode extends RawNodeDatum {
  name: string;
  lookupId: string;
  reference: boolean;
  attributes: {
    version: string;
    type: PackageType;
    optional?: boolean;
    scope?: string;
    size?: number;
    artifactType?: string;
    classifier?: string;
  };
  children?: DisplayTreeNode[];
}

/** Visit source objects once; merge artifact edges without changing the resolver graph. */
export function indexDependencyGraph(root: DependencyNode): DependencyGraph {
  const artifacts = new Map<string, ArtifactNode>();
  const visited = new Set<DependencyNode>();
  const stack = [root];
  let edgeCount = 0;
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (visited.has(node)) continue;
    visited.add(node);
    const key = getPackageArtifactKey(node.package);
    let artifact = artifacts.get(key);
    if (!artifact) {
      artifact = { original: node, children: new Map() };
      artifacts.set(key, artifact);
    }
    for (const child of node.dependencies) {
      const childKey = getPackageArtifactKey(child.package);
      if (!artifact.children.has(childKey)) {
        artifact.children.set(childKey, child);
        edgeCount++;
      }
    }
    for (let index = node.dependencies.length - 1; index >= 0; index--) {
      if (!visited.has(node.dependencies[index])) stack.push(node.dependencies[index]);
    }
  }
  return { rootKey: getPackageArtifactKey(root.package), artifacts, edgeCount };
}

/** DTO contains no source graph: react-d3-tree can safely clone this bounded, acyclic tree. */
export function createDisplayTree(graph: DependencyGraph, limit = INITIAL_TREE_NODE_LIMIT) {
  const lookup = new Map<string, DependencyNode>();
  const expanded = new Set<string>([graph.rootKey]);
  const budget = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : INITIAL_TREE_NODE_LIMIT;
  let referenceCount = 0;
  const datum = (node: DependencyNode, reference: boolean): DisplayTreeNode => {
    const lookupId = String(lookup.size);
    lookup.set(lookupId, node);
    if (reference) referenceCount++;
    const metadata = node.package.metadata;
    return {
      name: node.package.name,
      lookupId,
      reference,
      attributes: {
        version: node.package.version,
        type: node.package.type,
        optional: node.optional,
        scope: node.scope,
        size: metadata?.size,
        artifactType: typeof metadata?.type === 'string' ? metadata.type : undefined,
        classifier: typeof metadata?.classifier === 'string' ? metadata.classifier : undefined,
      },
    };
  };
  const root = datum(graph.artifacts.get(graph.rootKey)!.original, false);
  const queue = [{ key: graph.rootKey, datum: root }];
  for (let cursor = 0; cursor < queue.length && lookup.size < budget; cursor++) {
    const current = queue[cursor];
    for (const [key, original] of graph.artifacts.get(current.key)!.children) {
      if (lookup.size >= budget) break;
      const reference = expanded.has(key);
      const child = datum(original, reference);
      (current.datum.children ??= []).push(child);
      if (!reference) {
        expanded.add(key);
        queue.push({ key, datum: child });
      }
    }
  }
  return {
    root,
    lookup,
    displayedCount: lookup.size,
    totalCount: graph.edgeCount + 1,
    referenceCount,
    hasMore: lookup.size < graph.edgeCount + 1,
  };
}
