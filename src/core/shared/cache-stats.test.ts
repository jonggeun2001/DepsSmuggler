import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createCacheStatsReader, getDirectoryStats } from './cache-stats';

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it('shares concurrent scans, reuses snapshots and refreshes explicitly', async () => {
  const first = deferred<number>();
  const scan = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(2);
  const reader = createCacheStatsReader(scan);
  const requests = [reader.get('/cache'), reader.get('/cache'), reader.get('/cache', true)];
  await Promise.resolve();
  expect(scan).toHaveBeenCalledOnce();
  first.resolve(1);
  expect(await Promise.all(requests)).toEqual([1, 1, 1]);
  expect(await reader.get('/cache')).toBe(1);
  expect(scan).toHaveBeenCalledOnce();
  expect(await reader.get('/cache', true)).toBe(2);
  expect(scan).toHaveBeenCalledTimes(2);
  expect(await reader.get('/another-cache')).toBe(2);
  expect(scan).toHaveBeenCalledTimes(3);
});

it('retries a scan invalidated by a write or clear and keeps waiters on the same request', async () => {
  const stale = deferred<number>();
  const scan = vi.fn().mockReturnValueOnce(stale.promise).mockResolvedValue(0);
  const reader = createCacheStatsReader(scan);
  const beforeClear = reader.get('/cache');
  await Promise.resolve();
  reader.invalidate();
  const afterClear = reader.get('/cache');
  expect(afterClear).toBe(beforeClear);
  stale.resolve(100);
  expect(await beforeClear).toBe(0);
  expect(await reader.get('/cache')).toBe(0);
  expect(scan).toHaveBeenCalledTimes(2);
  reader.invalidate();
  await reader.get('/cache');
  expect(scan).toHaveBeenCalledTimes(3);
});

it('does not cache failures and permits retry after a failed refresh', async () => {
  const scan = vi
    .fn()
    .mockResolvedValueOnce(1)
    .mockRejectedValueOnce(new Error('EACCES'))
    .mockResolvedValue(2);
  const reader = createCacheStatsReader(scan);
  expect(await reader.get('/cache')).toBe(1);
  await expect(reader.get('/cache', true)).rejects.toThrow('EACCES');
  expect(await reader.get('/cache')).toBe(2);
});

it('counts nested files asynchronously and tolerates missing directories', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cache-stats-'));
  directories.push(root);
  await fs.mkdir(path.join(root, 'nested'));
  await fs.writeFile(path.join(root, 'a.json'), '123');
  await fs.writeFile(path.join(root, 'nested', 'b.json'), '12345');
  await fs.writeFile(path.join(root, 'ignored.txt'), '12');
  let yielded = false;
  setImmediate(() => {
    yielded = true;
  });
  expect(await getDirectoryStats(root, (name) => name.endsWith('.json'))).toEqual({
    size: 8,
    fileCount: 2,
  });
  expect(yielded).toBe(true);
  expect(await getDirectoryStats(root)).toEqual({ size: 10, fileCount: 3 });
  expect(await getDirectoryStats(path.join(root, 'missing'))).toEqual({ size: 0, fileCount: 0 });
});

it('skips files removed during enumeration but propagates permission errors', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cache-stats-race-'));
  directories.push(root);
  await fs.writeFile(path.join(root, 'a.json'), '123');
  const stat = vi.spyOn(fs, 'stat');
  stat.mockRejectedValueOnce(Object.assign(new Error('removed'), { code: 'ENOENT' }));
  expect(await getDirectoryStats(root)).toEqual({ size: 0, fileCount: 0 });
  stat.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }));
  await expect(getDirectoryStats(root)).rejects.toThrow('denied');
});
