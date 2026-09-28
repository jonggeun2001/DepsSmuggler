import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as conda from './conda-cache';
import * as maven from './maven-cache';
import * as pip from './pip-cache';

const http = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('axios', () => ({
  default: {
    get: http.get,
    create: () => ({ get: http.get, defaults: { baseURL: 'https://repo1.maven.org/maven2' } }),
    isAxiosError: () => false,
  },
}));

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'package-stats-'));
  http.get.mockReset();
  pip.clearMemoryCache();
  maven.clearMemoryCache();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

it('conda skips malformed or incomplete entries and retries after an I/O failure', async () => {
  const directory = path.join(root, 'conda');
  const subdir = path.join(directory, 'channel', 'linux-64');
  await fs.mkdir(subdir, { recursive: true });
  await fs.writeFile(path.join(subdir, 'repodata.meta.json'), '{invalid');
  expect((await conda.getCacheStatsAsync(directory)).entries).toEqual([]);
  await fs.writeFile(path.join(subdir, 'repodata.meta.json'), '{}');
  expect((await conda.getCacheStatsAsync(directory, true)).entries).toEqual([]);
  await fs.writeFile(path.join(subdir, 'repodata.json'), '{}');
  const read = vi.spyOn(fs, 'readFile');
  read.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }));
  await expect(conda.getCacheStatsAsync(directory, true)).rejects.toThrow('denied');
  expect((await conda.getCacheStatsAsync(directory)).entries).toHaveLength(1);
});

it('pip reuses disk totals, sees writes/pruning/clear and keeps memory counts live', async () => {
  const directory = path.join(root, 'pip');
  expect((await pip.getCacheStatsAsync(directory)).diskEntries).toBe(0);
  http.get.mockResolvedValue({ data: { info: { name: 'sample', version: '1' } } });
  await pip.fetchPackageMetadata('sample', undefined, { cacheDir: directory });
  const first = await pip.getCacheStatsAsync(directory);
  expect(first).toEqual(pip.getCacheStats(directory));
  expect(first.diskEntries).toBe(1);
  const reads = vi.spyOn(fs, 'opendir');
  pip.clearMemoryCache();
  expect(await pip.getCacheStatsAsync(directory)).toEqual({ ...first, memoryEntries: 0 });
  expect(reads).not.toHaveBeenCalled();
  await fs.writeFile(
    path.join(directory, 'expired.json'),
    JSON.stringify({ meta: { cachedAt: 0, ttl: 1 } })
  );
  expect((await pip.getCacheStatsAsync(directory)).diskEntries).toBe(1);
  expect((await pip.getCacheStatsAsync(directory, true)).diskEntries).toBe(2);
  pip.pruneExpiredCache(directory);
  expect((await pip.getCacheStatsAsync(directory)).diskEntries).toBe(1);
  pip.clearAllCache(directory);
  expect(await pip.getCacheStatsAsync(directory)).toEqual({
    memoryEntries: 0,
    diskEntries: 0,
    diskSize: 0,
  });
});

it('maven shares concurrent disk scans and invalidates them after writes and deletion', async () => {
  const directory = path.join(root, 'maven');
  await maven.getMavenCacheStatsAsync(directory);
  http.get.mockResolvedValue({
    data: '<project><groupId>org.test</groupId><artifactId>sample</artifactId><version>1</version></project>',
  });
  await maven.fetchPom(
    { groupId: 'org.test', artifactId: 'sample', version: '1' },
    { cacheDir: directory }
  );
  const reads = vi.spyOn(fs, 'opendir');
  const [first, second] = await Promise.all([
    maven.getMavenCacheStatsAsync(directory),
    maven.getMavenCacheStatsAsync(directory),
  ]);
  expect(first).toEqual(second);
  expect(first.diskEntries).toBe(2);
  const scanReads = reads.mock.calls.length;
  expect(scanReads).toBeGreaterThan(0);
  maven.clearMemoryCache();
  expect(await maven.getMavenCacheStatsAsync(directory)).toMatchObject({
    diskEntries: 2,
    memoryEntries: 0,
  });
  expect(reads).toHaveBeenCalledTimes(scanReads);
  await fs.writeFile(path.join(directory, 'external.pom'), 'test');
  expect((await maven.getMavenCacheStatsAsync(directory, true)).diskEntries).toBe(3);
  await maven.clearDiskCache(directory);
  expect(await maven.getMavenCacheStatsAsync(directory)).toMatchObject({
    diskEntries: 0,
    diskSize: 0,
  });
});

it('conda reuses metadata without reading repodata and invalidates on write, 304, prune and clear', async () => {
  const directory = path.join(root, 'conda');
  await conda.getCacheStatsAsync(directory);
  http.get.mockRejectedValueOnce(new Error('no zstd')).mockResolvedValue({
    status: 200,
    headers: {},
    data: Buffer.from(JSON.stringify({ packages: {}, info: { subdir: 'linux-64' } })),
  });
  await conda.fetchRepodata('conda-forge', 'linux-64', { cacheDir: directory });
  const first = await conda.getCacheStatsAsync(directory);
  expect(first).toEqual(conda.getCacheStats(directory));
  expect(first.entries).toHaveLength(1);
  const reads = vi.spyOn(fs, 'readFile');
  expect(await conda.getCacheStatsAsync(directory)).toEqual(first);
  expect(reads).not.toHaveBeenCalled();
  await conda.getCacheStatsAsync(directory, true);
  expect(reads.mock.calls.every(([file]) => String(file).endsWith('repodata.meta.json'))).toBe(
    true
  );
  const metaPath = path.join(directory, 'conda-forge', 'linux-64', 'repodata.meta.json');
  const expired = { ...first.entries[0].meta, cachedAt: 0, etag: 'old' };
  await fs.writeFile(metaPath, JSON.stringify(expired));
  await conda.getCacheStatsAsync(directory, true);
  http.get
    .mockRejectedValueOnce(new Error('no zstd'))
    .mockResolvedValue({ status: 304, headers: {} });
  await conda.fetchRepodata('conda-forge', 'linux-64', { cacheDir: directory });
  expect((await conda.getCacheStatsAsync(directory)).entries[0].meta.cachedAt).toBeGreaterThan(0);
  const reference = (await conda.fetchRepodata('conda-forge', 'linux-64', { cacheDir: directory }))!
    .data;
  await conda.getCacheStatsAsync(directory);
  await fs.writeFile(metaPath, JSON.stringify(expired));
  http.get
    .mockRejectedValueOnce(new Error('no zstd'))
    .mockResolvedValue({ status: 304, headers: {} });
  await conda.queryRepodata(reference, 'missing');
  expect((await conda.getCacheStatsAsync(directory)).entries[0].meta.cachedAt).toBeGreaterThan(
    first.entries[0].meta.cachedAt
  );
  await fs.writeFile(metaPath, JSON.stringify(expired));
  conda.pruneExpiredCache(directory);
  expect((await conda.getCacheStatsAsync(directory)).entries).toEqual([]);
  conda.clearCache(directory);
  expect(await conda.getCacheStatsAsync(directory)).toEqual({
    totalSize: 0,
    channelCount: 0,
    entries: [],
  });
});
