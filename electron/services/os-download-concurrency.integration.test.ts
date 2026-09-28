import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createOSDownloadOrchestrator,
  type OSDownloadOrchestrator,
} from './os-download-orchestrator';
import { runOSDownloadPool } from './os-download-pool';
import {
  BaseOSDownloader,
  type BaseDownloaderOptions,
  type OSPackageDownloadResult,
} from '../../src/core/downloaders/os-shared/base-downloader';
import type {
  OSDistribution,
  OSDownloadProgress,
  OSPackageInfo,
} from '../../src/core/downloaders/os-shared/types';
import type { BrowserWindow } from 'electron';

const boundary = vi.hoisted(() => ({ factory: vi.fn(), archive: vi.fn(), dialog: vi.fn() }));
vi.mock('../../src/core', () => ({
  getAptDownloader: boundary.factory,
  getYumDownloader: boundary.factory,
  getApkDownloader: boundary.factory,
  getAptResolver: vi.fn(),
  getYumResolver: vi.fn(),
  getApkResolver: vi.fn(),
}));
vi.mock('../utils/logger', () => ({
  createScopedLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
}));
vi.mock('electron', () => ({ dialog: { showMessageBox: boundary.dialog } }));
vi.mock('../../src/core/downloaders/os-shared/archive-packager', () => ({
  OSArchivePackager: class {
    createArchive = boundary.archive;
  },
}));

const distribution: OSDistribution = {
  id: 'fixture',
  name: 'Fixture',
  version: '1',
  packageManager: 'apt',
  architectures: ['amd64'],
  defaultRepos: [],
  extendedRepos: [],
};
const pkg = (name: string): OSPackageInfo => ({
  name,
  version: '1',
  architecture: 'amd64',
  size: 1024,
  dependencies: [],
  checksum: { type: 'sha256', value: 'fixture' },
  location: `https://fixture.invalid/${name}`,
  repository: {
    id: 'fixture',
    name: 'fixture',
    baseUrl: 'https://fixture.invalid',
    enabled: true,
    gpgCheck: false,
    isOfficial: false,
  },
});
class FixtureDownloader extends BaseOSDownloader {
  protected maxRetries = 1;
  protected getDownloadUrl(item: OSPackageInfo) {
    return item.location;
  }
  protected getFilename(item: OSPackageInfo) {
    return `${item.name}.deb`;
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let directory: string;
let services: OSDownloadOrchestrator[];
let pendingJobs: Promise<unknown>[];
let releaseStreams: () => void;
function startService() {
  const send = vi.fn();
  const window = {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, send },
  } as unknown as BrowserWindow;
  const service = createOSDownloadOrchestrator({ getMainWindow: () => window });
  services.push(service);
  return { service, send };
}
function start(service: OSDownloadOrchestrator, packages: OSPackageInfo[], concurrency: number) {
  const pending = service.startDownload({
    packages,
    distribution,
    architecture: 'amd64',
    outputDir: directory,
    concurrency,
  });
  pending.catch(() => undefined); // failures are asserted below; never leave a rejection unobserved
  pendingJobs.push(pending);
  return pending;
}
beforeEach(async () => {
  vi.resetAllMocks();
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'os-pool-'));
  services = [];
  pendingJobs = [];
  releaseStreams = () => {};
  boundary.factory.mockImplementation(
    (options: BaseDownloaderOptions) => new FixtureDownloader(options)
  );
  boundary.archive.mockResolvedValue(path.join(directory, 'os-packages.zip'));
});
afterEach(async () => {
  await Promise.all(services.map((service) => service.cancelDownload()));
  releaseStreams();
  await Promise.allSettled(pendingJobs);
  await fs.remove(directory);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function transport(waitForAbort = false) {
  const close = deferred<void>();
  releaseStreams = () => close.resolve();
  const stats = { active: 0, peak: 0, started: 0, cancelled: 0, closed: 0 };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      stats.started++;
      stats.active++;
      stats.peak = Math.max(stats.peak, stats.active);
      let ended = false;
      const finish = () => {
        if (!ended) {
          ended = true;
          stats.active--;
          stats.closed++;
        }
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(1024));
            if (!waitForAbort)
              timer = setTimeout(() => {
                controller.close();
                finish();
              }, 50);
          },
          async cancel() {
            if (timer) clearTimeout(timer);
            stats.cancelled++;
            if (waitForAbort) await close.promise;
            finish();
          },
        }),
        { headers: { 'content-length': '1024' } }
      );
    })
  );
  return stats;
}

describe('GUI OS bounded downloads with actual base streams and files', () => {
  it.each([1, 3, 6])(
    'runs at most %i transfers and reaches the configured concurrency',
    async (concurrency) => {
      const stats = transport();
      const packages = Array.from({ length: 12 }, (_, index) => pkg(`package-${index}`));
      const { service, send } = startService();
      const result = await start(service, packages, concurrency);
      expect(stats).toMatchObject({ peak: concurrency, active: 0, started: 12, closed: 12 });
      expect(result.success).toEqual(packages);
      expect(boundary.archive).toHaveBeenCalledTimes(1);
      const values = send.mock.calls
        .filter((call) => call[0] === 'os:download:progress')
        .map((call) => call[1] as OSDownloadProgress);
      expect(values.filter((item) => item.phase === 'downloading').at(-1)).toMatchObject({
        completedPackages: 12,
        activePackages: 0,
        totalPackages: 12,
      });
      expect(Math.max(...values.map((item) => item.activePackages ?? 0))).toBe(concurrency);
      expect(await fs.readdir(directory)).toEqual([]); // packaging is the only mocked file boundary
    }
  );

  it('waits for every aborted stream before removing staging and rejects an overlapping session', async () => {
    const stats = transport(true);
    const { service, send } = startService();
    const result = start(
      service,
      Array.from({ length: 8 }, (_, index) => pkg(`package-${index}`)),
      3
    );
    await vi.waitFor(() => expect(stats.started).toBe(3));
    await expect(start(service, [pkg('overlap')], 1)).rejects.toThrow('이미 OS 패키지 다운로드');
    let settled = false;
    result.then(() => {
      settled = true;
    });
    await service.cancelDownload();
    await vi.waitFor(() => expect(stats.cancelled).toBe(3));
    expect(settled).toBe(false);
    expect((await fs.readdir(directory)).some((name) => name.startsWith('.depssmuggler-os-'))).toBe(
      true
    );
    expect(boundary.archive).not.toHaveBeenCalled();
    releaseStreams();
    await expect(result).resolves.toMatchObject({
      success: [],
      failed: [],
      cancelled: true,
      generatedOutputs: [],
    });
    expect((await result).skipped).toHaveLength(8);
    expect(stats).toMatchObject({ active: 0, started: 3, closed: 3 });
    expect(await fs.readdir(directory)).toEqual([]);
    const count = send.mock.calls.length;
    for (const [options] of boundary.factory.mock.calls)
      options.onProgress({ currentPackage: 'stale', bytesDownloaded: 999 });
    expect(send).toHaveBeenCalledTimes(count);
  });

  it('drains peers on an unexpected rejection before cleanup and preserves the original exception', async () => {
    const stats = transport(true);
    const failure = new Error('unexpected disk failure');
    const fail = deferred<OSPackageDownloadResult>();
    boundary.factory.mockImplementation((options: BaseDownloaderOptions) => {
      const downloader = new FixtureDownloader(options);
      return {
        downloadPackage: (item: OSPackageInfo) =>
          item.name === 'fatal' ? fail.promise : downloader.downloadPackage(item),
      };
    });
    const { service } = startService();
    const pending = start(service, [pkg('fatal'), pkg('second'), pkg('third'), pkg('queued')], 3);
    await vi.waitFor(() => expect(stats.started).toBe(2));
    fail.reject(failure);
    await vi.waitFor(() => expect(stats.cancelled).toBe(2));
    expect(await fs.readdir(directory)).toHaveLength(1);
    expect(boundary.archive).not.toHaveBeenCalled();
    releaseStreams();
    await expect(pending).rejects.toBe(failure);
    expect(stats).toMatchObject({ active: 0, started: 2, closed: 2 });
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it('retries and skips the correct concurrent packages through the shared error queue', async () => {
    const attempts = new Map<string, number>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const name = new URL(url).pathname.slice(1);
        const count = (attempts.get(name) ?? 0) + 1;
        attempts.set(name, count);
        if (name === 'skip' || (name === 'retry' && count === 1))
          return new Response('failure', { status: 500 });
        return new Response(new Uint8Array(1024), { headers: { 'content-length': '1024' } });
      })
    );
    boundary.dialog.mockImplementation(async (_window, options) => ({
      response: options.message.includes('retry@') ? 0 : 1,
    }));
    const { service } = startService();
    const packages = [pkg('retry'), pkg('skip'), pkg('success')];
    const result = await start(service, packages, 3);
    expect(attempts).toEqual(
      new Map([
        ['retry', 2],
        ['skip', 1],
        ['success', 1],
      ])
    );
    expect(result).toMatchObject({
      success: [packages[0], packages[2]],
      skipped: [packages[1]],
      failed: [],
      cancelled: false,
    });
    expect(boundary.dialog).toHaveBeenCalledTimes(2);
    expect(new Set(boundary.factory.mock.calls.map(([options]) => options.onError)).size).toBe(1);
  });

  it('isolates equal filenames across active slots', async () => {
    const stats = transport();
    const { service } = startService();
    const packages = [pkg('same'), pkg('same')];
    const result = await start(service, packages, 2);
    expect(stats.peak).toBe(2);
    expect(result.success).toHaveLength(2);
    expect(new Set(boundary.factory.mock.calls.map(([options]) => options.outputDir)).size).toBe(2);
  });
});

it('keeps input order, individual failure/skip results, and stable focus while peers complete', async () => {
  const controller = new AbortController();
  const results = Array.from({ length: 4 }, () => deferred<OSPackageDownloadResult>());
  const callbacks: Array<(progress: OSDownloadProgress) => void> = [];
  let created = 0;
  const onProgress = vi.fn();
  const packages = Array.from({ length: 4 }, (_, index) => pkg(String(index)));
  const pending = runOSDownloadPool({
    packages,
    concurrency: 3,
    controller,
    cancel: () => controller.abort(),
    onProgress,
    createDownloader: (_slot, update) => {
      const index = created++;
      callbacks[index] = update;
      return { downloadPackage: () => results[index].promise };
    },
  });
  callbacks[1]({
    currentPackage: '1',
    currentIndex: 0,
    totalPackages: 1,
    bytesDownloaded: 900,
    totalBytes: 1024,
    speed: 99,
    phase: 'downloading',
  });
  expect(onProgress.mock.lastCall![0]).toMatchObject({
    currentPackage: '0',
    bytesDownloaded: 0,
    completedPackages: 0,
    activePackages: 3,
  });
  callbacks[0]({
    currentPackage: '0',
    currentIndex: 0,
    totalPackages: 1,
    bytesDownloaded: 500,
    totalBytes: 1024,
    speed: 10,
    phase: 'downloading',
  });
  results[1].resolve({ success: false, skipped: true });
  await vi.waitFor(() => expect(created).toBe(4));
  expect(onProgress.mock.lastCall![0]).toMatchObject({
    currentPackage: '0',
    bytesDownloaded: 500,
    speed: 10,
    completedPackages: 1,
    activePackages: 3,
  });
  const failure = { success: false, error: new Error('failed package') };
  results[2].resolve(failure);
  results[3].resolve({ success: true, filePath: 'fourth' });
  results[0].resolve({ success: true, filePath: 'first' });
  await expect(pending).resolves.toEqual([
    { success: true, filePath: 'first' },
    { success: false, skipped: true },
    failure,
    { success: true, filePath: 'fourth' },
  ]);
  const count = onProgress.mock.calls.length;
  callbacks[0]({} as OSDownloadProgress);
  expect(onProgress).toHaveBeenCalledTimes(count);
});
