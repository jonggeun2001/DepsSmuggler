import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MavenQueueProcessor,
  MavenResolutionContext,
  QueueProcessorDependencies,
} from './maven-queue-processor';
import { MavenResolver } from './maven-resolver';
import { DependencyNode, PackageInfo } from '../../types';
import { fetchPom } from '../shared/maven-cache';
import { DependencyProcessingContext, MavenCoordinate, PomProject } from '../shared/maven-types';

vi.mock('../shared/maven-cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/maven-cache')>()),
  fetchPom: vi.fn(),
}));

const fetchPomMock = vi.mocked(fetchPom);
const coordinate = (artifactId: string, version = '1.0'): MavenCoordinate => ({
  groupId: 'org.example',
  artifactId,
  version,
});

function serveModels(models: Record<string, PomProject>): void {
  fetchPomMock.mockImplementation(async (coord) => {
    const model = models[`${coord.artifactId}:${coord.version}`];
    if (!model) throw new Error(`Missing POM: ${coord.artifactId}:${coord.version}`);
    return model;
  });
}

function flatten(resolver: MavenResolver, root: DependencyNode): PackageInfo[] {
  return (
    resolver as unknown as {
      flattenDependencies(node: DependencyNode): PackageInfo[];
    }
  ).flattenDependencies(root);
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
        dependencyManagement: {
          dependencies: {
            dependency: {
              ...coordinate('bom'),
              type: 'pom',
              scope: 'import',
            },
          },
        },
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
    expect(result.flatList.map((p) => `${p.name}@${p.version}`).sort()).toEqual([
      'org.example:bom-parent@1.0',
      'org.example:bom@1.0',
      'org.example:child@1.0',
      'org.example:library@2.0',
      'org.example:parent@1.0',
      'org.example:root@1.0',
    ]);
    expect(
      result.flatList
        .filter((p) => p.metadata?.type === 'pom')
        .map((p) => p.metadata?.filename)
        .sort()
    ).toEqual(['bom-1.0.pom', 'bom-parent-1.0.pom', 'parent-1.0.pom']);
  });

  it('형제 패키지의 미사용 관리 버전이 다른 패키지의 부모 관리 버전을 오염시키지 않는다', async () => {
    serveModels({
      'root:1.0': {
        dependencies: { dependency: [coordinate('unused-manager'), coordinate('consumer')] },
      },
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
    expect(
      result.flatList.filter((pkg) => pkg.name === 'org.example:library').map((pkg) => pkg.version)
    ).toEqual(['2.0']);
    expect(
      result.flatList.find((pkg) => pkg.name === 'org.example:consumer-parent')?.metadata?.type
    ).toBe('pom');
    expect(
      fetchPomMock.mock.calls.some(
        ([coord]) => coord.artifactId === 'library' && coord.version === '1.0'
      )
    ).toBe(false);
  });

  it('자식 모델 버전과 해당 의존성에 적용되는 루트 관리 버전을 함께 반입한다', async () => {
    serveModels({
      'root:1.0': {
        dependencyManagement: { dependencies: { dependency: coordinate('library', '3.0') } },
        dependencies: { dependency: coordinate('consumer') },
      },
      'consumer:1.0': {
        parent: coordinate('consumer-parent'),
        dependencyManagement: {
          dependencies: {
            dependency: {
              ...coordinate('consumer-bom'),
              type: 'pom',
              scope: 'import',
            },
          },
        },
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
    expect(
      result.flatList.filter((pkg) => pkg.name === 'org.example:library').map((pkg) => pkg.version)
    ).toEqual(['2.0', '3.0']);
    expect(
      result.flatList
        .filter((pkg) => pkg.metadata?.type === 'pom')
        .map((pkg) => pkg.name)
        .sort()
    ).toEqual(['org.example:consumer-bom', 'org.example:consumer-parent']);
    expect(
      fetchPomMock.mock.calls
        .filter(([coord]) => coord.artifactId === 'library')
        .some(([coord]) => coord.version === '4.0')
    ).toBe(false);
  });

  it('자식에 버전이 없고 루트에만 관리 버전이 있으면 해당 버전도 반입한다', async () => {
    serveModels({
      'root:1.0': {
        dependencyManagement: { dependencies: { dependency: coordinate('library', '3.0') } },
        dependencies: { dependency: coordinate('consumer') },
      },
      'consumer:1.0': {
        dependencies: { dependency: { groupId: 'org.example', artifactId: 'library' } },
      },
      'library:3.0': {},
    });
    const result = await new MavenResolver().resolveDependencies('org.example:root', '1.0');
    expect(
      result.flatList.some((p) => p.name === 'org.example:library' && p.version === '3.0')
    ).toBe(true);
  });

  it('일반 JAR 관리 버전을 다른 type/classifier에 적용하지 않는다', async () => {
    serveModels({
      'root:1.0': {
        dependencyManagement: { dependencies: { dependency: coordinate('library', '2.0') } },
        dependencies: { dependency: coordinate('consumer') },
      },
      'consumer:1.0': { dependencies: { dependency: [
        { ...coordinate('library'), classifier: 'linux' },
        { ...coordinate('library'), type: 'pom' },
      ] } },
      'library:1.0': {},
    });
    const result = await new MavenResolver().resolveDependencies('org.example:root', '1.0');
    expect(result.flatList.filter(p => p.name === 'org.example:library').map(p => p.metadata?.filename).sort())
      .toEqual(['library-1.0-linux.jar', 'library-1.0.pom']);
    expect(fetchPomMock.mock.calls.some(([coord]) => coord.artifactId === 'library' && coord.version === '2.0')).toBe(false);
  });

  it('일치하는 classifier 관리 버전과 선언 버전은 함께 보존한다', async () => {
    serveModels({
      'root:1.0': {
        dependencyManagement: { dependencies: { dependency: { ...coordinate('library', '2.0'), classifier: 'linux' } } },
        dependencies: { dependency: coordinate('consumer') },
      },
      'consumer:1.0': { dependencies: { dependency: { ...coordinate('library'), classifier: 'linux' } } },
      'library:1.0': {},
      'library:2.0': {},
    });
    const result = await new MavenResolver().resolveDependencies('org.example:root', '1.0');
    expect(result.flatList.filter(p => p.name === 'org.example:library').map(p => p.metadata?.filename).sort())
      .toEqual(['library-1.0-linux.jar', 'library-2.0-linux.jar']);
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
    expect(
      result.flatList
        .filter((p) => p.name === 'org.example:parent')
        .map((p) => p.version)
        .sort()
    ).toEqual(['1.0', '2.0']);
    const next = await resolver.resolveDependencies('org.example:standalone', '1.0');
    expect(next.flatList.map((p) => p.name)).toEqual(['org.example:standalone']);
  });

  it('전이 POM 조회 실패를 의존성 없는 성공으로 처리하지 않는다', async () => {
    serveModels({ 'root:1.0': { dependencies: { dependency: coordinate('missing') } } });
    await expect(
      new MavenResolver().resolveDependencies('org.example:root', '1.0')
    ).rejects.toThrow(/missing/);
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
    const result = await new MavenResolver().resolveDependencies('org.example:root', '1.0', {
      maxDepth: 1,
    });
    expect(result.flatList.map((p) => p.name).sort()).toEqual([
      'org.example:child',
      'org.example:parent',
      'org.example:root',
    ]);
  });

  it('충돌하는 모든 버전과 하위 의존성의 JAR 및 필수 모델 POM을 보존한다', async () => {
    serveModels({
      'root:1.0': {
        dependencies: { dependency: [coordinate('winner'), coordinate('loser')] },
      },
      'winner:1.0': {
        dependencies: {
          dependency: {
            groupId: 'org.example',
            artifactId: 'shared',
            version: '2.0',
          },
        },
      },
      'loser:1.0': {
        dependencies: { dependency: coordinate('loser-parent') },
      },
      'loser-parent:1.0': {
        dependencies: {
          dependency: {
            groupId: 'org.example',
            artifactId: 'shared',
            version: '1.0',
          },
        },
      },
      'shared:2.0': {},
      'shared:1.0': {
        parent: coordinate('descriptor-parent'),
        dependencyManagement: {
          dependencies: {
            dependency: {
              ...coordinate('descriptor-bom'),
              type: 'pom',
              scope: 'import',
            },
          },
        },
        dependencies: { dependency: coordinate('loser-leaf') },
      },
      'descriptor-parent:1.0': { packaging: 'pom' },
      'descriptor-bom:1.0': {
        packaging: 'pom',
        dependencyManagement: { dependencies: { dependency: coordinate('loser-leaf') } },
      },
      'loser-leaf:1.0': {},
    });

    const result = await new MavenResolver().resolveDependencies('org.example:root', '1.0');
    const sharedVersions = result.flatList
      .filter((pkg) => pkg.name === 'org.example:shared')
      .map((pkg) => ({ version: pkg.version, type: pkg.metadata?.type }));

    expect(sharedVersions).toEqual([
      { version: '2.0', type: undefined },
      { version: '1.0', type: undefined },
    ]);
    expect(result.flatList).toContainEqual(
      expect.objectContaining({
        name: 'org.example:loser-leaf',
        version: '1.0',
        metadata: expect.objectContaining({ filename: expect.stringMatching(/\.jar$/) }),
      })
    );
    expect(
      result.flatList
        .filter((pkg) => pkg.metadata?.type === 'pom')
        .map((pkg) => pkg.name)
        .sort()
    ).toEqual(['org.example:descriptor-bom', 'org.example:descriptor-parent']);
    expect(result.conflicts).toContainEqual(
      expect.objectContaining({
        packageName: 'org.example:shared',
        versions: expect.arrayContaining(['1.0', '2.0']),
      })
    );
  });

  it('충돌로 생략된 descriptor를 조회할 수 없으면 해결에 실패한다', async () => {
    serveModels({
      'root:1.0': {
        dependencies: { dependency: [coordinate('winner'), coordinate('loser')] },
      },
      'winner:1.0': {
        dependencies: {
          dependency: {
            groupId: 'org.example',
            artifactId: 'shared',
            version: '2.0',
          },
        },
      },
      'loser:1.0': {
        dependencies: {
          dependency: {
            groupId: 'org.example',
            artifactId: 'shared',
            version: '1.0',
          },
        },
      },
      'shared:2.0': {},
    });

    await expect(
      new MavenResolver().resolveDependencies('org.example:root', '1.0')
    ).rejects.toThrow('shared:1.0');
  });

  it('같은 버전을 제한된 경로와 전체 경로에서 만나면 자손 JAR의 합집합을 보존한다', async () => {
    serveModels({
      'root:1.0': {
        dependencies: {
          dependency: [coordinate('winner'), coordinate('restricted'), coordinate('open')],
        },
      },
      'winner:1.0': {
        dependencies: {
          dependency: {
            groupId: 'org.example',
            artifactId: 'shared',
            version: '2.0',
          },
        },
      },
      'restricted:1.0': {
        dependencies: {
          dependency: {
            groupId: 'org.example',
            artifactId: 'shared',
            version: '1.0',
            exclusions: { exclusion: { groupId: 'org.example', artifactId: 'leaf' } },
          },
        },
      },
      'open:1.0': {
        dependencies: {
          dependency: {
            groupId: 'org.example',
            artifactId: 'shared',
            version: '1.0',
          },
        },
      },
      'shared:2.0': {},
      'shared:1.0': {
        dependencies: { dependency: [coordinate('leaf'), coordinate('cycle')] },
      },
      'leaf:1.0': {},
      'cycle:1.0': {
        dependencies: {
          dependency: {
            groupId: 'org.example',
            artifactId: 'shared',
            version: '1.0',
          },
        },
      },
    });

    const result = await new MavenResolver().resolveDependencies('org.example:root', '1.0');
    expect(result.flatList).toContainEqual(
      expect.objectContaining({
        name: 'org.example:leaf',
        version: '1.0',
        metadata: expect.objectContaining({ filename: expect.stringMatching(/\.jar$/) }),
      })
    );
    expect(result.flatList.filter((pkg) => pkg.name === 'org.example:shared')).toHaveLength(2);
    expect(result.flatList).toContainEqual(
      expect.objectContaining({
        name: 'org.example:cycle',
        version: '1.0',
        metadata: expect.objectContaining({ filename: expect.stringMatching(/\.jar$/) }),
      })
    );
  });

  it('모든 버전 탐색도 maxDepth를 넘는 자손을 확장하지 않는다', async () => {
    serveModels({
      'root:1.0': {
        dependencies: { dependency: [coordinate('winner'), coordinate('loser')] },
      },
      'winner:1.0': {
        dependencies: {
          dependency: {
            groupId: 'org.example',
            artifactId: 'shared',
            version: '2.0',
          },
        },
      },
      'loser:1.0': {
        dependencies: {
          dependency: {
            groupId: 'org.example',
            artifactId: 'shared',
            version: '1.0',
          },
        },
      },
      'shared:2.0': {},
      'shared:1.0': { dependencies: { dependency: coordinate('leaf') } },
      'leaf:1.0': {},
    });

    const result = await new MavenResolver().resolveDependencies('org.example:root', '1.0', {
      maxDepth: 2,
    });
    expect(result.flatList).toContainEqual(
      expect.objectContaining({
        name: 'org.example:shared',
        version: '1.0',
        metadata: expect.objectContaining({ filename: expect.stringMatching(/\.jar$/) }),
      })
    );
    expect(result.flatList.some((pkg) => pkg.name === 'org.example:leaf')).toBe(false);
  });

  it('엣지의 wildcard exclusion은 선택한 JAR를 보존하고 그 자손만 제외한다', async () => {
    serveModels({
      'root:1.0': {
        dependencies: {
          dependency: {
            ...coordinate('library'),
            exclusions: { exclusion: { groupId: '*', artifactId: '*' } },
          },
        },
      },
      'library:1.0': { dependencies: { dependency: coordinate('leaf') } },
      'leaf:1.0': {},
    });
    const result = await new MavenResolver().resolveDependencies('org.example:root', '1.0');
    expect(result.flatList.map((p) => p.name)).toEqual(['org.example:root', 'org.example:library']);
  });

  it('같은 GAV의 일반 JAR, classifier JAR, 명시적 POM을 트리와 목록에 각각 보존한다', async () => {
    serveModels({
      'root:1.0': {
        dependencies: {
          dependency: [
            coordinate('shared'),
            { ...coordinate('shared'), classifier: 'tests' },
            { ...coordinate('shared'), type: 'pom' },
          ],
        },
      },
      'shared:1.0': {},
    });
    const result = await new MavenResolver().resolveDependencies('org.example:root', '1.0');
    const filenames = result.flatList
      .filter((p) => p.name === 'org.example:shared')
      .map((p) => p.metadata?.filename)
      .sort();
    expect(filenames).toEqual(['shared-1.0-tests.jar', 'shared-1.0.jar', 'shared-1.0.pom']);
    expect(result.root.dependencies).toHaveLength(3);
  });

  it('아티팩트 수집 상태를 다음 해석 요청으로 누출하지 않는다', async () => {
    serveModels({
      'root:1.0': {
        dependencies: { dependency: [coordinate('winner'), coordinate('loser')] },
      },
      'winner:1.0': { dependencies: { dependency: coordinate('shared', '2.0') } },
      'loser:1.0': { dependencies: { dependency: coordinate('shared', '1.0') } },
      'shared:2.0': {},
      'shared:1.0': { dependencies: { dependency: coordinate('loser-leaf') } },
      'loser-leaf:1.0': {},
      'standalone:1.0': {},
    });

    const resolver = new MavenResolver();
    const first = await resolver.resolveDependencies('org.example:root', '1.0');
    expect(first.flatList).toContainEqual(
      expect.objectContaining({
        name: 'org.example:loser-leaf',
        metadata: expect.objectContaining({ filename: expect.stringMatching(/\.jar$/) }),
      })
    );

    const second = await resolver.resolveDependencies('org.example:standalone', '1.0');
    expect(second.flatList.map((pkg) => pkg.name)).toEqual(['org.example:standalone']);
  });

  it('의존성 컨텍스트 작업 수를 제한해 과도한 확장을 실패시킨다', async () => {
    const versions = Array.from({ length: 10002 }, (_, index) => `${index + 1}.0`);
    serveModels({
      'root:1.0': {
        dependencies: {
          dependency: versions.map((version) => coordinate(`library-${version}`)),
        },
      },
      ...Object.fromEntries(versions.map((version) => [`library-${version}:1.0`, {}])),
    });

    await expect(
      new MavenResolver().resolveDependencies('org.example:root', '1.0')
    ).rejects.toThrow('의존성 해결 작업 수가 제한을 초과했습니다');
  });

  it('더 깊은 context가 먼저 와도 얕은 재방문에서 남은 자손을 확장한다', async () => {
    const deps: QueueProcessorDependencies = {
      fetchPomWithCache: async (coord) =>
        coord.artifactId === 'shared' ? { dependencies: { dependency: coordinate('leaf') } } : {},
      prefetchPomsParallel: () => undefined,
      shouldIncludeDependency: () => true,
      createDependencyNode: (coord, scope) => ({
        package: {
          type: 'maven',
          name: `${coord.groupId}:${coord.artifactId}`,
          version: coord.version,
          metadata: { type: coord.type },
        },
        dependencies: [],
        scope,
      }),
      recordConflict: vi.fn(),
      skipper: {
        recordResolved: vi.fn(),
        getResolvedVersion: () => '2.0',
        getCoordinateManager: () => ({ createCoordinate: vi.fn() }),
      },
      bomProcessor: {
        processModel: async (pom) => ({
          properties: {},
          dependencyManagement: new Map(),
          dependencies: pom.dependencies ? [pom.dependencies.dependency].flat() : [],
        }),
      },
    };
    const processor = new MavenQueueProcessor(deps);
    const shared = coordinate('shared', '1.0');
    const item = (depth: number, parent: string): DependencyProcessingContext => ({
      coordinate: shared,
      parentPath: [`org.example:${parent}:1.0`],
      depth,
      nodeCoordinate: { depth, sequence: 1 },
      scope: 'compile',
      originalScope: 'compile',
      exclusions: new Set(),
      managedVersion: false,
    });
    const ctx: MavenResolutionContext = {
      nodeMap: new Map(),
      queue: [item(3, 'deep'), item(2, 'shallow')],
      contextDepths: new Map(),
      workCount: 0,
      maxDepth: 3,
      includeOptional: false,
      dependencyManagement: new Map(),
      rootNode: deps.createDependencyNode(shared, 'compile'),
      rootKey: 'org.example:root:1.0',
    };

    await processor.processQueue(ctx);

    expect([...ctx.nodeMap.values()].some((n) => n.package.name === 'org.example:leaf')).toBe(true);
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
    expect(flatten(new MavenResolver(), root).map((p) => p.name)).toEqual([
      'org.example:root',
      'org.example:same',
      'org.example:extra',
    ]);
  });

  it('같은 GAV의 JAR와 POM 아티팩트를 각각 보존한다', () => {
    const root = node('root');
    root.dependencies.push(node('same', 'jar'), node('same', 'pom'));
    expect(flatten(new MavenResolver(), root)).toHaveLength(3);
  });
});
