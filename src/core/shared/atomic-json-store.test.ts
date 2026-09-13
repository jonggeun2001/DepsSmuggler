import { fork, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  withSerializedFile,
  writeJsonAtomically,
  writeJsonAtomicallySync,
} from './atomic-json-store';

const renameControl = vi.hoisted(() => ({
  realRename: undefined as typeof fs.rename | undefined,
  implementation: undefined as ((oldPath: string, newPath: string) => Promise<void>) | undefined,
}));

const syncRenameControl = vi.hoisted(() => ({
  implementation: undefined as ((oldPath: string, newPath: string) => void) | undefined,
}));

const randomUUIDControl = vi.hoisted(() => ({ value: 'fixed-random-id' }));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomUUID: () => randomUUIDControl.value };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  renameControl.realRename = actual.rename;
  return {
    ...actual,
    rename: (oldPath: string, newPath: string) =>
      renameControl.implementation?.(oldPath, newPath) ?? actual.rename(oldPath, newPath),
  };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    renameSync: (oldPath: string, newPath: string) =>
      syncRenameControl.implementation?.(oldPath, newPath) ?? actual.renameSync(oldPath, newPath),
  };
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function temporaryNames(directory: string): Promise<string[]> {
  return fs.readdir(directory).then((entries) => entries.filter((entry) => entry.endsWith('.tmp')));
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
}

function waitForMessage(
  child: ChildProcess,
  predicate: (message: Record<string, unknown>) => boolean,
  timeout = 10_000
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off('message', onMessage);
      reject(new Error('timed out waiting for child message'));
    }, timeout);
    const onMessage = (message: Record<string, unknown>) => {
      if (!predicate(message)) return;
      clearTimeout(timer);
      child.off('message', onMessage);
      resolve(message);
    };
    child.on('message', onMessage);
  });
}

function waitForClose(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

const childFixture = path.resolve('tests/fixtures/atomic-json-store-child.cjs');

function forkReader(target: string): ChildProcess {
  return fork(childFixture, [], {
    cwd: process.cwd(),
    env: { ...process.env, ATOMIC_JSON_TARGET: target, ATOMIC_JSON_MODE: 'read-target' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    silent: true,
  });
}

describe('atomic JSON store', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-atomic-json-'));
    renameControl.implementation = undefined;
    syncRenameControl.implementation = undefined;
  });

  afterEach(async () => {
    renameControl.implementation = undefined;
    syncRenameControl.implementation = undefined;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('serializes invalid JSON before opening a temporary file', async () => {
    const target = path.join(tempDir, 'settings.json');
    const previous = '{"generation":"old"}\n';
    await fs.writeFile(target, previous, 'utf8');
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await expect(writeJsonAtomically(target, circular)).rejects.toThrow();

    await expect(fs.readFile(target, 'utf8')).resolves.toBe(previous);
    await expect(temporaryNames(tempDir)).resolves.toEqual([]);
  });

  it('writes JSON through a same-directory temporary file and replaces the target', async () => {
    const target = path.join(tempDir, 'settings.json');
    await fs.writeFile(target, '{"generation":"old"}\n', 'utf8');

    await writeJsonAtomically(target, { generation: 'new', count: 2 });

    await expect(readJson(target)).resolves.toEqual({ generation: 'new', count: 2 });
    await expect(temporaryNames(tempDir)).resolves.toEqual([]);
  });

  it('preserves old bytes and cleans its temporary file when rename fails', async () => {
    const target = path.join(tempDir, 'settings.json');
    const previous = '{"generation":"old"}\n';
    await fs.writeFile(target, previous, 'utf8');
    const error = new Error('rename failed');
    renameControl.implementation = async () => { throw error; };

    await expect(writeJsonAtomically(target, { generation: 'new' })).rejects.toBe(error);

    await expect(fs.readFile(target, 'utf8')).resolves.toBe(previous);
    await expect(temporaryNames(tempDir)).resolves.toEqual([]);
  });

  it('preserves a pre-existing temporary file when exclusive creation collides', async () => {
    const target = path.join(tempDir, 'settings.json');
    const collision = path.join(
      tempDir,
      `.settings.json.${process.pid}.${randomUUIDControl.value}.tmp`
    );
    const sentinel = 'owned by another writer';
    await fs.writeFile(collision, sentinel, 'utf8');

    await expect(writeJsonAtomically(target, { generation: 'new' })).rejects.toMatchObject({
      code: 'EEXIST',
    });

    await expect(fs.readFile(collision, 'utf8')).resolves.toBe(sentinel);
  });

  it('preserves old bytes and cleans its temporary file when synchronous rename fails', async () => {
    const target = path.join(tempDir, 'settings.json');
    const previous = '{"generation":"old"}\n';
    await fs.writeFile(target, previous, 'utf8');
    const error = new Error('sync rename failed');
    syncRenameControl.implementation = () => { throw error; };

    expect(() => writeJsonAtomicallySync(target, { generation: 'new' })).toThrow(error);

    await expect(fs.readFile(target, 'utf8')).resolves.toBe(previous);
    await expect(temporaryNames(tempDir)).resolves.toEqual([]);
  });

  it('preserves a pre-existing temporary file when synchronous exclusive creation collides', async () => {
    const target = path.join(tempDir, 'settings.json');
    const collision = path.join(
      tempDir,
      `.settings.json.${process.pid}.${randomUUIDControl.value}.tmp`
    );
    const sentinel = 'owned by another writer';
    await fs.writeFile(collision, sentinel, 'utf8');

    expect(() => writeJsonAtomicallySync(target, { generation: 'new' })).toThrowError(
      expect.objectContaining({ code: 'EEXIST' })
    );

    await expect(fs.readFile(collision, 'utf8')).resolves.toBe(sentinel);
  });

  it('serializes invalid JSON before opening a temporary file synchronously', async () => {
    const target = path.join(tempDir, 'settings.json');
    const previous = '{"generation":"old"}\n';
    await fs.writeFile(target, previous, 'utf8');
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => writeJsonAtomicallySync(target, circular)).toThrow();

    await expect(fs.readFile(target, 'utf8')).resolves.toBe(previous);
    await expect(temporaryNames(tempDir)).resolves.toEqual([]);
  });

  it('provides equivalent synchronous replacement semantics', async () => {
    const target = path.join(tempDir, 'settings.json');
    writeJsonAtomicallySync(target, { generation: 'sync' });

    await expect(readJson(target)).resolves.toEqual({ generation: 'sync' });
    expect(existsSync(target)).toBe(true);
    await expect(temporaryNames(tempDir)).resolves.toEqual([]);
  });

  it('serializes operations for one normalized path while allowing another path to proceed', async () => {
    const firstPath = path.join(tempDir, 'one.json');
    const equivalentPath = path.join(tempDir, '.', 'one.json');
    const secondPath = path.join(tempDir, 'two.json');
    const firstStarted = deferred();
    const releaseFirst = deferred();
    const order: string[] = [];

    const first = withSerializedFile(firstPath, async () => {
      order.push('first-start');
      firstStarted.resolve();
      await releaseFirst.promise;
      order.push('first-end');
    });
    await firstStarted.promise;
    const queued = withSerializedFile(equivalentPath, async () => { order.push('queued'); });
    const independent = withSerializedFile(secondPath, async () => { order.push('independent'); });

    await independent;
    expect(order).toEqual(['first-start', 'independent']);
    releaseFirst.resolve();
    await Promise.all([first, queued]);
    expect(order).toEqual(['first-start', 'independent', 'first-end', 'queued']);
  });

  it('recovers the per-file queue after a rejected operation', async () => {
    const target = path.join(tempDir, 'settings.json');
    const error = new Error('operation failed');

    await expect(withSerializedFile(target, async () => { throw error; })).rejects.toBe(error);
    await expect(withSerializedFile(target, async () => 'recovered')).resolves.toBe('recovered');
  });

  it('keeps an old target when a child is killed at the deterministic pre-rename boundary', async () => {
    const target = path.join(tempDir, 'settings.json');
    const previous = '{"generation":"old"}\n';
    await fs.writeFile(target, previous, 'utf8');
    const child = fork(childFixture, [], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ATOMIC_JSON_TARGET: target,
        ATOMIC_JSON_VALUE: JSON.stringify({ generation: 'new' }),
        ATOMIC_JSON_MODE: 'hold-before-rename',
        DEPS_SMUGGLER_PROJECT_ROOT: process.cwd(),
        ATOMIC_JSON_COMPILED_HELPER: path.join(tempDir, 'atomic-json-store-child-helper.cjs'),
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      silent: true,
    });
    const close = waitForClose(child);
    try {
      const beforeRename = await waitForMessage(child, (message) => message.type === 'before-rename');
      expect(await fs.readFile(target, 'utf8')).toBe(previous);
      expect(typeof beforeRename.tempPath).toBe('string');
      expect(await fs.readFile(String(beforeRename.tempPath), 'utf8')).toContain('generation');

      child.kill('SIGKILL');
      const result = await close;
      expect(result.code).not.toBe(0);
      await expect(fs.readFile(target, 'utf8')).resolves.toBe(previous);
      await expect(readJson(target)).resolves.toEqual({ generation: 'old' });

      const reader = forkReader(target);
      const readerClose = waitForClose(reader);
      try {
        const readerMessage = await waitForMessage(reader, (message) => message.type === 'read');
        await expect(readerClose).resolves.toEqual({ code: 0, signal: null });
        expect(readerMessage.value).toEqual({ generation: 'old' });
      } finally {
        if (reader.exitCode === null && reader.signalCode === null) reader.kill('SIGKILL');
        await readerClose.catch(() => undefined);
      }
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await close.catch(() => undefined);
    }
  }, 30_000);

  it('restarts after the rename boundary and observes the new JSON before writer termination', async () => {
    const target = path.join(tempDir, 'settings.json');
    await fs.writeFile(target, '{"generation":"old"}\n', 'utf8');
    const child = fork(childFixture, [], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ATOMIC_JSON_TARGET: target,
        ATOMIC_JSON_VALUE: JSON.stringify({ generation: 'new' }),
        ATOMIC_JSON_MODE: 'hold-after-rename',
        DEPS_SMUGGLER_PROJECT_ROOT: process.cwd(),
        ATOMIC_JSON_COMPILED_HELPER: path.join(tempDir, 'atomic-json-store-child-helper.cjs'),
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      silent: true,
    });
    const close = waitForClose(child);
    try {
      await waitForMessage(child, (message) => message.type === 'before-rename');
      child.send('release');
      await waitForMessage(child, (message) => message.type === 'after-rename');

      child.kill('SIGKILL');
      const result = await close;
      expect(result.code).not.toBe(0);
      await expect(readJson(target)).resolves.toEqual({ generation: 'new' });

      const reader = forkReader(target);
      const readerClose = waitForClose(reader);
      try {
        const readerMessage = await waitForMessage(reader, (message) => message.type === 'read');
        await expect(readerClose).resolves.toEqual({ code: 0, signal: null });
        expect(readerMessage.value).toEqual({ generation: 'new' });
      } finally {
        if (reader.exitCode === null && reader.signalCode === null) reader.kill('SIGKILL');
        await readerClose.catch(() => undefined);
      }
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await close.catch(() => undefined);
    }
  }, 30_000);
});
