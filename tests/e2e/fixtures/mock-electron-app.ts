import type { Page } from '@playwright/test';
import type { CartItem } from '../../../src/renderer/stores/cart-store';
import type { DownloadHistory } from '../../../src/types';

interface MockElectronAppOptions {
  config?: Record<string, unknown>;
  cartItems?: CartItem[];
  histories?: DownloadHistory[];
  downloadDelayMs?: number;
}

interface MockElectronAppState {
  config: Record<string, unknown>;
  cart: {
    items: CartItem[];
  };
  history: {
    histories: DownloadHistory[];
  };
  runtime: {
    downloadCalls: Array<{ packages: unknown[]; options: Record<string, unknown> }>;
    smtpTestCalls: Array<Record<string, unknown>>;
    openedPaths: string[];
  };
}

export async function setupMockElectronApp(
  page: Page,
  options: MockElectronAppOptions = {}
): Promise<void> {
  await page.addInitScript((seed: MockElectronAppOptions) => {
    const SETTINGS_KEY = 'depssmuggler-settings';
    const CART_KEY = 'depssmuggler-cart';
    const HISTORY_KEY = 'depssmuggler-history';
    const RUNTIME_KEY = 'depssmuggler-e2e-runtime';

    const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
    const readJson = <T,>(storage: Storage, key: string): T | null => {
      const raw = storage.getItem(key);
      if (!raw) {
        return null;
      }

      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    };

    const defaultSettings = {
      concurrentDownloads: 3,
      enableCache: true,
      cachePath: '',
      includeDependencies: true,
      defaultDownloadPath: '/tmp/depssmuggler-e2e',
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
      languageVersions: { python: '3.11' },
      defaultTargetOS: 'linux',
      defaultArchitecture: 'x86_64',
      pipTargetPlatform: {
        os: 'linux',
        arch: 'x86_64',
        linuxDistro: 'rocky9',
        glibcVersion: '2.34',
      },
      condaChannel: 'conda-forge',
      customCondaChannels: [],
      customPipIndexUrls: [],
      cudaVersion: null,
      yumDistribution: { id: 'rocky-9', architecture: 'x86_64' },
      aptDistribution: { id: 'ubuntu-22.04', architecture: 'amd64' },
      apkDistribution: { id: 'alpine-3.18', architecture: 'x86_64' },
      dockerRegistry: 'docker.io',
      dockerCustomRegistry: '',
      dockerArchitecture: 'amd64',
      dockerLayerCompression: 'gzip',
      dockerRetryStrategy: 'layer',
      dockerIncludeLoadScript: true,
      autoUpdate: false,
      autoDownloadUpdate: false,
      downloadRenderInterval: 10,
      _initialized: true,
    };

    const persistedSettings = readJson<{ state?: Record<string, unknown> }>(localStorage, SETTINGS_KEY);
    const persistedCart = readJson<{ state?: { items?: CartItem[] } }>(localStorage, CART_KEY);
    const persistedHistory = readJson<{ state?: { histories?: DownloadHistory[] } }>(localStorage, HISTORY_KEY);
    const persistedRuntime = readJson<MockElectronAppState['runtime']>(sessionStorage, RUNTIME_KEY);

    const state = {
      config: {
        ...defaultSettings,
        ...(persistedSettings?.state || seed.config || {}),
        _initialized: true,
      },
      cartItems: persistedCart?.state?.items || seed.cartItems || [],
      histories: persistedHistory?.state?.histories || seed.histories || [],
      runtime: persistedRuntime || {
        downloadCalls: [],
        smtpTestCalls: [],
        openedPaths: [],
      },
    };

    const persistRuntime = () => {
      sessionStorage.setItem(RUNTIME_KEY, JSON.stringify(state.runtime));
    };

    const persistStores = () => {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({
          state: state.config,
          version: 0,
        })
      );
      localStorage.setItem(
        CART_KEY,
        JSON.stringify({
          state: { items: state.cartItems },
          version: 0,
        })
      );
      localStorage.setItem(
        HISTORY_KEY,
        JSON.stringify({
          state: { histories: state.histories },
          version: 0,
        })
      );
      persistRuntime();
    };

    const readPersistedState = () => {
      const currentSettings = readJson<{ state?: Record<string, unknown> }>(localStorage, SETTINGS_KEY)?.state || state.config;
      const currentCart =
        readJson<{ state?: { items?: CartItem[] } }>(localStorage, CART_KEY)?.state?.items || state.cartItems;
      const currentHistories =
        readJson<{ state?: { histories?: DownloadHistory[] } }>(localStorage, HISTORY_KEY)?.state?.histories ||
        state.histories;
      const currentRuntime = readJson<MockElectronAppState['runtime']>(sessionStorage, RUNTIME_KEY) || state.runtime;

      return {
        config: currentSettings,
        cart: { items: currentCart },
        history: { histories: currentHistories },
        runtime: currentRuntime,
      };
    };

    persistStores();

    const updaterListeners = new Set<(value: unknown) => void>();
    const downloadProgressListeners = new Set<(value: unknown) => void>();
    const downloadStatusListeners = new Set<(value: unknown) => void>();
    const downloadDepsResolvedListeners = new Set<(value: unknown) => void>();
    const downloadAllCompleteListeners = new Set<(value: unknown) => void>();
    const osProgressListeners = new Set<(value: unknown) => void>();

    const subscribe = <T,>(listeners: Set<(value: T) => void>, callback: (value: T) => void) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    };

    const emit = <T,>(listeners: Set<(value: T) => void>, payload: T) => {
      listeners.forEach((listener) => listener(clone(payload)));
    };

    const readHistories = (): DownloadHistory[] => {
      return readPersistedState().history.histories;
    };

    const defaultDistributions = [
      {
        id: 'rocky-9',
        name: 'Rocky Linux 9',
        version: '9',
        packageManager: 'yum',
        architectures: ['x86_64'],
        defaultRepos: [],
        extendedRepos: [],
      },
      {
        id: 'ubuntu-22.04',
        name: 'Ubuntu 22.04 LTS',
        version: '22.04',
        packageManager: 'apt',
        architectures: ['amd64'],
        defaultRepos: [],
        extendedRepos: [],
      },
      {
        id: 'alpine-3.18',
        name: 'Alpine 3.18',
        version: '3.18',
        packageManager: 'apk',
        architectures: ['x86_64'],
        defaultRepos: [],
        extendedRepos: [],
      },
    ];

    const updaterStatus = {
      checking: false,
      available: false,
      downloaded: false,
      downloading: false,
      error: null,
      progress: null,
      updateInfo: null,
    };

    const electronAPI = {
      log: () => undefined,
      selectFolder: async () => String(state.config.defaultDownloadPath || '/tmp/depssmuggler-e2e'),
      selectDirectory: async () => String(state.config.defaultDownloadPath || '/tmp/depssmuggler-e2e'),
      openFolder: async (targetPath: string) => {
        state.runtime.openedPaths.push(targetPath);
        persistRuntime();
      },
      testSmtpConnection: async (config: Record<string, unknown>) => {
        state.runtime.smtpTestCalls.push(clone(config));
        persistRuntime();
        return { success: true };
      },
      config: {
        get: async () => clone(state.config),
        set: async (config: Record<string, unknown>) => {
          state.config = {
            ...state.config,
            ...clone(config),
            _initialized: true,
          };
          persistStores();
          return { success: true };
        },
        reset: async () => {
          state.config = clone(defaultSettings);
          persistStores();
          return { success: true };
        },
        getPath: async () => '/tmp/depssmuggler-config.json',
      },
      cache: {
        getSize: async () => 0,
        getStats: async () => ({
          scope: 'all',
          excludes: [],
          totalSize: 0,
          entryCount: 0,
          details: { pip: {}, npm: {}, maven: {}, conda: {} },
        }),
        clear: async () => ({ success: true }),
      },
      history: {
        load: async () => clone(readHistories()),
        save: async (histories: DownloadHistory[]) => {
          state.histories = clone(histories);
          persistStores();
          return { success: true };
        },
        add: async (history: DownloadHistory) => {
          state.histories = [clone(history), ...readHistories()];
          persistStores();
          return { success: true };
        },
        delete: async (id: string) => {
          state.histories = readHistories().filter((history) => history.id !== id);
          persistStores();
          return { success: true };
        },
        clear: async () => {
          state.histories = [];
          persistStores();
          return { success: true };
        },
      },
      download: {
        onProgress: (callback: (progress: unknown) => void) => subscribe(downloadProgressListeners, callback),
        onStatus: (callback: (status: unknown) => void) => subscribe(downloadStatusListeners, callback),
        onDepsResolved: (callback: (data: unknown) => void) => subscribe(downloadDepsResolvedListeners, callback),
        onAllComplete: (callback: (data: unknown) => void) => subscribe(downloadAllCompleteListeners, callback),
        pause: async () => undefined,
        resume: async () => undefined,
        cancel: async () => undefined,
        checkPath: async () => ({ exists: false, files: [], fileCount: 0, totalSize: 0 }),
        clearPath: async () => ({ success: true, deleted: true }),
        start: async (payload: { packages: Array<Record<string, unknown>>; options: Record<string, unknown> }) => {
          state.runtime.downloadCalls.push(clone(payload));
          persistRuntime();

          const packages = payload.packages || [];
          const options = payload.options || {};
          const requestedFormat = options.outputFormat === 'tar.gz' ? 'tar.gz' : 'zip';
          const outputDir = String(options.outputDir || state.config.defaultDownloadPath || '/tmp/depssmuggler-e2e');
          const baseName =
            packages.length === 1
              ? `${packages[0].name || 'package'}-${packages[0].version || 'latest'}`
              : `depssmuggler-${packages.length}-packages`;
          const artifactPath = `${outputDir}/${baseName}.${requestedFormat}`;
          const deliveryMethod = options.deliveryMethod === 'email' ? 'email' : 'local';
          const deliveryResult =
            deliveryMethod === 'email'
              ? {
                  emailSent: true,
                  emailsSent: 1,
                  attachmentsSent: 1,
                  splitApplied: false,
                }
              : undefined;
          const stepDelay = seed.downloadDelayMs ?? 10;

          window.setTimeout(() => {
            emit(downloadStatusListeners, {
              phase: 'downloading',
              message: '다운로드 시작',
            });

            packages.forEach((pkg, index) => {
              emit(downloadProgressListeners, {
                packageId: pkg.id,
                status: 'completed',
                progress: 100,
                downloadedBytes: 1024,
                totalBytes: 1024,
                speed: 0,
              });

              if (index === packages.length - 1) {
                emit(downloadStatusListeners, {
                  phase: 'packaging',
                  message: '패키징',
                });
              }
            });
          }, stepDelay);

          window.setTimeout(() => {
            emit(downloadAllCompleteListeners, {
              success: true,
              outputPath: artifactPath,
              artifactPaths: [artifactPath],
              deliveryMethod,
              deliveryResult,
              results: packages.map((pkg) => ({
                id: pkg.id,
                success: true,
              })),
            });
          }, stepDelay * 3);
        },
      },
      dependency: {
        resolve: async (payload: { packages?: Array<Record<string, unknown>> }) => {
          const packages = payload.packages || [];
          const normalizedPackages = packages.map((pkg) => ({
            id: String(pkg.id),
            name: String(pkg.name),
            version: String(pkg.version),
            type: String(pkg.type || 'pip'),
          }));

          const dependencyTrees = normalizedPackages.map((pkg) => ({
            root: {
              package: {
                name: pkg.name,
                version: pkg.version,
                type: pkg.type,
              },
              dependencies: [],
            },
          }));

          emit(downloadDepsResolvedListeners, {
            originalPackages: normalizedPackages,
            allPackages: normalizedPackages,
            dependencyTrees,
            failedPackages: [],
          });

          return {
            originalPackages: normalizedPackages,
            allPackages: normalizedPackages,
            dependencyTrees,
            failedPackages: [],
          };
        },
        onProgress: () => () => undefined,
      },
      search: {
        packages: async () => ({ results: [] }),
        suggest: async () => [],
        versions: async () => ({ versions: [] }),
      },
      maven: {
        isNativeArtifact: async () => false,
        getAvailableClassifiers: async () => [],
      },
      versions: {
        python: async () => ['3.13', '3.12', '3.11'],
        cuda: async () => ['12.4', '12.1', '11.8'],
        preload: async () => ({
          success: true,
          status: { python: 'loaded', cuda: 'loaded' },
          errors: [],
          duration: 1,
        }),
        refreshExpired: async () => undefined,
        cacheStatus: async () => ({}),
      },
      os: {
        getAllDistributions: async () => clone(defaultDistributions),
        getDistribution: async (id: string) =>
          clone(defaultDistributions.find((distribution) => distribution.id === id) || defaultDistributions[0]),
        search: async () => ({ packages: [], totalCount: 0 }),
        download: {
          onProgress: (callback: (progress: unknown) => void) => subscribe(osProgressListeners, callback),
          cancel: async () => ({ success: true }),
          start: async () => undefined,
        },
      },
      updater: {
        check: async () => ({ success: true }),
        download: async () => ({ success: true }),
        install: async () => ({ success: true }),
        getStatus: async () => clone(updaterStatus),
        setAutoDownload: async () => ({ success: true }),
        onStatusChange: (callback: (status: unknown) => void) => subscribe(updaterListeners, callback),
      },
    };

    Object.defineProperty(window, 'electronAPI', {
      value: electronAPI,
      configurable: true,
    });

    Object.defineProperty(window, '__DEPS_SMUGGLER_E2E__', {
      value: {
        getState: () => clone(readPersistedState()),
      },
      configurable: true,
    });
  }, options);
}

export async function readMockElectronAppState(page: Page): Promise<MockElectronAppState> {
  return page.evaluate(() => {
    return (window as typeof window & {
      __DEPS_SMUGGLER_E2E__?: { getState: () => MockElectronAppState };
    }).__DEPS_SMUGGLER_E2E__!.getState();
  });
}
