import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  python: vi.fn(),
  cuda: vi.fn(),
  preload: vi.fn(),
  refresh: vi.fn(),
  isValid: vi.fn(),
  age: vi.fn(),
}));
vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }));
vi.mock('./utils/logger', () => ({
  createScopedLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../src/core/shared/version-fetcher', () => ({
  fetchPythonVersions: mocks.python,
  fetchCudaVersions: mocks.cuda,
}));
vi.mock('../src/core/shared/version-preloader', () => ({
  preloadAllVersions: mocks.preload,
  refreshExpiredCaches: mocks.refresh,
  isCacheValid: mocks.isValid,
  getCacheAge: mocks.age,
}));

function invoke(channel: string) {
  const handler = mocks.handle.mock.calls.find(([name]) => name === channel)?.[1];
  expect(handler).toBeTypeOf('function');
  return handler({});
}

async function register() {
  const { registerVersionHandlers } = await import('./version-handlers');
  registerVersionHandlers();
  // Settle the two background preloads before testing explicit IPC requests.
  await Promise.allSettled([mocks.python.mock.results[0].value, mocks.cuda.mock.results[0].value]);
}

describe('version IPC caches', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    mocks.python.mockResolvedValue([]);
    mocks.cuda.mockResolvedValue([]);
  });

  it('preloads Python and CUDA and serves repeated requests from memory', async () => {
    mocks.python.mockResolvedValue(['3.14', '3.13']);
    mocks.cuda.mockResolvedValue(['13.0', '12.6']);
    await register();
    for (let index = 0; index < 2; index++) {
      await expect(invoke('versions:python')).resolves.toEqual(['3.14', '3.13']);
      await expect(invoke('versions:cuda')).resolves.toEqual(['13.0', '12.6']);
    }
    expect(mocks.python).toHaveBeenCalledOnce();
    expect(mocks.cuda).toHaveBeenCalledOnce();
  });

  it.each(['python', 'cuda'] as const)(
    'retries empty %s preload results and caches the first nonempty response',
    async (kind) => {
      await register();
      await expect(invoke(`versions:${kind}`)).resolves.toEqual([]);
      mocks[kind].mockResolvedValue(['next-version']);
      await expect(invoke(`versions:${kind}`)).resolves.toEqual(['next-version']);
      await expect(invoke(`versions:${kind}`)).resolves.toEqual(['next-version']);
      expect(mocks[kind]).toHaveBeenCalledTimes(3);
    }
  );

  it.each([
    ['python', ['3.13', '3.12', '3.11', '3.10', '3.9']],
    ['cuda', ['12.6', '12.5', '12.4', '12.1', '12.0', '11.8']],
  ] as const)(
    'returns the %s fallback after preload/request failures and retries later',
    async (kind, fallback) => {
      mocks[kind].mockRejectedValue('offline');
      await register();
      await expect(invoke(`versions:${kind}`)).resolves.toEqual(fallback);
      mocks[kind].mockResolvedValue(['recovered']);
      await expect(invoke(`versions:${kind}`)).resolves.toEqual(['recovered']);
      expect(mocks[kind]).toHaveBeenCalledTimes(3);
    }
  );

  it('reports validity and age independently for both version caches', async () => {
    mocks.isValid.mockImplementation((kind) => kind === 'python');
    mocks.age.mockImplementation((kind) => (kind === 'python' ? 0 : undefined));
    await register();
    expect(invoke('versions:cache-status')).toEqual({
      python: { valid: true, age: 0 },
      cuda: { valid: false, age: undefined },
    });
    expect(mocks.isValid.mock.calls).toEqual([['python'], ['cuda']]);
    expect(mocks.age.mock.calls).toEqual([['python'], ['cuda']]);
  });

  it('returns manual preload results and awaits expired-cache refresh', async () => {
    const preloadResult = { python: true, cuda: false, errors: ['CUDA unavailable'] };
    mocks.preload.mockResolvedValue(preloadResult);
    mocks.refresh.mockResolvedValue(undefined);
    await register();
    await expect(invoke('versions:preload')).resolves.toBe(preloadResult);
    await expect(invoke('versions:refresh-expired')).resolves.toBeUndefined();
    expect(mocks.preload).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it.each([
    ['versions:preload', 'preload'],
    ['versions:refresh-expired', 'refresh'],
  ] as const)('%s propagates service failures to its caller', async (channel, mockName) => {
    const error = new Error('cache permission denied');
    mocks[mockName].mockRejectedValue(error);
    await register();
    await expect(invoke(channel)).rejects.toBe(error);
  });
});
