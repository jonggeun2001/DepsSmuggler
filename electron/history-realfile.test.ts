import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({ home: '' }));
const ipc = vi.hoisted(() => ({ handle: vi.fn() }));

vi.mock('electron', () => ({ ipcMain: ipc }));
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => testState.home };
});
vi.mock('./utils/logger', () => ({
  createScopedLogger: () => ({ info: vi.fn(), error: vi.fn() }),
}));

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = ipc.handle.mock.calls.find(([name]) => name === channel)?.[1];
  if (typeof handler !== 'function') throw new Error(`Missing handler: ${channel}`);
  return handler({}, ...args) as Promise<unknown>;
}

describe('history IPC real-file persistence', () => {
  let home: string;
  let historyFile: string;

  beforeAll(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-history-'));
    testState.home = home;
    historyFile = path.join(home, '.depssmuggler', 'history.json');
    const { registerHistoryHandlers } = await import('./history-handlers');
    registerHistoryHandlers();
  });

  beforeEach(async () => {
    await fs.rm(path.dirname(historyFile), { recursive: true, force: true });
  });

  afterAll(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  it('initializes a missing history file using the atomic writer', async () => {
    await expect(invoke('history:load')).resolves.toEqual([]);
    await expect(fs.readFile(historyFile, 'utf8')).resolves.toBe('[]\n');
  });

  it.each(['{broken', '{"missing": true}\n', '[{"id": 42}]\n'])(
    'returns empty history and preserves corrupt bytes on load: %s', async (corrupt) => {
      await fs.mkdir(path.dirname(historyFile), { recursive: true });
      await fs.writeFile(historyFile, corrupt, 'utf8');

      await expect(invoke('history:load')).resolves.toEqual([]);
      await expect(fs.readFile(historyFile, 'utf8')).resolves.toBe(corrupt);
    }
  );

  it.each(['{broken', '[{"id": 42}]\n'])(
    'rejects mutation and preserves corrupt bytes: %s', async (corrupt) => {
      await fs.mkdir(path.dirname(historyFile), { recursive: true });
      await fs.writeFile(historyFile, corrupt, 'utf8');

      await expect(invoke('history:add', { id: 'new' })).rejects.toThrow();
      await expect(fs.readFile(historyFile, 'utf8')).resolves.toBe(corrupt);
    }
  );

  it('keeps both records when concurrent adds use the real file queue', async () => {
    await expect(Promise.all([
      invoke('history:add', { id: 'first', detail: 'kept' }),
      invoke('history:add', { id: 'second' }),
    ])).resolves.toEqual([{ success: true }, { success: true }]);

    await expect(invoke('history:load')).resolves.toEqual([
      { id: 'second' },
      { id: 'first', detail: 'kept' },
    ]);
  });
});
