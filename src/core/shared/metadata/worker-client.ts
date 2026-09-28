import { existsSync } from 'fs';
import * as path from 'path';
import { Worker } from 'worker_threads';
import axios from 'axios';
import logger from '../../../utils/logger';

export function metadataAbortError(): Error {
  return Object.assign(new Error('Metadata load cancelled'), { name: 'AbortError' });
}

/** One active job per worker; queued jobs survive a failed/cancelled worker. */
export class MetadataWorkerClient {
  private worker?: Worker;
  private queue: Promise<unknown> = Promise.resolve();
  private idleTimer?: NodeJS.Timeout;

  constructor(
    private readonly entry: string,
    private readonly idleMs = 30_000
  ) {}

  run<T>(request: unknown, transfer: ArrayBuffer[] = [], signal?: AbortSignal): Promise<T> {
    const job = this.queue.then(() => this.execute<T>(request, transfer, signal));
    this.queue = job.catch(() => {});
    return job;
  }

  async close(): Promise<void> {
    await this.queue;
    await this.stop();
  }

  private async stop(): Promise<void> {
    clearTimeout(this.idleTimer);
    const worker = this.worker;
    this.worker = undefined;
    if (worker) await worker.terminate();
  }

  private start(): Worker {
    const compiled = path.join(__dirname, `${this.entry}.js`);
    if (existsSync(compiled)) {
      return new Worker(compiled, { resourceLimits: { maxOldGenerationSizeMb: 1024 } });
    }
    // Source-only CLI/tests. Packaged applications always use the compiled sibling.
    return new Worker(
      `
      const { workerData } = require('worker_threads');
      require(workerData.register).register({
        skipProject: true, transpileOnly: true, moduleTypes: { '**': 'cjs' },
        compilerOptions: { module: 'CommonJS', target: 'ES2020', esModuleInterop: true }
      });
      require(workerData.entry);
    `,
      {
        eval: true,
        workerData: {
          register: require.resolve('ts-node'),
          entry: path.join(__dirname, `${this.entry}.ts`),
        },
        resourceLimits: { maxOldGenerationSizeMb: 1024 },
      }
    );
  }

  private execute<T>(request: unknown, transfer: ArrayBuffer[], signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(metadataAbortError());
    clearTimeout(this.idleTimer);
    if (!this.worker) {
      const created = this.start();
      this.worker = created;
      // Idle crashes must not become uncaught errors or leave a dead worker reference.
      created.on('error', () => {});
      created.on('exit', () => {
        if (this.worker === created) this.worker = undefined;
      });
    }
    const worker = this.worker;
    worker.ref();
    return new Promise<T>((resolve, reject) => {
      const network = new AbortController();
      let settled = false;
      const finish = async (error?: Error, result?: T, terminate = false) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', abort);
        worker.off('message', message);
        worker.off('error', failure);
        worker.off('exit', exited);
        network.abort();
        if (terminate) await this.stop();
        else {
          worker.unref();
          this.idleTimer = setTimeout(() => {
            void this.stop();
          }, this.idleMs);
          this.idleTimer.unref();
        }
        if (error) reject(error);
        else resolve(result as T);
      };
      const abort = () => {
        void finish(metadataAbortError(), undefined, true);
      };
      const failure = (error: Error) => {
        void finish(error, undefined, true);
      };
      const exited = (code: number) => failure(new Error(`Metadata worker exited (${code})`));
      const message = async (reply: {
        kind: string;
        level?: 'debug' | 'info' | 'warn' | 'error';
        message?: string;
        meta?: Record<string, unknown>;
        url?: string;
        options?: Record<string, unknown>;
        result?: T;
        error?: { message: string; name: string };
      }) => {
        if (reply.kind === 'log' && reply.level && reply.message) {
          logger[reply.level](reply.message, reply.meta);
        } else if (reply.kind === 'http') {
          try {
            let lastPercent = 0;
            // Preserve the main process axios defaults/TLS trust. Never let axios parse JSON here.
            const response = await axios.get(reply.url!, {
              ...reply.options,
              responseType: 'arraybuffer',
              signal: network.signal,
              validateStatus: (status) => status === 200 || status === 304,
              onDownloadProgress: ({ loaded, total }) => {
                const percent = total ? Math.floor((loaded / total) * 100) : 0;
                if (percent >= lastPercent + 20) {
                  lastPercent = percent;
                  logger.info('repodata 다운로드 중', { url: reply.url, loaded, total, percent });
                }
              },
            });
            const bytes =
              response.data == null
                ? new Uint8Array()
                : ArrayBuffer.isView(response.data)
                  ? new Uint8Array(
                      response.data.buffer,
                      response.data.byteOffset,
                      response.data.byteLength
                    )
                  : new Uint8Array(response.data);
            const buffer = bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength
            ) as ArrayBuffer;
            const headers =
              typeof response.headers.toJSON === 'function'
                ? response.headers.toJSON()
                : response.headers;
            if (!settled)
              worker.postMessage(
                { kind: 'http-result', result: { status: response.status, headers, data: buffer } },
                [buffer]
              );
          } catch (error) {
            const caught = error as Error & { response?: { status: number } };
            if (!settled)
              worker.postMessage({
                kind: 'http-result',
                error: { message: caught.message, status: caught.response?.status },
              });
          }
        } else if (reply.kind === 'result') {
          void finish(
            reply.error
              ? Object.assign(new Error(reply.error.message), { name: reply.error.name })
              : undefined,
            reply.result
          );
        }
      };
      worker.on('message', message);
      worker.once('error', failure);
      worker.once('exit', exited);
      signal?.addEventListener('abort', abort, { once: true });
      try {
        worker.postMessage(request, transfer);
      } catch (error) {
        failure(error as Error);
      }
    });
  }
}
