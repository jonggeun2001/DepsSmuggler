import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ loadFile: vi.fn(), appOn: vi.fn(), error: vi.fn() }));
vi.mock('electron', () => ({
  app: { isPackaged: true, whenReady: async () => undefined, on: mocks.appOn, quit: vi.fn() },
  BrowserWindow: class {
    static getAllWindows() { return []; }
    once = vi.fn(); on = vi.fn(); loadFile = mocks.loadFile;
  },
  ipcMain: { handle: vi.fn() }, dialog: {}, shell: {},
}));
vi.mock('./utils/logger', () => ({ createScopedLogger: () => ({
  info: vi.fn(), warn: vi.fn(), error: mocks.error, debug: vi.fn(),
}) }));
vi.mock('../src/utils/logger', () => ({ logger: { initialize: async () => undefined } }));
vi.mock('./config-handlers', () => ({ registerConfigHandlers: vi.fn() }));
vi.mock('./cache-handlers', () => ({ registerCacheHandlers: vi.fn() }));
vi.mock('./history-handlers', () => ({ registerHistoryHandlers: vi.fn() }));
vi.mock('./search-handlers', () => ({ registerSearchHandlers: vi.fn() }));
vi.mock('./download-handlers', () => ({ registerDownloadHandlers: vi.fn() }));
vi.mock('./version-handlers', () => ({ registerVersionHandlers: vi.fn() }));
vi.mock('../src/core/mailer/email-sender', () => ({ EmailSender: class {} }));
vi.mock('../src/core/shared/version-preloader', () => ({ preloadAllVersions: async () => ({ success: true }) }));
vi.mock('./updater', () => ({ initAutoUpdater: vi.fn(), checkForUpdatesOnStartup: vi.fn(), registerDevModeHandlers: vi.fn() }));

describe('Electron lifecycle promise boundaries', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('DEPSSMUGGLER_STRICT_SSL', 'true');
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('최초 창 로드 실패를 처리되지 않은 Promise 대신 로그로 남긴다', async () => {
    const failure = new Error('load failed');
    mocks.loadFile.mockRejectedValueOnce(failure);
    await import('./main');
    await vi.waitFor(() => expect(mocks.error).toHaveBeenCalledWith('앱 초기화 실패:', failure));
  });

  it('앱 활성화 시 창 재생성 실패도 기록한다', async () => {
    mocks.loadFile.mockResolvedValueOnce(undefined);
    await import('./main');
    await vi.waitFor(() => expect(mocks.appOn).toHaveBeenCalledWith('activate', expect.any(Function)));
    const failure = new Error('reopen failed');
    mocks.loadFile.mockRejectedValueOnce(failure);
    mocks.appOn.mock.calls.find(([event]) => event === 'activate')?.[1]();
    await vi.waitFor(() => expect(mocks.error).toHaveBeenCalledWith('창 재생성 실패:', failure));
  });
});
