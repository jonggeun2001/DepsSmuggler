import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  DownloadHistory,
  HistoryPackageItem,
  HistorySettings,
  HistoryStatus,
} from '../../types';

// 최대 히스토리 개수
const MAX_HISTORIES = 100;

// 고유 ID 생성
const generateId = (): string => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

// 히스토리 상태 인터페이스
interface HistoryState {
  histories: DownloadHistory[];

  // 히스토리 추가 (100개 초과 시 오래된 것 삭제)
  addHistory: (
    packages: HistoryPackageItem[],
    settings: HistorySettings,
    outputPath: string,
    totalSize: number,
    status: HistoryStatus,
    downloadedCount?: number,
    failedCount?: number
  ) => string;

  // ID로 히스토리 조회
  getHistory: (id: string) => DownloadHistory | undefined;

  // 전체 히스토리 조회
  getHistories: () => DownloadHistory[];

  // ID로 히스토리 삭제
  deleteHistory: (id: string) => void;

  // 전체 삭제
  clearAll: () => void;
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set, get) => ({
      histories: [],

      addHistory: (
        packages,
        settings,
        outputPath,
        totalSize,
        status,
        downloadedCount,
        failedCount
      ) => {
        const id = generateId();
        const newHistory: DownloadHistory = {
          id,
          timestamp: new Date().toISOString(),
          packages,
          settings,
          outputPath,
          totalSize,
          status,
          downloadedCount,
          failedCount,
        };

        set((state) => {
          const updatedHistories = [newHistory, ...state.histories];
          // 최대 개수 초과 시 오래된 것 삭제
          if (updatedHistories.length > MAX_HISTORIES) {
            updatedHistories.splice(MAX_HISTORIES);
          }
          return { histories: updatedHistories };
        });

        return id;
      },

      getHistory: (id) => {
        return get().histories.find((h) => h.id === id);
      },

      getHistories: () => {
        return get().histories;
      },

      deleteHistory: (id) => {
        set((state) => ({
          histories: state.histories.filter((h) => h.id !== id),
        }));
      },

      clearAll: () => {
        set({ histories: [] });
      },
    }),
    {
      name: 'depssmuggler-history',
    }
  )
);

// 타입 재export
export type { DownloadHistory, HistoryPackageItem, HistorySettings, HistoryStatus };
