import type { PackagingDetails } from '../../src/types/packaging';
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

export interface DownloadStatusPayload extends PackagingDetails {
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
  emitPackageProgress(packageId: string, payload: PackageProgressPayload, force?: boolean): void;
  clearPackageProgress(packageId: string): void;
  clearAllPackageProgress(): void;
  emitAllComplete(payload: Record<string, unknown>): void;
  emitOSProgress(progress: OSDownloadProgress, force?: boolean): void;
  flushOSProgress(): void;
  clearOSProgress(): void;
  emitOSResolveDependenciesProgress(payload: ResolveProgressPayload): void;
}

export function createDownloadProgressEmitter(
  getMainWindow: () => BrowserWindow | null,
  throttleMs = 1000
): DownloadProgressEmitter {
  const lastProgressTime = new Map<string, number>();
  const osIntervalMs = 150;
  let osLastTime = 0;
  let osLast: OSDownloadProgress | undefined;
  let osPending: OSDownloadProgress | undefined;
  let osTimer: ReturnType<typeof setTimeout> | undefined;
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

  const clearOSTimer = () => {
    if (osTimer !== undefined) clearTimeout(osTimer);
    osTimer = undefined;
  };
  const sendOS = (progress: OSDownloadProgress) => {
    clearOSTimer();
    osPending = undefined;
    osLastTime = Date.now();
    osLast = progress;
    send('os:download:progress', progress);
  };
  const flushOSProgress = () => {
    clearOSTimer();
    if (osPending) sendOS(osPending);
  };
  const isComplete = (progress: OSDownloadProgress) =>
    progress.totalBytes > 0 && progress.bytesDownloaded >= progress.totalBytes;
  const isOSBoundary = (progress: OSDownloadProgress) =>
    !osLast ||
    progress.phase !== osLast.phase ||
    progress.currentPackage !== osLast.currentPackage ||
    progress.currentIndex !== osLast.currentIndex ||
    progress.totalPackages !== osLast.totalPackages ||
    progress.completedPackages !== osLast.completedPackages ||
    progress.activePackages !== osLast.activePackages ||
    progress.packagingDetails?.message !== osLast.packagingDetails?.message ||
    progress.bytesDownloaded < osLast.bytesDownloaded ||
    (isComplete(progress) && !isComplete(osLast)) ||
    ((progress.packagingDetails?.archiveProgress?.percentage ?? 0) >= 100 &&
      (osLast.packagingDetails?.archiveProgress?.percentage ?? 0) < 100);

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

    emitOSProgress(progress, force = false) {
      if (force || isOSBoundary(progress) || Date.now() - osLastTime >= osIntervalMs) {
        sendOS(progress);
        return;
      }
      // Retain the latest aggregate payload, including its focused package's bytes and speed.
      osPending = progress;
      if (osTimer === undefined) {
        osTimer = setTimeout(flushOSProgress, osIntervalMs - (Date.now() - osLastTime));
        osTimer.unref?.();
      }
    },

    flushOSProgress,

    clearOSProgress() {
      clearOSTimer();
      osPending = undefined;
      osLast = undefined;
      osLastTime = 0;
    },

    emitOSResolveDependenciesProgress(payload) {
      send('os:resolveDependencies:progress', payload);
    },
  };
}
