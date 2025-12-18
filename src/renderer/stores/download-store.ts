import { create } from 'zustand';

// 다운로드 상태
export type DownloadStatus = 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled' | 'skipped' | 'paused';

// 패키징 상태
export type PackagingStatus = 'idle' | 'packaging' | 'completed' | 'failed';

// 로그 항목
export interface LogEntry {
  id: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  details?: string;
}

// 다운로드 아이템
export interface DownloadItem {
  id: string;
  name: string;
  version: string;
  type?: string;
  status: DownloadStatus;
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
  speed: number;
  error?: string;
  startTime?: number;
  endTime?: number;
  // 의존성 관계 필드
  isDependency?: boolean; // 이 패키지가 다른 패키지의 의존성인지 여부
  parentId?: string; // 부모 패키지 ID (원본 패키지)
  dependencyOf?: string; // 어떤 패키지의 의존성인지 (패키지명)
  // 패키지 다운로드 정보 (conda: subdir/filename, yum/apt/apk: 필수)
  downloadUrl?: string;
  /** 실제 다운로드될 파일명 (예: numpy-1.24.0-py311h64a7726_0.conda) */
  filename?: string;
  metadata?: Record<string, unknown>;
}

// 다운로드 상태
interface DownloadState {
  items: DownloadItem[];
  isDownloading: boolean;
  isPaused: boolean;
  outputPath: string;
  outputFormat: 'zip' | 'tar.gz' | 'mirror';
  packagingStatus: PackagingStatus;
  packagingProgress: number;
  logs: LogEntry[];
  startTime: number | null;
  currentItemIndex: number;

  // Actions
  setItems: (items: DownloadItem[]) => void;
  updateItem: (id: string, updates: Partial<DownloadItem>) => void;
  updateItemsBatch: (updates: Map<string, Partial<DownloadItem>>) => void;
  addLogsBatch: (logs: Array<{ level: LogEntry['level']; message: string; details?: string }>) => void;
  setIsDownloading: (isDownloading: boolean) => void;
  setIsPaused: (isPaused: boolean) => void;
  setOutputPath: (path: string) => void;
  setOutputFormat: (format: 'zip' | 'tar.gz' | 'mirror') => void;
  setPackagingStatus: (status: PackagingStatus) => void;
  setPackagingProgress: (progress: number) => void;
  addLog: (level: LogEntry['level'], message: string, details?: string) => void;
  clearLogs: () => void;
  setStartTime: (time: number | null) => void;
  setCurrentItemIndex: (index: number) => void;
  skipItem: (id: string) => void;
  retryItem: (id: string) => void;
  reset: () => void;
}

// 로그 ID 생성
const generateLogId = (): string => {
  return `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

export const useDownloadStore = create<DownloadState>()((set, get) => ({
  items: [],
  isDownloading: false,
  isPaused: false,
  outputPath: '',
  outputFormat: 'zip',
  packagingStatus: 'idle',
  packagingProgress: 0,
  logs: [],
  startTime: null,
  currentItemIndex: 0,

  setItems: (items) => set({ items }),

  updateItem: (id, updates) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id ? { ...item, ...updates } : item
      ),
    })),

  // 여러 아이템을 한번에 업데이트 (배치)
  updateItemsBatch: (updates) =>
    set((state) => ({
      items: state.items.map((item) => {
        const update = updates.get(item.id);
        return update ? { ...item, ...update } : item;
      }),
    })),

  // 여러 로그를 한번에 추가 (배치)
  addLogsBatch: (logs) =>
    set((state) => ({
      logs: [
        ...state.logs,
        ...logs.map((log) => ({
          id: generateLogId(),
          timestamp: Date.now(),
          level: log.level,
          message: log.message,
          details: log.details,
        })),
      ],
    })),

  setIsDownloading: (isDownloading) => set({ isDownloading }),

  setIsPaused: (isPaused) => set({ isPaused }),

  setOutputPath: (outputPath) => set({ outputPath }),

  setOutputFormat: (outputFormat) => set({ outputFormat }),

  setPackagingStatus: (packagingStatus) => set({ packagingStatus }),

  setPackagingProgress: (packagingProgress) => set({ packagingProgress }),

  addLog: (level, message, details) =>
    set((state) => ({
      logs: [
        ...state.logs,
        {
          id: generateLogId(),
          timestamp: Date.now(),
          level,
          message,
          details,
        },
      ],
    })),

  clearLogs: () => set({ logs: [] }),

  setStartTime: (startTime) => set({ startTime }),

  setCurrentItemIndex: (currentItemIndex) => set({ currentItemIndex }),

  skipItem: (id) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id ? { ...item, status: 'skipped' as DownloadStatus } : item
      ),
    })),

  retryItem: (id) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id
          ? { ...item, status: 'pending' as DownloadStatus, progress: 0, error: undefined }
          : item
      ),
    })),

  reset: () =>
    set({
      items: [],
      isDownloading: false,
      isPaused: false,
      packagingStatus: 'idle',
      packagingProgress: 0,
      logs: [],
      startTime: null,
      currentItemIndex: 0,
    }),
}));
