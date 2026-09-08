import { describe, expect, it, vi } from 'vitest';
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
