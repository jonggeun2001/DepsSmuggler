import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerCacheHandlers } from './cache-handlers';

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  pipStats: vi.fn(),
  npmStats: vi.fn(),
  mavenStats: vi.fn(),
  condaStats: vi.fn(),
  clearPip: vi.fn(),
  clearNpm: vi.fn(),
  clearMavenMemory: vi.fn(),
  clearMavenDisk: vi.fn(),
  clearConda: vi.fn(),
  refreshDocker: vi.fn(),
  dockerStatus: vi.fn(),
  clearDocker: vi.fn(),
}));
vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }));
vi.mock('./utils/logger', () => ({
  createScopedLogger: () => ({ info: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));
vi.mock('../src/core/shared/pip-cache', () => ({
  getCacheStats: mocks.pipStats,
  clearAllCache: mocks.clearPip,
}));
vi.mock('../src/core/shared/npm-cache', () => ({
  getNpmCacheStats: mocks.npmStats,
  clearNpmCache: mocks.clearNpm,
}));
vi.mock('../src/core/shared/maven-cache', () => ({
  getMavenCacheStats: mocks.mavenStats,
  clearMemoryCache: mocks.clearMavenMemory,
  clearDiskCache: mocks.clearMavenDisk,
}));
vi.mock('../src/core/shared/conda-cache', () => ({
  getCacheStats: mocks.condaStats,
  clearCache: mocks.clearConda,
}));
vi.mock('../src/core', () => ({
  getDockerDownloader: () => ({
    refreshCatalogCache: mocks.refreshDocker,
    getCatalogCacheStatus: mocks.dockerStatus,
    clearCatalogCache: mocks.clearDocker,
  }),
}));

function invoke(channel: string, ...args: unknown[]) {
  const handler = mocks.handle.mock.calls.find(([name]) => name === channel)?.[1];
  expect(handler).toBeTypeOf('function');
  return handler({}, ...args);
}

describe('cache IPC handlers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.pipStats.mockReturnValue({ memoryEntries: 5, diskEntries: 8, diskSize: 100 });
    mocks.npmStats.mockReturnValue({ entries: 3 });
    mocks.mavenStats.mockReturnValue({ memoryEntries: 4, diskEntries: 2, diskSize: 200 });
    mocks.condaStats.mockResolvedValue({ entries: [{ key: 'a' }, { key: 'b' }], totalSize: 300 });
    registerCacheHandlers();
  });

  it('aggregates metadata sizes and avoids counting memory/disk entries twice', async () => {
    await expect(invoke('cache:stats')).resolves.toEqual({
      scope: 'package-metadata',
      excludes: ['version caches', 'renderer localStorage'],
      totalSize: 600,
      entryCount: 17,
      details: {
        pip: { memoryEntries: 5, diskEntries: 8, diskSize: 100 },
        npm: { entries: 3 },
        maven: { memoryEntries: 4, diskEntries: 2, diskSize: 200 },
        conda: { entries: [{ key: 'a' }, { key: 'b' }], totalSize: 300 },
      },
    });
    await expect(invoke('cache:get-size')).resolves.toBe(600);
  });

  it('treats absent cache counters and sizes as zero', async () => {
    mocks.pipStats.mockReturnValue({});
    mocks.npmStats.mockReturnValue({});
    mocks.mavenStats.mockReturnValue({});
    mocks.condaStats.mockResolvedValue({});
    await expect(invoke('cache:stats')).resolves.toMatchObject({ totalSize: 0, entryCount: 0 });
  });

  it.each(['cache:stats', 'cache:get-size'])(
    '%s propagates statistics read failure without deleting caches',
    async (channel) => {
      const error = new Error('EACCES: cache metadata');
      mocks.condaStats.mockRejectedValue(error);
      await expect(invoke(channel)).rejects.toBe(error);
      expect(mocks.clearPip).not.toHaveBeenCalled();
      expect(mocks.clearMavenDisk).not.toHaveBeenCalled();
      expect(mocks.clearConda).not.toHaveBeenCalled();
    }
  );

  it('waits for every metadata cache clear before reporting success', async () => {
    let finish!: () => void;
    mocks.clearConda.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      })
    );
    const completed = vi.fn();
    const result = invoke('cache:clear').then(completed);
    await Promise.resolve();
    for (const clear of [
      mocks.clearPip,
      mocks.clearNpm,
      mocks.clearMavenMemory,
      mocks.clearMavenDisk,
      mocks.clearConda,
    ]) {
      expect(clear).toHaveBeenCalledOnce();
    }
    expect(completed).not.toHaveBeenCalled();
    expect(mocks.clearDocker).not.toHaveBeenCalled();
    finish();
    await result;
    expect(completed).toHaveBeenCalledWith({ success: true });
  });

  it('propagates asynchronous deletion failure', async () => {
    const error = new Error('EACCES: maven cache');
    mocks.clearMavenDisk.mockRejectedValue(error);
    await expect(invoke('cache:clear')).rejects.toBe(error);
  });

  it.each([undefined, 'ghcr.io'])(
    'refreshes Docker catalogue for registry %s',
    async (registry) => {
      await expect(invoke('docker:cache:refresh', registry)).resolves.toEqual({ success: true });
      expect(mocks.refreshDocker).toHaveBeenCalledWith(registry ?? 'docker.io');
    }
  );

  it('exposes Docker catalogue state separately from metadata caches', async () => {
    const status = { cached: true, count: 12 };
    mocks.dockerStatus.mockReturnValue(status);
    await expect(invoke('docker:cache:status')).resolves.toEqual(status);
    await expect(invoke('docker:cache:clear')).resolves.toEqual({ success: true });
    expect(mocks.clearDocker).toHaveBeenCalledOnce();
    expect(mocks.clearPip).not.toHaveBeenCalled();
  });

  it('propagates Docker refresh errors without clearing the catalogue', async () => {
    const error = new Error('registry unavailable');
    mocks.refreshDocker.mockRejectedValue(error);
    await expect(invoke('docker:cache:refresh')).rejects.toBe(error);
    expect(mocks.clearDocker).not.toHaveBeenCalled();
  });
});
