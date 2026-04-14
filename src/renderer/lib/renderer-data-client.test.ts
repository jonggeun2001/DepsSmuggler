import { describe, expect, it, vi } from 'vitest';
import type { DownloadHistory } from '../../types';
import { createRendererDataClient } from './renderer-data-client';

describe('renderer-data-client', () => {
  it('search.versions를 통해 최신 버전을 조회한다', async () => {
    const electronAPI = {
      search: {
        versions: vi.fn().mockResolvedValue({ versions: ['2.32.0', '2.31.0'] }),
      },
    };
    const client = createRendererDataClient({ electronAPI });

    const latest = await client.getLatestVersion('pip', 'requests');

    expect(latest).toBe('2.32.0');
    expect(electronAPI.search.versions).toHaveBeenCalledWith('pip', 'requests', undefined);
  });

  it('Electron search가 없으면 npm 검색 HTTP fallback을 사용한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ name: 'vite', version: '7.3.2', description: 'build tool' }],
      }),
    });
    const client = createRendererDataClient({ fetchImpl });

    const results = await client.searchPackages('npm', 'vite');

    expect(fetchImpl).toHaveBeenCalledWith('/api/npm/search?q=vite');
    expect(results).toEqual([{ name: 'vite', version: '7.3.2', description: 'build tool' }]);
  });

  it('history facade는 파일 기반 history load를 위임한다', async () => {
    const histories: DownloadHistory[] = [
      {
        id: 'history-1',
        timestamp: '2026-04-14T00:00:00.000Z',
        packages: [],
        settings: {
          outputFormat: 'zip',
          includeScripts: true,
          includeDependencies: true,
          deliveryMethod: 'local',
        },
        outputPath: '/tmp/output.zip',
        totalSize: 1234,
        status: 'success',
      },
    ];
    const electronAPI = {
      history: {
        load: vi.fn().mockResolvedValue(histories),
        add: vi.fn(),
        delete: vi.fn(),
        clear: vi.fn(),
      },
    };
    const client = createRendererDataClient({ electronAPI });

    const loaded = await client.history.load();

    expect(loaded).toEqual(histories);
    expect(electronAPI.history.load).toHaveBeenCalledTimes(1);
  });
});
