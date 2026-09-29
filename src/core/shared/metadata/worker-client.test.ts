import { EventEmitter } from 'events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import axios from 'axios';
import { MetadataWorkerClient } from './worker-client';

const state = vi.hoisted(() => ({ workers: [] as any[], compiled: true }));
vi.mock('fs', async () => ({
  ...(await vi.importActual<typeof import('fs')>('fs')),
  existsSync: () => state.compiled,
}));
vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('worker_threads', () => ({
  Worker: class extends EventEmitter {
    posts: any[] = [];
    ref = vi.fn();
    unref = vi.fn();
    terminate = vi.fn(async () => {
      this.emit('exit', 1);
      return 1;
    });
    constructor(...args: unknown[]) {
      super();
      state.workers.push(this);
      this.args = args;
    }
    args: unknown[];
    postMessage(...args: unknown[]) {
      this.posts.push(args);
    }
  },
}));
let client: MetadataWorkerClient;
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
beforeEach(() => {
  state.workers = [];
  state.compiled = true;
  client = new MetadataWorkerClient('yum-worker', 10);
  vi.clearAllMocks();
});
afterEach(async () => {
  await client.close();
});

it('serializes jobs and reuses one worker, then retires it while idle', async () => {
  const first = client.run('first');
  const second = client.run('second');
  await tick();
  const worker = state.workers[0];
  expect(worker.args[0]).toMatch(/yum-worker\.js$/);
  expect(worker.posts).toEqual([['first', []]]);
  worker.emit('message', { kind: 'result', result: 1 });
  await expect(first).resolves.toBe(1);
  await tick();
  expect(worker.posts).toEqual([
    ['first', []],
    ['second', []],
  ]);
  worker.emit('message', { kind: 'result', result: 2 });
  await expect(second).resolves.toBe(2);
  await vi.waitFor(() => expect(worker.terminate).toHaveBeenCalledOnce());
  expect(worker.unref).toHaveBeenCalledTimes(2);
});

it('terminates an aborted active parse before starting the queued job on a fresh worker', async () => {
  const controller = new AbortController();
  const first = client.run('first', [], controller.signal);
  const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  const second = client.run('second');
  await tick();
  controller.abort();
  await rejected;
  await tick();
  expect(state.workers[0].terminate).toHaveBeenCalledOnce();
  expect(state.workers).toHaveLength(2);
  state.workers[1].emit('message', { kind: 'result', result: 2 });
  await expect(second).resolves.toBe(2);
});

it('does not launch an already cancelled job', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(client.run({}, [], controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(state.workers).toHaveLength(0);
});

it('propagates parser errors and recovers from worker exits, including idle crashes', async () => {
  const malformed = client.run({});
  const error = expect(malformed).rejects.toMatchObject({
    name: 'SyntaxError',
    message: 'bad XML',
  });
  await tick();
  state.workers[0].emit('message', {
    kind: 'result',
    error: { name: 'SyntaxError', message: 'bad XML' },
  });
  await error;
  state.workers[0].emit('error', new Error('idle crash'));
  state.workers[0].emit('exit', 1);
  const next = client.run({});
  const exit = expect(next).rejects.toThrow('Metadata worker exited (2)');
  await tick();
  expect(state.workers).toHaveLength(2);
  state.workers[1].emit('exit', 2);
  await exit;
});

it('fetches bytes through the caller axios configuration and transfers them without JSON parsing', async () => {
  const pending = client.run({});
  await tick();
  vi.mocked(axios.get).mockResolvedValue({
    status: 200,
    headers: { etag: 'v1' },
    data: Buffer.from('not parsed JSON'),
  });
  const worker = state.workers[0];
  worker.emit('message', {
    kind: 'http',
    url: 'https://example.test/repodata',
    options: { headers: { 'If-None-Match': 'v0' }, timeout: 1234 },
  });
  await tick();
  const options = vi.mocked(axios.get).mock.calls[0][1]!;
  expect(options).toMatchObject({
    responseType: 'arraybuffer',
    timeout: 1234,
    headers: { 'If-None-Match': 'v0' },
  });
  expect(options.validateStatus!(200)).toBe(true);
  expect(options.validateStatus!(304)).toBe(true);
  expect(options.validateStatus!(500)).toBe(false);
  const [reply, transfers] = worker.posts[1];
  expect(Buffer.from(reply.result.data).toString()).toBe('not parsed JSON');
  expect(transfers).toEqual([reply.result.data]);
  worker.emit('message', { kind: 'result', result: null });
  await pending;
  expect(options.signal?.aborted).toBe(true);
});
