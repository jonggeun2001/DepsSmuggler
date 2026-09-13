import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { getEventListeners } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { downloadFile } from './file-utils';

describe('downloadFile HTTP status handling', () => {
  const resources: Array<{ server: http.Server; directory: string }> = [];

  afterEach(async () => {
    await Promise.all(resources.splice(0).map(async ({ server, directory }) => {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.promises.rm(directory, { recursive: true, force: true });
    }));
  });

  it.each([
    [404, 'not found body'],
    [503, 'service unavailable body'],
  ] as const)('rejects HTTP %d and removes destination', async (statusCode, body) => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-http-status-'));
    const server = http.createServer((_request, response) => {
      response.writeHead(statusCode, { 'content-length': Buffer.byteLength(body) });
      response.end(body);
    });
    resources.push({ server, directory });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind');

    const destination = path.join(directory, 'package.bin');
    const progress = [] as Array<[number, number]>;
    await expect(downloadFile(
      `http://127.0.0.1:${address.port}/package`,
      destination,
      (downloaded, total) => progress.push([downloaded, total]),
    )).rejects.toThrow(new RegExp(`${statusCode}`));
    expect(progress).toEqual([]);
    expect(fs.existsSync(destination)).toBe(false);
  });

  it.each([
    ['', Buffer.alloc(0)],
    ['payload', Buffer.from('payload')],
  ] as const)('accepts HTTP 200 with exact bytes (%s)', async (label, expected) => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-http-ok-'));
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-length': expected.length });
      response.end(expected);
    });
    resources.push({ server, directory });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind');
    const destination = path.join(directory, `${label || 'empty'}.bin`);
    await downloadFile(`http://127.0.0.1:${address.port}/package`, destination, () => {});
    expect(await fs.promises.readFile(destination)).toEqual(expected);
  });

  it.each([404, 503])('retries the same destination after HTTP %d without stale cleanup', async (status) => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-http-retry-'));
    let requests = 0;
    const server = http.createServer((_request, response) => {
      requests += 1;
      if (requests === 1) {
        response.writeHead(status);
        response.end('temporary failure');
      } else {
        response.writeHead(200, { 'content-length': 5 });
        response.end('fresh');
      }
    });
    resources.push({ server, directory });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind');
    const destination = path.join(directory, 'same.bin');
    await expect(downloadFile(`http://127.0.0.1:${address.port}/package`, destination, () => {})).rejects.toThrow();
    expect(fs.existsSync(destination)).toBe(false);
    await downloadFile(`http://127.0.0.1:${address.port}/package`, destination, () => {});
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(await fs.promises.readFile(destination, 'utf8')).toBe('fresh');
    expect(requests).toBe(2);
  }, 10_000);

  it.each([301, 302])('follows relative HTTP %d redirects and rejects missing locations and loops', async (status) => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-http-redirect-'));
    let loopRequests = 0;
    const server = http.createServer((request, response) => {
      if (request.url === '/relative') {
        response.writeHead(status, { location: '/final' });
        response.end();
      } else if (request.url === '/final') {
        response.end('redirected');
      } else if (request.url === '/missing') {
        response.writeHead(status);
        response.end();
      } else {
        loopRequests += 1;
        response.writeHead(status, { location: '/loop' });
        response.end();
      }
    });
    resources.push({ server, directory });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind');
    const url = (route: string) => `http://127.0.0.1:${address.port}${route}`;
    const controller = new AbortController();
    await downloadFile(url('/relative'), path.join(directory, 'relative.bin'), () => {}, { signal: controller.signal });
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
    controller.abort();
    expect(await fs.promises.readFile(path.join(directory, 'relative.bin'), 'utf8')).toBe('redirected');
    await expect(downloadFile(url('/missing'), path.join(directory, 'missing.bin'), () => {})).rejects.toThrow(`HTTP ${status}`);
    await expect(downloadFile(url('/loop'), path.join(directory, 'loop.bin'), () => {})).rejects.toThrow('20');
    expect(fs.existsSync(path.join(directory, 'missing.bin'))).toBe(false);
    expect(fs.existsSync(path.join(directory, 'loop.bin'))).toBe(false);
    expect(loopRequests).toBe(21);
  }, 10_000);

  it('does not issue a request for a pre-aborted signal', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-http-abort-'));
    let requests = 0;
    const server = http.createServer((_request, response) => {
      requests += 1;
      response.end('unexpected');
    });
    resources.push({ server, directory });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind');
    const controller = new AbortController();
    controller.abort();
    await expect(downloadFile(
      `http://127.0.0.1:${address.port}/pre-aborted`,
      path.join(directory, 'aborted.bin'),
      () => {},
      { signal: controller.signal },
    )).rejects.toThrow('Download aborted');
    expect(requests).toBe(0);
    expect(fs.existsSync(path.join(directory, 'aborted.bin'))).toBe(false);
  });
});
