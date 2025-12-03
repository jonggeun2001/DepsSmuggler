// Electron API 타입 정의 (렌더러 프로세스용)

export interface DownloadAPI {
  start: (packages: unknown[]) => Promise<void>;
  pause: () => Promise<void>;
  cancel: () => Promise<void>;
  onProgress: (callback: (progress: unknown) => void) => void;
  onComplete: (callback: (result: unknown) => void) => void;
  onError: (callback: (error: unknown) => void) => void;
}

export interface ConfigAPI {
  get: () => Promise<unknown>;
  set: (config: unknown) => Promise<void>;
  reset: () => Promise<void>;
}

export interface FileSystemAPI {
  selectDirectory: () => Promise<string | null>;
  selectFile: (filters?: unknown) => Promise<string | null>;
  readFile: (filePath: string) => Promise<string>;
}

export interface CacheAPI {
  getSize: () => Promise<number>;
  clear: () => Promise<void>;
}

export interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  getAppPath: () => Promise<string>;
  download: DownloadAPI;
  config: ConfigAPI;
  fs: FileSystemAPI;
  cache: CacheAPI;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
