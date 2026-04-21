import type { DownloadExecutionState } from '../download-package-router';
import type { DownloadProgressEmitter } from '../download-progress';

export interface DownloadSessionState {
  sessionId: number;
  cancelled: boolean;
  paused: boolean;
  abortController: AbortController;
}

export interface DownloadSessionRegistry {
  createSession(sessionId?: number): DownloadSessionState;
  getActiveSession(): DownloadSessionState | null;
  pauseActiveSession(): void;
  resumeActiveSession(): void;
  cancelActiveSession(): void;
}

export function createDownloadSessionRegistry(): DownloadSessionRegistry {
  let activeSession: DownloadSessionState | null = null;
  let lastSessionId = 0;

  return {
    createSession(sessionId) {
      const resolvedSessionId = sessionId ?? lastSessionId + 1;
      lastSessionId = Math.max(lastSessionId, resolvedSessionId);

      const session: DownloadSessionState = {
        sessionId: resolvedSessionId,
        cancelled: false,
        paused: false,
        abortController: new AbortController(),
      };

      activeSession = session;
      return session;
    },

    getActiveSession() {
      return activeSession;
    },

    pauseActiveSession() {
      if (activeSession) {
        activeSession.paused = true;
      }
    },

    resumeActiveSession() {
      if (activeSession) {
        activeSession.paused = false;
      }
    },

    cancelActiveSession() {
      if (activeSession) {
        activeSession.cancelled = true;
        activeSession.abortController.abort();
      }
    },
  };
}

export function createExecutionState(session: DownloadSessionState): DownloadExecutionState {
  return {
    isCancelled: () => session.cancelled,
    isPaused: () => session.paused,
    waitWhilePaused: async () => {
      while (session.paused && !session.cancelled) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
    get signal() {
      return session.abortController.signal;
    },
  };
}

export function bindSessionProgressEmitter(
  progressEmitter: DownloadProgressEmitter,
  sessionId: number
): DownloadProgressEmitter {
  return {
    emitDownloadStatus(payload) {
      progressEmitter.emitDownloadStatus({
        ...payload,
        sessionId,
      });
    },

    emitPackageProgress(packageId, payload, force = false) {
      progressEmitter.emitPackageProgress(
        packageId,
        {
          ...payload,
          sessionId,
        },
        force
      );
    },

    clearPackageProgress(packageId) {
      progressEmitter.clearPackageProgress(packageId);
    },

    clearAllPackageProgress() {
      progressEmitter.clearAllPackageProgress();
    },

    emitAllComplete(payload) {
      progressEmitter.emitAllComplete({
        ...payload,
        sessionId,
      });
    },

    emitOSProgress(progress) {
      progressEmitter.emitOSProgress(progress);
    },

    emitOSResolveDependenciesProgress(payload) {
      progressEmitter.emitOSResolveDependenciesProgress(payload);
    },
  };
}
