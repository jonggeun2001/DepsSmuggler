/**
 * 의존성 트리 유틸리티 테스트
 */
import { describe, it, expect } from 'vitest';
import { DependencyNode, PackageInfo } from '../../types';
import {
  flattenDependencyTree,
  flattenMultipleDependencyTrees,
  getDependencyTreeDepth,
  getDependencyTreeSize,
} from './dependency-tree-utils';

// 테스트용 패키지 생성 헬퍼
function createPackage(name: string, version: string, type: 'pip' | 'conda' = 'pip'): PackageInfo {
  return { type, name, version };
}

// 테스트용 노드 생성 헬퍼
function createNode(pkg: PackageInfo, dependencies: DependencyNode[] = []): DependencyNode {
  return { package: pkg, dependencies };
}

describe('flattenDependencyTree', () => {
  it('단일 노드 트리를 평탄화해야 함', () => {
    const node = createNode(createPackage('requests', '2.28.0'));

    const result = flattenDependencyTree(node);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('requests');
  });

  it('중첩된 의존성을 평탄화해야 함', () => {
    const urllib3 = createNode(createPackage('urllib3', '1.26.0'));
    const chardet = createNode(createPackage('chardet', '4.0.0'));
    const requests = createNode(createPackage('requests', '2.28.0'), [urllib3, chardet]);

    const result = flattenDependencyTree(requests);

    expect(result).toHaveLength(3);
    expect(result.map((p) => p.name)).toContain('requests');
    expect(result.map((p) => p.name)).toContain('urllib3');
    expect(result.map((p) => p.name)).toContain('chardet');
  });

  it('중복 패키지를 제거해야 함', () => {
    const common = createPackage('common', '1.0.0');
    const commonNode1 = createNode(common);
    const commonNode2 = createNode(common);
    const dep1 = createNode(createPackage('dep1', '1.0.0'), [commonNode1]);
    const dep2 = createNode(createPackage('dep2', '1.0.0'), [commonNode2]);
    const root = createNode(createPackage('root', '1.0.0'), [dep1, dep2]);

    const result = flattenDependencyTree(root);

    // root, dep1, dep2, common (common은 한 번만)
    expect(result).toHaveLength(4);
    const commonCount = result.filter((p) => p.name === 'common').length;
    expect(commonCount).toBe(1);
  });

  it('대소문자를 구분하지 않고 중복 제거해야 함', () => {
    const upper = createNode(createPackage('Package', '1.0.0'));
    const lower = createNode(createPackage('package', '1.0.0'));
    const root = createNode(createPackage('root', '1.0.0'), [upper, lower]);

    const result = flattenDependencyTree(root);

    // root + package (하나만)
    expect(result).toHaveLength(2);
  });

  it('빈 의존성 배열을 처리해야 함', () => {
    const node = createNode(createPackage('solo', '1.0.0'), []);

    const result = flattenDependencyTree(node);

    expect(result).toHaveLength(1);
  });
});

describe('flattenMultipleDependencyTrees', () => {
  it('여러 트리를 병합해야 함', () => {
    const tree1 = createNode(createPackage('pkg1', '1.0.0'));
    const tree2 = createNode(createPackage('pkg2', '2.0.0'));

    const result = flattenMultipleDependencyTrees([tree1, tree2]);

    expect(result).toHaveLength(2);
  });

  it('여러 트리에서 중복을 제거해야 함', () => {
    const common = createPackage('common', '1.0.0');
    const tree1 = createNode(createPackage('pkg1', '1.0.0'), [createNode(common)]);
    const tree2 = createNode(createPackage('pkg2', '2.0.0'), [createNode(common)]);

    const result = flattenMultipleDependencyTrees([tree1, tree2]);

    // pkg1, pkg2, common (common은 한 번만)
    expect(result).toHaveLength(3);
  });

  it('빈 배열을 처리해야 함', () => {
    const result = flattenMultipleDependencyTrees([]);

    expect(result).toHaveLength(0);
  });
});

describe('getDependencyTreeDepth', () => {
  it('단일 노드 깊이는 1이어야 함', () => {
    const node = createNode(createPackage('solo', '1.0.0'));

    expect(getDependencyTreeDepth(node)).toBe(1);
  });

  it('2단계 트리 깊이는 2이어야 함', () => {
    const child = createNode(createPackage('child', '1.0.0'));
    const parent = createNode(createPackage('parent', '1.0.0'), [child]);

    expect(getDependencyTreeDepth(parent)).toBe(2);
  });

  it('불균형 트리에서 최대 깊이를 반환해야 함', () => {
    const deep = createNode(createPackage('deep', '1.0.0'));
    const mid = createNode(createPackage('mid', '1.0.0'), [deep]);
    const shallow = createNode(createPackage('shallow', '1.0.0'));
    const root = createNode(createPackage('root', '1.0.0'), [mid, shallow]);

    // root -> mid -> deep (깊이 3)
    // root -> shallow (깊이 2)
    expect(getDependencyTreeDepth(root)).toBe(3);
  });
});

describe('getDependencyTreeSize', () => {
  it('단일 노드 크기는 1이어야 함', () => {
    const node = createNode(createPackage('solo', '1.0.0'));

    expect(getDependencyTreeSize(node)).toBe(1);
  });

  it('모든 노드를 카운트해야 함', () => {
    const child1 = createNode(createPackage('child1', '1.0.0'));
    const child2 = createNode(createPackage('child2', '1.0.0'));
    const parent = createNode(createPackage('parent', '1.0.0'), [child1, child2]);

    expect(getDependencyTreeSize(parent)).toBe(3);
  });

  it('깊이 중첩된 노드도 카운트해야 함', () => {
    const level3 = createNode(createPackage('l3', '1.0.0'));
    const level2 = createNode(createPackage('l2', '1.0.0'), [level3]);
    const level1 = createNode(createPackage('l1', '1.0.0'), [level2]);
    const root = createNode(createPackage('root', '1.0.0'), [level1]);

    expect(getDependencyTreeSize(root)).toBe(4);
  });
});
