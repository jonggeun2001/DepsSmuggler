import type { DownloadHistory } from '../types';
import type {
  OSDistribution,
  OSPackageInfo,
  MatchType,
  OSArchitecture,
} from '../core/downloaders/os/types';

export interface OSPackageOutputOptions {
  type: 'archive' | 'repository' | 'both';
  archiveFormat?: 'zip' | 'tar.gz';
  generateScripts: boolean;
  scriptTypes: Array<'dependency-order' | 'local-repo'>;
}

export { OSDistribution, OSPackageInfo, MatchType, OSArchitecture };

// Electron API 타입 정의
export interface ElectronAPI {
  // 앱 정보
  getAppVersion: () => Promise<string>;
  getAppPath: () => Promise<string>;

  // 캐시 통계 및 관리 (최상위 레벨)
  getCacheStats: () => Promise<{ totalSize: number; entryCount: number }>;
  clearCache: () => Promise<void>;

  // SMTP 연결 테스트
  testSmtpConnection: (config: {
    host: string;
    port: number;
    secure?: boolean;
    user?: string;
    password?: string;
  }) => Promise<boolean>;

  // 파일 다이얼로그
  selectFolder: () => Promise<string | null>;
  selectDirectory: () => Promise<string | null>;
  saveFile: (defaultPath: string) => Promise<string | null>;
  openFolder: (folderPath: string) => Promise<void>;

  // 다운로드 관련
  download: {
    start: (data: { packages: unknown[]; options: unknown }) => Promise<void>;
    pause: () => Promise<void>;
    resume: () => Promise<void>;
    cancel: () => Promise<void>;
    onProgress: (callback: (progress: unknown) => void) => () => void;
    onComplete: (callback: (result: unknown) => void) => () => void;
    onError: (callback: (error: unknown) => void) => () => void;
    onStatus: (callback: (status: { phase: string; message: string }) => void) => () => void;
    onDepsResolved: (callback: (data: {
      originalPackages: unknown[];
      allPackages: unknown[];
      dependencyTrees?: unknown[];
      failedPackages?: unknown[];
    }) => void) => () => void;
    onAllComplete: (callback: (data: { success: boolean; outputPath: string }) => void) => () => void;
  };

  // 설정 관련
  config: {
    get: () => Promise<unknown>;
    set: (config: unknown) => Promise<void>;
    reset: () => Promise<void>;
  };

  // 파일 시스템 관련
  fs: {
    selectDirectory: () => Promise<string | null>;
    selectFile: (filters?: unknown) => Promise<string | null>;
    readFile: (filePath: string) => Promise<string>;
  };

  // 캐시 관련
  cache: {
    getSize: () => Promise<number>;
    clear: () => Promise<void>;
  };

  // 히스토리 관련
  history: {
    load: () => Promise<DownloadHistory[]>;
    save: (histories: DownloadHistory[]) => Promise<{ success: boolean }>;
    add: (history: DownloadHistory) => Promise<{ success: boolean }>;
    delete: (id: string) => Promise<{ success: boolean }>;
    clear: () => Promise<{ success: boolean }>;
  };

  // 패키지 검색 관련
  search: {
    packages: (
      type: string,
      query: string,
      options?: { channel?: string }
    ) => Promise<{
      results: Array<{
        name: string;
        version: string;
        description?: string;
        versions?: string[];
      }>;
    }>;
    suggest: (type: string, query: string, options?: { channel?: string }) => Promise<string[]>;
    versions: (
      type: string,
      packageName: string,
      options?: { channel?: string }
    ) => Promise<{ versions: string[] }>;
  };

  // 의존성 해결 관련
  dependency: {
    resolve: (packages: unknown[], options?: { targetOS?: string }) => Promise<{
      originalPackages: unknown[];
      allPackages: unknown[];
      dependencyTrees?: unknown[];
      failedPackages?: unknown[];
    }>;
  };

  // OS 패키지 관련
  os: {
    // 배포판 목록 조회
    getDistributions: (osType?: string) => Promise<OSDistribution[]>;
    getAllDistributions: () => Promise<OSDistribution[]>;
    getDistribution: (distributionId: string) => Promise<OSDistribution | null>;

    // OS 패키지 검색
    search: (options: {
      query: string;
      distribution: OSDistribution | { id: string; name: string; osType: string; packageManager: string };
      architecture: OSArchitecture;
      matchType?: MatchType;
      limit?: number;
    }) => Promise<{ packages: OSPackageInfo[]; totalCount: number }>;

    // 의존성 해결
    resolveDependencies: (options: {
      packages: OSPackageInfo[];
      distribution: OSDistribution;
      architecture: OSArchitecture;
      includeOptional?: boolean;
      includeRecommends?: boolean;
    }) => Promise<{
      resolvedPackages: OSPackageInfo[];
      dependencyTree: unknown;
      failedPackages?: Array<{ package: OSPackageInfo; error: string }>;
    }>;

    // 의존성 해결 진행 이벤트
    onResolveDependenciesProgress: (
      callback: (data: { message: string; current: number; total: number }) => void
    ) => () => void;

    // 다운로드 관련
    download: {
      start: (options: {
        packages: OSPackageInfo[];
        outputDir: string;
        resolveDependencies?: boolean;
        includeOptionalDeps?: boolean;
        verifyGPG?: boolean;
        concurrency?: number;
      }) => Promise<{
        success: OSPackageInfo[];
        failed: Array<{ package: OSPackageInfo; error: string }>;
        skipped: OSPackageInfo[];
        outputPath: string;
      }>;

      onProgress: (callback: (progress: {
        packageName: string;
        downloaded: number;
        total: number;
        percent: number;
        speed: number;
      }) => void) => () => void;
    };

    // 캐시 관련
    cache: {
      getStats: () => Promise<{
        size: number;
        packageCount: number;
        lastUpdated: string;
      }>;
      clear: () => Promise<{ success: boolean }>;
    };
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
