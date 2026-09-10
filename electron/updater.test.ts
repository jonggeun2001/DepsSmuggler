import { beforeEach, describe, expect, it, vi } from 'vitest';

const openExternal = vi.fn();
const handle = vi.fn();

vi.mock('electron', () => ({
  app: { isPackaged: true },
  BrowserWindow: class {},
  ipcMain: { handle },
  shell: { openExternal },
}));

vi.mock('electron-updater', () => ({
  autoUpdater: {
    on: vi.fn(),
    logger: null,
    autoDownload: false,
    autoInstallOnAppQuit: false,
  },
}));

vi.mock('./utils/logger', () => ({
  createScopedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const { initAutoUpdater, openReleaseNotesLink, registerDevModeHandlers } =
  await import('./updater');

describe('updater release-notes links', () => {
  beforeEach(() => {
    openExternal.mockReset();
    openExternal.mockResolvedValue(undefined);
    handle.mockClear();
  });

  it('registers the link channel in production and development handlers', () => {
    initAutoUpdater({
      isDestroyed: () => false,
      webContents: { send: vi.fn() },
    } as never);
    expect(handle).toHaveBeenCalledWith('updater:open-release-notes-link', expect.any(Function));

    handle.mockClear();
    registerDevModeHandlers();
    expect(handle).toHaveBeenCalledWith('updater:open-release-notes-link', expect.any(Function));
  });

  it.each(['https://example.com/releases/0.2.27', 'http://example.com/releases/0.2.27'])(
    'opens valid %s links through Electron shell',
    async (url) => {
      await expect(openReleaseNotesLink(url)).resolves.toEqual({ success: true });
      expect(openExternal).toHaveBeenCalledWith(url);
    }
  );

  it.each([
    'javascript:alert(1)',
    'file:///tmp/release.html',
    'data:text/html,bad',
    'not-a-url',
    null,
    123,
    {},
    '//example.com',
    'https:example.com',
  ])('rejects non-http(s) link %s without invoking shell', async (url) => {
    await expect(openReleaseNotesLink(url)).resolves.toEqual({
      success: false,
      error: '릴리즈 노트 링크는 http 또는 https 주소만 열 수 있습니다.',
    });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('returns a failure result when the system browser cannot open the link', async () => {
    openExternal.mockRejectedValueOnce(new Error('shell unavailable'));

    await expect(openReleaseNotesLink('https://example.com/releases/0.2.27')).resolves.toEqual({
      success: false,
      error: '릴리즈 노트 링크를 열 수 없습니다.',
    });
  });
});
