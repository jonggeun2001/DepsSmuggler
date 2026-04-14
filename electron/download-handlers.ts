/**
 * 다운로드 관련 IPC 핸들러
 */

import { BrowserWindow, ipcMain } from 'electron';
import { createScopedLogger } from './utils/logger';
import { createDownloadOrchestrator } from './services/download-orchestrator';
import { createOSDownloadOrchestrator } from './services/os-download-orchestrator';

const log = createScopedLogger('Download');

export function registerDownloadHandlers(windowGetter: () => BrowserWindow | null): void {
  const downloadOrchestrator = createDownloadOrchestrator({
    getMainWindow: windowGetter,
  });
  const osDownloadOrchestrator = createOSDownloadOrchestrator({
    getMainWindow: windowGetter,
  });

  ipcMain.handle('download:start', async (_event, data) => {
    return downloadOrchestrator.startDownload(data);
  });

  ipcMain.handle('download:pause', async () => {
    return downloadOrchestrator.pauseDownload();
  });

  ipcMain.handle('download:resume', async () => {
    return downloadOrchestrator.resumeDownload();
  });

  ipcMain.handle('download:cancel', async () => {
    return downloadOrchestrator.cancelDownload();
  });

  ipcMain.handle('download:check-path', async (_event, outputDir: string) => {
    return downloadOrchestrator.checkPath(outputDir);
  });

  ipcMain.handle('download:clear-path', async (_event, outputDir: string) => {
    return downloadOrchestrator.clearPath(outputDir);
  });

  ipcMain.handle('os:resolveDependencies', async (_event, options) => {
    return osDownloadOrchestrator.resolveDependencies(options);
  });

  ipcMain.handle('os:download:start', async (_event, options) => {
    return osDownloadOrchestrator.startDownload(options);
  });

  ipcMain.handle('os:download:cancel', async () => {
    return osDownloadOrchestrator.cancelDownload();
  });

  ipcMain.handle('os:cache:stats', async () => {
    return osDownloadOrchestrator.getCacheStats();
  });

  ipcMain.handle('os:cache:clear', async () => {
    return osDownloadOrchestrator.clearCache();
  });

  log.info('다운로드 핸들러 등록 완료');
}
