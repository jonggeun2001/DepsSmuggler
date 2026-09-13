import { readFile } from 'node:fs/promises';
import * as https from 'node:https';
import path from 'node:path';
import axios from 'axios';
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

describe('TLS defaults at Electron main startup', () => {
  const originalTlsEnv = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  const originalAgent = axios.defaults.httpsAgent;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.loadFile.mockImplementation(() => new Promise(() => {}));
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    axios.defaults.httpsAgent = undefined;
  });

  afterEach(() => {
    if (axios.defaults.httpsAgent && axios.defaults.httpsAgent !== originalAgent) {
      axios.defaults.httpsAgent.destroy();
    }
    if (originalTlsEnv === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalTlsEnv;
    axios.defaults.httpsAgent = originalAgent;
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function startTlsServer() {
    const [key, cert] = await Promise.all([
      readFile(path.resolve('electron/test-fixtures/tls-key.pem')),
      readFile(path.resolve('electron/test-fixtures/tls-cert.pem')),
    ]);
    const server = https.createServer({ key, cert }, (_request, response) => {
      response.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('TLS fixture did not bind');
    return { server, url: `https://localhost:${address.port}/health`, cert };
  }

  async function closeServer(server: https.Server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  it.each([undefined, 'true', 'FALSE', 'invalid'])(
    'rejects self-signed HTTPS with strict setting %s',
    async (strictValue) => {
      if (strictValue === undefined) vi.stubEnv('DEPSSMUGGLER_STRICT_SSL', undefined);
      else vi.stubEnv('DEPSSMUGGLER_STRICT_SSL', strictValue);
      const { server, url } = await startTlsServer();
      try {
        await import('./main');
        await expect(axios.get(url, { proxy: false, timeout: 5000 }))
          .rejects.toMatchObject({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
      } finally {
        await closeServer(server);
      }
    },
  );

  it('rejects self-signed HTTPS through Node https.get in default mode', async () => {
    vi.stubEnv('DEPSSMUGGLER_STRICT_SSL', undefined);
    const { server, url } = await startTlsServer();
    try {
      await import('./main');
      await expect(new Promise((resolve, reject) => {
        const request = https.get(url, { timeout: 5000 }, (response) => {
          response.resume();
          resolve(response.statusCode);
        });
        request.once('error', reject);
        request.once('timeout', () => request.destroy(new Error('request timeout')));
      })).rejects.toMatchObject({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
    } finally {
      await closeServer(server);
    }
  });

  it('accepts a self-signed HTTPS request only with explicit insecure opt-in', async () => {
    vi.stubEnv('DEPSSMUGGLER_STRICT_SSL', 'false');
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    const { server, url } = await startTlsServer();
    try {
      await import('./main');
      await expect(axios.get(url, { proxy: false, timeout: 5000 })).resolves.toMatchObject({ data: 'ok' });
    } finally {
      await closeServer(server);
    }
  });

  it('allows a trusted fixture certificate with a request-scoped CA agent', async () => {
    vi.stubEnv('DEPSSMUGGLER_STRICT_SSL', undefined);
    const { server, url, cert } = await startTlsServer();
    const agent = new https.Agent({ ca: cert });
    try {
      await import('./main');
      await expect(axios.get(url, { httpsAgent: agent, proxy: false, timeout: 5000 }))
        .resolves.toMatchObject({ data: 'ok' });
    } finally {
      agent.destroy();
      await closeServer(server);
    }
  });

  it('rejects a hostname mismatch even with the trusted fixture CA', async () => {
    vi.stubEnv('DEPSSMUGGLER_STRICT_SSL', undefined);
    const { server, url, cert } = await startTlsServer();
    const agent = new https.Agent({ ca: cert, servername: 'wrong.example' });
    try {
      await import('./main');
      await expect(axios.get(url, { httpsAgent: agent, proxy: false, timeout: 5000 }))
        .rejects.toMatchObject({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
    } finally {
      agent.destroy();
      await closeServer(server);
    }
  });
});
