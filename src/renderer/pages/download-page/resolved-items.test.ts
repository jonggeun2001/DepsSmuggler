import { describe, expect, it } from 'vitest';
import type { DownloadPackage } from '../../../core/shared/types';
import type { DependencyNode, PackageInfo } from '../../../types';
import { createResolvedDownloadItems } from './resolved-items';
import { groupDownloadItems } from './utils';

function artifact(name: string, type = 'jar', version = '1.0', classifier?: string): PackageInfo {
  return {
    type: 'maven', name: `org.example:${name}`, version,
    metadata: { type, classifier, filename: `${name}-${version}${classifier ? `-${classifier}` : ''}.${type}` },
  };
}

function download(pkg: PackageInfo, id: string): DownloadPackage {
  return { ...pkg, id, filename: typeof pkg.metadata?.filename === 'string' ? pkg.metadata.filename : undefined, size: 123 };
}

function node(pkg: PackageInfo, dependencies: DependencyNode[] = []): DependencyNode {
  return { package: pkg, dependencies };
}

describe('resolved download item presentation', () => {
  it('flatList에만 있는 부모·BOM POM을 실제 원본 ID 아래에 표시한다', () => {
    const root = artifact('root');
    const child = artifact('child');
    const parent = artifact('parent', 'pom');
    const bom = artifact('bom', 'pom');
    const original = { id: 'cart-random-id', type: 'maven', name: root.name, version: 'latest' };
    const packages = [root, child, parent, bom];
    const items = createResolvedDownloadItems({
      originalPackages: [original],
      allPackages: packages.map((pkg, index) => download(pkg, index === 0 ? original.id : `resolved-${index}`)),
      dependencyTrees: [{ root: node(root, [node(child)]), flatList: packages }],
    });

    expect(items[0]).toMatchObject({ id: original.id, isDependency: false, version: '1.0' });
    expect(items.slice(1)).toEqual(packages.slice(1).map(pkg => expect.objectContaining({
      parentId: original.id, dependencyOf: root.name, isDependency: true,
      filename: pkg.metadata?.filename, metadata: pkg.metadata, totalBytes: 123,
    })));
    expect(groupDownloadItems(items)[0].status.total).toBe(4);
  });

  it('같은 GAV의 JAR/POM/classifier 원본을 별도 그룹으로 유지하고 공유 POM은 한 번만 표시한다', () => {
    const roots = [artifact('same'), artifact('same', 'pom'), artifact('same', 'jar', '1.0', 'tests')];
    const shared = artifact('parent', 'pom');
    const own = roots.map((_, index) => artifact(`own-${index}`, 'pom'));
    const originals = roots.map((pkg, index) => download(pkg, `root-${index}`));
    const allPackages = [...originals, download(shared, 'shared'), ...own.map((pkg, i) => download(pkg, `own-${i}`))];
    const items = createResolvedDownloadItems({
      originalPackages: originals, allPackages,
      dependencyTrees: roots.map((pkg, i) => ({ root: node(pkg), flatList: [pkg, shared, own[i]] })),
    });
    expect(items.find(item => item.id === 'shared')?.parentId).toBe('root-0');
    own.forEach((_, i) => expect(items.find(item => item.id === `own-${i}`)?.parentId).toBe(`root-${i}`));
    const groups = groupDownloadItems(items);
    expect(groups).toHaveLength(3);
    expect(groups.reduce((sum, group) => sum + group.status.total, 0)).toBe(allPackages.length);
  });

  it('동일한 이름의 서로 다른 버전 원본에 올바른 POM을 연결한다', () => {
    const roots = [artifact('same', 'jar', '1.0'), artifact('same', 'jar', '2.0')];
    const parents = roots.map(pkg => artifact('parent', 'pom', pkg.version));
    const originals = roots.map((pkg, i) => download(pkg, `root-${i}`));
    const items = createResolvedDownloadItems({
      originalPackages: originals,
      allPackages: [...originals, ...parents.map((pkg, i) => download(pkg, `parent-${i}`))],
      dependencyTrees: roots.map((pkg, i) => ({ root: node(pkg), flatList: [pkg, parents[i]] })),
    });
    parents.forEach((_, i) => expect(items.find(item => item.id === `parent-${i}`)?.parentId).toBe(`root-${i}`));
  });

  it('flatList가 없는 기존 응답의 순환 트리도 반복 탐색하여 표시한다', () => {
    const root = node(artifact('root'));
    const child = node(artifact('child'));
    root.dependencies.push(child);
    child.dependencies.push(root);
    const original = download(root.package, 'root');
    const items = createResolvedDownloadItems({
      originalPackages: [original], allPackages: [original, download(child.package, 'child')],
      dependencyTrees: [{ root }],
    });
    expect(groupDownloadItems(items)[0].status.total).toBe(2);
  });

  it('원본에서 보완된 저장소 정보가 있어도 유일한 아티팩트의 부모를 찾는다', () => {
    const root = artifact('root');
    const child = artifact('child', 'pom');
    const original = { ...download(root, 'root'), indexUrl: 'https://example.invalid/repository' };
    const items = createResolvedDownloadItems({
      originalPackages: [original],
      allPackages: [original, { ...download(child, 'child'), indexUrl: original.indexUrl }],
      dependencyTrees: [{ root: node(root), flatList: [root, child] }],
    });
    expect(items[1]).toMatchObject({ parentId: 'root', indexUrl: original.indexUrl });
  });

  it('연결할 수 없는 항목도 그룹 목록에서 누락하지 않는다', () => {
    const original = download(artifact('root'), 'root');
    const orphan = download(artifact('orphan', 'pom'), 'orphan');
    const items = createResolvedDownloadItems({ originalPackages: [original], allPackages: [original, orphan] });
    items.push({ ...items[1], id: 'missing-parent', parentId: 'unknown' });
    const groups = groupDownloadItems(items);
    expect(groups.map(group => group.parent.id)).toEqual(['root', 'orphan', 'missing-parent']);
    expect(groups.reduce((sum, group) => sum + group.status.total, 0)).toBe(3);
  });
});
