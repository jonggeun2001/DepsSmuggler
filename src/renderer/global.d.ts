// Electron API 타입 정의
export interface ElectronAPI {
  // 앱 정보
  getAppVersion: () => Promise<string>;
  getAppPath: () => Promise<string>;

  // 파일 다이얼로그
  selectFolder: () => Promise<string | null>;
  saveFile: (defaultPath: string) => Promise<string | null>;

  // 다운로드 관련
  download: {
    start: (packages: unknown[]) => Promise<void>;
    pause: () => Promise<void>;
    cancel: () => Promise<void>;
    onProgress: (callback: (progress: unknown) => void) => () => void;
    onComplete: (callback: (result: unknown) => void) => () => void;
    onError: (callback: (error: unknown) => void) => () => void;
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

  // 패키지 검색 관련
  search: {
    packages: (
      type: string,
      query: string
    ) => Promise<{
      results: Array<{
        name: string;
        version: string;
        description?: string;
        versions?: string[];
      }>;
    }>;
    suggest: (type: string, query: string) => Promise<string[]>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
