import { describe, expect, it, vi } from 'vitest';
import {
  bindSessionProgressEmitter,
  createDownloadSessionRegistry,
  createExecutionState,
} from './session-registry';
import type { DownloadProgressEmitter } from '../download-progress';

describe('createDownloadSessionRegistry', () => {
  it('sessionId를 자동 증가시키고 active session을 교체해야 함', () => {
    const registry = createDownloadSessionRegistry();

    const first = registry.createSession();
    const second = registry.createSession();

    expect(first.sessionId).toBe(1);
    expect(second.sessionId).toBe(2);
    expect(registry.getActiveSession()).toBe(second);
  });

  it('활성 세션만 pause/resume/cancel 처리하고 이전 세션 상태는 유지해야 함', () => {
    const registry = createDownloadSessionRegistry();

    const first = registry.createSession(10);
    registry.cancelActiveSession();

    const second = registry.createSession(11);
    registry.pauseActiveSession();
    registry.resumeActiveSession();

    expect(first.cancelled).toBe(true);
    expect(first.abortController.signal.aborted).toBe(true);
    expect(second.cancelled).toBe(false);
    expect(second.paused).toBe(false);
    expect(registry.getActiveSession()).toBe(second);
  });
});

describe('createExecutionState', () => {
  it('세션 상태를 DownloadExecutionState로 노출해야 함', async () => {
    const registry = createDownloadSessionRegistry();
    const session = registry.createSession(21);
    const executionState = createExecutionState(session);

    expect(executionState.isCancelled()).toBe(false);
    expect(executionState.isPaused()).toBe(false);
    expect(executionState.signal).toBe(session.abortController.signal);

    registry.pauseActiveSession();
    expect(executionState.isPaused()).toBe(true);

    registry.cancelActiveSession();
    expect(executionState.isCancelled()).toBe(true);

    await executionState.waitWhilePaused();
  });
});

describe('bindSessionProgressEmitter', () => {
  it('sessionId가 필요한 이벤트 payload에 세션 정보를 주입해야 함', () => {
    const emitter: DownloadProgressEmitter = {
      emitDownloadStatus: vi.fn(),
      emitPackageProgress: vi.fn(),
      clearPackageProgress: vi.fn(),
      clearAllPackageProgress: vi.fn(),
      emitAllComplete: vi.fn(),
      emitOSProgress: vi.fn(),
      emitOSResolveDependenciesProgress: vi.fn(),
    };

    const sessionEmitter = bindSessionProgressEmitter(emitter, 33);

    sessionEmitter.emitDownloadStatus({
      phase: 'downloading',
      message: '다운로드 중...',
    });
    sessionEmitter.emitPackageProgress('pkg-1', {
      status: 'downloading',
      progress: 50,
      downloadedBytes: 5,
      totalBytes: 10,
    });
    sessionEmitter.emitAllComplete({
      success: true,
    });
    sessionEmitter.clearPackageProgress('pkg-1');
    sessionEmitter.clearAllPackageProgress();
    sessionEmitter.emitOSResolveDependenciesProgress({
      message: 'resolving',
      current: 1,
      total: 2,
    });

    expect(emitter.emitDownloadStatus).toHaveBeenCalledWith({
      sessionId: 33,
      phase: 'downloading',
      message: '다운로드 중...',
    });
    expect(emitter.emitPackageProgress).toHaveBeenCalledWith(
      'pkg-1',
      {
        sessionId: 33,
        status: 'downloading',
        progress: 50,
        downloadedBytes: 5,
        totalBytes: 10,
      },
      false
    );
    expect(emitter.emitAllComplete).toHaveBeenCalledWith({
      sessionId: 33,
      success: true,
    });
    expect(emitter.clearPackageProgress).toHaveBeenCalledWith('pkg-1');
    expect(emitter.clearAllPackageProgress).toHaveBeenCalled();
    expect(emitter.emitOSResolveDependenciesProgress).toHaveBeenCalledWith({
      message: 'resolving',
      current: 1,
      total: 2,
    });
  });
});
