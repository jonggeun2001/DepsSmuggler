import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigManager, type Config } from './config';

const testHome = vi.hoisted(() => ({ path: '' }));
vi.mock('node-machine-id', () => ({ machineIdSync: () => 'persistence-test-machine' }));
vi.mock('fs-extra', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof import('fs-extra') }>();
  return { ...actual.default };
});
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => testHome.path };
});

const settings: Config = {
  concurrentDownloads: 5, cachingEnabled: true, fileSplitSizeMB: 25,
  defaultOutputFormat: 'archive', defaultArchiveType: 'zip',
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(async () => {
  testHome.path = await fs.mkdtemp(path.join(os.tmpdir(), 'deps-config-persistence-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(testHome.path);
});

describe('ConfigManager persistence', () => {
  it('serializes the entire update across manager instances using the same file', async () => {
    const first = new ConfigManager();
    const second = new ConfigManager();
    await first.saveConfig(settings);
    const beforeWrite = deferred();
    const release = deferred();
    const ensure = first.ensureDirectories.bind(first);
    let calls = 0;
    vi.spyOn(first, 'ensureDirectories').mockImplementation(async () => {
      await ensure();
      if (++calls === 2) {
        beforeWrite.resolve();
        await release.promise;
      }
    });
    const secondEnsure = vi.spyOn(second, 'ensureDirectories');
    const updateFirst = first.updateConfig({ concurrentDownloads: 12 });
    await beforeWrite.promise;
    const updateSecond = second.updateConfig({ fileSplitSizeMB: 77 });
    try {
      await Promise.resolve();
      expect(secondEnsure).not.toHaveBeenCalled();
    } finally {
      release.resolve();
      await Promise.all([updateFirst, updateSecond]);
    }
    await expect(new ConfigManager().loadConfig()).resolves.toMatchObject({
      concurrentDownloads: 12, fileSplitSizeMB: 77,
    });
  });

  it.each(['{broken', 'null', '[]'])('refuses a partial update of unreadable settings %s', async (bytes) => {
    const manager = new ConfigManager();
    const file = path.join(manager.getConfigDir(), 'settings.json');
    await fs.outputFile(file, bytes);
    await expect(manager.loadConfig()).resolves.toMatchObject({ concurrentDownloads: 5 });
    await expect(manager.updateConfig({ concurrentDownloads: 8 })).rejects.toThrow();
    expect(await fs.readFile(file, 'utf8')).toBe(bytes);
  });

  it('recovers after a rejected update and preserves CLI settings on restart', async () => {
    const manager = new ConfigManager();
    await manager.saveConfig(settings);
    await expect(manager.updateConfig({ cachingEnabled: 'invalid' as unknown as boolean })).rejects.toThrow();
    await manager.updateConfig({ concurrentDownloads: 9 });
    manager.set('cacheEnabled', false);
    const restarted = new ConfigManager();
    expect(restarted.getConfig()).toMatchObject({ concurrentDownloads: 9, cacheEnabled: false });
    await expect(restarted.loadConfig()).resolves.toMatchObject({ concurrentDownloads: 9, cachingEnabled: false });
    restarted.reset();
    await expect(new ConfigManager().loadConfig()).resolves.toMatchObject(settings);
  });

  it('propagates partial-update read errors without overwriting the file', async () => {
    const manager = new ConfigManager();
    await manager.saveConfig(settings);
    const file = path.join(manager.getConfigDir(), 'settings.json');
    const original = await fs.readFile(file, 'utf8');
    vi.spyOn(fs, 'readJson').mockRejectedValueOnce(Object.assign(new Error('cannot read settings'), { code: 'EACCES' }));
    await expect(manager.updateConfig({ fileSplitSizeMB: 80 })).rejects.toThrow('cannot read settings');
    expect(await fs.readFile(file, 'utf8')).toBe(original);
  });
});
