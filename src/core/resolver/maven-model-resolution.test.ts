import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DependencyNode, PackageInfo } from '../../types';
import { fetchPom } from '../shared/maven-cache';
import { MavenCoordinate, PomProject } from '../shared/maven-types';
import { MavenResolver } from './maven-resolver';

vi.mock('../shared/maven-cache', async (importOriginal) => ({
  ...await importOriginal<typeof import('../shared/maven-cache')>(),
  fetchPom: vi.fn(),
}));

const fetchPomMock = vi.mocked(fetchPom);
const coordinate = (artifactId: string, version = '1.0'): MavenCoordinate => ({
  groupId: 'org.example', artifactId, version,
});

function serveModels(models: Record<string, PomProject>): void {
  fetchPomMock.mockImplementation(async (coord) => {
    const model = models[`${coord.artifactId}:${coord.version}`];
    if (!model) throw new Error(`Missing POM: ${coord.artifactId}:${coord.version}`);
    return model;
  });
}

function flatten(resolver: MavenResolver, root: DependencyNode): PackageInfo[] {
  return (resolver as unknown as {
    flattenDependencies(node: DependencyNode): PackageInfo[];
  }).flattenDependencies(root);
}

function node(name: string, type = 'jar'): DependencyNode {
  return {
    package: { type: 'maven', name: `org.example:${name}`, version: '1.0', metadata: { type } },
    dependencies: [],
    scope: 'compile',
  };
}

describe('Maven 필수 모델 POM 다운로드 목록', () => {
  beforeEach(() => {
    fetchPomMock.mockReset();
    const createClient = axios.create.bind(axios);
    vi.spyOn(axios, 'create').mockImplementation((config) => {
      const client = createClient(config);
      vi.spyOn(client, 'head').mockResolvedValue({ headers: { 'content-length': '10' } });
      return client;
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('자식이 import한 BOM으로 전이 버전을 해결하고 필요한 모델 POM을 포함한다', async () => {
    serveModels({
      'root:1.0': { dependencies: { dependency: coordinate('child') } },
      'child:1.0': {
        parent: coordinate('parent'),
        dependencyManagement: { dependencies: { dependency: {
          ...coordinate('bom'), type: 'pom', scope: 'import',
        } } },
        dependencies: { dependency: { groupId: 'org.example', artifactId: 'library' } },
      },
      'parent:1.0': { packaging: 'pom' },
      'bom:1.0': {
        packaging: 'pom',
        parent: coordinate('bom-parent'),
        dependencyManagement: { dependencies: { dependency: coordinate('library', '2.0') } },
      },
      'bom-parent:1.0': { packaging: 'pom' },
      'library:2.0': {},
    });

    const result = await new MavenResolver().resolveDependencies('org.example:root', '1.0');
    expect(result.flatList.map(p => `${p.name}@${p.version}`).sort()).toEqual([
      'org.example:bom-parent@1.0', 'org.example:bom@1.0', 'org.example:child@1.0',
      'org.example:library@2.0', 'org.example:parent@1.0', 'org.example:root@1.0',
    ]);
    expect(result.flatList.filter(p => p.metadata?.type === 'pom').map(p => p.metadata?.filename).sort())
      .toEqual(['bom-1.0.pom', 'bom-parent-1.0.pom', 'parent-1.0.pom']);
  });

  it('형제 패키지의 미사용 관리 버전이 다른 패키지의 부모 관리 버전을 오염시키지 않는다', async () => {
    serveModels({
      'root:1.0': { dependencies: { dependency: [coordinate('unused-manager'), coordinate('consumer')] } },
      'unused-manager:1.0': {
        dependencyManagement: { dependencies: { dependency: coordinate('library', '1.0') } },
      },
      'consumer:1.0': {
        parent: coordinate('consumer-parent'),
        dependencies: { dependency: { groupId: 'org.example', artifactId: 'library' } },
      },
      'consumer-parent:1.0': {
        packaging: 'pom',
        dependencyManagement: { dependencies: { dependency: coordinate('library', '2.0') } },
      },
      'library:1.0': {},
      'library:2.0': {},
    });

    const result = await new MavenResolver().resolveDependencies('org.example:root', '1.0');
    expect(result.flatList.filter(pkg => pkg.name === 'org.example:library').map(pkg => pkg.version))
      .toEqual(['2.0']);
    expect(result.flatList.find(pkg => pkg.name === 'org.example:consumer-parent')?.metadata?.type)
      .toBe('pom');
    expect(fetchPomMock.mock.calls.some(([coord]) => coord.artifactId === 'library' && coord.version === '1.0'))
      .toBe(false);
  });

  it('루트의 관리 버전이 자식의 부모 및 import BOM 관리 버전보다 우선한다', async () => {
    serveModels({
      'root:1.0': {
        dependencyManagement: { dependencies: { dependency: coordinate('library', '3.0') } },
        dependencies: { dependency: coordinate('consumer') },
      },
      'consumer:1.0': {
        parent: coordinate('consumer-parent'),
        dependencyManagement: { dependencies: { dependency: {
          ...coordinate('consumer-bom'), type: 'pom', scope: 'import',
        } } },
        dependencies: { dependency: { groupId: 'org.example', artifactId: 'library' } },
      },
      'consumer-parent:1.0': {
        packaging: 'pom',
        dependencyManagement: { dependencies: { dependency: coordinate('library', '2.0') } },
      },
      'consumer-bom:1.0': {
        packaging: 'pom',
        dependencyManagement: { dependencies: { dependency: coordinate('library', '4.0') } },
      },
      'library:2.0': {},
      'library:3.0': {},
      'library:4.0': {},
    });

    const result = await new MavenResolver().resolveDependencies('org.example:root', '1.0');
    expect(result.flatList.filter(pkg => pkg.name === 'org.example:library').map(pkg => pkg.version))
      .toEqual(['3.0']);
    expect(result.flatList.filter(pkg => pkg.metadata?.type === 'pom').map(pkg => pkg.name).sort())
      .toEqual(['org.example:consumer-bom', 'org.example:consumer-parent']);
    expect(fetchPomMock.mock.calls.filter(([coord]) => coord.artifactId === 'library')
      .every(([coord]) => coord.version === '3.0')).toBe(true);
  });

  it('같은 부모의 여러 버전을 모두 보존하고 다음 요청에는 이전 모델을 남기지 않는다', async () => {
    serveModels({
      'root:1.0': { dependencies: { dependency: [coordinate('left'), coordinate('right')] } },
      'left:1.0': { parent: coordinate('parent', '1.0') },
      'right:1.0': { parent: coordinate('parent', '2.0') },
      'parent:1.0': { packaging: 'pom' },
      'parent:2.0': { packaging: 'pom' },
      'standalone:1.0': {},
    });
    const resolver = new MavenResolver();
    const result = await resolver.resolveDependencies('org.example:root', '1.0');
    expect(result.flatList.filter(p => p.name === 'org.example:parent').map(p => p.version).sort())
      .toEqual(['1.0', '2.0']);
    const next = await resolver.resolveDependencies('org.example:standalone', '1.0');
    expect(next.flatList.map(p => p.name)).toEqual(['org.example:standalone']);
  });

  it('전이 POM 조회 실패를 의존성 없는 성공으로 처리하지 않는다', async () => {
    serveModels({ 'root:1.0': { dependencies: { dependency: coordinate('missing') } } });
    await expect(new MavenResolver().resolveDependencies('org.example:root', '1.0'))
      .rejects.toThrow(/missing/);
  });

  it('깊이 제한의 마지막 포함 아티팩트도 부모 POM을 가져온다', async () => {
    serveModels({
      'root:1.0': { dependencies: { dependency: coordinate('child') } },
      'child:1.0': {
        parent: coordinate('parent'),
        dependencies: { dependency: coordinate('grandchild') },
      },
      'parent:1.0': { packaging: 'pom' },
      'grandchild:1.0': {},
    });
    const result = await new MavenResolver().resolveDependencies('org.example:root', '1.0', { maxDepth: 1 });
    expect(result.flatList.map(p => p.name).sort())
      .toEqual(['org.example:child', 'org.example:parent', 'org.example:root']);
  });
});

describe('Maven 의존성 그래프 평탄화 안전성', () => {
  it('15000단계의 깊은 그래프를 스택 오버플로 없이 평탄화한다', () => {
    const root = node('0');
    let current = root;
    for (let i = 1; i < 15000; i++) {
      const next = node(String(i));
      current.dependencies.push(next);
      current = next;
    }
    expect(flatten(new MavenResolver(), root)).toHaveLength(15000);
  });

  it('순환과 공유 노드를 종료하면서 서로 다른 경로의 자식은 보존한다', () => {
    const root = node('root');
    const left = node('same');
    const right = node('same');
    const extra = node('extra');
    root.dependencies.push(left, right);
    left.dependencies.push(root);
    right.dependencies.push(extra, left);
    expect(flatten(new MavenResolver(), root).map(p => p.name))
      .toEqual(['org.example:root', 'org.example:same', 'org.example:extra']);
  });

  it('같은 GAV의 JAR와 POM 아티팩트를 각각 보존한다', () => {
    const root = node('root');
    root.dependencies.push(node('same', 'jar'), node('same', 'pom'));
    expect(flatten(new MavenResolver(), root)).toHaveLength(3);
  });
});
