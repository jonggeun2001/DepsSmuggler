// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DependencyTree from './DependencyTree';
import type { DependencyNode, DependencyResolutionResult, PackageInfo } from '../../types';

function mavenPackage(name: string, artifactType = 'jar', classifier?: string): PackageInfo {
  return {
    type: 'maven',
    name,
    version: '1.0',
    metadata: {
      type: artifactType,
      filename: `${name.split(':')[1]}-1.0${classifier ? `-${classifier}` : ''}.${artifactType}`,
      ...(classifier ? { classifier } : {}),
    },
  };
}

function node(pkg: PackageInfo, dependencies: DependencyNode[] = []): DependencyNode {
  return { package: pkg, dependencies };
}

function result(root: DependencyNode, flatList: PackageInfo[]): DependencyResolutionResult {
  return { root, flatList, conflicts: [], totalSize: 0 };
}

describe('DependencyTree의 Maven POM 미리보기', () => {
  beforeEach(() => {
    const getComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => getComputedStyle(element));
    // jsdom does not implement SVG layout/transform APIs used by d3 zoom.
    Object.defineProperties(SVGElement.prototype, {
      width: { configurable: true, value: { baseVal: { value: 800 } } },
      height: { configurable: true, value: { baseVal: { value: 500 } } },
      transform: { configurable: true, value: { baseVal: { consolidate: () => null } } },
    });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('그래프 밖 부모·BOM POM을 중복 없이 펼쳐 보고 파일 상세를 확인한다', async () => {
    const rootPackage = mavenPackage('org:root');
    const library = mavenPackage('org:lib');
    const parentPom = mavenPackage('org:parent', 'pom');
    const bom = mavenPackage('org:bom', 'pom');
    const runtimeTree = node(rootPackage, [node(library)]);
    const originalTree = structuredClone(runtimeTree);
    const onNodeClick = vi.fn();
    render(<DependencyTree data={result(runtimeTree, [rootPackage, library, parentPom, bom, { ...parentPom }])} onNodeClick={onNodeClick} />);

    const toggle = screen.getByRole('button', { name: /함께 다운로드할 POM.*2개/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    const list = await screen.findByRole('list', { name: '함께 다운로드할 POM 목록' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getAllByText('POM')).toHaveLength(2);
    expect(within(list).getAllByText('1.0')).toHaveLength(2);
    expect(within(list).getByText('org:parent')).toBeTruthy();
    expect(within(list).getByText('org:bom')).toBeTruthy();
    fireEvent.click(within(list).getByRole('button', { name: 'parent-1.0.pom 상세 보기' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('parent-1.0.pom')).toBeTruthy();
    expect(within(dialog).getByText('POM')).toBeTruthy();
    expect(onNodeClick).toHaveBeenCalledWith(expect.objectContaining({ package: parentPom, dependencies: [] }));
    expect(runtimeTree).toEqual(originalTree);
    expect(document.querySelectorAll('svg text')).toHaveLength(4);
  });

  it('같은 GAV의 JAR·POM·classifier를 서로 다른 그래프 노드로 유지한다', () => {
    const rootPackage = mavenPackage('org:root');
    const jar = mavenPackage('org:lib');
    const pom = mavenPackage('org:lib', 'pom');
    const testsJar = mavenPackage('org:lib', 'jar', 'tests');
    render(<DependencyTree data={result(node(rootPackage, [node(jar), node(pom), node(testsJar)]), [rootPackage, jar, pom, testsJar])} />);

    expect(screen.getAllByText('org:lib')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /함께 다운로드할 POM/ })).toBeNull();
  });

  it('그래프에 이미 있는 POM과 다른 패키지 타입을 추가 POM 목록에 넣지 않는다', async () => {
    const rootPackage = mavenPackage('org:root');
    const existingPom = mavenPackage('org:platform', 'pom');
    const extraPom = mavenPackage('org:root', 'pom');
    const unrelated: PackageInfo = { type: 'npm', name: 'npm-extra', version: '1.0' };
    render(<DependencyTree data={result(node(rootPackage, [node(existingPom)]), [rootPackage, existingPom, { ...existingPom }, extraPom, unrelated])} />);

    fireEvent.click(screen.getByRole('button', { name: /함께 다운로드할 POM.*1개/ }));
    const list = await screen.findByRole('list', { name: '함께 다운로드할 POM 목록' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByText('org:root')).toBeTruthy();
    expect(within(list).queryByText('org:platform')).toBeNull();
    expect(within(list).queryByText('npm-extra')).toBeNull();
  });
});
