// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { toPng, toSvg } from 'html-to-image';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DependencyTree from './DependencyTree';
vi.mock('html-to-image', () => ({
  toPng: vi.fn().mockResolvedValue('data:image/png;base64,test'),
  toSvg: vi.fn().mockResolvedValue('data:image/svg+xml;base64,test'),
}));
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
    render(
      <DependencyTree
        data={result(runtimeTree, [rootPackage, library, parentPom, bom, { ...parentPom }])}
        onNodeClick={onNodeClick}
      />
    );

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
    expect(onNodeClick).toHaveBeenCalledWith(
      expect.objectContaining({ package: parentPom, dependencies: [] })
    );
    expect(runtimeTree).toEqual(originalTree);
    expect(document.querySelectorAll('svg text')).toHaveLength(4);
  });

  it('같은 GAV의 JAR·POM·classifier를 서로 다른 그래프 노드로 유지한다', () => {
    const rootPackage = mavenPackage('org:root');
    const jar = mavenPackage('org:lib');
    const pom = mavenPackage('org:lib', 'pom');
    const testsJar = mavenPackage('org:lib', 'jar', 'tests');
    render(
      <DependencyTree
        data={result(node(rootPackage, [node(jar), node(pom), node(testsJar)]), [
          rootPackage,
          jar,
          pom,
          testsJar,
        ])}
      />
    );

    expect(screen.getAllByText('org:lib')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /함께 다운로드할 POM/ })).toBeNull();
  });

  it('그래프에 이미 있는 POM과 다른 패키지 타입을 추가 POM 목록에 넣지 않는다', async () => {
    const rootPackage = mavenPackage('org:root');
    const existingPom = mavenPackage('org:platform', 'pom');
    const extraPom = mavenPackage('org:root', 'pom');
    const unrelated: PackageInfo = { type: 'npm', name: 'npm-extra', version: '1.0' };
    render(
      <DependencyTree
        data={result(node(rootPackage, [node(existingPom)]), [
          rootPackage,
          existingPom,
          { ...existingPom },
          extraPom,
          unrelated,
        ])}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /함께 다운로드할 POM.*1개/ }));
    const list = await screen.findByRole('list', { name: '함께 다운로드할 POM 목록' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByText('org:root')).toBeTruthy();
    expect(within(list).queryByText('org:platform')).toBeNull();
    expect(within(list).queryByText('npm-extra')).toBeNull();
  });
  it('renders the shared DAG with references and opens the original referenced node details', async () => {
    let children: DependencyNode[] = [];
    const packages: PackageInfo[] = [];
    for (let depth = 9; depth >= 0; depth--) {
      const left = node(mavenPackage(`org:left-${depth}`), children);
      const right = node(mavenPackage(`org:right-${depth}`), children);
      packages.push(left.package, right.package);
      children = [left, right];
    }
    const root = node(mavenPackage('org:root'), children);
    const onNodeClick = vi.fn();
    render(
      <DependencyTree data={result(root, [root.package, ...packages])} onNodeClick={onNodeClick} />
    );
    expect(document.querySelectorAll('.rd3t-node,.rd3t-leaf-node')).toHaveLength(39);
    const references = screen.getAllByRole('button', { name: /참조 상세 보기/ });
    expect(references).toHaveLength(18);
    fireEvent.keyDown(references[0], { key: 'Enter' });
    expect(await screen.findByRole('dialog')).toBeTruthy();
    const selected = onNodeClick.mock.calls[0][0] as DependencyNode;
    expect(packages).toContain(selected.package);
    expect(selected.dependencies.length).toBeGreaterThan(0);
  });

  it('starts with 200 nodes, expands on demand and resets the limit for a new result', async () => {
    const wide = () => {
      const root = node(
        mavenPackage('org:root'),
        Array.from({ length: 230 }, (_, index) => node(mavenPackage(`org:leaf-${index}`)))
      );
      return result(root, [root.package, ...root.dependencies.map((item) => item.package)]);
    };
    const first = wide();
    const { rerender } = render(<DependencyTree data={first} />);
    expect(document.querySelectorAll('.rd3t-node,.rd3t-leaf-node')).toHaveLength(200);
    fireEvent.click(screen.getByRole('button', { name: '200개 더 표시' }));
    expect(document.querySelectorAll('.rd3t-node,.rd3t-leaf-node')).toHaveLength(231);
    expect(screen.queryByRole('button', { name: '200개 더 표시' })).toBeNull();
    rerender(<DependencyTree data={wide()} />);
    await waitFor(() =>
      expect(document.querySelectorAll('.rd3t-node,.rd3t-leaf-node')).toHaveLength(200)
    );
    expect(first.flatList).toHaveLength(231);
  });

  it('exports the current viewport including reference marks and the displayed scope', async () => {
    const shared = node(mavenPackage('org:shared'));
    const root = node(mavenPackage('org:root'), [
      node(mavenPackage('org:a'), [shared]),
      node(mavenPackage('org:b'), [shared]),
    ]);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<DependencyTree data={result(root, [root.package, shared.package])} />);
    fireEvent.click(screen.getByRole('button', { name: 'PNG 저장' }));
    fireEvent.click(screen.getByRole('button', { name: 'SVG 저장' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(2));
    for (const exporter of [toPng, toSvg]) {
      const captured = vi.mocked(exporter).mock.calls[0][0];
      expect(captured.querySelectorAll('.rd3t-node,.rd3t-leaf-node')).toHaveLength(5);
      expect(captured.textContent).toContain('↗ 참조');
      expect(captured.textContent).toContain('현재 표시 영역');
      expect(captured.textContent).toContain('표시 항목 5/5개');
    }
  });
});
