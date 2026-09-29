import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Worker } from 'worker_threads';
import { expect, it } from 'vitest';
import type { RepoData } from '../conda-types';

it.each(['delete', 'replace'] as const)(
  'does not reuse old data when the disk is %s during parsing',
  async (mutation) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'conda-worker-race-'));
    const folder = path.join(directory, 'fixture', 'noarch');
    const target = path.join(folder, 'repodata.json');
    const metaPath = path.join(folder, 'repodata.meta.json');
    const payload = (version: string) => ({
      packages: {
        'demo.conda': {
          name: 'demo',
          version,
          build: '0',
          build_number: 0,
          depends: [],
          subdir: 'noarch',
        },
      },
    });
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(target, JSON.stringify(payload('old')));
    await fs.writeFile(
      metaPath,
      JSON.stringify({
        url: 'https://invalid.test',
        maxAge: 86400,
        cachedAt: Date.now(),
        fileSize: 0,
        packageCount: 1,
        compressed: false,
      })
    );
    const control = new Int32Array(new SharedArrayBuffer(4));
    // Pause after reading the old bytes, before JSON.parse returns: deterministic cross-thread race.
    const worker = new Worker(
      `
    const { parentPort, workerData } = require('worker_threads');
    const fs = require('fs');
    const original = fs.readFileSync;
    let paused = false;
    fs.readFileSync = function (file, ...args) {
      const value = original.call(this, file, ...args);
      if (!paused && String(file) === workerData.target) {
        paused = true;
        parentPort.postMessage({ kind: 'snapshot-read' });
        Atomics.wait(workerData.control, 0, 0);
      }
      return value;
    };
    require(workerData.register).register({ skipProject: true, transpileOnly: true, moduleTypes: { '**': 'cjs' }, compilerOptions: { module: 'CommonJS', target: 'ES2020', esModuleInterop: true } });
    require(workerData.entry);
  `,
      {
        eval: true,
        workerData: {
          target,
          control,
          register: require.resolve('ts-node'),
          entry: path.join(__dirname, 'conda-worker.ts'),
        },
      }
    );
    let current: { resolve(value: any): void; reject(error: Error): void };
    worker.on('error', (error) => current?.reject(error));
    worker.on('message', async (message) => {
      try {
        if (message.kind === 'snapshot-read') {
          if (mutation === 'delete') await fs.rm(folder, { recursive: true });
          else await fs.writeFile(target, JSON.stringify(payload('replacement-longer')));
          Atomics.store(control, 0, 1);
          Atomics.notify(control, 0);
        } else if (message.kind === 'http') {
          if (message.url.endsWith('.zst'))
            worker.postMessage({
              kind: 'http-result',
              error: { message: 'not found', status: 404 },
            });
          else
            worker.postMessage({
              kind: 'http-result',
              result: {
                status: 200,
                headers: {},
                data: Uint8Array.from(Buffer.from(JSON.stringify(payload('fresh-network')))).buffer,
              },
            });
        } else if (message.kind === 'result') {
          if (message.error) current.reject(new Error(message.error.message));
          else current.resolve(message.result);
        }
      } catch (error) {
        current.reject(error as Error);
      }
    });
    const call = (message: unknown) =>
      new Promise<any>((resolve, reject) => {
        current = { resolve, reject };
        worker.postMessage(message);
      });
    try {
      const reference = {
        kind: 'conda-repodata',
        channel: 'fixture',
        subdir: 'noarch',
        options: { cacheDir: directory },
      };
      const loaded = await call({ kind: 'load', reference });
      const data = (
        await call({
          kind: 'query',
          reference: loaded.data,
          name: 'demo',
        })
      ).data as RepoData;
      expect(data.packages['demo.conda'].version).toBe(
        mutation === 'delete' ? 'fresh-network' : 'replacement-longer'
      );
    } finally {
      Atomics.store(control, 0, 1);
      Atomics.notify(control, 0);
      await worker.terminate();
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
);
