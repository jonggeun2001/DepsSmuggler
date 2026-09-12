import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { downloadFile } from './file-utils';

describe('downloadFile interrupted HTTP streams', () => {
  const resources: Array<{ server: http.Server; directory: string }> = [];

  afterEach(async () => {
    await Promise.all(resources.splice(0).map(async ({ server, directory }) => {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.promises.rm(directory, { recursive: true, force: true });
    }));
  });

  it('rejects twice when a 200 response is interrupted after the first chunk', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-http-interrupted-'));
    const contentLength = 19_160;
    const firstChunk = Buffer.alloc(128, 'x');
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-length': contentLength });
      response.write(firstChunk);
      setTimeout(() => response.destroy(), 20);
    });
    resources.push({ server, directory });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind');
    const url = `http://127.0.0.1:${address.port}/interrupted`;

    for (let iteration = 0; iteration < 2; iteration += 1) {
      const destination = path.join(directory, `interrupted-${iteration}.bin`);
      const progress: Array<[number, number]> = [];
      const controller = new AbortController();
      const startedAt = Date.now();
      const pending = downloadFile(
        url,
        destination,
        (downloaded, total) => progress.push([downloaded, total]),
        { signal: controller.signal },
      );
      let timer: NodeJS.Timeout | undefined;
      const outcome = await Promise.race([
        pending.then(
          () => ({ kind: 'resolved' as const }),
          (error: unknown) => ({ kind: 'rejected' as const, error }),
        ),
        new Promise<{ kind: 'timeout' }>((resolve) => {
          timer = setTimeout(() => resolve({ kind: 'timeout' }), 1_500);
        }),
      ]);
      if (timer) clearTimeout(timer);
      try {
        expect(outcome.kind).toBe('rejected');
        expect(Date.now() - startedAt).toBeLessThan(1_500);
        if (outcome.kind === 'rejected') expect(outcome.error).toBeInstanceOf(Error);
        expect(progress.some(([downloaded]) => downloaded >= firstChunk.length)).toBe(true);
        expect(progress.some(([downloaded]) => downloaded === contentLength)).toBe(false);
        expect(fs.existsSync(destination)).toBe(false);
      } finally {
        controller.abort();
        await pending.catch(() => undefined);
      }
    }
  }, 10_000);

  it('can retry the same destination after an interrupted response', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-http-retry-'));
    let requests = 0;
    const expected = Buffer.from('complete retry payload');
    const server = http.createServer((_request, response) => {
      requests += 1;
      if (requests === 1) {
        response.writeHead(200, { 'content-length': expected.length });
        response.write(expected.subarray(0, 4));
        setTimeout(() => response.destroy(), 20);
        return;
      }
      response.writeHead(200, { 'content-length': expected.length });
      response.end(expected);
    });
    resources.push({ server, directory });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind');
    const destination = path.join(directory, 'retry.bin');
    const progress: number[] = [];
    await expect(downloadFile(`http://127.0.0.1:${address.port}/retry`, destination, (bytes) => progress.push(bytes))).rejects.toThrow('Download interrupted');
    expect(progress).toEqual([4]);
    expect(fs.existsSync(destination)).toBe(false);
    await downloadFile(`http://127.0.0.1:${address.port}/retry`, destination, () => {});
    expect(await fs.promises.readFile(destination)).toEqual(expected);
    expect(requests).toBe(2);
  });

  it('rejects a response whose headers arrive before the socket is interrupted', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-http-header-close-'));
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-length': 19_160 });
      response.flushHeaders();
      setTimeout(() => response.destroy(), 20);
    });
    resources.push({ server, directory });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind');
    const destination = path.join(directory, 'header-close.bin');
    await expect(downloadFile(`http://127.0.0.1:${address.port}/header-close`, destination, () => {})).rejects.toThrow('Download interrupted');
    expect(fs.existsSync(destination)).toBe(false);
  });

  it('rejects a socket failure before any response headers arrive', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-http-no-header-'));
    const server = http.createServer((request) => request.socket.destroy());
    resources.push({ server, directory });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind');
    const destination = path.join(directory, 'no-header.bin');
    const progress: number[] = [];
    await expect(downloadFile(`http://127.0.0.1:${address.port}/no-header`, destination, (bytes) => progress.push(bytes))).rejects.toThrow(/socket hang up|ECONNRESET/);
    expect(progress).toEqual([]);
    expect(fs.existsSync(destination)).toBe(false);
  });

  it('accepts a complete chunked response without Content-Length', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-http-chunked-'));
    const expected = Buffer.from('chunk-one\0chunk-two');
    const server = http.createServer((_request, response) => {
      response.writeHead(200);
      response.write(expected.subarray(0, 10));
      response.end(expected.subarray(10));
    });
    resources.push({ server, directory });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind');
    const destination = path.join(directory, 'chunked.bin');
    await downloadFile(`http://127.0.0.1:${address.port}/chunked`, destination, () => {});
    expect(await fs.promises.readFile(destination)).toEqual(expected);
  });

  it('removes a partial file when cancellation occurs during a response', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-http-cancel-'));
    const controller = new AbortController();
    let requests = 0;
    const server = http.createServer((_request, response) => {
      requests += 1;
      response.writeHead(200, { 'content-length': 19_160 });
      response.write(Buffer.alloc(128, 'c'));
      const laterWrite = setTimeout(() => response.write(Buffer.alloc(128, 'd')), 100);
      const laterEnd = setTimeout(() => response.end(Buffer.alloc(128, 'e')), 200);
      response.on('close', () => { clearTimeout(laterWrite); clearTimeout(laterEnd); });
    });
    resources.push({ server, directory });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind');
    const destination = path.join(directory, 'cancel.bin');
    const pending = downloadFile(
      `http://127.0.0.1:${address.port}/cancel`,
      destination,
      () => controller.abort(),
      { signal: controller.signal },
    );
    await expect(pending).rejects.toThrow(/aborted/i);
    expect(requests).toBe(1);
    expect(fs.existsSync(destination)).toBe(false);
  });

  it('pauses and resumes a response before completing it', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-http-pause-'));
    const expected = Buffer.from('pause-resume-payload');
    let paused = true;
    let checks = 0;
    let downloaded = 0;
    let completed = false;
    const controller = new AbortController();
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-length': expected.length });
      response.write(expected.subarray(0, 5));
      setTimeout(() => response.end(expected.subarray(5)), 20);
    });
    resources.push({ server, directory });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind');
    const destination = path.join(directory, 'pause-resume.bin');
    const pending = downloadFile(`http://127.0.0.1:${address.port}/pause-resume`, destination, (bytes) => { downloaded = bytes; }, {
      signal: controller.signal,
      shouldPause: () => { checks += 1; return paused; },
    }).then(() => { completed = true; });
    try {
      await expect.poll(() => downloaded).toBe(5);
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(downloaded).toBe(5);
      expect((await fs.promises.stat(destination)).size).toBe(5);
      expect(completed).toBe(false);
      paused = false;
      await pending;
      expect(await fs.promises.readFile(destination)).toEqual(expected);
      const finalChecks = checks;
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(checks).toBe(finalChecks);
    } finally {
      controller.abort();
      await pending.catch(() => undefined);
    }
  }, 5_000);

  it('cancels a paused response and cleans its polling timer', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-http-pause-cancel-'));
    const controller = new AbortController();
    let checks = 0;
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-length': 19_160 });
      response.write(Buffer.alloc(128, 'p'));
      const interval = setInterval(() => response.write(Buffer.alloc(128, 'q')), 100);
      response.on('close', () => clearInterval(interval));
    });
    resources.push({ server, directory });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind');
    let cancelTimer: NodeJS.Timeout | undefined;
    try {
      const destination = path.join(directory, 'pause-cancel.bin');
      await expect(downloadFile(`http://127.0.0.1:${address.port}/pause-cancel`, destination, () => {
        cancelTimer ??= setTimeout(() => controller.abort(), 250);
      }, {
        signal: controller.signal,
        shouldPause: () => { checks += 1; return true; },
      })).rejects.toThrow(/aborted/i);
      expect(fs.existsSync(destination)).toBe(false);
      const finalChecks = checks;
      expect(finalChecks).toBeGreaterThan(1);
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(checks).toBe(finalChecks);
    } finally {
      if (cancelTimer) clearTimeout(cancelTimer);
    }
  }, 5_000);
});
