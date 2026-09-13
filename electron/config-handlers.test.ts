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
  writeJsonAtomically: vi.fn(),
  withSerializedFile: vi.fn(),
  remove: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }));
vi.mock('os', () => ({ homedir: mocks.homedir }));
vi.mock('fs-extra', () => mocks);
vi.mock('../src/core/shared/atomic-json-store', () => ({
  writeJsonAtomically: mocks.writeJsonAtomically,
  withSerializedFile: mocks.withSerializedFile,
}));
vi.mock('./utils/logger', () => ({
  createScopedLogger: () => ({ info: vi.fn(), error: mocks.loggerError }),
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
    mocks.readFile.mockResolvedValue(JSON.stringify({}));
    mocks.ensureDir.mockResolvedValue(undefined);
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.writeJsonAtomically.mockResolvedValue(undefined);
    mocks.withSerializedFile.mockImplementation(async (_filePath, operation) => operation());
    mocks.remove.mockResolvedValue(undefined);
    registerConfigHandlers();
  });

  it('uses the current home directory for both path lookup and persisted JSON', async () => {
    const config = { concurrentDownloads: 5, cache: { enabled: false }, label: '설정' };
    expect(getSettingsPath()).toBe(settingsPath);
    expect(invoke('config:getPath')).toBe(settingsPath);
    await expect(invoke('config:set', config)).resolves.toEqual({ success: true });
    expect(mocks.ensureDir).toHaveBeenCalledWith(path.dirname(settingsPath));
    expect(mocks.writeJsonAtomically).toHaveBeenCalledWith(settingsPath, config);
    mocks.readFile.mockResolvedValue(JSON.stringify(config));
    await expect(invoke('config:get')).resolves.toEqual(config);
    expect(mocks.readFile).toHaveBeenCalledWith(settingsPath, 'utf-8');
  });

  it('persists GUI, CLI legacy, and unknown JSON fields without migration', async () => {
    const config = {
      cachingEnabled: false,
      fileSplitSizeMB: 25,
      maxCacheSize: 1024,
      logLevel: 'debug',
      defaultOutputFormat: 'withScript',
      defaultArchiveType: 'tar.gz',
      futureSetting: { enabled: true },
    };
    await expect(invoke('config:set', config)).resolves.toEqual({ success: true });
    expect(mocks.writeJsonAtomically).toHaveBeenCalledWith(settingsPath, config);
  });

  it('returns null for missing settings without attempting to read or create a file', async () => {
    const error = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mocks.readFile.mockRejectedValue(error);
    await expect(invoke('config:get')).resolves.toBeNull();
    expect(mocks.readFile).toHaveBeenCalledWith(settingsPath, 'utf-8');
    expect(mocks.ensureDir).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.writeJsonAtomically).not.toHaveBeenCalled();
  });

  it.each(['', '{broken'])('falls back to null for malformed JSON %j', async (data) => {
    mocks.readFile.mockResolvedValue(data);
    await expect(invoke('config:get')).resolves.toBeNull();
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.writeJsonAtomically).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('falls back on read permission errors and records the failure', async () => {
    mocks.readFile.mockRejectedValue(new Error('EACCES'));
    await expect(invoke('config:get')).resolves.toBeNull();
    expect(mocks.loggerError).toHaveBeenCalled();
    expect(mocks.writeJsonAtomically).not.toHaveBeenCalled();
  });

  it('reports directory permission failure without attempting a write', async () => {
    mocks.ensureDir.mockRejectedValue(new Error('EACCES: mkdir'));
    await expect(invoke('config:set', {})).resolves.toEqual({
      success: false,
      error: 'Error: EACCES: mkdir',
    });
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.writeJsonAtomically).not.toHaveBeenCalled();
  });

  it('reports write errors without returning success', async () => {
    mocks.writeJsonAtomically.mockRejectedValue(new Error('ENOSPC'));
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
    expect(mocks.writeJsonAtomically).not.toHaveBeenCalled();
  });

  it('rejects a non-object configuration before writing', async () => {
    await expect(invoke('config:set', null)).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('객체'),
    });
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.writeJsonAtomically).not.toHaveBeenCalled();
  });

  it('rejects malformed known fields before touching the existing file', async () => {
    const result = await invoke('config:set', { smtpPort: 70000, keep: 'original' });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('smtpPort') });
    expect(mocks.ensureDir).not.toHaveBeenCalled();
    expect(mocks.writeJsonAtomically).not.toHaveBeenCalled();
  });

  it('returns null for a valid JSON scalar without writing a fallback', async () => {
    mocks.readFile.mockResolvedValue('false');
    await expect(invoke('config:get')).resolves.toBeNull();
    expect(mocks.writeJsonAtomically).not.toHaveBeenCalled();
  });

  it('serializes set, get, and reset as one path-ordered operation', async () => {
    const events: string[] = [];
    let releaseDirectory!: () => void;
    const directoryReady = new Promise<void>((resolve) => { releaseDirectory = resolve; });
    let tail = Promise.resolve();
    mocks.withSerializedFile.mockImplementation((_filePath, operation) => {
      const current = tail.then(operation);
      tail = current.then(() => undefined, () => undefined);
      return current;
    });
    mocks.ensureDir.mockImplementation(async () => {
      events.push('mkdir');
      await directoryReady;
    });
    mocks.writeJsonAtomically.mockImplementation(async () => { events.push('write'); });
    mocks.remove.mockImplementation(async () => { events.push('remove'); });
    mocks.readFile.mockImplementation(async () => { events.push('read'); return '{}'; });

    const setPromise = invoke('config:set', {});
    await Promise.resolve();
    const resetPromise = invoke('config:reset');
    const getPromise = invoke('config:get');
    await Promise.resolve();
    expect(events).toEqual(['mkdir']);
    releaseDirectory();
    await Promise.all([setPromise, resetPromise, getPromise]);
    expect(events).toEqual(['mkdir', 'write', 'remove', 'read']);
  });

  it.each([true, false])('reset succeeds when file existence is %s', async (exists) => {
    mocks.pathExists.mockResolvedValue(exists);
    await expect(invoke('config:reset')).resolves.toEqual({ success: true });
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledWith(settingsPath);
  });

  it('reports reset remove failures', async () => {
    mocks.remove.mockRejectedValue(new Error('EACCES'));
    await expect(invoke('config:reset')).resolves.toEqual({
      success: false,
      error: 'Error: EACCES',
    });
  });
});
