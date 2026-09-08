import { afterEach, describe, expect, it, vi } from 'vitest';
import { OSDependencyTree } from './dependency-tree';
import type { OSPackageInfo } from './types';

function pkg(name: string, overrides: Partial<OSPackageInfo> = {}): OSPackageInfo {
  return {
    name,
    version: '1.0',
    architecture: 'amd64',
    size: 100,
    location: `${name}.deb`,
    checksum: { type: 'sha256', value: 'checksum' },
    dependencies: [],
    repository: {
      id: 'main',
      name: 'Main',
      baseUrl: 'https://example.test',
      enabled: true,
      gpgCheck: false,
      isOfficial: true,
    },
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('OSDependencyTree', () => {
  it('reports a completely empty graph without errors', () => {
    const tree = new OSDependencyTree();
    expect(tree.getInstallOrder()).toEqual([]);
    expect(tree.getRootPackages()).toEqual([]);
    expect(tree.getLeafPackages()).toEqual([]);
    expect(tree.toVisualizationData()).toEqual({ nodes: [], edges: [] });
    expect(tree.getStats()).toEqual({
      totalPackages: 0,
      totalSize: 0,
      missingCount: 0,
      conflictCount: 0,
      maxDepth: 0,
    });
  });

  it('deduplicates identical nodes while preserving different versions and architectures', () => {
    const tree = new OSDependencyTree();
    const first = pkg('lib');
    tree.addNode(first);
    tree.addNode({ ...first });
    tree.addNode(pkg('lib', { version: '2.0', size: 200 }));
    tree.addNode(pkg('lib', { architecture: 'arm64', size: 300 }));
    expect(tree.hasNode({ ...first })).toBe(true);
    expect(tree.hasNode(pkg('absent'))).toBe(false);
    expect(tree.getPackageCount()).toBe(3);
    expect(tree.getTotalSize()).toBe(600);
    expect(tree.getAllPackages()[0]).toBe(first);
  });

  it('orders a diamond graph from shared dependency to roots and computes its longest depth', () => {
    const tree = new OSDependencyTree();
    const app = pkg('app');
    const left = pkg('left');
    const right = pkg('right');
    const shared = pkg('shared');
    const base = pkg('base');
    tree.addEdge(app, left, { name: 'left' });
    tree.addEdge(app, right, { name: 'right', isOptional: true });
    tree.addEdge(left, shared, { name: 'shared' });
    tree.addEdge(right, shared, { name: 'shared' });
    tree.addEdge(shared, base, { name: 'base' });

    const order = tree.getInstallOrder();
    for (const [parent, child] of [
      [app, left],
      [app, right],
      [left, shared],
      [right, shared],
      [shared, base],
    ]) {
      expect(order.indexOf(child)).toBeLessThan(order.indexOf(parent));
    }
    expect(order).toHaveLength(5);
    expect(tree.getInstallOrder()).toEqual(order);
    expect(tree.getRootPackages()).toEqual([app]);
    expect(tree.getLeafPackages()).toEqual([base]);
    expect(tree.getStats()).toMatchObject({ maxDepth: 3, totalPackages: 5, totalSize: 500 });
    expect(tree.toVisualizationData()).toEqual({
      nodes: [app, left, right, shared, base].map((node) => ({
        id: `${node.name}-1.0-amd64`,
        label: node.name,
        version: '1.0',
        size: 100,
      })),
      edges: [
        { source: 'app-1.0-amd64', target: 'left-1.0-amd64', optional: false },
        { source: 'app-1.0-amd64', target: 'right-1.0-amd64', optional: true },
        { source: 'left-1.0-amd64', target: 'shared-1.0-amd64', optional: false },
        { source: 'right-1.0-amd64', target: 'shared-1.0-amd64', optional: false },
        { source: 'shared-1.0-amd64', target: 'base-1.0-amd64', optional: false },
      ],
    });
  });

  it('keeps disconnected packages and cycles in the installation result without hanging or duplicates', () => {
    const tree = new OSDependencyTree();
    const a = pkg('a');
    const b = pkg('b');
    const independent = pkg('independent');
    tree.addEdge(a, b, { name: 'b' });
    tree.addEdge(b, a, { name: 'a' });
    tree.addNode(independent);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const order = tree.getInstallOrder();
    expect(order[0]).toBe(independent);
    expect(new Set(order)).toEqual(new Set([a, b, independent]));
    expect(order).toHaveLength(3);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Circular dependency detected'));
    expect(Number.isFinite(tree.getStats().maxDepth)).toBe(true);
  });

  it('does not lose nodes when a package depends on itself or an edge is repeated', () => {
    const self = pkg('self');
    const app = pkg('app');
    const leaf = pkg('leaf');
    const tree = new OSDependencyTree();
    tree.addEdge(self, self, { name: 'self' });
    tree.addEdge(app, leaf, { name: 'leaf' });
    tree.addEdge(app, leaf, { name: 'leaf' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const order = tree.getInstallOrder();
    expect(order).toHaveLength(3);
    expect(order.indexOf(leaf)).toBeLessThan(order.indexOf(app));
    expect(order).toContain(self);
    expect(tree.getStats().maxDepth).toBe(1);
  });

  it('retains missing dependency reasons and returns an independent result array', () => {
    const tree = new OSDependencyTree();
    const app = pkg('app');
    tree.addMissingDependency(app, { name: 'absent' });
    tree.addMissingDependency(
      app,
      { name: 'old', version: '2', operator: '>=' },
      'version_mismatch'
    );
    tree.addMissingDependency(app, { name: 'wrong-arch' }, 'architecture_mismatch');
    expect(tree.getMissingDependencies().map((missing) => missing.reason)).toEqual([
      'not_found',
      'version_mismatch',
      'architecture_mismatch',
    ]);
    expect(tree.getMissingDependencies()[1]).toEqual({
      requestedBy: app,
      dependency: { name: 'old', version: '2', operator: '>=' },
      reason: 'version_mismatch',
    });
    tree.getMissingDependencies().pop();
    expect(tree.getStats().missingCount).toBe(3);
  });

  it('merges repeated version conflicts without duplicating existing versions', () => {
    const tree = new OSDependencyTree();
    const old = pkg('lib');
    const current = pkg('lib', { version: '2.0' });
    const next = pkg('lib', { version: '3.0' });
    const firstRequester = { package: pkg('app'), requiredVersion: '1.0' };
    const nextRequester = { package: pkg('tool'), requiredVersion: '3.0' };
    tree.addConflict('lib', [old, current], [firstRequester]);
    tree.addConflict('lib', [current, next], [nextRequester]);
    expect(tree.getConflicts()).toEqual([
      {
        packageName: 'lib',
        versions: [old, current, next],
        requestedBy: [firstRequester, nextRequester],
      },
    ]);
    expect(tree.getStats().conflictCount).toBe(1);
  });
});
