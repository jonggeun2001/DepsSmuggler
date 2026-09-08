// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  OSDistribution,
  OSDownloadProgress,
  OSPackageInfo,
  OSPackageOutputOptions,
} from '../../../../core/downloaders/os-shared/types';
import type { CartItem } from '../../../stores/cart-store';
import type { OSDownloadResultData } from '../types';
import { useOSDownloadFlow } from './use-os-download-flow';

const mocks = vi.hoisted(() => ({
  message: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  confirm: vi.fn(),
  cart: { items: [] as CartItem[] },
}));

vi.mock('antd', () => ({ message: mocks.message, Modal: { confirm: mocks.confirm } }));
vi.mock('../../../stores/cart-store', () => ({ useCartStore: { getState: () => mocks.cart } }));

const distribution: OSDistribution = {
  id: 'rocky-9',
  name: 'Rocky Linux 9',
  version: '9',
  packageManager: 'yum',
  architectures: ['x86_64', 'aarch64'],
  defaultRepos: [],
  extendedRepos: [],
};
const pkg: OSPackageInfo = {
  name: 'nginx',
  version: '1.24.0',
  architecture: 'x86_64',
  size: 2048,
  checksum: { type: 'sha256', value: 'test-checksum' },
  location: 'Packages/nginx.rpm',
  dependencies: [],
  repository: {
    id: 'baseos',
    name: 'BaseOS',
    baseUrl: 'https://repo.example.test/',
    enabled: true,
    gpgCheck: true,
    isOfficial: true,
  },
};
const outputOptions: OSPackageOutputOptions = {
  type: 'both',
  archiveFormat: 'tar.gz',
  generateScripts: true,
  scriptTypes: ['local-repo'],
};
const progress: OSDownloadProgress = {
  phase: 'downloading',
  currentPackage: pkg.name,
  currentIndex: 0,
  totalPackages: 1,
  bytesDownloaded: 1024,
  totalBytes: 2048,
  speed: 100,
};

function cartItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: 'nginx-yum',
    type: 'yum',
    name: pkg.name,
    version: pkg.version,
    arch: 'x86_64',
    addedAt: 1,
    metadata: {
      osPackageInfo: pkg,
      osContext: { distributionId: 'rocky-9', architecture: 'x86_64', packageManager: 'yum' },
    },
    ...overrides,
  };
}

function downloadResult(overrides: Partial<OSDownloadResultData> = {}): OSDownloadResultData {
  return {
    success: [pkg],
    failed: [],
    skipped: [],
    outputPath: '/downloads/os.tar.gz',
    packageManager: 'yum',
    outputOptions,
    warnings: [],
    unresolved: [],
    conflicts: [],
    cancelled: false,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createApi() {
  const listeners = new Set<(event: OSDownloadProgress) => void>();
  const unsubscribe = vi.fn();
  return {
    listeners,
    unsubscribe,
    os: {
      getDistribution: vi.fn().mockResolvedValue(distribution),
      download: {
        start: vi.fn().mockResolvedValue(downloadResult()),
        cancel: vi.fn().mockResolvedValue(undefined),
        onProgress: vi.fn((listener: (event: OSDownloadProgress) => void) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
            unsubscribe();
          };
        }),
      },
    },
  };
}

function mountFlow(overrides: Partial<Parameters<typeof useOSDownloadFlow>[0]> = {}) {
  const args = {
    cartItems: [cartItem()],
    outputDir: '/downloads',
    includeDependencies: true,
    concurrentDownloads: 4,
    cartSnapshotRef: { current: [] as CartItem[] },
    addHistory: vi.fn().mockResolvedValue('history-1'),
    clearCart: vi.fn(() => {
      mocks.cart.items = [];
    }),
    removeCartItem: vi.fn(),
    checkOutputPath: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
  mocks.cart.items = args.cartItems;
  const hook = renderHook((props) => useOSDownloadFlow(props), { initialProps: args });
  return { ...hook, args };
}

let api: ReturnType<typeof createApi>;
const originalApi = Object.getOwnPropertyDescriptor(window, 'electronAPI');

beforeEach(() => {
  vi.clearAllMocks();
  api = createApi();
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: api });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalApi) Object.defineProperty(window, 'electronAPI', originalApi);
  else Reflect.deleteProperty(window, 'electronAPI');
});

describe('useOSDownloadFlow selection and validation', () => {
  it.each([
    ['empty cart', []],
    ['library cart', [{ id: 'pip', type: 'pip', name: 'requests', version: '2.32.0', addedAt: 1 }]],
    [
      'mixed libraries and OS packages',
      [cartItem(), { id: 'npm', type: 'npm', name: 'react', version: '19.0.0', addedAt: 1 }],
    ],
  ] as Array<[string, CartItem[]]>)(
    'does not subscribe to OS download events for %s',
    (_label, cartItems) => {
      const { result } = mountFlow({ cartItems });
      expect(result.current).toMatchObject({
        isDedicatedOSFlow: false,
        requiresOSCartReselection: false,
        shouldRenderDedicatedOSFlow: false,
      });
      expect(api.os.getDistribution).not.toHaveBeenCalled();
      expect(api.os.download.onProgress).not.toHaveBeenCalled();
    }
  );

  it('requires reselection for old OS cart entries without an environment snapshot', () => {
    const { result } = mountFlow({ cartItems: [cartItem({ metadata: { osPackageInfo: pkg } })] });
    expect(result.current).toMatchObject({
      requiresOSCartReselection: true,
      isDedicatedOSFlow: false,
      effectiveOSContext: null,
    });
    expect(api.os.getDistribution).not.toHaveBeenCalled();
  });

  it('does not combine packages selected for different distributions', () => {
    const other = cartItem({
      id: 'nginx-other',
      metadata: {
        osPackageInfo: pkg,
        osContext: { distributionId: 'rocky-10', architecture: 'x86_64', packageManager: 'yum' },
      },
    });
    const { result } = mountFlow({ cartItems: [cartItem(), other] });
    expect(result.current.isDedicatedOSFlow).toBe(false);
    expect(result.current.effectiveOSContext).toBeNull();
    expect(api.os.download.onProgress).not.toHaveBeenCalled();
  });

  it('ignores a stale distribution response when the selected environment changes', async () => {
    const oldRequest = deferred<OSDistribution>();
    api.os.getDistribution.mockReturnValueOnce(oldRequest.promise);
    const { result, args, rerender } = mountFlow();
    const newerDistribution = { ...distribution, id: 'rocky-10', version: '10' };
    api.os.getDistribution.mockResolvedValueOnce(newerDistribution);
    rerender({
      ...args,
      cartItems: [
        cartItem({
          metadata: {
            osPackageInfo: pkg,
            osContext: {
              distributionId: 'rocky-10',
              architecture: 'x86_64',
              packageManager: 'yum',
            },
          },
        }),
      ],
    });
    await waitFor(() => expect(result.current.osDistribution).toEqual(newerDistribution));
    await act(async () => {
      oldRequest.resolve(distribution);
      await oldRequest.promise;
    });
    expect(result.current.osDistribution).toEqual(newerDistribution);
  });

  it('reports failed distribution lookup and blocks download before path checks', async () => {
    api.os.getDistribution.mockRejectedValueOnce(new Error('offline'));
    const { result, args } = mountFlow();
    await waitFor(() => expect(console.error).toHaveBeenCalled());
    await act(() => result.current.handleStartOSDownload(outputOptions));
    expect(result.current.osDistribution).toBeNull();
    expect(args.checkOutputPath).not.toHaveBeenCalled();
    expect(api.os.download.start).not.toHaveBeenCalled();
    expect(mocks.message.error).toHaveBeenCalledWith('OS 배포판 정보를 아직 불러오지 못했습니다');
  });

  it.each(['empty-output', 'missing-metadata', 'path-rejected', 'missing-api'] as const)(
    'prevents download and history changes when %s',
    async (failure) => {
      const { result, args } = mountFlow({
        ...(failure === 'empty-output' ? { outputDir: '' } : {}),
        ...(failure === 'missing-metadata'
          ? {
              cartItems: [
                cartItem({
                  metadata: {
                    osContext: {
                      distributionId: 'rocky-9',
                      architecture: 'x86_64',
                      packageManager: 'yum',
                    },
                  },
                }),
              ],
            }
          : {}),
      });
      await waitFor(() => expect(result.current.osDistribution).toEqual(distribution));
      if (failure === 'path-rejected') vi.mocked(args.checkOutputPath).mockResolvedValueOnce(false);
      if (failure === 'missing-api') Reflect.deleteProperty(api.os.download, 'start');
      await act(() => result.current.handleStartOSDownload(outputOptions));
      if (failure !== 'missing-api') expect(api.os.download.start).not.toHaveBeenCalled();
      expect(args.addHistory).not.toHaveBeenCalled();
      expect(args.clearCart).not.toHaveBeenCalled();
      expect(args.cartSnapshotRef.current).toEqual([]);
      expect(result.current.osDownloading).toBe(false);
      if (failure === 'empty-output')
        expect(mocks.message.warning).toHaveBeenCalledWith('출력 폴더를 선택하세요');
      if (failure === 'missing-metadata')
        expect(mocks.message.error).toHaveBeenCalledWith(
          '장바구니의 OS 패키지 메타데이터가 부족합니다. 다시 검색 후 담아주세요.'
        );
      if (failure === 'missing-api')
        expect(mocks.message.error).toHaveBeenCalledWith(
          'OS 패키지 다운로드 API를 사용할 수 없습니다'
        );
    }
  );
});

describe('useOSDownloadFlow results and cart preservation', () => {
  it('sends the selected environment and options, saves artifact history, then clears the matching cart', async () => {
    const saving = deferred<string>();
    const { result, args, rerender } = mountFlow();
    args.addHistory.mockReturnValueOnce(saving.promise);
    await waitFor(() => expect(result.current.osDistribution).toEqual(distribution));
    let downloading!: Promise<void>;
    act(() => {
      downloading = result.current.handleStartOSDownload(outputOptions);
    });
    await waitFor(() => expect(args.addHistory).toHaveBeenCalledOnce());
    expect(api.os.download.start).toHaveBeenCalledWith({
      packages: [pkg],
      outputDir: '/downloads',
      distribution,
      architecture: 'x86_64',
      resolveDependencies: true,
      includeOptionalDeps: true,
      concurrency: 4,
      outputOptions,
    });
    expect(result.current.osDownloading).toBe(true);
    expect(args.clearCart).not.toHaveBeenCalled();
    expect(args.addHistory).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          name: 'nginx',
          version: '1.24.0',
          type: 'yum',
          arch: 'x86_64',
          metadata: {
            osPackageInfo: pkg,
            osContext: { distributionId: 'rocky-9', architecture: 'x86_64', packageManager: 'yum' },
          },
        }),
      ],
      {
        outputFormat: 'tar.gz',
        includeScripts: true,
        includeDependencies: true,
        deliveryMethod: 'local',
        osOutputOptions: outputOptions,
      },
      '/downloads/os.tar.gz',
      2048,
      'success',
      1,
      0
    );
    await act(async () => {
      saving.resolve('history-1');
      await downloading;
    });
    expect(args.clearCart).toHaveBeenCalledOnce();
    expect(result.current).toMatchObject({
      osDownloading: false,
      osResult: downloadResult(),
      osDownloadError: null,
      isOSPackaging: true,
    });
    expect(mocks.message.success).toHaveBeenCalledWith('OS 패키지 다운로드가 완료되었습니다');
    rerender({ ...args, cartItems: [] });
    expect(result.current.shouldRenderDedicatedOSFlow).toBe(true);
    expect(result.current.activeOSPackageManager).toBe('yum');
  });

  it('keeps a cart modified while history is being saved', async () => {
    const saving = deferred<string>();
    const { result, args } = mountFlow();
    args.addHistory.mockReturnValueOnce(saving.promise);
    await waitFor(() => expect(result.current.osDistribution).toEqual(distribution));
    let downloading!: Promise<void>;
    act(() => {
      downloading = result.current.handleStartOSDownload(outputOptions);
    });
    await waitFor(() => expect(args.addHistory).toHaveBeenCalledOnce());
    mocks.cart.items = [...args.cartItems, cartItem({ id: 'new-selection', name: 'curl' })];
    await act(async () => {
      saving.resolve('history-1');
      await downloading;
    });
    expect(args.clearCart).not.toHaveBeenCalled();
    expect(mocks.cart.items.map((item) => item.name)).toEqual(['nginx', 'curl']);
    expect(result.current.osResult?.success).toEqual([pkg]);
  });

  it('preserves completed results and the cart if history persistence fails', async () => {
    const { result, args } = mountFlow();
    args.addHistory.mockRejectedValueOnce(new Error('EACCES: history write denied'));
    await waitFor(() => expect(result.current.osDistribution).toEqual(distribution));
    await act(() => result.current.handleStartOSDownload(outputOptions));
    expect(result.current).toMatchObject({
      osDownloading: false,
      osResult: downloadResult(),
      osDownloadError: null,
    });
    expect(args.clearCart).not.toHaveBeenCalled();
    expect(mocks.message.error).toHaveBeenCalledWith('다운로드 히스토리 저장에 실패했습니다');
  });

  it.each([
    [
      'partial',
      downloadResult({
        failed: [{ package: { ...pkg, name: 'curl' }, error: 'checksum mismatch' }],
      }),
      1,
      1,
    ],
    [
      'failed',
      downloadResult({ success: [], failed: [{ package: pkg, error: 'download denied' }] }),
      0,
      1,
    ],
    ['partial', downloadResult({ skipped: [{ ...pkg, name: 'curl' }] }), 1, 0],
  ] as const)(
    'records %s history for unsuccessful package outcomes',
    async (status, response, downloaded, failed) => {
      api.os.download.start.mockResolvedValueOnce(response);
      const { result, args } = mountFlow({ includeDependencies: false });
      await waitFor(() => expect(result.current.osDistribution).toEqual(distribution));
      await act(() => result.current.handleStartOSDownload(outputOptions));
      expect(api.os.download.start).toHaveBeenCalledWith(
        expect.objectContaining({ resolveDependencies: false, includeOptionalDeps: false })
      );
      expect(args.addHistory).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Object),
        response.outputPath,
        downloaded * pkg.size,
        status,
        downloaded,
        failed
      );
      expect(args.clearCart).not.toHaveBeenCalled();
      expect(result.current.osResult).toEqual(response);
      expect(mocks.message.warning).toHaveBeenCalledWith(
        'OS 패키지 다운로드가 부분 완료되었습니다'
      );
    }
  );

  it('shows dependency resolution errors without recording or clearing a download that never started', async () => {
    api.os.download.start.mockResolvedValueOnce(
      downloadResult({
        success: [],
        unresolved: [{ name: 'libssl', operator: '>=', version: '3' }],
        warnings: ['repository is incomplete'],
      })
    );
    const { result, args } = mountFlow();
    await waitFor(() => expect(result.current.osDistribution).toEqual(distribution));
    await act(() => result.current.handleStartOSDownload(outputOptions));
    expect(result.current.osDownloadError).toContain('libssl >= 3');
    expect(result.current.osDownloadError).toContain('repository is incomplete');
    expect(result.current).toMatchObject({ osDownloading: false, osResult: null });
    expect(args.addHistory).not.toHaveBeenCalled();
    expect(args.clearCart).not.toHaveBeenCalled();
  });

  it('retains a cancelled result without saving history or clearing the cart', async () => {
    const response = downloadResult({ cancelled: true });
    api.os.download.start.mockResolvedValueOnce(response);
    const { result, args } = mountFlow();
    await waitFor(() => expect(result.current.osDistribution).toEqual(distribution));
    await act(() => result.current.handleStartOSDownload(outputOptions));
    expect(result.current).toMatchObject({
      osResult: response,
      osDownloading: false,
      isOSPackaging: false,
    });
    expect(args.addHistory).not.toHaveBeenCalled();
    expect(args.clearCart).not.toHaveBeenCalled();
    expect(mocks.message.warning).toHaveBeenCalledWith('OS 패키지 다운로드가 취소되었습니다');
  });

  it.each([new Error('EACCES: output write denied'), 'connection closed'])(
    'recovers from a rejected download and resets transient state: %s',
    async (error) => {
      api.os.download.start.mockRejectedValueOnce(error);
      const { result, args } = mountFlow();
      await waitFor(() => expect(result.current.osDistribution).toEqual(distribution));
      await act(() => result.current.handleStartOSDownload(outputOptions));
      expect(result.current).toMatchObject({
        osDownloading: false,
        osResult: null,
        osDownloadError: error instanceof Error ? error.message : error,
      });
      expect(args.addHistory).not.toHaveBeenCalled();
      expect(args.clearCart).not.toHaveBeenCalled();
      act(() => result.current.resetOSFlow());
      expect(result.current).toMatchObject({
        osDownloading: false,
        osProgress: null,
        osResult: null,
        osDownloadError: null,
      });
      await act(() => result.current.handleStartOSDownload(outputOptions));
      expect(result.current.osResult?.success).toEqual([pkg]);
      expect(api.os.download.start).toHaveBeenCalledTimes(2);
    }
  );
});

describe('useOSDownloadFlow progress and cancellation', () => {
  it('subscribes to progress and releases the listener when unmounted', async () => {
    const { result, unmount } = mountFlow();
    await waitFor(() => expect(result.current.osDistribution).toEqual(distribution));
    expect(api.listeners.size).toBe(1);
    act(() => api.listeners.forEach((listener) => listener(progress)));
    expect(result.current.osProgress).toEqual(progress);
    unmount();
    expect(api.listeners.size).toBe(0);
    expect(api.unsubscribe).toHaveBeenCalledOnce();
  });

  it('waits for cancellation confirmation before invoking IPC', async () => {
    const { result } = mountFlow();
    await waitFor(() => expect(result.current.osDistribution).toEqual(distribution));
    act(() => api.listeners.forEach((listener) => listener(progress)));
    act(() => result.current.handleCancelOSDownload());
    expect(api.os.download.cancel).not.toHaveBeenCalled();
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'OS 패키지 다운로드 취소' })
    );
    const onOk = mocks.confirm.mock.lastCall![0].onOk as () => Promise<void>;
    await act(onOk);
    expect(api.os.download.cancel).toHaveBeenCalledOnce();
    expect(result.current.osProgress).toMatchObject({
      currentPackage: '취소 요청 중',
      bytesDownloaded: 1024,
    });
    expect(mocks.message.warning).toHaveBeenCalledWith('OS 패키지 다운로드 취소를 요청했습니다');
  });

  it('rejects cancellation while packaging without opening a confirmation dialog', async () => {
    const { result } = mountFlow();
    await waitFor(() => expect(result.current.osDistribution).toEqual(distribution));
    act(() => api.listeners.forEach((listener) => listener({ ...progress, phase: 'packaging' })));
    act(() => result.current.handleCancelOSDownload());
    expect(result.current.isOSPackaging).toBe(true);
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(api.os.download.cancel).not.toHaveBeenCalled();
    expect(mocks.message.info).toHaveBeenCalledWith('패키징 단계에서는 취소할 수 없습니다');
  });

  it('reports unavailable cancellation IPC without pretending to request cancellation', async () => {
    const { result } = mountFlow();
    await waitFor(() => expect(result.current.osDistribution).toEqual(distribution));
    Reflect.deleteProperty(api.os.download, 'cancel');
    act(() => result.current.handleCancelOSDownload());
    await act(mocks.confirm.mock.lastCall![0].onOk as () => Promise<void>);
    expect(mocks.message.error).toHaveBeenCalledWith('OS 패키지 취소 API를 사용할 수 없습니다');
    expect(mocks.message.warning).not.toHaveBeenCalled();
  });

  it('removes only the requested package in the active OS manager', async () => {
    const { result, args } = mountFlow();
    await waitFor(() => expect(result.current.osDistribution).toEqual(distribution));
    act(() => result.current.handleRemoveOSPackage({ ...pkg, version: 'different' }));
    expect(args.removeCartItem).not.toHaveBeenCalled();
    act(() => result.current.handleRemoveOSPackage(pkg));
    expect(args.removeCartItem).toHaveBeenCalledExactlyOnceWith('nginx-yum');
  });
});
