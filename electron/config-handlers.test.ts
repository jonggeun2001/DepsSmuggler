import * as path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSettingsPath, registerConfigHandlers } from './config-handlers';

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  homedir: vi.fn(),
  pathExists: vi.fn(),
  ensureDir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }));
vi.mock('os', () => ({ homedir: mocks.homedir }));
vi.mock('fs-extra', () => mocks);
vi.mock('./utils/logger', () => ({
  createScopedLogger: () => ({ info: vi.fn(), error: vi.fn() }),
}));

function invoke(channel: string, ...args: unknown[]) {
  const handler = mocks.handle.mock.calls.find(([name]) => name === channel)?.[1];
  expect(handler).toBeTypeOf('function');
  return handler({}, ...args);
}

describe('config IPC persistence', () => {
  const home = path.resolve('test-home');
  const settingsPath = path.join(home, '.depssmuggler', 'settings.json');

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.homedir.mockReturnValue(home);
    mocks.pathExists.mockResolvedValue(true);
    mocks.ensureDir.mockResolvedValue(undefined);
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.remove.mockResolvedValue(undefined);
    registerConfigHandlers();
  });

  it('uses the current home directory for both path lookup and persisted JSON', async () => {
    const config = { concurrentDownloads: 5, cache: { enabled: false }, label: '설정' };
    expect(getSettingsPath()).toBe(settingsPath);
    expect(invoke('config:getPath')).toBe(settingsPath);
    await expect(invoke('config:set', config)).resolves.toEqual({ success: true });
    expect(mocks.ensureDir).toHaveBeenCalledWith(path.dirname(settingsPath));
    expect(mocks.writeFile).toHaveBeenCalledWith(
      settingsPath,
      JSON.stringify(config, null, 2),
      'utf-8'
    );
    mocks.readFile.mockResolvedValue(JSON.stringify(config));
    await expect(invoke('config:get')).resolves.toEqual(config);
    expect(mocks.readFile).toHaveBeenCalledWith(settingsPath, 'utf-8');
  });

  it('returns null for missing settings without attempting to read or create a file', async () => {
    mocks.pathExists.mockResolvedValue(false);
    await expect(invoke('config:get')).resolves.toBeNull();
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.ensureDir).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it.each(['', '{broken'])('falls back to null for malformed JSON %j', async (data) => {
    mocks.readFile.mockResolvedValue(data);
    await expect(invoke('config:get')).resolves.toBeNull();
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it.each(['pathExists', 'readFile'] as const)(
    'falls back on %s permission errors',
    async (operation) => {
      mocks[operation].mockRejectedValue(new Error('EACCES'));
      await expect(invoke('config:get')).resolves.toBeNull();
      if (operation === 'pathExists') expect(mocks.readFile).not.toHaveBeenCalled();
      expect(mocks.writeFile).not.toHaveBeenCalled();
    }
  );

  it('reports directory permission failure without attempting a write', async () => {
    mocks.ensureDir.mockRejectedValue(new Error('EACCES: mkdir'));
    await expect(invoke('config:set', {})).resolves.toEqual({
      success: false,
      error: 'Error: EACCES: mkdir',
    });
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it('reports write errors without returning success', async () => {
    mocks.writeFile.mockRejectedValue(new Error('ENOSPC'));
    await expect(invoke('config:set', {})).resolves.toEqual({
      success: false,
      error: 'Error: ENOSPC',
    });
  });

  it('rejects circular data before writing the settings file', async () => {
    const config: Record<string, unknown> = {};
    config.self = config;
    await expect(invoke('config:set', config)).resolves.toEqual({
      success: false,
      error: expect.stringContaining('circular'),
    });
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it('persists null without imposing an IPC configuration schema', async () => {
    await expect(invoke('config:set', null)).resolves.toEqual({ success: true });
    expect(mocks.writeFile).toHaveBeenCalledWith(settingsPath, 'null', 'utf-8');
  });

  it.each([true, false])('reset succeeds when file existence is %s', async (exists) => {
    mocks.pathExists.mockResolvedValue(exists);
    await expect(invoke('config:reset')).resolves.toEqual({ success: true });
    expect(mocks.remove).toHaveBeenCalledTimes(exists ? 1 : 0);
    if (exists) expect(mocks.remove).toHaveBeenCalledWith(settingsPath);
  });

  it.each(['pathExists', 'remove'] as const)('reports reset %s failures', async (operation) => {
    mocks[operation].mockRejectedValue(new Error('EACCES'));
    await expect(invoke('config:reset')).resolves.toEqual({
      success: false,
      error: 'Error: EACCES',
    });
    if (operation === 'pathExists') expect(mocks.remove).not.toHaveBeenCalled();
  });
});
