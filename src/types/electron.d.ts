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

export interface AllCompleteData {
  success: boolean;
  outputPath: string;
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
  onAllComplete?: (callback: (data: AllCompleteData) => void) => () => void;
}

export interface ConfigAPI {
  get: () => Promise<unknown>;
  set: (config: unknown) => Promise<{ success: boolean; error?: string }>;
  reset: () => Promise<{ success: boolean; error?: string }>;
  getPath: () => Promise<string>;
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

export interface SearchOptions {
  channel?: string;
  registry?: string;
}

export interface SearchAPI {
  packages: (
    type: string,
    query: string,
    options?: SearchOptions
  ) => Promise<{
    results: Array<{
      name: string;
      version: string;
      description?: string;
      registry?: string;
    }>;
  }>;
  suggest: (type: string, query: string, options?: SearchOptions) => Promise<string[]>;
  versions: (type: string, packageName: string, options?: SearchOptions) => Promise<{ versions: string[] }>;
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

export interface DockerCacheStatusItem {
  registry: string;
  repositoryCount: number;
  fetchedAt: number;
  expiresAt: number;
  isExpired: boolean;
}

export interface DockerAPI {
  cache: {
    refresh: (registry?: string) => Promise<{ success: boolean }>;
    status: () => Promise<DockerCacheStatusItem[]>;
    clear: () => Promise<{ success: boolean }>;
  };
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
  docker?: DockerAPI;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
