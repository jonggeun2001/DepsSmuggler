import { beforeEach, describe, expect, it } from 'vitest';
import {
  useDownloadStore,
  type DownloadItem,
} from './download-store';

const createItem = (overrides?: Partial<DownloadItem>): DownloadItem => ({
  id: 'pkg-1',
  name: 'requests',
  version: '2.32.0',
  type: 'pip',
  status: 'pending',
  progress: 0,
  downloadedBytes: 0,
  totalBytes: 0,
  speed: 0,
  ...overrides,
});

describe('download-store', () => {
  beforeEach(() => {
    useDownloadStore.getState().reset();
  });

  it('updateItemsBatch는 대상 아이템만 한 번에 갱신한다', () => {
    useDownloadStore.getState().setItems([
      createItem(),
      createItem({
        id: 'pkg-2',
        name: 'urllib3',
      }),
    ]);

    useDownloadStore.getState().updateItemsBatch(
      new Map([
        ['pkg-1', { status: 'downloading', progress: 50, downloadedBytes: 512 }],
        ['pkg-2', { status: 'failed', error: 'network failed' }],
      ])
    );

    expect(useDownloadStore.getState().items).toEqual([
      expect.objectContaining({
        id: 'pkg-1',
        status: 'downloading',
        progress: 50,
        downloadedBytes: 512,
      }),
      expect.objectContaining({
        id: 'pkg-2',
        status: 'failed',
        error: 'network failed',
      }),
    ]);
  });

  it('addLogsBatch는 로그를 순서대로 추가한다', () => {
    useDownloadStore.getState().addLogsBatch([
      { level: 'info', message: '다운로드 시작' },
      { level: 'warn', message: '재시도 예정', details: 'timeout' },
    ]);

    expect(useDownloadStore.getState().logs).toEqual([
      expect.objectContaining({
        level: 'info',
        message: '다운로드 시작',
      }),
      expect.objectContaining({
        level: 'warn',
        message: '재시도 예정',
        details: 'timeout',
      }),
    ]);
  });

  it('retryItem은 실패 항목을 pending으로 되돌리고 진행 상태를 초기화한다', () => {
    useDownloadStore.getState().setItems([
      createItem({
        status: 'failed',
        progress: 90,
        downloadedBytes: 900,
        totalBytes: 1000,
        error: 'checksum mismatch',
      }),
    ]);

    useDownloadStore.getState().retryItem('pkg-1');

    expect(useDownloadStore.getState().items[0]).toEqual(
      expect.objectContaining({
        id: 'pkg-1',
        status: 'pending',
        progress: 0,
        error: undefined,
      })
    );
  });

  it('reset은 다운로드 세션 상태를 기본값으로 되돌린다', () => {
    useDownloadStore.setState({
      items: [createItem({ status: 'completed', progress: 100 })],
      isDownloading: true,
      isPaused: true,
      outputPath: '/tmp/out.zip',
      packagingStatus: 'completed',
      packagingProgress: 100,
      logs: [{ id: 'log-1', timestamp: 1, level: 'success', message: 'done' }],
      startTime: 123,
      currentItemIndex: 1,
      depsResolved: true,
    });

    useDownloadStore.getState().reset();

    expect(useDownloadStore.getState()).toMatchObject({
      items: [],
      isDownloading: false,
      isPaused: false,
      outputPath: '/tmp/out.zip',
      packagingStatus: 'idle',
      packagingProgress: 0,
      logs: [],
      startTime: null,
      currentItemIndex: 0,
      depsResolved: false,
    });
  });
});
