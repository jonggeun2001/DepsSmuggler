import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepodataReference } from '../conda-cache';
import type { RepoData, RepoDataPackage } from '../conda-types';

const boundary = vi.hoisted(() => ({
  receive: undefined as undefined | ((message: unknown) => Promise<void>),
  post: vi.fn(),
  fetch: vi.fn(),
  version: vi.fn(),
}));
vi.mock('worker_threads', () => ({
  parentPort: {
    on: (_event: string, listener: typeof boundary.receive) => {
      boundary.receive = listener;
    },
    postMessage: boundary.post,
  },
}));
vi.mock('../conda-cache', () => ({
  fetchRepodataInWorker: boundary.fetch,
  repodataCacheVersion: boundary.version,
}));

const reference: RepodataReference = {
  kind: 'conda-repodata',
  channel: 'fixture',
  subdir: 'linux-64',
  options: { useCache: true },
};
const pkg = (name: string, version = '1'): RepoDataPackage => ({
  name,
  version,
  build: '0',
  build_number: 0,
  depends: [],
  subdir: 'linux-64',
});
function snapshot(data: RepoData, version = 'v1') {
  return {
    data,
    dataSize: 1024,
    cacheVersion: version,
    fromCache: true,
    meta: { cachedAt: Date.now(), maxAge: 86400, packageCount: 1 },
  };
}
async function call(kind: 'load' | 'query', name?: string, source = reference) {
  await boundary.receive!({ kind, reference: source, name });
  const response = boundary.post.mock.lastCall![0];
  expect(response.error).toBeUndefined();
  return response.result;
}

// Exercise the production Worker handler with observable raw-object enumeration;
// thread/cache I/O are boundaries here and are covered by conda-cache/race integration tests.
describe('Conda Worker name index', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    boundary.version.mockReturnValue('v1');
    await import('./conda-worker');
  });

  it('enumerates 100,000 records once and never scans the source for indexed hits or misses', async () => {
    const scans = vi.fn(Reflect.ownKeys);
    const records = Object.fromEntries(
      Array.from({ length: 100_000 }, (_, index) => [`pkg-${index}.tar.bz2`, pkg(`pkg-${index}`)])
    );
    const data: RepoData = {
      info: { subdir: 'linux-64' },
      packages: new Proxy<Record<string, RepoDataPackage>>(records, { ownKeys: scans }),
      'packages.conda': new Proxy<Record<string, RepoDataPackage>>(
        { 'pkg-0.conda': pkg('PKG-0', '2') },
        { ownKeys: scans }
      ),
    };
    boundary.fetch.mockResolvedValue(snapshot(data));
    await call('load');
    expect(scans).toHaveBeenCalledTimes(2); // once for each format, not once per name
    scans.mockClear();
    for (let index = 0; index < 20; index++) {
      const hit = (await call('query', 'PKG-0')).data as RepoData;
      expect(Object.keys(hit.packages)).toEqual(['pkg-0.tar.bz2']);
      expect(Object.keys(hit['packages.conda']!)).toEqual(['pkg-0.conda']);
      const miss = (await call('query', `missing-${index}`)).data as RepoData;
      expect(miss).toEqual({ info: { subdir: 'linux-64' }, packages: {} });
    }
    expect(scans).not.toHaveBeenCalled();
    expect(boundary.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['replacement', 'force refresh', 'expiry'] as const)(
    'replaces both the index and payload after %s, including previously missing names',
    async (reason) => {
      const old = snapshot({ packages: { 'old.tar.bz2': pkg('old') } });
      if (reason === 'expiry') old.meta.maxAge = 0;
      boundary.fetch.mockResolvedValueOnce(old).mockResolvedValue(
        snapshot(
          {
            packages: { 'new.tar.bz2': pkg('new') },
          },
          'v2'
        )
      );
      await call('load');
      if (reason !== 'expiry') expect((await call('query', 'new')).data.packages).toEqual({});
      if (reason === 'replacement') boundary.version.mockReturnValue('v2');
      if (reason === 'force refresh') {
        await call('load', undefined, {
          ...reference,
          options: { ...reference.options, forceRefresh: true },
        });
        boundary.version.mockReturnValue('v2');
      }
      expect((await call('query', 'new')).data.packages['new.tar.bz2'].name).toBe('new');
      boundary.version.mockReturnValue('v2');
      expect((await call('query', 'old')).data.packages).toEqual({});
      expect(boundary.fetch).toHaveBeenCalledTimes(2);
    }
  );
});
