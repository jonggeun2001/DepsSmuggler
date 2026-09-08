import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type StorageMock = {
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
  removeItem: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
};

const createStorageMock = (): StorageMock => {
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

const loadSettingsStore = async (fileConfig?: Record<string, unknown> | Error) => {
  vi.resetModules();
  const localStorage = createStorageMock();
  const electronAPI = {
    config: {
      get: fileConfig instanceof Error ? vi.fn().mockRejectedValue(fileConfig) : vi.fn().mockResolvedValue(fileConfig ?? null),
      set: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn().mockResolvedValue(undefined),
    },
  };

  vi.stubGlobal('localStorage', localStorage);
  vi.stubGlobal('window', { electronAPI, localStorage });

  const module = await import('./settings-store');

  return {
    electronAPI,
    localStorage,
    useSettingsStore: module.useSettingsStore,
  };
};

describe('settings-store', () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['정상 설정', { concurrentDownloads: 6 }, 6],
    ['잘못된 설정', { concurrentDownloads: -1 }, 3],
    ['읽지 못한 설정', undefined, 3],
    ['IPC 읽기 실패', new Error('EACCES'), 3],
  ] as const)('%s 초기 로드는 원본 저장소를 수정하지 않고 명시적 변경부터 저장한다', async (_name, config, expected) => {
    const { useSettingsStore, electronAPI, localStorage } = await loadSettingsStore(config);
    await useSettingsStore.getState().initializeFromFile();
    expect(useSettingsStore.getState()).toMatchObject({ _initialized: true, concurrentDownloads: expected });
    expect(electronAPI.config.set).not.toHaveBeenCalled();
    expect(localStorage.setItem).not.toHaveBeenCalled();

    useSettingsStore.getState().updateSettings({ concurrentDownloads: 8 });
    expect(electronAPI.config.set).toHaveBeenCalledTimes(1);
    expect(electronAPI.config.set).toHaveBeenCalledWith(expect.objectContaining({ concurrentDownloads: 8 }));
    expect(localStorage.setItem).toHaveBeenCalledTimes(1);
  });

  it('손상된 설정은 기본값으로 복구하고 액션 함수를 덮어쓰지 않는다', async () => {
    const { useSettingsStore } = await loadSettingsStore({
      concurrentDownloads: -1, smtpPort: 99999, downloadRenderInterval: -2,
      enableCache: 'false', customCondaChannels: null, customPipIndexUrls: [null],
      languageVersions: null, pipTargetPlatform: null, yumDistribution: null,
      updateSettings: 'broken', resetSettings: null,
      smtpHost: 'smtp.example.com', cudaVersion: '12.4',
    });
    await useSettingsStore.getState().initializeFromFile();
    expect(useSettingsStore.getState()).toMatchObject({
      concurrentDownloads: 3, smtpPort: 587, downloadRenderInterval: 300, enableCache: true,
      languageVersions: { python: '3.11' }, yumDistribution: { id: 'rocky-9', architecture: 'x86_64' },
      smtpHost: 'smtp.example.com', cudaVersion: '12.4',
    });
    expect(() => useSettingsStore.getState().addCustomCondaChannel('test')).not.toThrow();
    expect(() => useSettingsStore.getState().addCustomPipIndexUrl('test', 'https://example.com')).not.toThrow();
    expect(typeof useSettingsStore.getState().updateSettings).toBe('function');
    expect(typeof useSettingsStore.getState().resetSettings).toBe('function');
  });

  it('브라우저 초기화도 기존 백업을 덮어쓰지 않고 이후 변경은 저장한다', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const localStorage = createStorageMock();
    vi.stubGlobal('localStorage', localStorage);
    vi.stubGlobal('window', { localStorage });
    try {
      const { useSettingsStore } = await import('./settings-store');
      await vi.advanceTimersByTimeAsync(2000);
      expect(useSettingsStore.getState()._initialized).toBe(true);
      expect(localStorage.setItem).not.toHaveBeenCalled();
      useSettingsStore.getState().updateSettings({ concurrentDownloads: 8 });
      expect(localStorage.setItem).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('브라우저 저장소 실패에도 메모리 변경과 Electron 파일 저장을 계속한다', async () => {
    const { useSettingsStore, localStorage, electronAPI } = await loadSettingsStore();
    await useSettingsStore.getState().initializeFromFile();
    localStorage.setItem.mockImplementation(() => { throw new Error('QuotaExceededError'); });
    electronAPI.config.set.mockClear();
    useSettingsStore.getState().updateSettings({ concurrentDownloads: 7 });
    await vi.waitFor(() => expect(electronAPI.config.set).toHaveBeenCalledWith(expect.objectContaining({ concurrentDownloads: 7 })));
    expect(useSettingsStore.getState().concurrentDownloads).toBe(7);
  });

  it('Electron 저장 실패 응답을 성공으로 무시하지 않고 로그를 남긴다', async () => {
    const { useSettingsStore, electronAPI } = await loadSettingsStore();
    await useSettingsStore.getState().initializeFromFile();
    electronAPI.config.set.mockResolvedValue({ success: false, error: 'ENOSPC' } as never);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    useSettingsStore.getState().updateSettings({ concurrentDownloads: 7 });
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    expect(useSettingsStore.getState().concurrentDownloads).toBe(7);
  });

  it('initializeFromFile은 레거시 output 설정을 현재 형식으로 마이그레이션한다', async () => {
    const { useSettingsStore } = await loadSettingsStore({
      defaultOutputFormat: 'withScript',
      defaultArchiveType: 'tar.gz',
      includeInstallScripts: undefined,
      concurrentDownloads: 5,
    });

    await useSettingsStore.getState().initializeFromFile();

    expect(useSettingsStore.getState()).toMatchObject({
      _initialized: true,
      concurrentDownloads: 5,
      defaultOutputFormat: 'tar.gz',
      includeInstallScripts: true,
    });
  });

  it('정상 Windows pip 타겟과 알 수 없는 기존 데이터 필드는 보존한다', async () => {
    const { useSettingsStore } = await loadSettingsStore({
      pipTargetPlatform: { os: 'windows', arch: 'amd64', pythonVersion: '3.12' },
      fileSplitSizeMB: 50,
    });
    await useSettingsStore.getState().initializeFromFile();
    expect(useSettingsStore.getState().pipTargetPlatform).toEqual({ os: 'windows', arch: 'amd64', pythonVersion: '3.12' });
    expect(useSettingsStore.getState()).toHaveProperty('fileSplitSizeMB', 50);
  });

  it('custom 채널과 pip index URL mutation은 중복 없이 관리된다', async () => {
    const { useSettingsStore } = await loadSettingsStore();

    useSettingsStore.getState().addCustomCondaChannel('pytorch');
    useSettingsStore.getState().addCustomCondaChannel('pytorch');
    useSettingsStore.getState().addCustomPipIndexUrl('Test', 'https://example.com/simple');
    useSettingsStore.getState().addCustomPipIndexUrl('Duplicate', 'https://example.com/simple');
    useSettingsStore.getState().removeCustomCondaChannel('pytorch');
    useSettingsStore.getState().removeCustomPipIndexUrl('https://example.com/simple');

    expect(useSettingsStore.getState().customCondaChannels).toEqual([]);
    expect(
      useSettingsStore.getState().customPipIndexUrls.some(
        (item) => item.url === 'https://example.com/simple'
      )
    ).toBe(false);
  });

  it('resetSettings는 기본값으로 되돌리고 Electron 설정도 초기화한다', async () => {
    const { electronAPI, useSettingsStore } = await loadSettingsStore();

    useSettingsStore.getState().updateSettings({
      concurrentDownloads: 9,
      smtpHost: 'smtp.example.com',
      dockerCustomRegistry: 'registry.example.com',
    });

    useSettingsStore.getState().resetSettings();

    expect(useSettingsStore.getState()).toMatchObject({
      _initialized: true,
      concurrentDownloads: 3,
      smtpHost: '',
      dockerCustomRegistry: '',
    });
    expect(electronAPI.config.reset).toHaveBeenCalledTimes(1);
  });
});
