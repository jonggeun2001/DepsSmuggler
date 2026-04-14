import { describe, expect, it, vi } from 'vitest';
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
});
