// @vitest-environment jsdom

import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { groupDownloadItems } from '../utils';
import type { DownloadStoreItem } from '../../../stores/download-store';
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

vi.mock('../../../../../electron/utils/logger', () => ({
  createScopedLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
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
    dependency: {
      resolve: vi.fn(),
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

const createFlinkResolutionFixture = () => {
  const version = '1.20.5';
  const makeArtifact = (artifactId: string, artifactType: 'jar' | 'pom') => {
    const filename = `${artifactId}-${version}.${artifactType}`;
    const metadata = { groupId: 'org.apache.flink', artifactId, type: artifactType, filename, size: 10 };
    return {
      id: randomUUID(),
      type: 'maven' as const,
      name: `org.apache.flink:${artifactId}`,
      version,
      filename,
      size: 10,
      downloadUrl: `https://repo.example.invalid/${filename}`,
      metadata,
    };
  };
  const original = makeArtifact('flink-streaming-java', 'jar');
  const libraries = Array.from({ length: 35 }, (_, index) => makeArtifact(`flink-library-${index}`, 'jar'));
  // The companion root POM has the same GAV as the original JAR but is a distinct artifact.
  const poms = [
    makeArtifact('flink-streaming-java', 'pom'),
    ...Array.from({ length: 34 }, (_, index) => makeArtifact(`flink-parent-${index}`, 'pom')),
  ];
  const allPackages = [original, ...libraries, ...poms];
  const toPackage = ({ type, name, version: packageVersion, metadata }: typeof original) => ({
    type, name, version: packageVersion, metadata,
  });
  return {
    original,
    poms,
    payload: {
      originalPackages: [original],
      allPackages,
      dependencyTrees: [{
        root: {
          package: toPackage(original),
          dependencies: libraries.map((item) => ({ package: toPackage(item), dependencies: [] })),
        },
        flatList: allPackages.map(toPackage),
        conflicts: [],
        totalSize: 710,
      }],
      failedPackages: [],
    },
  };
};

const expectCompleteFlinkPreview = (
  items: DownloadStoreItem[],
  fixture: ReturnType<typeof createFlinkResolutionFixture>
) => {
  expect(items).toHaveLength(71);
  const groups = groupDownloadItems(items);
  expect(groups).toHaveLength(1);
  expect(groups.reduce((total, group) => total + group.status.total, 0)).toBe(71);
  expect(groups[0].parent.id).toBe(fixture.original.id);
  expect(groups[0].dependencies).toHaveLength(70);
  expect(groups[0].dependencies.filter((item) => item.metadata?.type === 'pom')).toHaveLength(35);
  for (const expected of fixture.poms) {
    expect(items.find((item) => item.id === expected.id)).toMatchObject({
      id: expected.id,
      isDependency: true,
      parentId: fixture.original.id,
      dependencyOf: fixture.original.name,
      filename: expected.filename,
      metadata: expected.metadata,
      downloadUrl: expected.downloadUrl,
      totalBytes: expected.size,
    });
  }
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

  it('의존성 확인에서 트리 밖 부모 POM까지 71개 항목을 원본 장바구니 ID 아래 표시한다', async () => {
    const fixture = createFlinkResolutionFixture();
    const { electronAPI, rendered } = await loadController({
      cartItems: [{ ...fixture.original, addedAt: Date.now() }],
      includeDependencies: true,
    });
    electronAPI.dependency.resolve.mockResolvedValueOnce(fixture.payload);

    await act(async () => {
      await rendered.result.current.handleResolveDependencies();
    });

    expect(electronAPI.dependency.resolve).toHaveBeenCalledWith(expect.objectContaining({
      packages: [expect.objectContaining({ id: fixture.original.id, metadata: fixture.original.metadata })],
    }));
    expectCompleteFlinkPreview(rendered.result.current.downloadItems, fixture);
  });

  it('다운로드 의존성 완료 이벤트도 트리 밖 POM의 소속과 아티팩트 정보를 유지한다', async () => {
    const fixture = createFlinkResolutionFixture();
    const { listeners, rendered } = await loadController({
      cartItems: [{ ...fixture.original, addedAt: Date.now() }],
      includeDependencies: true,
      downloadState: { isDownloading: true },
    });

    await act(async () => {
      listeners.depsResolved?.(fixture.payload);
      await flushMicrotasks();
    });

    expectCompleteFlinkPreview(rendered.result.current.downloadItems, fixture);
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

  it('start 시 npm 직접 요청만 npmRootPackages로 전달하고 dependency는 제외한다', async () => {
    const { electronAPI, rendered, stores } = await loadController({
      cartItems: [{ id: 'npm-root', type: 'npm', name: 'is-odd', version: '3.0.1', addedAt: Date.now() }],
    });
    act(() => {
      stores.useDownloadStore.setState({
        items: [
          {
            id: 'npm-root', name: 'is-odd', version: '3.0.1', type: 'npm', isDependency: false,
            status: 'pending', progress: 0, downloadedBytes: 0, totalBytes: 0, speed: 0,
          },
          {
            id: 'npm-dependency', name: 'is-number', version: '6.0.0', type: 'npm', isDependency: true,
            status: 'pending', progress: 0, downloadedBytes: 0, totalBytes: 0, speed: 0,
          },
        ],
      });
    });
    await waitFor(() => expect(rendered.result.current.downloadItems).toHaveLength(2));

    await act(async () => {
      await rendered.result.current.handleStartDownload();
    });

    expect(electronAPI.download.start).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        npmRootPackages: [{ type: 'npm', name: 'is-odd', version: '3.0.1', metadata: undefined }],
      }),
    }));
  });

  it('npm 항목이 dependency만이어도 npmRootPackages를 빈 배열로 전달한다', async () => {
    const { electronAPI, rendered } = await loadController({
      cartItems: [{ id: 'npm-root', type: 'npm', name: 'is-odd', version: '3.0.1', addedAt: Date.now() }],
      includeDependencies: true,
      downloadState: {
        depsResolved: true,
        items: [{
          id: 'npm-dependency', name: 'is-number', version: '6.0.0', type: 'npm', isDependency: true,
          status: 'pending', progress: 0, downloadedBytes: 0, totalBytes: 0, speed: 0,
        }],
      },
    });

    await act(async () => {
      await rendered.result.current.handleStartDownload();
    });

    expect(electronAPI.download.start).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ npmRootPackages: [] }),
    }));
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

  it.each([503, 404])('실제 HTTP %s 실패 후 같은 항목 재시도는 성공 산출물만 기록한다', async (failureStatus) => {
    const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-http-status-'));
    const payload = Buffer.from('synthetic transport payload');
    let requests = 0;
    const server = http.createServer((_request, response) => {
      requests += 1;
      if (requests === 1) {
        response.writeHead(failureStatus, { 'content-type': 'text/plain' });
        response.end(`failure-${failureStatus}`);
        return;
      }
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': payload.length });
      response.end(payload);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('HTTP fixture did not bind');

    try {
      const packageItem = {
        id: `conda-http-${failureStatus}`,
        type: 'conda',
        name: 'fixture',
        version: '1.0.0',
        downloadUrl: `http://127.0.0.1:${address.port}/fixture-1.0.0-0.tar.bz2`,
        addedAt: Date.now(),
      };
      const { electronAPI, listeners, rendered, stores } = await loadController({
        cartItems: [packageItem],
        defaultDownloadPath: outputDir,
      });
      const { createDownloadOrchestrator } = await import('../../../../../electron/services/download-orchestrator');
      const dispatch = (channel: string, data: unknown) => {
        if (channel === 'download:progress') listeners.progress?.(data as Record<string, unknown>);
        if (channel === 'download:status') listeners.status?.(data as Record<string, unknown>);
        if (channel === 'download:all-complete') listeners.allComplete?.(data as Record<string, unknown>);
      };
      const orchestrator = createDownloadOrchestrator({
        getMainWindow: () => ({
          isDestroyed: () => false,
          webContents: { isDestroyed: () => false, send: dispatch },
        } as never),
      });
      electronAPI.download.start.mockImplementation((data) => orchestrator.startDownload(data as never));
      await act(async () => { await rendered.result.current.handleStartDownload(); });
      await waitFor(() => expect(rendered.result.current.packagingStatus).toBe('failed'), { timeout: 10_000 });
      expect(electronAPI.history.add).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed', outputPath: outputDir })
      );
      expect(fs.existsSync(`${outputDir}.zip`)).toBe(false);
      const packagePath = path.join(outputDir, 'packages', 'fixture-1.0.0-0.tar.bz2');
      expect(fs.existsSync(packagePath)).toBe(false);
      const failedHistoryCalls = electronAPI.history.add.mock.calls.length;
      expect(failedHistoryCalls).toBe(1);

      const failedItem = rendered.result.current.downloadItems[0];
      expect(failedItem.status).toBe('failed');
      expect(failedItem.error).toContain(`HTTP ${failureStatus}`);
      await act(async () => { await rendered.result.current.executeRetryDownload(failedItem); });
      await waitFor(() => expect(rendered.result.current.packagingStatus).toBe('completed'), { timeout: 10_000 });
      expect(requests).toBe(2);
      expect(electronAPI.history.add).toHaveBeenCalledTimes(failedHistoryCalls + 1);
      expect(electronAPI.history.add).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'success', outputPath: `${outputDir}.zip` })
      );
      expect(stores.useDownloadStore.getState().isDownloading).toBe(false);
      const outputPath = rendered.result.current.completedOutputPath;
      expect(outputPath).toMatch(/\.zip$/);
      expect(fs.existsSync(outputPath)).toBe(true);
      expect((await fs.promises.stat(outputPath)).size).toBeGreaterThan(0);
      expect(await fs.promises.readFile(packagePath)).toEqual(payload);
      const python = process.platform === 'win32' ? 'py' : 'python3';
      const args = process.platform === 'win32' ? ['-3', '-c'] : ['-c'];
      args.push(
        'import sys,zipfile,base64; z=zipfile.ZipFile(sys.argv[1]); print(base64.b64encode(z.read("packages/fixture-1.0.0-0.tar.bz2")).decode())',
        outputPath,
      );
      const inspected = await promisify(execFile)(python, args, { timeout: 30_000 });
      expect(inspected.stdout.trim()).toBe(payload.toString('base64'));
      rendered.unmount();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.promises.rm(outputDir, { recursive: true, force: true });
      await fs.promises.rm(`${outputDir}.zip`, { force: true });
    }
  }, 30_000);
});
