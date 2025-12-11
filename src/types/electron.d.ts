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
  checkPath: (outputDir: string) => Promise<{
    exists: boolean;
    files?: string[];
    fileCount?: number;
    totalSize?: number;
  }>;
  clearPath: (outputDir: string) => Promise<{
    success: boolean;
    deleted?: boolean;
  }>;
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
  getStats: () => Promise<{
    totalSize: number;
    entryCount: number;
    details: {
      pip: unknown;
      npm: unknown;
      maven: unknown;
      conda: unknown;
    };
  }>;
  clear: () => Promise<{ success: boolean }>;
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

export interface DependencyResolveOptions {
  targetOS?: string;
  architecture?: string;
  pythonVersion?: string;
}

export interface DependencyAPI {
  resolve: (data: {
    packages: unknown[];
    options?: DependencyResolveOptions;
  }) => Promise<DependencyResolveResult>;
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

export interface UpdaterStatus {
  checking: boolean;
  available: boolean;
  downloaded: boolean;
  downloading: boolean;
  error: string | null;
  progress: { percent: number; bytesPerSecond: number; total: number; transferred: number } | null;
  updateInfo: { version: string; releaseDate: string; releaseNotes?: string } | null;
}

export interface UpdaterAPI {
  check: () => Promise<{ success: boolean; result?: unknown; error?: string }>;
  download: () => Promise<{ success: boolean; error?: string }>;
  install: () => Promise<{ success: boolean }>;
  getStatus: () => Promise<UpdaterStatus>;
  setAutoDownload: (enabled: boolean) => Promise<{ success: boolean }>;
  onStatusChange: (callback: (status: UpdaterStatus) => void) => () => void;
}

export interface HistoryAPI {
  load: () => Promise<unknown[]>;
  save: (histories: unknown[]) => Promise<{ success: boolean }>;
  add: (history: unknown) => Promise<{ success: boolean }>;
  delete: (id: string) => Promise<{ success: boolean }>;
  clear: () => Promise<{ success: boolean }>;
}

export interface OSPackageAPI {
  getDistributions: (osType?: string) => Promise<unknown[]>;
  getAllDistributions: () => Promise<unknown[]>;
  getDistribution: (distributionId: string) => Promise<unknown>;
  search: (options: {
    query: string;
    distribution: unknown;
    architecture: string;
    matchType?: string;
    limit?: number;
  }) => Promise<{ packages: unknown[]; totalCount: number }>;
  resolveDependencies: (options: {
    packages: unknown[];
    distribution: unknown;
    architecture: string;
    includeOptional?: boolean;
    includeRecommends?: boolean;
  }) => Promise<unknown>;
  onResolveDependenciesProgress: (
    callback: (data: { message: string; current: number; total: number }) => void
  ) => () => void;
  download: {
    start: (options: {
      packages: unknown[];
      outputDir: string;
      resolveDependencies?: boolean;
      includeOptionalDeps?: boolean;
      verifyGPG?: boolean;
      concurrency?: number;
    }) => Promise<unknown>;
    onProgress: (callback: (progress: unknown) => void) => () => void;
  };
  cache: {
    getStats: () => Promise<unknown>;
    clear: () => Promise<{ success: boolean }>;
  };
}

export interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  getAppPath: () => Promise<string>;
  selectFolder: () => Promise<string | null>;
  selectDirectory: () => Promise<string | null>;
  saveFile: (defaultPath: string) => Promise<string | null>;
  openFolder: (folderPath: string) => Promise<void>;
  testSmtpConnection: (config: unknown) => Promise<{ success: boolean; error?: string }>;
  download: DownloadAPI;
  config: ConfigAPI;
  fs: FileSystemAPI;
  cache: CacheAPI;
  search: SearchAPI;
  dependency?: DependencyAPI;
  docker?: DockerAPI;
  updater?: UpdaterAPI;
  history?: HistoryAPI;
  os?: OSPackageAPI;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
