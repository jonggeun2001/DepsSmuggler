import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const loadSettingsStore = async (fileConfig?: Record<string, unknown>) => {
  vi.resetModules();
  const localStorage = createStorageMock();
  const electronAPI = {
    config: {
      get: vi.fn().mockResolvedValue(fileConfig ?? null),
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
  beforeEach(() => {
    vi.unstubAllGlobals();
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
