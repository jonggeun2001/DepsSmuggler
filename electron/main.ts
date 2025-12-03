import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';

// 개발 모드 여부 확인
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Vite 개발 서버 URL
const VITE_DEV_SERVER_URL = 'http://localhost:3000';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    resizable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    title: 'DepsSmuggler - 의존성 밀수꾼',
    show: false, // ready-to-show 이벤트 후 표시
  });

  // 윈도우가 준비되면 표시
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // 개발 모드: Vite 개발 서버 로드, 프로덕션: 빌드된 파일 로드
  if (isDev) {
    // Vite 개발 서버에서 로드
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
    // DevTools 자동 열기
    mainWindow.webContents.openDevTools();
  } else {
    // 프로덕션: dist/renderer/index.html (Vite 빌드 출력)
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Electron 앱이 준비되면 윈도우 생성
app.whenReady().then(() => {
  createWindow();

  // macOS: Dock 아이콘 클릭 시 윈도우가 없으면 새로 생성
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 모든 윈도우가 닫히면 앱 종료 (macOS 제외)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC 핸들러
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

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

// 패키지 검색 핸들러 (Mock - 추후 실제 API 연동)
ipcMain.handle('search:packages', async (_, type: string, query: string) => {
  // TODO: 실제 패키지 레지스트리 API 호출로 대체
  // PyPI, npm, Maven Central, Docker Hub 등
  console.log(`Searching ${type} packages: ${query}`);

  // Mock 결과 반환
  const baseVersions = ['2.0.0', '1.9.0', '1.8.5', '1.8.0', '1.7.0'];

  const mockResults: Record<string, Array<{
    name: string;
    version: string;
    description: string;
    versions: string[];
  }>> = {
    pip: [
      {
        name: query,
        version: '2.0.0',
        description: `${query} - Python 패키지`,
        versions: baseVersions,
      },
      {
        name: `${query}-extra`,
        version: '1.5.0',
        description: `${query} 확장 패키지`,
        versions: ['1.5.0', '1.4.0', '1.3.0'],
      },
    ],
    conda: [
      {
        name: query,
        version: '2.0.0',
        description: `${query} - Conda 패키지`,
        versions: baseVersions,
      },
    ],
    maven: [
      {
        name: `org.example:${query}`,
        version: '3.0.0',
        description: `${query} Maven 아티팩트`,
        versions: ['3.0.0', '2.5.0', '2.0.0'],
      },
    ],
    npm: [
      {
        name: query,
        version: '5.0.0',
        description: `${query} npm 패키지`,
        versions: ['5.0.0', '4.0.0', '3.0.0'],
      },
      {
        name: `@types/${query}`,
        version: '1.0.0',
        description: 'TypeScript 타입 정의',
        versions: ['1.0.0', '0.9.0'],
      },
    ],
    docker: [
      {
        name: query,
        version: 'latest',
        description: `${query} 공식 이미지`,
        versions: ['latest', '3.0', '2.0', '1.0'],
      },
    ],
    yum: [
      {
        name: query,
        version: '1.0-1.el8',
        description: `${query} RPM 패키지`,
        versions: ['1.0-1.el8', '0.9-1.el8'],
      },
    ],
    apt: [
      {
        name: query,
        version: '1.0-1',
        description: `${query} Debian 패키지`,
        versions: ['1.0-1', '0.9-1'],
      },
    ],
    apk: [
      {
        name: query,
        version: '1.0-r0',
        description: `${query} Alpine 패키지`,
        versions: ['1.0-r0', '0.9-r0'],
      },
    ],
  };

  return {
    results: mockResults[type] || [
      {
        name: query,
        version: '1.0.0',
        description: `${query} 패키지`,
        versions: ['1.0.0', '0.9.0'],
      },
    ],
  };
});

// 패키지 자동완성 제안
ipcMain.handle('search:suggest', async (_, type: string, query: string) => {
  // TODO: 실제 API 연동
  console.log(`Suggesting ${type} packages for: ${query}`);

  // Mock 제안
  return [query, `${query}-core`, `${query}-utils`, `py${query}`];
});
