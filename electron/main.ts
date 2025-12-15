import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as https from 'https';
import axios from 'axios';

// SSL 인증서 검증 비활성화 (기업 프록시/방화벽 환경 지원)
// 환경변수로 제어 가능: DEPSSMUGGLER_STRICT_SSL=true로 설정하면 검증 활성화
if (process.env.DEPSSMUGGLER_STRICT_SSL !== 'true') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

  // axios 기본 설정에 httpsAgent 추가
  axios.defaults.httpsAgent = new https.Agent({
    rejectUnauthorized: false
  });
}
import { createScopedLogger } from './utils/logger';

// 스코프별 로거 생성
const log = createScopedLogger('Main');

// OS 패키지 핸들러
import { registerOSPackageHandlers } from './os-package-handlers';

// 분리된 핸들러 모듈 import
import { registerConfigHandlers } from './config-handlers';
import { registerCacheHandlers } from './cache-handlers';
import { registerHistoryHandlers } from './history-handlers';
import { registerSearchHandlers } from './search-handlers';
import { registerDownloadHandlers } from './download-handlers';

// 자동 업데이트 모듈
import { initAutoUpdater, checkForUpdatesOnStartup, registerDevModeHandlers } from './updater';

// 개발 모드 여부 확인
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Vite 개발 서버 URL
const VITE_DEV_SERVER_URL = 'http://localhost:3000';

let mainWindow: BrowserWindow | null = null;

// mainWindow getter 함수 (다른 모듈에서 사용)
export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

// Vite 서버가 준비될 때까지 대기하는 함수
async function waitForViteServer(
  url: string,
  maxRetries = 30,
  retryDelay = 500
): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await axios.get(url, { timeout: 1000 });
      if (response.status === 200) {
        log.info(`Vite server is ready after ${i + 1} attempts`);
        return true;
      }
    } catch {
      log.debug(`Waiting for Vite server... (${i + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
  return false;
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
  });

  // 로드 완료 후 창 표시 (깜빡임 방지)
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (isDev) {
    log.info('Waiting for Vite dev server...');
    const isServerReady = await waitForViteServer(VITE_DEV_SERVER_URL);

    if (isServerReady) {
      await mainWindow.loadURL(VITE_DEV_SERVER_URL);
      mainWindow.webContents.openDevTools();
    } else {
      log.error('Vite server did not start in time');
      app.quit();
    }
  } else {
    // 프로덕션 모드: 빌드된 정적 파일 로드
    // __dirname은 dist/electron/ 이므로 ../index.html로 접근
    const indexPath = path.join(__dirname, '../index.html');
    await mainWindow.loadFile(indexPath);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Electron 앱 준비 완료
app.whenReady().then(async () => {
  await createWindow();

  // 자동 업데이트 초기화
  if (!isDev && mainWindow) {
    // 프로덕션 모드: 전체 업데이트 기능
    initAutoUpdater(mainWindow);
    // 앱 시작 후 업데이트 확인
    setTimeout(() => {
      checkForUpdatesOnStartup();
    }, 3000);
  } else {
    // 개발 모드: 더미 핸들러만 등록 (렌더러 에러 방지)
    registerDevModeHandlers();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// =====================================================
// 핸들러 모듈 등록
// =====================================================

// 설정 핸들러 등록
registerConfigHandlers();

// 캐시 핸들러 등록
registerCacheHandlers();

// 히스토리 핸들러 등록
registerHistoryHandlers();

// 검색 및 의존성 해결 핸들러 등록
registerSearchHandlers();

// 다운로드 핸들러 등록 (mainWindow getter 전달)
registerDownloadHandlers(getMainWindow);

// OS 패키지 핸들러 등록 (mainWindow getter 전달)
registerOSPackageHandlers(getMainWindow);

// =====================================================
// 기본 IPC 핸들러 (앱 정보, 다이얼로그 등)
// =====================================================

// DevTools 토글
ipcMain.handle('toggle-devtools', async () => {
  if (mainWindow) {
    if (mainWindow.webContents.isDevToolsOpened()) {
      mainWindow.webContents.closeDevTools();
    } else {
      mainWindow.webContents.openDevTools();
    }
  }
});

// 앱 버전 반환
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// 앱 경로 반환
ipcMain.handle('get-app-path', () => {
  return app.getPath('userData');
});

// 폴더 선택 다이얼로그
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory', 'createDirectory'],
    title: '출력 폴더 선택',
  });

  if (result.canceled) {
    return null;
  }

  return result.filePaths[0];
});

// 디렉토리 선택 다이얼로그 (설정용)
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory', 'createDirectory'],
    title: '다운로드 폴더 선택',
  });

  if (result.canceled) {
    return null;
  }

  return result.filePaths[0];
});

// 폴더 열기 (Finder/Explorer)
ipcMain.handle('open-folder', async (_, folderPath: string) => {
  await shell.openPath(folderPath);
});

// 파일 저장 다이얼로그
ipcMain.handle('save-file', async (_, defaultPath: string) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    defaultPath,
    title: '파일 저장',
    filters: [
      { name: 'ZIP 파일', extensions: ['zip'] },
      { name: 'TAR.GZ 파일', extensions: ['tar.gz'] },
      { name: '모든 파일', extensions: ['*'] },
    ],
  });

  if (result.canceled) {
    return null;
  }

  return result.filePath;
});

log.info('Electron 메인 프로세스 초기화 완료');
