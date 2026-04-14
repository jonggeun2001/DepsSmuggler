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
  ) => Promise<string>;
  getHistory: (id: string) => DownloadHistory | undefined;
  getHistories: () => DownloadHistory[];
  deleteHistory: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
}

export interface CreateHistoryStoreOptions {
  client?: HistoryPersistenceClient;
  autoHydrate?: boolean;
}

function logHistoryPersistenceError(action: string, error: unknown): void {
  console.error(`[history-store] ${action} 실패`, error);
}

function ensureHistoryWriteSucceeded(
  action: 'add' | 'delete' | 'clear',
  result: { success: boolean }
): void {
  if (!result.success) {
    throw new Error(`history ${action} persistence failed`);
  }
}

export function createHistoryStore({
  client = getRendererDataClient().history,
  autoHydrate = true,
}: CreateHistoryStoreOptions = {}) {
  let mutationVersion = 0;
  let hydrateRequestVersion = 0;
  let mutationQueue: Promise<void> = Promise.resolve();

  const enqueueMutation = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  };

  const store = create<HistoryState>()((set, get) => ({
    histories: [],
    initialized: false,
    loading: false,

    hydrate: async () => {
      if (get().loading) {
        return;
      }

      const requestVersion = ++hydrateRequestVersion;
      const mutationVersionAtStart = mutationVersion;
      set({ loading: true });

      try {
        await mutationQueue;
        const histories = await client.load();
        set((state) => {
          if (
            requestVersion !== hydrateRequestVersion
            || mutationVersionAtStart !== mutationVersion
          ) {
            return {
              histories: state.histories,
              initialized: true,
              loading: false,
            };
          }

          return {
            histories: Array.isArray(histories) ? histories : [],
            initialized: true,
            loading: false,
          };
        });
      } catch (error) {
        logHistoryPersistenceError('hydrate', error);
        set({
          initialized: true,
          loading: false,
        });
      }
    },

    addHistory: async (
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

      return enqueueMutation(async () => {
        const persistenceResult = await client.add(newHistory);
        ensureHistoryWriteSucceeded('add', persistenceResult);
        mutationVersion += 1;

        set((state) => {
          const updatedHistories = [newHistory, ...state.histories];
          if (updatedHistories.length > MAX_HISTORIES) {
            updatedHistories.splice(MAX_HISTORIES);
          }
          return { histories: updatedHistories };
        });

        return id;
      });
    },

    getHistory: (id) => get().histories.find((history) => history.id === id),

    getHistories: () => get().histories,

    deleteHistory: async (id) => enqueueMutation(async () => {
      const persistenceResult = await client.delete(id);
      ensureHistoryWriteSucceeded('delete', persistenceResult);
      mutationVersion += 1;

      set((state) => ({
        histories: state.histories.filter((history) => history.id !== id),
      }));
    }),

    clearAll: async () => enqueueMutation(async () => {
      const persistenceResult = await client.clear();
      ensureHistoryWriteSucceeded('clear', persistenceResult);
      mutationVersion += 1;

      set({ histories: [] });
    }),
  }));

  if (autoHydrate && typeof window !== 'undefined') {
    void store.getState().hydrate();
  }

  return store;
}

export const useHistoryStore = createHistoryStore();

export type { DownloadHistory, HistoryPackageItem, HistorySettings, HistoryStatus };
