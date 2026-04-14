import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class BrowserStorage {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  clear(): void {
    this.store.clear();
  }
}

describe('version-preloader', () => {
  let storage: BrowserStorage;

  beforeEach(() => {
    storage = new BrowserStorage();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.doUnmock('./version-fetcher');
  });

  it('브라우저가 아니면 캐시가 항상 유효하지 않다', async () => {
    const module = await import('./version-preloader');

    expect(module.isCacheValid('python')).toBe(false);
    expect(module.getCacheAge('python')).toBeUndefined();
  });

  it('preloadAllVersions는 fetch 실패 시에도 폴백으로 완료된다', async () => {
    vi.doMock('./version-fetcher', () => ({
      fetchPythonVersions: vi.fn().mockRejectedValue(new Error('python down')),
      fetchCudaVersions: vi.fn().mockRejectedValue(new Error('cuda down')),
    }));
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', storage);
    const module = await import('./version-preloader');

    const result = await module.preloadAllVersions();

    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.status).toEqual({
      python: 'success',
      cuda: 'success',
    });
  });

  it('refreshExpiredCaches는 만료된 소스만 새로고침한다', async () => {
    const fetchPythonVersions = vi.fn().mockResolvedValue(['3.13']);
    const fetchCudaVersions = vi.fn().mockResolvedValue(['12.6']);
    vi.doMock('./version-fetcher', () => ({
      fetchPythonVersions,
      fetchCudaVersions,
    }));
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', storage);
    storage.setItem('depssmuggler:python-versions', JSON.stringify(['3.13']));
    storage.setItem('depssmuggler:python-versions-timestamp', String(Date.now()));
    storage.setItem('depssmuggler:cuda-versions-timestamp', String(Date.now() - (8 * 24 * 60 * 60 * 1000)));
    const module = await import('./version-preloader');

    await module.refreshExpiredCaches();

    expect(fetchPythonVersions).not.toHaveBeenCalled();
    expect(fetchCudaVersions).toHaveBeenCalledTimes(1);
  });

  it('브라우저 환경에서는 캐시 나이와 유효성을 계산한다', async () => {
    vi.doMock('./version-fetcher', () => ({
      fetchPythonVersions: vi.fn().mockResolvedValue(['3.13']),
      fetchCudaVersions: vi.fn().mockResolvedValue(['12.6']),
    }));
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', storage);
    storage.setItem('depssmuggler:python-versions-timestamp', String(Date.now() - 1000));
    storage.setItem('depssmuggler:cuda-versions-timestamp', String(Date.now() - (8 * 24 * 60 * 60 * 1000)));
    const module = await import('./version-preloader');

    expect(module.isCacheValid('python')).toBe(true);
    expect(module.isCacheValid('cuda')).toBe(false);
    expect(module.getCacheAge('python')).toBeGreaterThanOrEqual(1000);
  });
});
