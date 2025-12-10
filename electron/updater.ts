import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater';
import { BrowserWindow, ipcMain } from 'electron';
import { createScopedLogger } from './utils/logger';

const log = createScopedLogger('Updater');

// 업데이트 상태
export interface UpdateStatus {
  checking: boolean;
  available: boolean;
  downloaded: boolean;
  downloading: boolean;
  error: string | null;
  progress: ProgressInfo | null;
  updateInfo: UpdateInfo | null;
}

let updateStatus: UpdateStatus = {
  checking: false,
  available: false,
  downloaded: false,
  downloading: false,
  error: null,
  progress: null,
  updateInfo: null,
};

let mainWindow: BrowserWindow | null = null;

/**
 * 렌더러에 상태 전송
 */
function sendStatusToRenderer() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:status', updateStatus);
  }
}

/**
 * 자동 업데이트 초기화
 */
export function initAutoUpdater(window: BrowserWindow) {
  mainWindow = window;

  // 로깅 설정
  autoUpdater.logger = {
    info: (message: unknown) => log.info(String(message)),
    warn: (message: unknown) => log.warn(String(message)),
    error: (message: unknown) => log.error(String(message)),
    debug: (message: unknown) => log.debug(String(message)),
  };

  // 자동 다운로드 비활성화 (사용자 승인 후 다운로드)
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // 이벤트 핸들러 등록
  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for updates...');
    updateStatus = {
      ...updateStatus,
      checking: true,
      error: null,
    };
    sendStatusToRenderer();
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    log.info(`Update available: ${info.version}`);
    updateStatus = {
      ...updateStatus,
      checking: false,
      available: true,
      updateInfo: info,
    };
    sendStatusToRenderer();
  });

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    log.info(`Current version is up to date: ${info.version}`);
    updateStatus = {
      ...updateStatus,
      checking: false,
      available: false,
      updateInfo: info,
    };
    sendStatusToRenderer();
  });

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    log.debug(`Download progress: ${progress.percent.toFixed(1)}%`);
    updateStatus = {
      ...updateStatus,
      downloading: true,
      progress,
    };
    sendStatusToRenderer();
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    log.info(`Update downloaded: ${info.version}`);
    updateStatus = {
      ...updateStatus,
      downloading: false,
      downloaded: true,
      updateInfo: info,
    };
    sendStatusToRenderer();
  });

  autoUpdater.on('error', (error: Error) => {
    log.error('Update error:', error);
    updateStatus = {
      ...updateStatus,
      checking: false,
      downloading: false,
      error: error.message,
    };
    sendStatusToRenderer();
  });

  // IPC 핸들러 등록
  registerIpcHandlers();
}

/**
 * IPC 핸들러 등록
 */
function registerIpcHandlers() {
  // 업데이트 체크
  ipcMain.handle('updater:check', async () => {
    log.info('Manual update check requested');
    try {
      const result = await autoUpdater.checkForUpdates();
      return { success: true, result };
    } catch (error) {
      log.error('Check for updates failed:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // 업데이트 다운로드
  ipcMain.handle('updater:download', async () => {
    log.info('Download update requested');
    try {
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (error) {
      log.error('Download update failed:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // 업데이트 설치 및 재시작
  ipcMain.handle('updater:install', () => {
    log.info('Install update and restart requested');
    autoUpdater.quitAndInstall(false, true);
    return { success: true };
  });

  // 현재 상태 조회
  ipcMain.handle('updater:status', () => {
    return updateStatus;
  });

  // 자동 업데이트 설정 변경
  ipcMain.handle('updater:set-auto-download', (_, enabled: boolean) => {
    autoUpdater.autoDownload = enabled;
    log.info(`Auto download ${enabled ? 'enabled' : 'disabled'}`);
    return { success: true };
  });
}

/**
 * 업데이트 체크 (앱 시작 시 호출)
 */
export async function checkForUpdatesOnStartup() {
  // 개발 모드에서는 체크하지 않음
  if (process.env.NODE_ENV === 'development' || !require('electron').app.isPackaged) {
    log.info('Skipping update check in development mode');
    return;
  }

  try {
    log.info('Checking for updates on startup...');
    await autoUpdater.checkForUpdates();
  } catch (error) {
    log.error('Startup update check failed:', error);
  }
}
