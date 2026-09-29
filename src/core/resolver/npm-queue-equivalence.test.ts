import { afterEach, describe, expect, it, vi } from 'vitest';
import { NpmResolver } from './npm-resolver';
import { fetchPackument } from '../shared/npm-cache';
import type {
  DepsQueueItem,
  NpmPackageVersion,
  NpmPackument,
  NpmResolverOptions,
} from '../shared/npm-types';

vi.mock('../shared/npm-cache', () => ({ fetchPackument: vi.fn() }));
vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Legacy buildDeps: repeated stable sort followed by shift.
class LegacyQueue {
  private items: DepsQueueItem[] = [];
  get length() {
    return this.items.length;
  }
  clear() {
    this.items = [];
  }
  push(item: DepsQueueItem) {
    this.items.push(item);
  }
  pop() {
    this.items.sort((a, b) =>
      a.depth !== b.depth ? a.depth - b.depth : a.path.localeCompare(b.path)
    );
    return this.items.shift();
  }
}

const packument = (
  name: string,
  versions: Record<string, Partial<NpmPackageVersion>>
): NpmPackument => ({
  _id: name,
  name,
  'dist-tags': { latest: Object.keys(versions)[0] },
  versions: Object.fromEntries(
    Object.entries(versions).map(([version, extra]) => [
      version,
      {
        name,
        version,
        dist: {
          tarball: `https://fixture.invalid/${name}-${version}.tgz`,
          shasum: name,
          unpackedSize: 10,
        },
        ...extra,
      },
    ])
  ),
});
const fixture = new Map([
  [
    'root',
    packument('root', {
      '1.0.0': {
        dependencies: { 'z-parent': '1.0.0', 'a-parent': '1.0.0', shared: '2.0.0' },
        devDependencies: { shared: '1.0.0', 'dev-leaf': '1.0.0' },
        optionalDependencies: { 'optional-leaf': '1.0.0', missing: '1.0.0' },
        peerDependencies: { shared: '3.0.0', 'peer-leaf': '1.0.0', 'missing-peer': '1.0.0' },
        peerDependenciesMeta: { 'missing-peer': { optional: true } },
      },
    }),
  ],
  [
    'a-parent',
    packument('a-parent', {
      '1.0.0': {
        dependencies: {
          shared: '1.0.0',
          repeated: '1.0.0',
          'z-child': '1.0.0',
          'a-child': '1.0.0',
        },
      },
    }),
  ],
  [
    'z-parent',
    packument('z-parent', { '1.0.0': { dependencies: { shared: '3.0.0', repeated: '1.0.0' } } }),
  ],
  ['shared', packument('shared', { '1.0.0': {}, '2.0.0': {}, '3.0.0': {} })],
  ...['dev-leaf', 'optional-leaf', 'peer-leaf', 'repeated', 'z-child', 'a-child'].map(
    (name): [string, NpmPackument] => [name, packument(name, { '1.0.0': {} })]
  ),
]);

type Queue = Pick<LegacyQueue, 'length' | 'clear' | 'push' | 'pop'>;
interface ResolverInternals {
  depsQueue: Queue;
  processDepItem: (item: DepsQueueItem, options: unknown) => Promise<void>;
}

afterEach(() => vi.restoreAllMocks());

describe('npm resolver queue equivalence', () => {
  it.each<NpmResolverOptions>([
    { includeDev: true, includeOptional: true },
    { includeDev: true, includeOptional: true, preferDedupe: true },
    { includeDev: true, includeOptional: true, installStrategy: 'nested' },
    { includeDev: true, includeOptional: true, maxDepth: 1 },
    { includeDev: false, includeOptional: false, installPeers: false },
  ])('기존 순서와 최종 버전·설치 경로·충돌을 유지한다: %j', async (options) => {
    vi.mocked(fetchPackument).mockImplementation(async (name) => {
      const result = fixture.get(name);
      if (!result) throw new Error(`missing fixture ${name}`);
      return result;
    });
    const resolve = async (legacy: boolean) => {
      const resolver = new NpmResolver();
      const internal = resolver as unknown as ResolverInternals;
      if (legacy) internal.depsQueue = new LegacyQueue();
      const processed = vi.spyOn(internal, 'processDepItem');
      const result = await resolver.resolveDependencies('root', '1.0.0', options);
      const order = processed.mock.calls.map(([item]) => [
        item.name,
        item.spec,
        item.depth,
        item.path,
        item.type,
      ]);
      // Reusing the resolver must reset pending and visited state.
      expect(await resolver.resolveDependencies('root', '1.0.0', options)).toEqual(result);
      return { result, order };
    };
    const old = await resolve(true);
    const current = await resolve(false);
    expect(current).toEqual(old);
    expect(current.order.slice(0, 3).map(([name]) => name)).toEqual([
      'z-parent',
      'a-parent',
      'shared',
    ]);
    expect(current.result.flatList.length).toBeGreaterThan(2);
    if (options.maxDepth !== 1) {
      // 부모 경로 a가 먼저이며 같은 부모의 자식은 z-child, a-child 입력 순서다.
      const children = current.order.filter(([, , depth]) => depth === 1);
      expect(children[0]?.[3]).toBe('node_modules/a-parent');
      expect(children.filter(([name]) => name === 'repeated')).toHaveLength(1);
      expect(
        children.filter(([name]) => name === 'z-child' || name === 'a-child').map(([name]) => name)
      ).toEqual(['z-child', 'a-child']);
    }
    if (options.includeDev && !options.preferDedupe && options.installStrategy !== 'nested') {
      expect(current.result.conflicts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            packageName: 'shared',
            resolvedVersion: '1.0.0',
            type: 'version',
          }),
        ])
      );
    }
  });
});
