// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { FormInstance } from 'antd';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsFormActions } from './use-settings-form-actions';
import type { SettingsFormSubmission, SettingsStoreSnapshot } from './settings-form-utils';

const mocks = vi.hoisted(() => ({
  message: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn() },
  blocker: { state: 'unblocked', proceed: vi.fn(), reset: vi.fn() },
  useBlocker: vi.fn(),
}));

vi.mock('antd', () => ({ message: mocks.message }));
vi.mock('react-router-dom', () => ({
  useBlocker: (predicate: unknown) => {
    mocks.useBlocker(predicate);
    return mocks.blocker;
  },
}));

const snapshot: SettingsStoreSnapshot = {
  concurrentDownloads: 3,
  enableCache: true,
  cachePath: '/cache',
  includeDependencies: true,
  defaultDownloadPath: '/downloads',
  defaultOutputFormat: 'zip',
  includeInstallScripts: true,
  enableFileSplit: false,
  maxFileSize: 25,
  smtpHost: '',
  smtpPort: 587,
  smtpUser: '',
  smtpPassword: '',
  smtpFrom: '',
  smtpTo: '',
  languageVersions: { python: '3.12' },
  defaultTargetOS: 'linux',
  defaultArchitecture: 'x86_64',
  pipTargetPlatform: { os: 'linux', arch: 'x86_64', linuxDistro: 'rocky9', glibcVersion: '2.34' },
  condaChannel: 'defaults',
  cudaVersion: null,
  yumDistribution: { id: 'rocky-9', architecture: 'x86_64' },
  aptDistribution: { id: 'ubuntu-24.04', architecture: 'amd64' },
  apkDistribution: { id: 'alpine-3.20', architecture: 'aarch64' },
  dockerArchitecture: 'amd64',
  dockerLayerCompression: 'gzip',
  dockerIncludeLoadScript: true,
  autoUpdate: false,
  autoDownloadUpdate: false,
  downloadRenderInterval: 100,
};

function createApi() {
  return {
    cache: {
      getStats: vi.fn().mockResolvedValue({
        totalSize: 4096,
        entryCount: 3,
        details: { pip: { diskEntries: 2, diskSize: 4096 }, npm: { entries: 1 } },
      }),
      clear: vi.fn().mockResolvedValue(undefined),
    },
    selectDirectory: vi.fn().mockResolvedValue('/selected-downloads'),
    selectFolder: vi.fn().mockResolvedValue('/selected-cache'),
    testSmtpConnection: vi.fn().mockResolvedValue({ success: true }),
    updater: { check: vi.fn().mockResolvedValue({ success: true }) },
  };
}

function installApi(api: unknown) {
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: api });
}

function mountActions() {
  let values: SettingsFormSubmission = {};
  const form = {
    getFieldsValue: vi.fn(() => ({ ...values })),
    setFieldsValue: vi.fn((updates: SettingsFormSubmission) => {
      values = { ...values, ...updates };
    }),
    setFieldValue: vi.fn((field: string, value: unknown) => {
      values = { ...values, [field]: value };
    }),
    resetFields: vi.fn(() => {
      values = {};
    }),
    validateFields: vi.fn().mockResolvedValue(undefined),
  };
  const updateSettings = vi.fn();
  const resetSettings = vi.fn();
  const hook = renderHook(
    ({ settingsSnapshot }) =>
      useSettingsFormActions({
        form: form as unknown as FormInstance,
        settingsSnapshot,
        updateSettings,
        resetSettings,
      }),
    { initialProps: { settingsSnapshot: { ...snapshot } } }
  );
  return { ...hook, form, updateSettings, resetSettings };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let api: ReturnType<typeof createApi>;
const originalApi = Object.getOwnPropertyDescriptor(window, 'electronAPI');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.blocker.state = 'unblocked';
  api = createApi();
  installApi(api);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalApi) Object.defineProperty(window, 'electronAPI', originalApi);
  else Reflect.deleteProperty(window, 'electronAPI');
});

describe('useSettingsFormActions form and navigation', () => {
  it('keeps a dirty draft across equivalent store snapshots and marks a normalized save clean', async () => {
    const { result, form, updateSettings, rerender } = mountActions();
    await waitFor(() => expect(result.current.loadingCache).toBe(false));
    act(() => {
      form.setFieldValue('yumDistributionId', 'rocky-10');
      result.current.handleFormChange();
    });
    expect(result.current.isDirty).toBe(true);
    rerender({ settingsSnapshot: { ...snapshot } });
    expect(form.getFieldsValue().yumDistributionId).toBe('rocky-10');
    expect(result.current.isDirty).toBe(true);

    act(() => result.current.handleSave(form.getFieldsValue()));
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        yumDistribution: { id: 'rocky-10', architecture: 'x86_64' },
      })
    );
    expect(updateSettings.mock.calls[0][0]).not.toHaveProperty('yumDistributionId');
    expect(result.current.isDirty).toBe(false);
    expect(mocks.message.success).toHaveBeenCalledWith('설정이 저장되었습니다');
    act(() => result.current.handleFormChange());
    expect(result.current.isDirty).toBe(false);
  });

  it('blocks only a dirty path change and removes the unload protection on unmount', async () => {
    const { result, form, unmount } = mountActions();
    await waitFor(() => expect(result.current.loadingCache).toBe(false));
    const cleanEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);
    act(() => {
      form.setFieldValue('smtpHost', 'smtp.example.test');
      result.current.handleFormChange();
    });
    const predicate = mocks.useBlocker.mock.lastCall![0] as (locations: {
      currentLocation: { pathname: string };
      nextLocation: { pathname: string };
    }) => boolean;
    expect(
      predicate({
        currentLocation: { pathname: '/settings' },
        nextLocation: { pathname: '/settings' },
      })
    ).toBe(false);
    expect(
      predicate({ currentLocation: { pathname: '/settings' }, nextLocation: { pathname: '/cart' } })
    ).toBe(true);
    const dirtyEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);
    unmount();
    const unmountedEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unmountedEvent);
    expect(unmountedEvent.defaultPrevented).toBe(false);
  });

  it('keeps navigation blocked after form validation fails, then saves before proceeding', async () => {
    mocks.blocker.state = 'blocked';
    const { result, form, updateSettings } = mountActions();
    await waitFor(() => expect(result.current.loadingCache).toBe(false));
    form.validateFields.mockRejectedValueOnce({ errorFields: [{ name: ['smtpPort'] }] });
    await act(() => result.current.handleNavigationConfirm(true));
    expect(result.current.showNavigationModal).toBe(true);
    expect(updateSettings).not.toHaveBeenCalled();
    expect(mocks.blocker.proceed).not.toHaveBeenCalled();
    expect(mocks.message.error).toHaveBeenCalledWith('설정 저장에 실패했습니다');

    await act(() => result.current.handleNavigationConfirm(true));
    expect(updateSettings).toHaveBeenCalledOnce();
    expect(mocks.blocker.proceed).toHaveBeenCalledOnce();
    expect(updateSettings.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.blocker.proceed.mock.invocationCallOrder[0]
    );
    expect(result.current.showNavigationModal).toBe(false);
  });

  it.each(['discard', 'cancel'] as const)(
    '%s navigation does not save or validate the draft',
    async (action) => {
      mocks.blocker.state = 'blocked';
      const { result, form, updateSettings } = mountActions();
      await waitFor(() => expect(result.current.loadingCache).toBe(false));
      if (action === 'discard') await act(() => result.current.handleNavigationConfirm(false));
      else act(() => result.current.handleNavigationCancel());
      expect(form.validateFields).not.toHaveBeenCalled();
      expect(updateSettings).not.toHaveBeenCalled();
      expect(mocks.blocker.proceed).toHaveBeenCalledTimes(action === 'discard' ? 1 : 0);
      expect(mocks.blocker.reset).toHaveBeenCalledTimes(action === 'cancel' ? 1 : 0);
      expect(result.current.showNavigationModal).toBe(false);
    }
  );

  it('reset removes fields outside the snapshot even when persisted defaults are unchanged', async () => {
    const { result, form, resetSettings, rerender } = mountActions();
    await waitFor(() => expect(result.current.loadingCache).toBe(false));
    act(() => {
      form.setFieldValue('hiddenDraft', 'stale');
      result.current.handleFormChange();
    });
    act(() => result.current.handleReset());
    rerender({ settingsSnapshot: { ...snapshot } });
    expect(resetSettings).toHaveBeenCalledOnce();
    expect(form.resetFields).toHaveBeenCalledOnce();
    expect(form.getFieldsValue()).not.toHaveProperty('hiddenDraft');
    expect(form.getFieldsValue().defaultDownloadPath).toBe('/downloads');
    expect(result.current.isDirty).toBe(false);
  });
});

describe('useSettingsFormActions cache and folders', () => {
  it('loads cache statistics, clears only after successful deletion, and releases loading state', async () => {
    const pending = deferred<void>();
    api.cache.clear.mockReturnValueOnce(pending.promise);
    const { result } = mountActions();
    await waitFor(() => expect(result.current.cacheSize).toBe(4096));
    expect(result.current.cacheCount).toBe(3);
    expect(result.current.cacheDetails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'pip', entryCount: 2, sizeBytes: 4096 }),
        expect.objectContaining({ key: 'npm', entryCount: 1 }),
      ])
    );
    let clearing!: Promise<void>;
    act(() => {
      clearing = result.current.handleClearCache();
    });
    expect(result.current.clearingCache).toBe(true);
    expect(result.current.cacheCount).toBe(3);
    await act(async () => {
      pending.resolve();
      await clearing;
    });
    expect(result.current.clearingCache).toBe(false);
    expect(result.current.cacheSize).toBe(0);
    expect(result.current.cacheCount).toBe(0);
    expect(result.current.cacheDetails.every((detail) => detail.entryCount === 0)).toBe(true);
    expect(mocks.message.success).toHaveBeenCalledWith('패키지 캐시가 삭제되었습니다');
  });

  it('retains cache statistics after a deletion permission error and permits a retry', async () => {
    api.cache.clear.mockRejectedValueOnce(new Error('EACCES: permission denied'));
    const { result } = mountActions();
    await waitFor(() => expect(result.current.cacheCount).toBe(3));
    await act(() => result.current.handleClearCache());
    expect(result.current.cacheSize).toBe(4096);
    expect(result.current.cacheCount).toBe(3);
    expect(result.current.clearingCache).toBe(false);
    expect(mocks.message.error).toHaveBeenCalledWith('패키지 캐시 삭제에 실패했습니다');
    expect(mocks.message.success).not.toHaveBeenCalled();
    await act(() => result.current.handleClearCache());
    expect(result.current.cacheCount).toBe(0);
  });

  it('replaces stale statistics with an empty state if cache refresh fails', async () => {
    const { result } = mountActions();
    await waitFor(() => expect(result.current.cacheCount).toBe(3));
    api.cache.getStats.mockRejectedValueOnce(new Error('cache unavailable'));
    await act(() => result.current.loadCacheInfo());
    expect(result.current).toMatchObject({ cacheSize: 0, cacheCount: 0, loadingCache: false });
    expect(result.current.cacheDetails.every((detail) => detail.entryCount === 0)).toBe(true);
  });

  it('reports unavailable cache and folder APIs in browser mode without changing the form', async () => {
    installApi(undefined);
    const { result, form } = mountActions();
    await waitFor(() => expect(result.current.loadingCache).toBe(false));
    await act(() => result.current.handleClearCache());
    await act(() => result.current.handleSelectCacheFolder());
    await act(() => result.current.handleSelectDownloadFolder());
    expect(result.current).toMatchObject({
      cacheCount: 0,
      cacheSize: 0,
      clearingCache: false,
      isDirty: false,
    });
    expect(form.setFieldValue).not.toHaveBeenCalled();
    expect(mocks.message.error).toHaveBeenCalledWith('패키지 캐시 삭제에 실패했습니다');
    expect(mocks.message.info).toHaveBeenCalledWith(
      '폴더 선택 기능은 Electron 환경에서 사용 가능합니다'
    );
    expect(mocks.message.info).toHaveBeenCalledWith('폴더 선택은 Electron 환경에서만 가능합니다');
  });

  it.each([
    ['handleSelectDownloadFolder', 'selectDirectory', 'defaultDownloadPath', '/selected-downloads'],
    ['handleSelectCacheFolder', 'selectFolder', 'cachePath', '/selected-cache'],
  ] as const)(
    '%s keeps cancelled selection clean and marks a chosen folder dirty',
    async (handler, picker, field, path) => {
      api[picker].mockResolvedValueOnce(null);
      const { result, form } = mountActions();
      await waitFor(() => expect(result.current.loadingCache).toBe(false));
      await act(() => result.current[handler]());
      expect(form.setFieldValue).not.toHaveBeenCalled();
      expect(result.current.isDirty).toBe(false);
      await act(() => result.current[handler]());
      expect(form.getFieldsValue()[field]).toBe(path);
      expect(result.current.isDirty).toBe(true);
    }
  );
});

describe('useSettingsFormActions SMTP and updates', () => {
  it.each([
    { smtpHost: '', smtpPort: 587 },
    { smtpHost: 'smtp.example.test', smtpPort: 0 },
  ])('rejects missing SMTP host or port before invoking IPC: %j', async (fields) => {
    const { result, form } = mountActions();
    await waitFor(() => expect(result.current.loadingCache).toBe(false));
    form.setFieldsValue(fields);
    await act(() => result.current.handleTestSmtp());
    expect(api.testSmtpConnection).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ testingSmtp: false, smtpTestResult: null });
    expect(mocks.message.warning).toHaveBeenCalledWith('SMTP 서버와 포트를 입력하세요');
  });

  it('passes the current unsaved SMTP fields and resolves the pending state from IPC', async () => {
    const pending = deferred<{ success: boolean }>();
    api.testSmtpConnection.mockReturnValueOnce(pending.promise);
    const { result, form, updateSettings } = mountActions();
    await waitFor(() => expect(result.current.loadingCache).toBe(false));
    form.setFieldsValue({
      smtpHost: 'smtp.example.test',
      smtpPort: 2525,
      smtpUser: 'sender',
      smtpPassword: 'test-only',
      smtpFrom: 'sender@example.test',
    });
    let testing!: Promise<void>;
    act(() => {
      testing = result.current.handleTestSmtp();
    });
    expect(result.current).toMatchObject({
      testingSmtp: true,
      smtpTestResult: null,
      smtpTestMode: 'ipc',
    });
    expect(api.testSmtpConnection).toHaveBeenCalledWith({
      host: 'smtp.example.test',
      port: 2525,
      user: 'sender',
      password: 'test-only',
      from: 'sender@example.test',
    });
    await act(async () => {
      pending.resolve({ success: true });
      await testing;
    });
    expect(result.current).toMatchObject({ testingSmtp: false, smtpTestResult: 'success' });
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it.each([
    [false, 'SMTP 연결 테스트 실패'],
    [{ success: false, error: 'Authentication rejected' }, 'Authentication rejected'],
    [{ success: false }, 'SMTP 연결 테스트 실패'],
  ])('displays a failed SMTP response without throwing: %j', async (response, errorMessage) => {
    api.testSmtpConnection.mockResolvedValueOnce(response);
    const { result, form } = mountActions();
    await waitFor(() => expect(result.current.loadingCache).toBe(false));
    form.setFieldValue('smtpHost', 'smtp.example.test');
    await act(() => result.current.handleTestSmtp());
    expect(result.current).toMatchObject({ smtpTestResult: 'failed', testingSmtp: false });
    expect(mocks.message.error).toHaveBeenCalledWith(errorMessage);
  });

  it.each([new Error('Connection timed out'), 'non-error rejection'])(
    'recovers from an SMTP exception and can retry: %s',
    async (failure) => {
      api.testSmtpConnection.mockRejectedValueOnce(failure).mockResolvedValueOnce(true);
      const { result, form } = mountActions();
      await waitFor(() => expect(result.current.loadingCache).toBe(false));
      form.setFieldValue('smtpHost', 'smtp.example.test');
      await act(() => result.current.handleTestSmtp());
      expect(result.current).toMatchObject({ smtpTestResult: 'failed', testingSmtp: false });
      expect(mocks.message.error).toHaveBeenCalledWith(
        failure instanceof Error ? failure.message : 'SMTP 연결 테스트 실패'
      );
      await act(() => result.current.handleTestSmtp());
      expect(result.current).toMatchObject({ smtpTestResult: 'success', testingSmtp: false });
    }
  );

  it('does not simulate success when Electron is present but SMTP IPC is missing', async () => {
    installApi({ cache: api.cache });
    const { result, form } = mountActions();
    await waitFor(() => expect(result.current.loadingCache).toBe(false));
    form.setFieldValue('smtpHost', 'smtp.example.test');
    await act(() => result.current.handleTestSmtp());
    expect(result.current).toMatchObject({
      smtpTestMode: 'missing-ipc',
      smtpTestResult: 'failed',
      testingSmtp: false,
    });
    expect(mocks.message.warning).toHaveBeenCalledWith(
      '현재 Electron 빌드에는 SMTP 연결 테스트 IPC가 연결되어 있지 않습니다.'
    );
    expect(mocks.message.success).not.toHaveBeenCalled();
  });

  it('labels browser SMTP simulation and completes it only after its delay', async () => {
    installApi(undefined);
    const { result, form } = mountActions();
    await waitFor(() => expect(result.current.loadingCache).toBe(false));
    vi.useFakeTimers();
    form.setFieldValue('smtpHost', 'smtp.example.test');
    let testing!: Promise<void>;
    act(() => {
      testing = result.current.handleTestSmtp();
    });
    expect(result.current).toMatchObject({
      smtpTestMode: 'browser-simulated',
      testingSmtp: true,
      smtpTestResult: null,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
      await testing;
    });
    expect(result.current).toMatchObject({ smtpTestResult: 'success', testingSmtp: false });
    expect(mocks.message.success).toHaveBeenCalledWith('SMTP 연결 테스트 성공 (시뮬레이션)');
    expect(api.testSmtpConnection).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'replaces update progress with the reported result: success=%s',
    async (success) => {
      api.updater.check.mockResolvedValueOnce({ success, error: 'network unavailable' });
      const { result } = mountActions();
      await waitFor(() => expect(result.current.loadingCache).toBe(false));
      await act(() => result.current.handleCheckForUpdates());
      expect(mocks.message.loading).toHaveBeenCalledWith({
        content: '업데이트 확인 중...',
        key: 'update-check',
      });
      expect(success ? mocks.message.success : mocks.message.error).toHaveBeenCalledWith({
        content: success ? '업데이트 확인 완료' : '업데이트 확인 실패: network unavailable',
        key: 'update-check',
      });
    }
  );
});
