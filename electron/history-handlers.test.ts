import * as path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerHistoryHandlers } from './history-handlers';

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  ensureDir: vi.fn(),
  pathExists: vi.fn(),
  readJson: vi.fn(),
  writeJson: vi.fn(),
}));
vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }));
vi.mock('os', () => ({ homedir: () => 'test-home' }));
vi.mock('fs-extra', () => mocks);
vi.mock('./utils/logger', () => ({
  createScopedLogger: () => ({ info: vi.fn(), error: vi.fn() }),
}));

function invoke(channel: string, ...args: unknown[]) {
  const handler = mocks.handle.mock.calls.find(([name]) => name === channel)?.[1];
  expect(handler).toBeTypeOf('function');
  return handler({}, ...args);
}

describe('history IPC persistence', () => {
  const historyFile = path.join('test-home', '.depssmuggler', 'history.json');

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.ensureDir.mockResolvedValue(undefined);
    mocks.pathExists.mockResolvedValue(true);
    mocks.readJson.mockResolvedValue([]);
    mocks.writeJson.mockResolvedValue(undefined);
    registerHistoryHandlers();
  });

  it('initializes a missing history file before loading it', async () => {
    mocks.pathExists.mockResolvedValue(false);
    await expect(invoke('history:load')).resolves.toEqual([]);
    expect(mocks.ensureDir).toHaveBeenCalledWith(path.dirname(historyFile));
    expect(mocks.writeJson).toHaveBeenCalledWith(historyFile, [], { spaces: 2 });
    expect(mocks.writeJson.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.readJson.mock.invocationCallOrder[0]
    );
    expect(mocks.readJson).toHaveBeenCalledWith(historyFile);
  });

  it('loads existing histories without overwriting them', async () => {
    const histories = [{ id: 'latest', packages: ['requests'] }];
    mocks.readJson.mockResolvedValue(histories);
    await expect(invoke('history:load')).resolves.toEqual(histories);
    expect(mocks.writeJson).not.toHaveBeenCalled();
  });

  it.each(['ensureDir', 'readJson'] as const)(
    'returns an empty history on %s failure',
    async (operation) => {
      mocks[operation].mockRejectedValue(new Error('EACCES'));
      await expect(invoke('history:load')).resolves.toEqual([]);
      expect(mocks.writeJson).not.toHaveBeenCalled();
      if (operation === 'ensureDir') expect(mocks.readJson).not.toHaveBeenCalled();
    }
  );

  it.each([{ histories: [] }, { histories: [{ id: 'replacement' }] }])(
    'save replaces history with $histories',
    async ({ histories }) => {
      await expect(invoke('history:save', histories)).resolves.toEqual({ success: true });
      expect(mocks.writeJson).toHaveBeenCalledWith(historyFile, histories, { spaces: 2 });
      expect(mocks.readJson).not.toHaveBeenCalled();
    }
  );

  it('prepends new records and retains only the latest 100', async () => {
    const oldHistories = Array.from({ length: 100 }, (_, index) => ({ id: `old-${index}` }));
    mocks.readJson.mockResolvedValue([...oldHistories]);
    const newest = { id: 'newest' };
    await expect(invoke('history:add', newest)).resolves.toEqual({ success: true });
    expect(mocks.writeJson).toHaveBeenCalledWith(
      historyFile,
      [newest, ...oldHistories.slice(0, 99)],
      { spaces: 2 }
    );
  });

  it('adds the first record to empty history', async () => {
    await invoke('history:add', { id: 'first' });
    expect(mocks.writeJson).toHaveBeenCalledWith(historyFile, [{ id: 'first' }], { spaces: 2 });
  });

  it('deletes all matching IDs while preserving remaining record order', async () => {
    mocks.readJson.mockResolvedValue([
      { id: 'remove' },
      { id: 'keep-a' },
      { id: 'remove' },
      { id: 'keep-b' },
    ]);
    await expect(invoke('history:delete', 'remove')).resolves.toEqual({ success: true });
    expect(mocks.writeJson).toHaveBeenCalledWith(
      historyFile,
      [{ id: 'keep-a' }, { id: 'keep-b' }],
      { spaces: 2 }
    );
  });

  it('deleting an unknown ID retains existing history', async () => {
    mocks.readJson.mockResolvedValue([{ id: 'keep' }]);
    await invoke('history:delete', 'missing');
    expect(mocks.writeJson).toHaveBeenCalledWith(historyFile, [{ id: 'keep' }], { spaces: 2 });
  });

  it('clear writes an empty list without reading old records', async () => {
    await expect(invoke('history:clear')).resolves.toEqual({ success: true });
    expect(mocks.writeJson).toHaveBeenCalledWith(historyFile, [], { spaces: 2 });
    expect(mocks.readJson).not.toHaveBeenCalled();
  });

  it.each([
    ['history:save', []],
    ['history:add', { id: 'new' }],
    ['history:delete', 'old'],
    ['history:clear', undefined],
  ])(
    '%s propagates initialization permission errors without further IO',
    async (channel, payload) => {
      const error = new Error('EACCES: history directory');
      mocks.ensureDir.mockRejectedValue(error);
      await expect(invoke(channel as string, payload)).rejects.toBe(error);
      expect(mocks.pathExists).not.toHaveBeenCalled();
      expect(mocks.readJson).not.toHaveBeenCalled();
      expect(mocks.writeJson).not.toHaveBeenCalled();
    }
  );

  it.each(['history:add', 'history:delete'])(
    '%s does not overwrite malformed history',
    async (channel) => {
      mocks.readJson.mockResolvedValue({ invalid: 'object instead of array' });
      await expect(invoke(channel, { id: 'new' })).rejects.toBeInstanceOf(TypeError);
      expect(mocks.writeJson).not.toHaveBeenCalled();
    }
  );

  it('propagates write errors from history mutations', async () => {
    const error = new Error('ENOSPC');
    mocks.writeJson.mockRejectedValue(error);
    await expect(invoke('history:save', [])).rejects.toBe(error);
  });
});
