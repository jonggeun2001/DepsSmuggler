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

  // 다운로드 관련
  download: {
    start: (data: { packages: unknown[]; options: unknown }): Promise<void> =>
      ipcRenderer.invoke('download:start', data),
    pause: (): Promise<void> => ipcRenderer.invoke('download:pause'),
    resume: (): Promise<void> => ipcRenderer.invoke('download:resume'),
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
    // 의존성 해결 상태 이벤트
    onStatus: (callback: (status: { phase: string; message: string }) => void): () => void => {
      const handler = (_event: Electron.IpcRendererEvent, status: { phase: string; message: string }) =>
        callback(status);
      ipcRenderer.on('download:status', handler);
      return () => ipcRenderer.removeListener('download:status', handler);
    },
    // 의존성 해결 완료 이벤트
    onDepsResolved: (callback: (data: {
      originalPackages: unknown[];
      allPackages: unknown[];
      dependencyTrees?: unknown[];
      failedPackages?: unknown[];
    }) => void): () => void => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) =>
        callback(data as { originalPackages: unknown[]; allPackages: unknown[]; dependencyTrees?: unknown[]; failedPackages?: unknown[] });
      ipcRenderer.on('download:deps-resolved', handler);
      return () => ipcRenderer.removeListener('download:deps-resolved', handler);
    },
    // 전체 다운로드 완료 이벤트
    onAllComplete: (callback: (data: { success: boolean; outputPath: string }) => void): () => void => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) =>
        callback(data as { success: boolean; outputPath: string });
      ipcRenderer.on('download:all-complete', handler);
      return () => ipcRenderer.removeListener('download:all-complete', handler);
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
      query: string,
      options?: { channel?: string }
    ): Promise<{
      results: Array<{
        name: string;
        version: string;
        description?: string;
      }>;
    }> => ipcRenderer.invoke('search:packages', type, query, options),
    suggest: (type: string, query: string, options?: { channel?: string }): Promise<string[]> =>
      ipcRenderer.invoke('search:suggest', type, query, options),
    versions: (
      type: string,
      packageName: string,
      options?: { channel?: string }
    ): Promise<{ versions: string[] }> =>
      ipcRenderer.invoke('search:versions', type, packageName, options),
  },

  // 의존성 해결 관련
  dependency: {
    resolve: (packages: unknown[]): Promise<{
      originalPackages: unknown[];
      allPackages: unknown[];
      dependencyTrees?: unknown[];
      failedPackages?: unknown[];
    }> => ipcRenderer.invoke('dependency:resolve', packages),
  },

  // OS 패키지 관련
  os: {
    // 배포판 목록 조회
    getDistributions: (osType?: string): Promise<unknown[]> =>
      ipcRenderer.invoke(osType ? 'os:getDistributions' : 'os:getAllDistributions', osType),

    getAllDistributions: (): Promise<unknown[]> =>
      ipcRenderer.invoke('os:getAllDistributions'),

    getDistribution: (distributionId: string): Promise<unknown> =>
      ipcRenderer.invoke('os:getDistribution', distributionId),

    // OS 패키지 검색
    search: (options: {
      query: string;
      distribution: unknown;
      architecture: string;
      matchType?: string;
      limit?: number;
    }): Promise<{ packages: unknown[]; totalCount: number }> =>
      ipcRenderer.invoke('os:search', options),

    // 의존성 해결
    resolveDependencies: (options: {
      packages: unknown[];
      distribution: unknown;
      architecture: string;
      includeOptional?: boolean;
      includeRecommends?: boolean;
    }): Promise<unknown> =>
      ipcRenderer.invoke('os:resolveDependencies', options),

    // 의존성 해결 진행 이벤트
    onResolveDependenciesProgress: (
      callback: (data: { message: string; current: number; total: number }) => void
    ): () => void => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) =>
        callback(data as { message: string; current: number; total: number });
      ipcRenderer.on('os:resolveDependencies:progress', handler);
      return () => ipcRenderer.removeListener('os:resolveDependencies:progress', handler);
    },

    // 다운로드 시작
    download: {
      start: (options: {
        packages: unknown[];
        outputDir: string;
        resolveDependencies?: boolean;
        includeOptionalDeps?: boolean;
        verifyGPG?: boolean;
        concurrency?: number;
      }): Promise<unknown> =>
        ipcRenderer.invoke('os:download:start', options),

      onProgress: (callback: (progress: unknown) => void): () => void => {
        const handler = (_event: Electron.IpcRendererEvent, progress: unknown) =>
          callback(progress);
        ipcRenderer.on('os:download:progress', handler);
        return () => ipcRenderer.removeListener('os:download:progress', handler);
      },
    },

    // 캐시 관련
    cache: {
      getStats: (): Promise<unknown> =>
        ipcRenderer.invoke('os:cache:stats'),
      clear: (): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('os:cache:clear'),
    },
  },
};

// contextBridge를 통해 안전하게 렌더러에 API 노출
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// TypeScript 타입 정의를 위한 선언 (렌더러에서 사용)
export type ElectronAPI = typeof electronAPI;
