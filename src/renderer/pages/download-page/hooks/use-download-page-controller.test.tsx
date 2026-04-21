// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const routerMock = vi.hoisted(() => ({
  navigate: vi.fn(),
  location: { state: null as unknown },
}));

const antdMock = vi.hoisted(() => ({
  message: {
    warning: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
  confirm: vi.fn(({ onOk }: { onOk?: () => void | Promise<void> }) => onOk?.()),
}));

const osFlowMock = vi.hoisted(() => ({
  value: {
    isDedicatedOSFlow: false,
    osDownloading: false,
    osResult: null,
    requiresOSCartReselection: false,
    resetOSFlow: vi.fn(),
  },
}));

vi.mock('@ant-design/icons', () => ({
  ExclamationCircleOutlined: () => null,
}));

vi.mock('antd', () => ({
  message: antdMock.message,
  Modal: {
    confirm: antdMock.confirm,
  },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => routerMock.navigate,
  useLocation: () => routerMock.location,
}));

vi.mock('./use-os-download-flow', () => ({
  useOSDownloadFlow: () => osFlowMock.value,
}));

type DownloadListenerMap = {
  progress?: (payload: Record<string, unknown>) => void;
  status?: (payload: Record<string, unknown>) => void;
  depsResolved?: (payload: Record<string, unknown>) => void;
  allComplete?: (payload: Record<string, unknown>) => void;
};

const createStorageMock = () => {
  const store = new Map<string, string>();

  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
  };
};

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const createElectronApi = () => {
  const listeners: DownloadListenerMap = {};

  const electronAPI = {
    config: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn().mockResolvedValue(undefined),
    },
    history: {
      load: vi.fn().mockResolvedValue([]),
      add: vi.fn().mockResolvedValue({ success: true }),
      delete: vi.fn().mockResolvedValue({ success: true }),
      clear: vi.fn().mockResolvedValue({ success: true }),
    },
    download: {
      checkPath: vi.fn().mockResolvedValue({
        exists: false,
        fileCount: 0,
        totalSize: 0,
      }),
      clearPath: vi.fn().mockResolvedValue({ success: true }),
      start: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(undefined),
      onProgress: vi.fn((callback: DownloadListenerMap['progress']) => {
        listeners.progress = callback;
        return () => {
          delete listeners.progress;
        };
      }),
      onStatus: vi.fn((callback: DownloadListenerMap['status']) => {
        listeners.status = callback;
        return () => {
          delete listeners.status;
        };
      }),
      onDepsResolved: vi.fn((callback: DownloadListenerMap['depsResolved']) => {
        listeners.depsResolved = callback;
        return () => {
          delete listeners.depsResolved;
        };
      }),
      onAllComplete: vi.fn((callback: DownloadListenerMap['allComplete']) => {
        listeners.allComplete = callback;
        return () => {
          delete listeners.allComplete;
        };
      }),
    },
    openFolder: vi.fn().mockResolvedValue(undefined),
    selectFolder: vi.fn().mockResolvedValue('/tmp/selected'),
  };

  return { electronAPI, listeners };
};

const loadController = async (options?: {
  cartItems?: Array<Record<string, unknown>>;
  includeDependencies?: boolean;
  downloadState?: Record<string, unknown>;
  defaultDownloadPath?: string;
}) => {
  vi.resetModules();
  const localStorage = createStorageMock();
  const { electronAPI, listeners } = createElectronApi();
  (window as typeof window & { electronAPI?: typeof electronAPI }).electronAPI = electronAPI;
  vi.stubGlobal('localStorage', localStorage);
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: localStorage,
  });

  const [{ useCartStore }, { useDownloadStore }, { useSettingsStore }, { useHistoryStore }, hookModule] =
    await Promise.all([
      import('../../../stores/cart-store'),
      import('../../../stores/download-store'),
      import('../../../stores/settings-store'),
      import('../../../stores/history-store'),
      import('./use-download-page-controller'),
    ]);

  useCartStore.setState({
    items: (options?.cartItems ?? [
      {
        id: 'pip-requests-2.32.0',
        type: 'pip',
        name: 'requests',
        version: '2.32.0',
        addedAt: Date.now(),
      },
    ]) as never,
  });
  useDownloadStore.getState().reset();
  if (options?.downloadState) {
    useDownloadStore.setState(options.downloadState as never);
  }
  useHistoryStore.setState({
    histories: [],
    initialized: true,
    loading: false,
  });
  useSettingsStore.setState({
    ...useSettingsStore.getState(),
    _initialized: true,
    includeDependencies: options?.includeDependencies ?? false,
    defaultDownloadPath: options?.defaultDownloadPath ?? '/tmp/out',
    downloadRenderInterval: 0,
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    smtpUser: 'sender@example.com',
    smtpFrom: 'sender@example.com',
    smtpTo: 'offline@example.com',
  });

  const rendered = renderHook(() => hookModule.useDownloadPageController());

  await waitFor(() => {
    expect(rendered.result.current.downloadItems.length).toBeGreaterThan(0);
  });

  return {
    electronAPI,
    listeners,
    localStorage,
    rendered,
    stores: {
      useCartStore,
      useDownloadStore,
      useSettingsStore,
      useHistoryStore,
    },
  };
};

describe('useDownloadPageController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routerMock.navigate.mockReset();
    routerMock.location = { state: null };
    osFlowMock.value.resetOSFlow.mockReset();
  });

  afterEach(() => {
    delete (window as typeof window & { electronAPI?: unknown }).electronAPI;
  });

  it('start 시 다운로드 API에 현재 장바구니와 옵션을 전달한다', async () => {
    const { electronAPI, rendered } = await loadController();

    await act(async () => {
      await rendered.result.current.handleStartDownload();
    });

    expect(electronAPI.download.start).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 1,
        packages: [
          expect.objectContaining({
            id: 'pip-requests-2.32.0',
            type: 'pip',
            name: 'requests',
            version: '2.32.0',
          }),
        ],
        options: expect.objectContaining({
          outputDir: '/tmp/out',
          outputFormat: 'zip',
          includeDependencies: false,
          concurrency: 3,
        }),
      })
    );
    expect(rendered.result.current.isDownloading).toBe(true);
  });

  it('pause 시 상태와 IPC 호출을 일시정지로 바꾼다', async () => {
    const { electronAPI, rendered, stores } = await loadController({
      downloadState: {
        isDownloading: true,
      },
    });

    await act(async () => {
      await rendered.result.current.handlePauseResume();
    });

    expect(electronAPI.download.pause).toHaveBeenCalledTimes(1);
    expect(stores.useDownloadStore.getState().isPaused).toBe(true);
    expect(stores.useDownloadStore.getState().logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'info',
          message: '다운로드 일시정지',
        }),
      ])
    );
  });

  it('resume 시 상태와 IPC 호출을 재개로 바꾼다', async () => {
    const { electronAPI, rendered, stores } = await loadController({
      downloadState: {
        isDownloading: true,
        isPaused: true,
      },
    });

    await act(async () => {
      await rendered.result.current.handlePauseResume();
    });

    expect(electronAPI.download.resume).toHaveBeenCalledTimes(1);
    expect(stores.useDownloadStore.getState().isPaused).toBe(false);
    expect(stores.useDownloadStore.getState().logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'info',
          message: '다운로드 재개',
        }),
      ])
    );
  });

  it('cancel 시 진행 중 항목을 cancelled로 바꾸고 취소 IPC를 호출한다', async () => {
    const { electronAPI, rendered, stores } = await loadController();

    act(() => {
      stores.useDownloadStore.setState({
        isDownloading: true,
        items: [
          {
            id: 'pip-requests-2.32.0',
            name: 'requests',
            version: '2.32.0',
            type: 'pip',
            status: 'downloading',
            progress: 25,
            downloadedBytes: 256,
            totalBytes: 1024,
            speed: 32,
          },
          {
            id: 'pip-urllib3-2.1.0',
            name: 'urllib3',
            version: '2.1.0',
            type: 'pip',
            status: 'pending',
            progress: 0,
            downloadedBytes: 0,
            totalBytes: 0,
            speed: 0,
          },
        ],
      });
    });

    await waitFor(() => {
      expect(rendered.result.current.downloadItems).toHaveLength(2);
    });

    await act(async () => {
      rendered.result.current.handleCancelDownload();
      await flushMicrotasks();
    });

    await waitFor(() => {
      expect(electronAPI.download.cancel).toHaveBeenCalledTimes(1);
    });

    expect(stores.useDownloadStore.getState().isDownloading).toBe(false);
    expect(stores.useDownloadStore.getState().logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'info',
          message: '다운로드 취소 요청 전송됨',
        }),
        expect.objectContaining({
          level: 'warn',
          message: '다운로드 취소됨',
        }),
      ])
    );
    expect(antdMock.message.warning).toHaveBeenCalledWith('다운로드가 취소되었습니다');
  });

  it('complete 이벤트를 받으면 완료 상태와 산출물 경로를 고정한다', async () => {
    const { electronAPI, listeners, rendered, stores } = await loadController();

    await act(async () => {
      await rendered.result.current.handleStartDownload();
    });

    await act(async () => {
      listeners.allComplete?.({
        sessionId: 1,
        success: true,
        outputPath: '/tmp/out.zip',
        artifactPaths: ['/tmp/out.zip'],
        deliveryMethod: 'local',
        results: [{ id: 'pip-requests-2.32.0', success: true }],
      });
      await flushMicrotasks();
    });

    await waitFor(() => {
      expect(rendered.result.current.packagingStatus).toBe('completed');
    });

    expect(rendered.result.current.completedOutputPath).toBe('/tmp/out.zip');
    expect(stores.useDownloadStore.getState().isDownloading).toBe(false);
    expect(electronAPI.history.add).toHaveBeenCalledTimes(1);
    expect(antdMock.message.success).toHaveBeenCalledWith('다운로드 및 패키징이 완료되었습니다');
  });

  it('start 실패 시 이전 세션 상태로 복구하고 오류 로그를 남긴다', async () => {
    const { electronAPI, rendered, stores } = await loadController();
    electronAPI.download.start.mockRejectedValueOnce(new Error('IPC unavailable'));

    await act(async () => {
      await rendered.result.current.handleStartDownload();
    });

    await waitFor(() => {
      expect(stores.useDownloadStore.getState().isDownloading).toBe(false);
    });

    expect(stores.useDownloadStore.getState().logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'error',
          message: '다운로드 시작 실패',
          details: 'Error: IPC unavailable',
        }),
      ])
    );
  });
});
