import type { BrowserWindow } from 'electron';
import type { OSDownloadProgress } from '../../src/core/downloaders/os-shared/types';
import { createScopedLogger } from '../utils/logger';

const log = createScopedLogger('DownloadProgress');

export interface PackageProgressPayload {
  sessionId?: number;
  status: string;
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
  speed?: number;
  error?: string;
}

export interface DownloadStatusPayload {
  sessionId?: number;
  phase: string;
  message: string;
}

export interface ResolveProgressPayload {
  message: string;
  current: number;
  total: number;
}

export interface DownloadProgressEmitter {
  emitDownloadStatus(payload: DownloadStatusPayload): void;
  emitPackageProgress(
    packageId: string,
    payload: PackageProgressPayload,
    force?: boolean
  ): void;
  clearPackageProgress(packageId: string): void;
  clearAllPackageProgress(): void;
  emitAllComplete(payload: Record<string, unknown>): void;
  emitOSProgress(progress: OSDownloadProgress): void;
  emitOSResolveDependenciesProgress(payload: ResolveProgressPayload): void;
}

export function createDownloadProgressEmitter(
  getMainWindow: () => BrowserWindow | null,
  throttleMs = 1000
): DownloadProgressEmitter {
  const lastProgressTime = new Map<string, number>();
  const send = (channel: string, payload: unknown): void => {
    try {
      const window = getMainWindow();
      if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
      window.webContents.send(channel, payload);
    } catch (error) {
      // 창 닫힘과 send 사이의 경쟁도 처리한다. UI 알림 실패는 다운로드 실패가 아니다.
      log.warn(`진행 이벤트 전달 실패 (${channel}):`, error);
    }
  };

  return {
    emitDownloadStatus(payload) {
      send('download:status', payload);
    },

    emitPackageProgress(packageId, payload, force = false) {
      const now = Date.now();
      const lastTime = lastProgressTime.get(packageId) || 0;
      if (!force && now - lastTime < throttleMs) {
        return;
      }

      lastProgressTime.set(packageId, now);
      send('download:progress', {
        packageId,
        ...payload,
      });
    },

    clearPackageProgress(packageId) {
      lastProgressTime.delete(packageId);
    },

    clearAllPackageProgress() {
      lastProgressTime.clear();
    },

    emitAllComplete(payload) {
      send('download:all-complete', payload);
    },

    emitOSProgress(progress) {
      send('os:download:progress', progress);
    },

    emitOSResolveDependenciesProgress(payload) {
      send('os:resolveDependencies:progress', payload);
    },
  };
}
