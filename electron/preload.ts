import { contextBridge, ipcRenderer } from 'electron';

// 렌더러 프로세스에 노출할 API 정의
const electronAPI = {
  // 앱 정보
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('get-app-version'),
  getAppPath: (): Promise<string> => ipcRenderer.invoke('get-app-path'),

  // 파일 다이얼로그
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('select-folder'),
  saveFile: (defaultPath: string): Promise<string | null> =>
    ipcRenderer.invoke('save-file', defaultPath),

  // 다운로드 관련 (향후 구현)
  download: {
    start: (packages: unknown[]): Promise<void> =>
      ipcRenderer.invoke('download:start', packages),
    pause: (): Promise<void> => ipcRenderer.invoke('download:pause'),
    cancel: (): Promise<void> => ipcRenderer.invoke('download:cancel'),
    onProgress: (callback: (progress: unknown) => void): () => void => {
      const handler = (_event: Electron.IpcRendererEvent, progress: unknown) =>
        callback(progress);
      ipcRenderer.on('download:progress', handler);
      return () => ipcRenderer.removeListener('download:progress', handler);
    },
    onComplete: (callback: (result: unknown) => void): () => void => {
      const handler = (_event: Electron.IpcRendererEvent, result: unknown) =>
        callback(result);
      ipcRenderer.on('download:complete', handler);
      return () => ipcRenderer.removeListener('download:complete', handler);
    },
    onError: (callback: (error: unknown) => void): () => void => {
      const handler = (_event: Electron.IpcRendererEvent, error: unknown) =>
        callback(error);
      ipcRenderer.on('download:error', handler);
      return () => ipcRenderer.removeListener('download:error', handler);
    },
  },

  // 설정 관련 (향후 구현)
  config: {
    get: (): Promise<unknown> => ipcRenderer.invoke('config:get'),
    set: (config: unknown): Promise<void> => ipcRenderer.invoke('config:set', config),
    reset: (): Promise<void> => ipcRenderer.invoke('config:reset'),
  },

  // 파일 시스템 관련 (향후 구현)
  fs: {
    selectDirectory: (): Promise<string | null> =>
      ipcRenderer.invoke('fs:select-directory'),
    selectFile: (filters?: unknown): Promise<string | null> =>
      ipcRenderer.invoke('fs:select-file', filters),
    readFile: (filePath: string): Promise<string> =>
      ipcRenderer.invoke('fs:read-file', filePath),
  },

  // 캐시 관련 (향후 구현)
  cache: {
    getSize: (): Promise<number> => ipcRenderer.invoke('cache:get-size'),
    clear: (): Promise<void> => ipcRenderer.invoke('cache:clear'),
  },

  // 패키지 검색 관련
  search: {
    packages: (
      type: string,
      query: string
    ): Promise<{
      results: Array<{
        name: string;
        version: string;
        description?: string;
        versions?: string[];
      }>;
    }> => ipcRenderer.invoke('search:packages', type, query),
    suggest: (type: string, query: string): Promise<string[]> =>
      ipcRenderer.invoke('search:suggest', type, query),
  },
};

// contextBridge를 통해 안전하게 렌더러에 API 노출
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// TypeScript 타입 정의를 위한 선언 (렌더러에서 사용)
export type ElectronAPI = typeof electronAPI;
