import type { BrowserWindow } from 'electron';
import type { OSDownloadProgress } from '../../src/core/downloaders/os-shared/types';

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

  return {
    emitDownloadStatus(payload) {
      getMainWindow()?.webContents.send('download:status', payload);
    },

    emitPackageProgress(packageId, payload, force = false) {
      const now = Date.now();
      const lastTime = lastProgressTime.get(packageId) || 0;
      if (!force && now - lastTime < throttleMs) {
        return;
      }

      lastProgressTime.set(packageId, now);
      getMainWindow()?.webContents.send('download:progress', {
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
      getMainWindow()?.webContents.send('download:all-complete', payload);
    },

    emitOSProgress(progress) {
      getMainWindow()?.webContents.send('os:download:progress', progress);
    },

    emitOSResolveDependenciesProgress(payload) {
      getMainWindow()?.webContents.send('os:resolveDependencies:progress', payload);
    },
  };
}
