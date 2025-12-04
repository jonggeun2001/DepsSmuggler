// Electron API 타입 정의 (렌더러 프로세스용)

export interface DownloadStatusData {
  phase: 'resolving' | 'downloading' | 'packaging' | 'complete';
  message: string;
}

export interface DepsResolvedData {
  originalPackages: unknown[];
  allPackages: unknown[];
  dependencyTrees?: unknown[];
  failedPackages?: Array<{ name: string; version: string; error: string }>;
}

export interface DownloadAPI {
  start: (data: { packages: unknown[]; options: unknown }) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  cancel: () => Promise<void>;
  onProgress: (callback: (progress: unknown) => void) => () => void;
  onComplete: (callback: (result: unknown) => void) => () => void;
  onError: (callback: (error: unknown) => void) => () => void;
  onStatus?: (callback: (status: DownloadStatusData) => void) => () => void;
  onDepsResolved?: (callback: (data: DepsResolvedData) => void) => () => void;
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

export interface SearchAPI {
  packages: (
    type: string,
    query: string
  ) => Promise<{
    results: Array<{
      name: string;
      version: string;
      description?: string;
    }>;
  }>;
  suggest: (type: string, query: string) => Promise<string[]>;
  versions: (type: string, packageName: string) => Promise<{ versions: string[] }>;
}

export interface DependencyResolveResult {
  originalPackages: unknown[];
  allPackages: unknown[];
  dependencyTrees?: unknown[];
  failedPackages?: Array<{ name: string; version: string; error: string }>;
}

export interface DependencyAPI {
  resolve: (packages: unknown[]) => Promise<DependencyResolveResult>;
}

export interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  getAppPath: () => Promise<string>;
  selectFolder: () => Promise<string | null>;
  saveFile: (defaultPath: string) => Promise<string | null>;
  download: DownloadAPI;
  config: ConfigAPI;
  fs: FileSystemAPI;
  cache: CacheAPI;
  search: SearchAPI;
  dependency?: DependencyAPI;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
