import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { DockerAuthClient } from './docker-auth-client';
import { DockerCatalogCache, DEFAULT_CATALOG_CACHE_TTL } from './docker-catalog-cache';

vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('DockerCatalogCache', () => {
  let cache: DockerCatalogCache;
  let token: MockInstance<DockerAuthClient['getTokenForRegistry']>;
  const get = vi.mocked(axios.get);
  const now = new Date('2026-01-01T00:00:00Z').getTime();

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const auth = new DockerAuthClient();
    token = vi.spyOn(auth, 'getTokenForRegistry').mockResolvedValue('catalog-token');
    cache = new DockerCatalogCache(auth);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('requests an unscoped catalog token and caches repositories with observable expiry', async () => {
    get.mockResolvedValue({ data: { repositories: ['team/a', 'team/b'] } });
    expect(cache.getCatalogCacheStatus()).toEqual([]);
    expect(cache.getCatalogCacheTTL()).toBe(DEFAULT_CATALOG_CACHE_TTL);

    await expect(cache.getCachedCatalog('ghcr.io')).resolves.toEqual(['team/a', 'team/b']);
    await cache.getCachedCatalog('ghcr.io');
    expect(token).toHaveBeenCalledExactlyOnceWith('ghcr.io', '');
    expect(get).toHaveBeenCalledExactlyOnceWith('https://ghcr.io/v2/_catalog', {
      headers: { Authorization: 'Bearer catalog-token' },
      params: { n: 1000 },
      timeout: 30000,
    });
    expect(cache.getCatalogCacheStatus()).toEqual([
      {
        registry: 'ghcr.io',
        repositoryCount: 2,
        fetchedAt: now,
        expiresAt: now + DEFAULT_CATALOG_CACHE_TTL,
        isExpired: false,
      },
    ]);
  });

  it('refreshes exactly at expiry and applies a configured TTL to new entries', async () => {
    cache.setCatalogCacheTTL(1000);
    expect(cache.getCatalogCacheTTL()).toBe(1000);
    get
      .mockResolvedValueOnce({ data: { repositories: ['old/image'] } })
      .mockResolvedValueOnce({ data: { repositories: ['new/image'] } });
    await cache.getCachedCatalog('ghcr.io');
    vi.advanceTimersByTime(999);
    await expect(cache.getCachedCatalog('ghcr.io')).resolves.toEqual(['old/image']);
    vi.advanceTimersByTime(1);
    expect(cache.getCatalogCacheStatus()[0].isExpired).toBe(true);

    await expect(cache.getCachedCatalog('ghcr.io')).resolves.toEqual(['new/image']);
    expect(get).toHaveBeenCalledTimes(2);
    expect(cache.getCatalogCacheStatus()[0]).toMatchObject({
      fetchedAt: now + 1000,
      expiresAt: now + 2000,
      isExpired: false,
    });
  });

  it('uses stale data on network failure, leaving it expired so later requests retry', async () => {
    cache.setCatalogCacheTTL(1);
    get.mockResolvedValueOnce({ data: { repositories: ['cached/image'] } });
    await cache.getCachedCatalog('ghcr.io');
    vi.advanceTimersByTime(1);
    get.mockRejectedValueOnce(new Error('network unavailable'));

    await expect(cache.getCachedCatalog('ghcr.io')).resolves.toEqual(['cached/image']);
    expect(cache.getCatalogCacheStatus()[0]).toMatchObject({ fetchedAt: now, isExpired: true });
    get.mockResolvedValueOnce({ data: { repositories: ['recovered/image'] } });
    await expect(cache.getCachedCatalog('ghcr.io')).resolves.toEqual(['recovered/image']);
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('returns an empty list after denied authentication and retries without a poisoned cache', async () => {
    token.mockRejectedValueOnce(new Error('forbidden'));
    await expect(cache.getCachedCatalog('ghcr.io')).resolves.toEqual([]);
    expect(get).not.toHaveBeenCalled();
    expect(cache.getCatalogCacheStatus()).toEqual([]);

    get.mockResolvedValue({ data: { repositories: ['public/image'] } });
    await expect(cache.getCachedCatalog('ghcr.io')).resolves.toEqual(['public/image']);
    expect(token).toHaveBeenCalledTimes(2);
  });

  it('returns an empty list on a first catalog request failure without caching the failure', async () => {
    get.mockRejectedValue(new Error('catalog disabled'));
    await expect(cache.getCachedCatalog('quay.io')).resolves.toEqual([]);
    await expect(cache.getCachedCatalog('quay.io')).resolves.toEqual([]);
    expect(get).toHaveBeenCalledTimes(2);
    expect(cache.getCatalogCacheStatus()).toEqual([]);
  });

  it.each([{ repositories: [] }, {}])('caches a successful empty catalog: %j', async (data) => {
    get.mockResolvedValue({ data });
    await expect(cache.getCachedCatalog('quay.io')).resolves.toEqual([]);
    await expect(cache.getCachedCatalog('quay.io')).resolves.toEqual([]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(cache.getCatalogCacheStatus()[0].repositoryCount).toBe(0);
  });

  it('isolates registries, force refreshes one, and clears all cached catalogs', async () => {
    get
      .mockResolvedValueOnce({ data: { repositories: ['ghcr/old'] } })
      .mockResolvedValueOnce({ data: { repositories: ['quay/image'] } })
      .mockResolvedValueOnce({ data: { repositories: ['ghcr/new'] } });
    await cache.getCachedCatalog('ghcr.io');
    await cache.getCachedCatalog('quay.io');
    await expect(cache.refreshCatalogCache('ghcr.io')).resolves.toEqual(['ghcr/new']);
    await expect(cache.getCachedCatalog('quay.io')).resolves.toEqual(['quay/image']);
    expect(get).toHaveBeenCalledTimes(3);

    cache.clearCatalogCache();
    expect(cache.getCatalogCacheStatus()).toEqual([]);
    get.mockResolvedValue({ data: { repositories: ['fresh/image'] } });
    await expect(cache.getCachedCatalog('quay.io')).resolves.toEqual(['fresh/image']);
    expect(get).toHaveBeenCalledTimes(4);
  });
});
