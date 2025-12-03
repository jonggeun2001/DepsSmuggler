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
