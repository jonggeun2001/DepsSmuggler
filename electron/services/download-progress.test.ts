import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { createDownloadProgressEmitter } from './download-progress';

const warning = vi.hoisted(() => vi.fn());
vi.mock('../utils/logger', () => ({ createScopedLogger: () => ({ warn: warning }) }));

describe('download progress IPC boundary', () => {
  it('닫힌 창과 send 실패가 다운로드 실행으로 전파되지 않고 새 창에는 다시 전달한다', () => {
    const send = vi.fn(() => { throw new Error('Object has been destroyed'); });
    let destroyed = false;
    const window = {
      isDestroyed: () => destroyed,
      webContents: { isDestroyed: () => destroyed, send },
    } as unknown as BrowserWindow;
    const emitter = createDownloadProgressEmitter(() => window);
    expect(() => emitter.emitAllComplete({ success: true })).not.toThrow();
    expect(warning).toHaveBeenCalled();
    destroyed = true;
    send.mockClear();
    expect(() => emitter.emitDownloadStatus({ phase: 'downloading', message: '진행 중' })).not.toThrow();
    expect(send).not.toHaveBeenCalled();
    destroyed = false;
    send.mockImplementation(() => undefined);
    emitter.emitAllComplete({ success: true });
    expect(send).toHaveBeenCalledWith('download:all-complete', { success: true });
  });

  it('정상 진행 이벤트의 payload와 throttle을 유지한다', () => {
    const send = vi.fn();
    const window = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send } } as unknown as BrowserWindow;
    const emitter = createDownloadProgressEmitter(() => window);
    const payload = { status: 'downloading', progress: 25, downloadedBytes: 25, totalBytes: 100 };
    emitter.emitPackageProgress('pkg', payload);
    emitter.emitPackageProgress('pkg', payload);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('download:progress', { packageId: 'pkg', ...payload });
    emitter.clearPackageProgress('pkg');
    emitter.emitPackageProgress('pkg', payload);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('download progress IPC emission', () => {
  const payload = {
    sessionId: 4,
    status: 'downloading',
    progress: 10,
    downloadedBytes: 10,
    totalBytes: 100,
  };
  const osProgress = {
    currentPackage: 'curl',
    currentIndex: 1,
    totalPackages: 2,
    bytesDownloaded: 10,
    totalBytes: 100,
    speed: 5,
    phase: 'downloading' as const,
  };
  let send: ReturnType<typeof vi.fn>;
  let window: BrowserWindow | null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    send = vi.fn();
    window = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send } } as unknown as BrowserWindow;
  });

  afterEach(() => vi.useRealTimers());

  it('throttles each package independently and permits the exact interval boundary', () => {
    const emitter = createDownloadProgressEmitter(() => window, 1000);
    emitter.emitPackageProgress('a', payload);
    emitter.emitPackageProgress('b', payload);
    vi.advanceTimersByTime(999);
    emitter.emitPackageProgress('a', { ...payload, progress: 20 });
    expect(send).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    emitter.emitPackageProgress('a', { ...payload, progress: 30 });
    expect(send).toHaveBeenLastCalledWith('download:progress', {
      packageId: 'a',
      ...payload,
      progress: 30,
    });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('forced completion bypasses throttling and establishes the next throttle interval', () => {
    const emitter = createDownloadProgressEmitter(() => window, 1000);
    emitter.emitPackageProgress('a', payload);
    vi.advanceTimersByTime(500);
    emitter.emitPackageProgress('a', { ...payload, status: 'completed', progress: 100 }, true);
    vi.advanceTimersByTime(500);
    emitter.emitPackageProgress('a', payload);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith('download:progress', {
      packageId: 'a',
      ...payload,
      status: 'completed',
      progress: 100,
    });
  });

  it('clears individual and all package throttle state without affecting other packages', () => {
    const emitter = createDownloadProgressEmitter(() => window);
    emitter.emitPackageProgress('a', payload);
    emitter.emitPackageProgress('b', payload);
    emitter.clearPackageProgress('a');
    emitter.emitPackageProgress('a', payload);
    emitter.emitPackageProgress('b', payload);
    expect(send).toHaveBeenCalledTimes(3);
    emitter.clearAllPackageProgress();
    emitter.emitPackageProgress('a', payload);
    emitter.emitPackageProgress('b', payload);
    expect(send).toHaveBeenCalledTimes(5);
  });

  it('uses the current main window and preserves payloads on all unthrottled channels', () => {
    const emitter = createDownloadProgressEmitter(() => window);
    const status = { sessionId: 4, phase: 'packaging', message: '압축 중' };
    const complete = { sessionId: 4, success: false, cancelled: true };
    const resolve = { message: 'curl', current: 1, total: 2 };
    emitter.emitDownloadStatus(status);
    emitter.emitAllComplete(complete);
    emitter.emitOSProgress(osProgress);
    emitter.emitOSResolveDependenciesProgress(resolve);
    expect(send.mock.calls).toEqual([
      ['download:status', status],
      ['download:all-complete', complete],
      ['os:download:progress', osProgress],
      ['os:resolveDependencies:progress', resolve],
    ]);
    const replacementSend = vi.fn();
    window = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: replacementSend } } as unknown as BrowserWindow;
    emitter.emitDownloadStatus(status);
    expect(replacementSend).toHaveBeenCalledWith('download:status', status);
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('silently skips delivery when no main window exists', () => {
    window = null;
    const emitter = createDownloadProgressEmitter(() => window);
    expect(() => {
      emitter.emitDownloadStatus({ phase: 'done', message: '' });
      emitter.emitPackageProgress('a', payload);
      emitter.emitAllComplete({});
      emitter.emitOSProgress(osProgress);
      emitter.emitOSResolveDependenciesProgress({ message: '', current: 0, total: 0 });
      emitter.clearPackageProgress('unknown');
      emitter.clearAllPackageProgress();
    }).not.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});
