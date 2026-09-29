import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import type { OSDownloadProgress } from '../../src/core/downloaders/os-shared/types';
import { createDownloadProgressEmitter } from './download-progress';

vi.mock('../utils/logger', () => ({ createScopedLogger: () => ({ warn: vi.fn() }) }));
const progress: OSDownloadProgress = {
  currentPackage: 'fixture',
  currentIndex: 1,
  totalPackages: 3,
  completedPackages: 0,
  activePackages: 3,
  bytesDownloaded: 10,
  totalBytes: 100,
  speed: 5,
  phase: 'downloading',
};
const archive = (percentage: number) => ({
  message: 'archive',
  archiveProgress: {
    processedFiles: 1,
    totalFiles: 2,
    processedBytes: percentage,
    totalBytes: 100,
    percentage,
  },
});
let send: ReturnType<typeof vi.fn>;
let destroyed: boolean;
function setup() {
  return createDownloadProgressEmitter(
    () =>
      ({
        isDestroyed: () => destroyed,
        webContents: { isDestroyed: () => destroyed, send },
      }) as unknown as BrowserWindow
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  send = vi.fn();
  destroyed = false;
});
afterEach(() => vi.useRealTimers());

describe('OS progress latest-value coalescing', () => {
  it('sends the first update at clock zero and only the latest bytes/speed at 150ms', () => {
    const emitter = setup();
    emitter.emitOSProgress(progress);
    for (let i = 11; i < 100; i++)
      emitter.emitOSProgress({ ...progress, bytesDownloaded: i, speed: i });
    vi.advanceTimersByTime(149);
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(send.mock.calls).toEqual([
      ['os:download:progress', progress],
      ['os:download:progress', { ...progress, bytesDownloaded: 99, speed: 99 }],
    ]);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(150);
    emitter.emitOSProgress({ ...progress, bytesDownloaded: 99 });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it.each([
    { currentPackage: 'next' },
    { phase: 'packaging' as const },
    { currentIndex: 2 },
    { totalPackages: 4 },
    { completedPackages: 1 },
    { activePackages: 2 },
    { bytesDownloaded: 100 },
    { bytesDownloaded: 0 },
    { packagingDetails: { message: 'repository' } },
  ])('delivers boundaries immediately and removes older pending values: %j', (boundary) => {
    const emitter = setup();
    emitter.emitOSProgress(progress);
    emitter.emitOSProgress({ ...progress, bytesDownloaded: 50 });
    const next = { ...progress, ...boundary };
    emitter.emitOSProgress(next);
    expect(send.mock.calls).toEqual([
      ['os:download:progress', progress],
      ['os:download:progress', next],
    ]);
    vi.advanceTimersByTime(1000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('forces the first archive completion but coalesces repeated 100% updates', () => {
    const emitter = setup();
    const value = { ...progress, phase: 'packaging' as const, packagingDetails: archive(10) };
    emitter.emitOSProgress(value);
    emitter.emitOSProgress({ ...value, packagingDetails: archive(99) });
    emitter.emitOSProgress({ ...value, packagingDetails: archive(100) });
    expect(send).toHaveBeenCalledTimes(2);
    emitter.emitOSProgress({ ...value, packagingDetails: archive(100) });
    expect(send).toHaveBeenCalledTimes(2);
    emitter.clearOSProgress();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('flushes the latest value before an error and allows an explicit forced update', () => {
    const emitter = setup();
    emitter.emitOSProgress(progress);
    emitter.emitOSProgress({ ...progress, bytesDownloaded: 40 });
    emitter.flushOSProgress();
    expect(send).toHaveBeenLastCalledWith('os:download:progress', {
      ...progress,
      bytesDownloaded: 40,
    });
    emitter.emitOSProgress({ ...progress, bytesDownloaded: 60 });
    emitter.emitOSProgress({ ...progress, bytesDownloaded: 70 }, true);
    expect(send).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(1000);
    emitter.flushOSProgress();
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('drops pending state on cancellation and sends a fresh session immediately', () => {
    const emitter = setup();
    emitter.emitOSProgress(progress);
    emitter.emitOSProgress({ ...progress, bytesDownloaded: 40 });
    emitter.clearOSProgress();
    emitter.flushOSProgress();
    expect(vi.getTimerCount()).toBe(0);
    emitter.emitOSProgress({ ...progress, bytesDownloaded: 1 });
    expect(send).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(send).toHaveBeenLastCalledWith('os:download:progress', {
      ...progress,
      bytesDownloaded: 1,
    });
  });

  it('does not throw or retain a timer when a window closes before trailing delivery', () => {
    const emitter = setup();
    emitter.emitOSProgress(progress);
    emitter.emitOSProgress({ ...progress, bytesDownloaded: 40 });
    destroyed = true;
    expect(() => vi.advanceTimersByTime(150)).not.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
