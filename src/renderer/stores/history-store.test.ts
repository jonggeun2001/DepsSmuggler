import { describe, expect, it, vi } from 'vitest';
import type { DownloadHistory } from '../../types';
import { createHistoryStore } from './history-store';

describe('history-store', () => {
  it('hydrate는 파일 히스토리를 source of truth로 로드한다', async () => {
    const fileHistory = {
      id: 'history-1',
      timestamp: '2026-04-14T00:00:00.000Z',
      packages: [],
      settings: {
        outputFormat: 'zip' as const,
        includeScripts: true,
        includeDependencies: true,
        deliveryMethod: 'local' as const,
      },
      outputPath: '/tmp/output.zip',
      totalSize: 1234,
      status: 'success' as const,
    };
    const client = {
      load: vi.fn().mockResolvedValue([fileHistory]),
      add: vi.fn().mockResolvedValue({ success: true }),
      delete: vi.fn().mockResolvedValue({ success: true }),
      clear: vi.fn().mockResolvedValue({ success: true }),
    };
    const store = createHistoryStore({ client, autoHydrate: false });

    await store.getState().hydrate();

    expect(store.getState().initialized).toBe(true);
    expect(store.getState().histories).toEqual([fileHistory]);
    expect(client.load).toHaveBeenCalledTimes(1);
  });

  it('addHistory는 persistence 성공 후 store를 갱신한다', async () => {
    const client = {
      load: vi.fn().mockResolvedValue([]),
      add: vi.fn().mockResolvedValue({ success: true }),
      delete: vi.fn().mockResolvedValue({ success: true }),
      clear: vi.fn().mockResolvedValue({ success: true }),
    };
    const store = createHistoryStore({ client, autoHydrate: false });

    const id = await store.getState().addHistory(
      [],
      {
        outputFormat: 'zip',
        includeScripts: true,
        includeDependencies: true,
        deliveryMethod: 'local',
      },
      '/tmp/output.zip',
      512,
      'success'
    );

    expect(store.getState().histories[0]).toEqual(
      expect.objectContaining({
        id,
        outputPath: '/tmp/output.zip',
        totalSize: 512,
        status: 'success',
      })
    );
    expect(client.add).toHaveBeenCalledWith(
      expect.objectContaining({
        id,
        outputPath: '/tmp/output.zip',
      })
    );
  });

  it('addHistory는 persistence가 실패하면 store를 갱신하지 않는다', async () => {
    const client = {
      load: vi.fn().mockResolvedValue([]),
      add: vi.fn().mockRejectedValue(new Error('disk write failed')),
      delete: vi.fn().mockResolvedValue({ success: true }),
      clear: vi.fn().mockResolvedValue({ success: true }),
    };
    const store = createHistoryStore({ client, autoHydrate: false });

    await expect(
      store.getState().addHistory(
        [],
        {
          outputFormat: 'zip',
          includeScripts: true,
          includeDependencies: true,
          deliveryMethod: 'local',
        },
        '/tmp/output.zip',
        512,
        'success'
      )
    ).rejects.toThrow('disk write failed');

    expect(store.getState().histories).toEqual([]);
  });

  it('deleteHistory는 persistence가 실패하면 store를 유지한다', async () => {
    const existingHistory = {
      id: 'history-1',
      timestamp: '2026-04-14T00:00:00.000Z',
      packages: [],
      settings: {
        outputFormat: 'zip' as const,
        includeScripts: true,
        includeDependencies: true,
        deliveryMethod: 'local' as const,
      },
      outputPath: '/tmp/output.zip',
      totalSize: 1234,
      status: 'success' as const,
    };
    const client = {
      load: vi.fn().mockResolvedValue([existingHistory]),
      add: vi.fn().mockResolvedValue({ success: true }),
      delete: vi.fn().mockRejectedValue(new Error('disk delete failed')),
      clear: vi.fn().mockResolvedValue({ success: true }),
    };
    const store = createHistoryStore({ client, autoHydrate: false });

    await store.getState().hydrate();

    await expect(store.getState().deleteHistory(existingHistory.id)).rejects.toThrow(
      'disk delete failed'
    );

    expect(store.getState().histories).toEqual([existingHistory]);
  });

  it('hydrate보다 늦게 적용된 mutation state를 stale load가 덮어쓰지 않는다', async () => {
    let resolveLoad: ((value: DownloadHistory[]) => void) | null = null;
    const client = {
      load: vi.fn().mockImplementation(
        () => new Promise<DownloadHistory[]>((resolve) => {
          resolveLoad = resolve;
        })
      ),
      add: vi.fn().mockResolvedValue({ success: true }),
      delete: vi.fn().mockResolvedValue({ success: true }),
      clear: vi.fn().mockResolvedValue({ success: true }),
    };
    const store = createHistoryStore({ client, autoHydrate: false });

    const hydratePromise = store.getState().hydrate();
    const addedId = await store.getState().addHistory(
      [],
      {
        outputFormat: 'zip',
        includeScripts: true,
        includeDependencies: true,
        deliveryMethod: 'local',
      },
      '/tmp/output.zip',
      512,
      'success'
    );

    resolveLoad?.([]);
    await hydratePromise;

    expect(store.getState().histories).toEqual([
      expect.objectContaining({
        id: addedId,
        outputPath: '/tmp/output.zip',
      }),
    ]);
  });

  it('겹치는 mutation도 직렬화해서 persistence와 store를 일치시킨다', async () => {
    const existingHistory: DownloadHistory = {
      id: 'history-1',
      timestamp: '2026-04-14T00:00:00.000Z',
      packages: [],
      settings: {
        outputFormat: 'zip',
        includeScripts: true,
        includeDependencies: true,
        deliveryMethod: 'local',
      },
      outputPath: '/tmp/existing.zip',
      totalSize: 128,
      status: 'success',
    };
    let persistedHistories: DownloadHistory[] = [existingHistory];
    const client = {
      load: vi.fn().mockImplementation(async () => persistedHistories),
      add: vi.fn().mockImplementation(async (entry: DownloadHistory) => {
        const snapshot = [...persistedHistories];
        await new Promise((resolve) => setTimeout(resolve, 1));
        persistedHistories = [entry, ...snapshot];
        return { success: true };
      }),
      delete: vi.fn().mockImplementation(async (id: string) => {
        const snapshot = [...persistedHistories];
        await new Promise((resolve) => setTimeout(resolve, 5));
        persistedHistories = snapshot.filter((history) => history.id !== id);
        return { success: true };
      }),
      clear: vi.fn().mockResolvedValue({ success: true }),
    };
    const store = createHistoryStore({ client, autoHydrate: false });

    await store.getState().hydrate();

    const deletePromise = store.getState().deleteHistory(existingHistory.id);
    const addPromise = store.getState().addHistory(
      [],
      {
        outputFormat: 'zip',
        includeScripts: true,
        includeDependencies: true,
        deliveryMethod: 'local',
      },
      '/tmp/new.zip',
      512,
      'success'
    );
    const [, addedId] = await Promise.all([deletePromise, addPromise]);

    expect(persistedHistories).toEqual([
      expect.objectContaining({
        id: addedId,
        outputPath: '/tmp/new.zip',
      }),
    ]);
    expect(store.getState().histories).toEqual([
      expect.objectContaining({
        id: addedId,
        outputPath: '/tmp/new.zip',
      }),
    ]);
  });
});
