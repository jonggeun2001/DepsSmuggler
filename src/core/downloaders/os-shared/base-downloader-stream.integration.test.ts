import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseOSDownloader, type BaseDownloaderOptions } from './base-downloader';
import { GPGVerifier } from './gpg-verifier';
import type { OSPackageInfo } from './types';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, createWriteStream: vi.fn(actual.createWriteStream) };
});

const nativeFs = await vi.importActual<typeof import('fs')>('fs');
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class StreamingDownloader extends BaseOSDownloader {
  constructor(options: BaseDownloaderOptions, retries = 1) {
    super(options);
    this.maxRetries = retries;
    this.retryDelay = 0;
  }
  protected getDownloadUrl(): string {
    return 'https://example.test/package';
  }
  protected getFilename(): string {
    return 'package.rpm';
  }
}

describe('OS streaming transfer lifecycle', () => {
  let directory: string;
  let destination: string;
  let options: BaseDownloaderOptions;
  let pkg: OSPackageInfo;
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'os-stream-'));
    destination = path.join(directory, 'package.rpm');
    options = {
      outputDir: directory,
      architecture: 'x86_64',
      concurrency: 1,
      repositories: [],
      distribution: {
        id: 'rocky-9',
        name: 'Rocky Linux',
        version: '9',
        packageManager: 'yum',
        architectures: ['x86_64'],
        defaultRepos: [],
        extendedRepos: [],
      },
    };
    pkg = {
      name: 'fixture',
      version: '1',
      architecture: 'x86_64',
      size: 5,
      location: 'package.rpm',
      dependencies: [],
      checksum: { type: 'sha256', value: '' },
      repository: {
        id: 'fixture',
        name: 'fixture',
        baseUrl: 'https://example.test',
        enabled: true,
        gpgCheck: false,
        isOfficial: true,
      },
    };
    vi.mocked(fs.createWriteStream).mockReset().mockImplementation(nativeFs.createWriteStream);
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('backpressure bounds read-ahead and verification starts only after the writer closes', async () => {
    const blocked = deferred();
    const release = deferred();
    const chunkSize = 64 * 1024;
    const total = 4 * 1024 * 1024;
    let produced = 0;
    let writer!: fs.WriteStream;
    vi.mocked(fs.createWriteStream).mockImplementationOnce((file) => {
      writer = nativeFs.createWriteStream(file, { highWaterMark: chunkSize });
      const write = writer._write.bind(writer);
      writer._write = (chunk, encoding, callback) => {
        blocked.resolve();
        void release.promise.then(() => write(chunk, encoding, callback));
      };
      return writer;
    });
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (produced === total) return controller.close();
            produced += chunkSize;
            controller.enqueue(new Uint8Array(chunkSize).fill(42));
          },
        }),
        { headers: { 'content-length': String(total) } }
      )
    );
    const verifier = new GPGVerifier();
    const verify = vi.spyOn(verifier, 'verifyPackage').mockImplementation(async (_, file) => {
      expect(writer.closed).toBe(true);
      expect((await fs.promises.readFile(file)).equals(Buffer.alloc(total, 42))).toBe(true);
      return { verified: true, skipped: false };
    });
    const onProgress = vi.fn();
    const pending = new StreamingDownloader({
      ...options,
      gpgVerifier: verifier,
      onProgress,
    }).downloadPackage(pkg);
    try {
      await blocked.promise;
      await tick();
      await tick();
      expect(produced).toBeLessThan(1024 * 1024);
      expect(verify).not.toHaveBeenCalled();
    } finally {
      release.resolve();
    }
    expect(await pending).toMatchObject({ success: true, filePath: destination });
    expect(verify).toHaveBeenCalledOnce();
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ bytesDownloaded: total, totalBytes: total })
    );
  });

  it('aborts a pending response read, closes the writer and removes the partial file', async () => {
    const cancelled = vi.fn();
    const first = deferred();
    const controller = new AbortController();
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(stream) {
            stream.enqueue(new Uint8Array(64 * 1024));
          },
          cancel: cancelled,
        })
      )
    );
    const onError = vi.fn();
    const downloader = new StreamingDownloader({
      ...options,
      abortSignal: controller.signal,
      onError,
      onProgress: first.resolve,
    });
    const pending = downloader.downloadPackage(pkg);
    await first.promise;
    controller.abort();
    expect(await pending).toMatchObject({ success: false, cancelled: true });
    expect(cancelled).toHaveBeenCalledOnce();
    expect(vi.mocked(fs.createWriteStream).mock.results[0].value.closed).toBe(true);
    expect(fs.existsSync(destination)).toBe(false);
    expect(onError).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('removes a failed response before retrying and never appends old bytes', async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    let failed = false;
    const onProgress = () => {
      if (!failed) {
        failed = true;
        stream.error(new Error('connection interrupted'));
      }
    };
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              stream = controller;
              controller.enqueue(new Uint8Array(64 * 1024).fill(1));
            },
          })
        )
      )
      .mockImplementationOnce(async () => {
        expect(fs.existsSync(destination)).toBe(false);
        expect(vi.mocked(fs.createWriteStream).mock.results[0].value.closed).toBe(true);
        return new Response('fresh');
      });
    const result = await new StreamingDownloader({ ...options, onProgress }, 2).downloadPackage(
      pkg
    );
    expect(result.success).toBe(true);
    expect(await fs.promises.readFile(destination, 'utf8')).toBe('fresh');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('cancels the source and cleans an opened writer on disk failure before skip', async () => {
    const cancelled = vi.fn();
    let writer!: fs.WriteStream;
    vi.mocked(fs.createWriteStream).mockImplementationOnce((file) => {
      writer = nativeFs.createWriteStream(file);
      writer._write = (_chunk, _encoding, callback) => callback(new Error('disk full'));
      return writer;
    });
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(64 * 1024));
          },
          cancel: cancelled,
        })
      )
    );
    const onError = vi.fn(async () => {
      expect(writer.closed).toBe(true);
      expect(fs.existsSync(destination)).toBe(false);
      return 'skip' as const;
    });
    expect(
      await new StreamingDownloader({ ...options, onError }).downloadPackage(pkg)
    ).toMatchObject({ success: false, skipped: true, error: { message: 'disk full' } });
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it('does not delete an existing directory when opening the destination fails', async () => {
    fs.mkdirSync(destination);
    fs.writeFileSync(path.join(destination, 'keep'), 'existing');
    fetchMock.mockResolvedValue(new Response('hello'));
    expect((await new StreamingDownloader(options).downloadPackage(pkg)).success).toBe(false);
    expect(fs.readFileSync(path.join(destination, 'keep'), 'utf8')).toBe('existing');
  });

  it('removes a fully written file when verification fails', async () => {
    fetchMock.mockResolvedValue(new Response('hello'));
    const verifier = new GPGVerifier();
    vi.spyOn(verifier, 'verifyPackage').mockResolvedValue({
      verified: false,
      skipped: false,
      reason: 'checksum-mismatch',
    });
    expect(
      await new StreamingDownloader({ ...options, gpgVerifier: verifier }).downloadPackage(pkg)
    ).toMatchObject({
      success: false,
      error: { message: 'Verification failed: checksum-mismatch' },
    });
    expect(fs.existsSync(destination)).toBe(false);
  });

  it('does not report success if cancellation arrives during verification', async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValue(new Response('hello'));
    const verifier = new GPGVerifier();
    vi.spyOn(verifier, 'verifyPackage').mockImplementation(async () => {
      controller.abort();
      return { verified: true, skipped: false };
    });
    expect(
      await new StreamingDownloader({
        ...options,
        abortSignal: controller.signal,
        gpgVerifier: verifier,
      }).downloadPackage(pkg)
    ).toMatchObject({ success: false, cancelled: true });
    expect(fs.existsSync(destination)).toBe(false);
  });

  it('preserves verification and cleanup errors through the error callback and retry', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('failed'))
      .mockResolvedValueOnce(new Response('fresh'));
    const verifier = new GPGVerifier();
    vi.spyOn(verifier, 'verifyPackage')
      .mockResolvedValueOnce({ verified: false, skipped: false, reason: 'checksum-mismatch' })
      .mockResolvedValueOnce({ verified: true, skipped: false });
    const cleanupError = Object.assign(new Error('file locked'), { code: 'EPERM' });
    vi.spyOn(fs.promises, 'rm').mockRejectedValueOnce(cleanupError);
    const onError = vi.fn(async () => 'retry' as const);

    const result = await new StreamingDownloader({
      ...options,
      gpgVerifier: verifier,
      onError,
    }).downloadPackage(pkg);

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        cause: expect.objectContaining({
          cause: expect.objectContaining({ message: 'Verification failed: checksum-mismatch' }),
          cleanupError,
        }),
      })
    );
    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fs.readFileSync(destination, 'utf8')).toBe('fresh');
  });

  it('returns cancellation with cleanup details when unlink fails after verification', async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValue(new Response('hello'));
    const verifier = new GPGVerifier();
    vi.spyOn(verifier, 'verifyPackage').mockImplementation(async () => {
      controller.abort();
      return { verified: true, skipped: false };
    });
    const cleanupError = Object.assign(new Error('file locked'), { code: 'EPERM' });
    vi.spyOn(fs.promises, 'rm').mockRejectedValueOnce(cleanupError);
    const onError = vi.fn();

    expect(
      await new StreamingDownloader({
        ...options,
        abortSignal: controller.signal,
        gpgVerifier: verifier,
        onError,
      }).downloadPackage(pkg)
    ).toMatchObject({
      success: false,
      cancelled: true,
      error: { name: 'AbortError', cause: { name: 'AbortError' }, cleanupError },
    });
    expect(onError).not.toHaveBeenCalled();
    expect(fs.existsSync(destination)).toBe(true);
  });

  it('cancels an HTTP error response without opening the destination', async () => {
    const cancelled = vi.fn();
    fetchMock.mockResolvedValue(
      new Response(new ReadableStream({ cancel: cancelled }), { status: 503 })
    );
    expect((await new StreamingDownloader(options).downloadPackage(pkg)).success).toBe(false);
    expect(cancelled).toHaveBeenCalledOnce();
    expect(fs.createWriteStream).not.toHaveBeenCalled();
  });
});
