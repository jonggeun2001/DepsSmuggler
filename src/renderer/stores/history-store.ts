import { create } from 'zustand';
import type {
  DownloadHistory,
  HistoryDeliveryResult,
  HistoryPackageItem,
  HistorySettings,
  HistoryStatus,
} from '../../types';
import {
  getRendererDataClient,
  type HistoryPersistenceClient,
} from '../lib/renderer-data-client';

const MAX_HISTORIES = 100;

const generateId = (): string => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

interface HistoryState {
  histories: DownloadHistory[];
  initialized: boolean;
  loading: boolean;
  hydrate: () => Promise<void>;
  addHistory: (
    packages: HistoryPackageItem[],
    settings: HistorySettings,
    outputPath: string,
    totalSize: number,
    status: HistoryStatus,
    downloadedCount?: number,
    failedCount?: number,
    options?: {
      artifactPaths?: string[];
      deliveryMethod?: 'local' | 'email';
      deliveryResult?: HistoryDeliveryResult;
    }
  ) => string;
  getHistory: (id: string) => DownloadHistory | undefined;
  getHistories: () => DownloadHistory[];
  deleteHistory: (id: string) => void;
  clearAll: () => void;
}

export interface CreateHistoryStoreOptions {
  client?: HistoryPersistenceClient;
  autoHydrate?: boolean;
}

function logHistoryPersistenceError(action: string, error: unknown): void {
  console.error(`[history-store] ${action} 실패`, error);
}

export function createHistoryStore({
  client = getRendererDataClient().history,
  autoHydrate = true,
}: CreateHistoryStoreOptions = {}) {
  const store = create<HistoryState>()((set, get) => ({
    histories: [],
    initialized: false,
    loading: false,

    hydrate: async () => {
      if (get().loading) {
        return;
      }

      set({ loading: true });

      try {
        const histories = await client.load();
        set({
          histories: Array.isArray(histories) ? histories : [],
          initialized: true,
          loading: false,
        });
      } catch (error) {
        logHistoryPersistenceError('hydrate', error);
        set({
          initialized: true,
          loading: false,
        });
      }
    },

    addHistory: (
      packages,
      settings,
      outputPath,
      totalSize,
      status,
      downloadedCount,
      failedCount,
      options
    ) => {
      const id = generateId();
      const newHistory: DownloadHistory = {
        id,
        timestamp: new Date().toISOString(),
        packages,
        settings,
        outputPath,
        artifactPaths: options?.artifactPaths,
        deliveryMethod: options?.deliveryMethod ?? settings.deliveryMethod,
        deliveryResult: options?.deliveryResult,
        totalSize,
        status,
        downloadedCount,
        failedCount,
      };

      set((state) => {
        const updatedHistories = [newHistory, ...state.histories];
        if (updatedHistories.length > MAX_HISTORIES) {
          updatedHistories.splice(MAX_HISTORIES);
        }
        return { histories: updatedHistories };
      });

      void client.add(newHistory).catch((error) => {
        logHistoryPersistenceError('add', error);
      });

      return id;
    },

    getHistory: (id) => get().histories.find((history) => history.id === id),

    getHistories: () => get().histories,

    deleteHistory: (id) => {
      set((state) => ({
        histories: state.histories.filter((history) => history.id !== id),
      }));

      void client.delete(id).catch((error) => {
        logHistoryPersistenceError('delete', error);
      });
    },

    clearAll: () => {
      set({ histories: [] });

      void client.clear().catch((error) => {
        logHistoryPersistenceError('clear', error);
      });
    },
  }));

  if (autoHydrate && typeof window !== 'undefined') {
    void store.getState().hydrate();
  }

  return store;
}

export const useHistoryStore = createHistoryStore();

export type { DownloadHistory, HistoryPackageItem, HistorySettings, HistoryStatus };
