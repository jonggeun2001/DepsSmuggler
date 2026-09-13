import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import * as nodeOs from 'node:os';
import * as path from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { getSettingsPath, registerConfigHandlers } from './config-handlers';

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  homedir: vi.fn(),
}));

vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }));
vi.mock('os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('os')>()),
  homedir: mocks.homedir,
}));
vi.mock('./utils/logger', () => ({
  createScopedLogger: () => ({ info: vi.fn(), error: vi.fn() }),
}));

function invoke(channel: string, ...args: unknown[]) {
  const handler = mocks.handle.mock.calls.find(([name]) => name === channel)?.[1];
  expect(handler).toBeTypeOf('function');
  return handler({}, ...args);
}

describe('config IPC atomic integration', () => {
  let home: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    home = await mkdtemp(path.join(nodeOs.tmpdir(), 'depssmuggler-config-ipc-'));
    mocks.homedir.mockReturnValue(home);
    registerConfigHandlers();
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('persists, reads, and resets a settings file using the real atomic path', async () => {
    const config = {
      concurrentDownloads: 4,
      cachingEnabled: false,
      defaultOutputFormat: 'withScript',
      futureSetting: { enabled: true },
    };

    await expect(invoke('config:set', config)).resolves.toEqual({ success: true });
    const settingsPath = getSettingsPath();
    await expect(stat(settingsPath)).resolves.toBeDefined();
    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual(config);
    await expect(invoke('config:get')).resolves.toEqual(config);
    await expect(invoke('config:reset')).resolves.toEqual({ success: true });
    await expect(stat(settingsPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(invoke('config:get')).resolves.toBeNull();
  });

  it('keeps existing bytes when set validation rejects malformed data', async () => {
    const settingsPath = getSettingsPath();
    const previous = '{"concurrentDownloads":3,"future":"keep"}\n';
    await mkdir(path.dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, previous, 'utf8');

    await expect(invoke('config:set', { smtpPort: 70000 })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('smtpPort'),
    });
    await expect(readFile(settingsPath, 'utf8')).resolves.toBe(previous);
  });

  it('keeps corrupt JSON bytes when get falls back to null', async () => {
    const settingsPath = getSettingsPath();
    const corrupt = '{broken\n';
    await mkdir(path.dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, corrupt, 'utf8');

    await expect(invoke('config:get')).resolves.toBeNull();
    await expect(readFile(settingsPath, 'utf8')).resolves.toBe(corrupt);
  });
});
