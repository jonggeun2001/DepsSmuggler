import { describe, expect, it } from 'vitest';
import {
  createDisplayTree,
  indexDependencyGraph,
  INITIAL_TREE_NODE_LIMIT,
  type DisplayTreeNode,
} from './dependency-tree-model';
import { getPackageArtifactKey } from '../../core/shared/dependency-tree-utils';
import type { DependencyNode, PackageInfo } from '../../types';

const node = (
  name: string,
  dependencies: DependencyNode[] = [],
  metadata?: PackageInfo['metadata']
): DependencyNode => ({ package: { type: 'maven', name, version: '1', metadata }, dependencies });
const walk = (root: DisplayTreeNode) => {
  const result: DisplayTreeNode[] = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop()!;
    result.push(current);
    stack.push(...(current.children ?? []));
  }
  return result;
};

describe('bounded dependency graph display', () => {
  it('shows all 38 edges of the 21-artifact shared DAG once instead of 2047 paths', () => {
    let children: DependencyNode[] = [];
    for (let depth = 9; depth >= 0; depth--)
      children = [node(`left-${depth}`, children), node(`right-${depth}`, children)];
    const root = node('root', children);
    const original = structuredClone(root);
    const graph = indexDependencyGraph(root);
    const display = createDisplayTree(graph);
    const nodes = walk(display.root);
    expect(graph.artifacts.size).toBe(21);
    expect(graph.edgeCount).toBe(38);
    expect(nodes).toHaveLength(39);
    expect(display.referenceCount).toBe(18);
    expect(display.hasMore).toBe(false);
    expect(nodes.filter((item) => item.reference).every((item) => !item.children?.length)).toBe(
      true
    );
    expect(
      new Set(
        nodes.flatMap((parent) =>
          (parent.children ?? []).map((child) => `${parent.name}->${child.name}`)
        )
      ).size
    ).toBe(38);
    expect(JSON.stringify(display.root)).not.toContain('originalNode');
    expect(root).toEqual(original);
    expect(root.dependencies[0].dependencies[0]).toBe(root.dependencies[1].dependencies[0]);
  });

  it('keeps relationships from distinct source contexts of the same artifact', () => {
    const first = node('shared', [node('left-only')]);
    const second = node('shared', [node('right-only')]);
    const root = node('root', [node('parent-a', [first]), node('parent-b', [second])]);
    const display = createDisplayTree(indexDependencyGraph(root));
    const shown = walk(display.root);
    expect(shown.map((item) => item.name)).toContain('left-only');
    expect(shown.map((item) => item.name)).toContain('right-only');
    const reference = shown.find((item) => item.name === 'shared' && item.reference)!;
    expect(display.lookup.get(reference.lookupId)).toBe(second);
    expect(first.dependencies.map((item) => item.package.name)).toEqual(['left-only']);
    expect(second.dependencies.map((item) => item.package.name)).toEqual(['right-only']);
  });

  it('retains version, type, and classifier identity and the untouched original node for details', () => {
    const jar = node('org:lib', [], { type: 'jar' });
    const pom = node('org:lib', [], { type: 'pom' });
    const tests = node('org:lib', [], { type: 'jar', classifier: 'tests' });
    const older = node('org:lib');
    older.package.version = '0.9';
    const root = node('root', [jar, pom, tests, older]);
    const graph = indexDependencyGraph(root);
    expect(
      new Set([jar, pom, tests, older].map((item) => getPackageArtifactKey(item.package))).size
    ).toBe(4);
    expect(graph.artifacts.size).toBe(5);
    const display = createDisplayTree(graph);
    expect(display.referenceCount).toBe(0);
    expect([...display.lookup.values()]).toEqual([root, jar, pom, tests, older]);
  });

  it('terminates a real cycle and produces a serializable tree', () => {
    const root = node('root');
    const child = node('child', [root]);
    root.dependencies.push(child);
    const display = createDisplayTree(indexDependencyGraph(root));
    expect(walk(display.root)).toHaveLength(3);
    expect(display.referenceCount).toBe(1);
    expect(() => JSON.stringify(display.root)).not.toThrow();
    expect(child.dependencies[0]).toBe(root);
  });

  it('caps deep input before library cloning and reveals a wide graph incrementally', () => {
    const deep = node('root');
    let tail = deep;
    for (let index = 0; index < 10_000; index++) {
      const next = node(`deep-${index}`);
      tail.dependencies.push(next);
      tail = next;
    }
    tail.dependencies.push(deep);
    const bounded = createDisplayTree(indexDependencyGraph(deep));
    expect(walk(bounded.root)).toHaveLength(INITIAL_TREE_NODE_LIMIT);
    expect(bounded.hasMore).toBe(true);
    expect(() => JSON.stringify(bounded.root)).not.toThrow();
    const wide = indexDependencyGraph(
      node(
        'root',
        Array.from({ length: 550 }, (_, index) => node(`leaf-${index}`))
      )
    );
    expect(createDisplayTree(wide).displayedCount).toBe(200);
    expect(createDisplayTree(wide, 400).displayedCount).toBe(400);
    expect(createDisplayTree(wide, 600)).toMatchObject({ displayedCount: 551, hasMore: false });
    expect(createDisplayTree(wide, 0).displayedCount).toBe(1);
  });
});
