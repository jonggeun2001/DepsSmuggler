import { contextBridge, ipcRenderer } from 'electron';

// 렌더러 프로세스에 노출할 API 정의
const electronAPI = {
  // 렌더러 로그를 메인 프로세스로 전달
  log: (level: 'debug' | 'info' | 'warn' | 'error', message: string, ...args: unknown[]): void => {
    ipcRenderer.send('renderer:log', { level, message, args });
  },

  // 앱 정보
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('get-app-version'),
  getAppPath: (): Promise<string> => ipcRenderer.invoke('get-app-path'),

  // 파일 다이얼로그
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('select-folder'),
  selectDirectory: (): Promise<string | null> => ipcRenderer.invoke('select-directory'),
  saveFile: (defaultPath: string): Promise<string | null> =>
    ipcRenderer.invoke('save-file', defaultPath),
  openFolder: (folderPath: string): Promise<void> =>
    ipcRenderer.invoke('open-folder', folderPath),

  // 다운로드 관련
  download: {
    start: (data: { packages: unknown[]; options: unknown }): Promise<void> =>
      ipcRenderer.invoke('download:start', data),
    pause: (): Promise<void> => ipcRenderer.invoke('download:pause'),
    resume: (): Promise<void> => ipcRenderer.invoke('download:resume'),
    cancel: (): Promise<void> => ipcRenderer.invoke('download:cancel'),
    // 출력 폴더 검사
    checkPath: (outputDir: string): Promise<{
      exists: boolean;
      files?: string[];
      fileCount?: number;
      totalSize?: number;
    }> => ipcRenderer.invoke('download:check-path', outputDir),
    // 출력 폴더 삭제
    clearPath: (outputDir: string): Promise<{
      success: boolean;
      deleted?: boolean;
    }> => ipcRenderer.invoke('download:clear-path', outputDir),
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

  // 설정 관련
  config: {
    get: (): Promise<unknown> => ipcRenderer.invoke('config:get'),
    set: (config: unknown): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('config:set', config),
    reset: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('config:reset'),
    getPath: (): Promise<string> => ipcRenderer.invoke('config:getPath'),
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

  // 캐시 관련
  cache: {
    getSize: (): Promise<number> => ipcRenderer.invoke('cache:get-size'),
    getStats: (): Promise<{
      totalSize: number;
      entryCount: number;
      details: {
        pip: unknown;
        npm: unknown;
        maven: unknown;
        conda: unknown;
      };
    }> => ipcRenderer.invoke('cache:stats'),
    clear: (): Promise<{ success: boolean }> => ipcRenderer.invoke('cache:clear'),
  },

  // 자동 업데이트 관련
  updater: {
    // 업데이트 체크
    check: (): Promise<{ success: boolean; result?: unknown; error?: string }> =>
      ipcRenderer.invoke('updater:check'),
    // 업데이트 다운로드
    download: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('updater:download'),
    // 업데이트 설치 및 재시작
    install: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('updater:install'),
    // 현재 상태 조회
    getStatus: (): Promise<{
      checking: boolean;
      available: boolean;
      downloaded: boolean;
      downloading: boolean;
      error: string | null;
      progress: { percent: number; bytesPerSecond: number; total: number; transferred: number } | null;
      updateInfo: { version: string; releaseDate: string; releaseNotes?: string } | null;
    }> => ipcRenderer.invoke('updater:status'),
    // 자동 다운로드 설정
    setAutoDownload: (enabled: boolean): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('updater:set-auto-download', enabled),
    // 상태 변경 이벤트 리스너
    onStatusChange: (callback: (status: unknown) => void): () => void => {
      const handler = (_event: Electron.IpcRendererEvent, status: unknown) =>
        callback(status);
      ipcRenderer.on('updater:status', handler);
      return () => ipcRenderer.removeListener('updater:status', handler);
    },
  },

  // 히스토리 관련
  history: {
    load: (): Promise<unknown[]> => ipcRenderer.invoke('history:load'),
    save: (histories: unknown[]): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('history:save', histories),
    add: (history: unknown): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('history:add', history),
    delete: (id: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('history:delete', id),
    clear: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('history:clear'),
  },

  // 패키지 검색 관련
  search: {
    packages: (
      type: string,
      query: string,
      options?: { channel?: string; registry?: string }
    ): Promise<{
      results: Array<{
        name: string;
        version: string;
        description?: string;
        registry?: string;
      }>;
    }> => ipcRenderer.invoke('search:packages', type, query, options),
    suggest: (type: string, query: string, options?: { channel?: string }): Promise<string[]> =>
      ipcRenderer.invoke('search:suggest', type, query, options),
    versions: (
      type: string,
      packageName: string,
      options?: { channel?: string; registry?: string }
    ): Promise<{ versions: string[] }> =>
      ipcRenderer.invoke('search:versions', type, packageName, options),
  },

  // 의존성 해결 관련
  dependency: {
    resolve: (data: {
      packages: unknown[];
      options?: {
        targetOS?: string;
        architecture?: string;
        pythonVersion?: string;
      };
    }): Promise<{
      originalPackages: unknown[];
      allPackages: unknown[];
      dependencyTrees?: unknown[];
      failedPackages?: unknown[];
    }> => ipcRenderer.invoke('dependency:resolve', data),
    onProgress: (callback: (progress: {
      current: number;
      total: number;
      packageName: string;
      packageType: string;
      status: 'start' | 'success' | 'error';
      dependencyCount?: number;
      error?: string;
    }) => void): (() => void) => {
      const handler = (_: unknown, progress: Parameters<typeof callback>[0]) => callback(progress);
      ipcRenderer.on('dependency:progress', handler);
      return () => ipcRenderer.removeListener('dependency:progress', handler);
    },
  },

  // Docker 카탈로그 캐시 관련
  docker: {
    cache: {
      refresh: (registry?: string): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('docker:cache:refresh', registry),
      status: (): Promise<Array<{
        registry: string;
        repositoryCount: number;
        fetchedAt: number;
        expiresAt: number;
        isExpired: boolean;
      }>> => ipcRenderer.invoke('docker:cache:status'),
      clear: (): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('docker:cache:clear'),
    },
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
