import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OSDistribution } from '../../src/core/downloaders/os-shared/types';
import { createOSSearchService } from './os-search-service';

const mocks = vi.hoisted(() => ({
  yum: vi.fn(),
  apt: vi.fn(),
  apk: vi.fn(),
  search: vi.fn(),
  distribution: vi.fn(),
  byManager: vi.fn(),
  internet: vi.fn(),
  invalidate: vi.fn(),
  distributions: [
    {
      id: 'test-apt',
      name: 'Test Linux',
      version: '1',
      packageManager: 'apt',
      architectures: ['amd64', 'arm64'],
      defaultRepos: [],
      extendedRepos: [],
    },
  ],
}));
vi.mock('../../src/core', () => ({
  getYumResolver: mocks.yum,
  getAptResolver: mocks.apt,
  getApkResolver: mocks.apk,
}));
vi.mock('../utils/logger', () => ({
  createScopedLogger: () => ({ info: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../src/core/downloaders/os-shared/repositories', () => ({
  OS_DISTRIBUTIONS: mocks.distributions,
  getDistributionById: mocks.distribution,
  getDistributionsByPackageManager: mocks.byManager,
}));
vi.mock('../../src/core/downloaders/os-shared/distribution-fetcher', () => ({
  getSimplifiedDistributions: mocks.internet,
  invalidateDistributionCache: mocks.invalidate,
}));

describe('OS search service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    for (const resolver of [mocks.yum, mocks.apt, mocks.apk])
      resolver.mockReturnValue({ searchPackages: mocks.search });
    mocks.distribution.mockReturnValue(mocks.distributions[0]);
    mocks.search.mockResolvedValue([]);
  });

  it('uses internet distributions by default and invalidates the cache only on explicit refresh', async () => {
    const remote = [{ id: 'remote', name: 'Remote Linux' }];
    mocks.internet.mockResolvedValue(remote);
    const service = createOSSearchService();
    await expect(service.getAllDistributions()).resolves.toBe(remote);
    expect(mocks.invalidate).not.toHaveBeenCalled();
    await expect(service.getAllDistributions({ refresh: true })).resolves.toBe(remote);
    expect(mocks.invalidate).toHaveBeenCalledOnce();
    expect(mocks.invalidate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.internet.mock.invocationCallOrder[1]
    );
  });

  it.each(['local', 'internet'] as const)(
    'maps local distributions when source is %s or fetching fails',
    async (source) => {
      mocks.internet.mockRejectedValue(new Error('offline'));
      await expect(
        createOSSearchService().getAllDistributions({ source, refresh: true })
      ).resolves.toEqual([
        {
          id: 'test-apt',
          name: 'Test Linux',
          version: '1',
          osType: 'linux',
          packageManager: 'apt',
          architectures: ['amd64', 'arm64'],
        },
      ]);
      expect(mocks.internet).toHaveBeenCalledTimes(source === 'internet' ? 1 : 0);
      expect(mocks.invalidate).toHaveBeenCalledTimes(source === 'internet' ? 1 : 0);
    }
  );

  it('preserves an empty internet result rather than replacing it with local entries', async () => {
    mocks.internet.mockResolvedValue([]);
    await expect(createOSSearchService().getAllDistributions()).resolves.toEqual([]);
  });

  it('looks up distributions by package manager or ID and preserves unknown lookup results', async () => {
    mocks.byManager.mockReturnValue(mocks.distributions);
    const service = createOSSearchService();
    await expect(service.getDistributions('apt')).resolves.toBe(mocks.distributions);
    expect(mocks.byManager).toHaveBeenCalledWith('apt');
    mocks.distribution.mockReturnValue(undefined);
    await expect(service.getDistribution('missing')).resolves.toBeUndefined();
    expect(mocks.distribution).toHaveBeenCalledWith('missing');
  });

  it.each(['yum', 'apt', 'apk'] as const)(
    'routes %s using canonical distribution metadata and the requested architecture',
    async (packageManager) => {
      const distribution = { ...mocks.distributions[0], packageManager } as OSDistribution;
      mocks.distribution.mockReturnValue(distribution);
      const latest = {
        name: 'curl',
        version: '8.0',
        architecture: 'arm64',
        checksum: { value: 'sha' },
      };
      mocks.search.mockResolvedValue([{ latest, versions: [latest] }]);
      await expect(
        createOSSearchService().searchPackages({
          query: 'curl',
          distribution: { id: 'test-apt', packageManager: 'untrusted-input' },
          architecture: 'arm64',
          matchType: 'exact',
        })
      ).resolves.toEqual({ packages: [latest], totalCount: 1 });
      expect(mocks[packageManager]).toHaveBeenCalledWith({
        repositories: distribution.defaultRepos,
        architecture: 'arm64',
        distribution,
        includeOptional: false,
        includeRecommends: false,
      });
      expect(mocks.search).toHaveBeenCalledWith('curl', 'exact');
      for (const other of ['yum', 'apt', 'apk'] as const) {
        if (other !== packageManager) expect(mocks[other]).not.toHaveBeenCalled();
      }
    }
  );

  it.each([undefined, 'partial', 'wildcard'] as const)(
    'normalizes %s matching to partial and returns empty results',
    async (matchType) => {
      await expect(
        createOSSearchService().searchPackages({
          query: '',
          distribution: mocks.distributions[0] as OSDistribution,
          architecture: 'amd64',
          matchType,
        })
      ).resolves.toEqual({ packages: [], totalCount: 0 });
      expect(mocks.search).toHaveBeenCalledWith('', 'partial');
    }
  );

  it.each([
    { limit: 1, expectedCount: 1 },
    { limit: 0, expectedCount: 3 },
    { limit: 10, expectedCount: 3 },
  ])('limits to $limit without reducing totalCount', async ({ limit, expectedCount }) => {
    const packages = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
    mocks.search.mockResolvedValue(packages.map((latest) => ({ latest })));
    await expect(
      createOSSearchService().searchPackages({
        query: 'a',
        distribution: mocks.distributions[0] as OSDistribution,
        architecture: 'amd64',
        limit,
      })
    ).resolves.toEqual({ packages: packages.slice(0, expectedCount), totalCount: 3 });
  });

  it('rejects unknown distribution IDs before creating a resolver', async () => {
    mocks.distribution.mockReturnValue(undefined);
    await expect(
      createOSSearchService().searchPackages({
        query: 'curl',
        distribution: { id: 'missing', packageManager: 'apt' },
        architecture: 'amd64',
      })
    ).rejects.toThrow('Unknown distribution: missing');
    expect(mocks.yum).not.toHaveBeenCalled();
    expect(mocks.apt).not.toHaveBeenCalled();
    expect(mocks.apk).not.toHaveBeenCalled();
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it('rejects unsupported canonical package managers without searching', async () => {
    mocks.distribution.mockReturnValue({ ...mocks.distributions[0], packageManager: 'pacman' });
    await expect(
      createOSSearchService().searchPackages({
        query: 'curl',
        distribution: mocks.distributions[0] as OSDistribution,
        architecture: 'amd64',
      })
    ).rejects.toThrow('Unsupported package manager: pacman');
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it('propagates resolver errors rather than reporting an empty successful search', async () => {
    const error = new Error('repository metadata unavailable');
    mocks.search.mockRejectedValue(error);
    await expect(
      createOSSearchService().searchPackages({
        query: 'curl',
        distribution: mocks.distributions[0] as OSDistribution,
        architecture: 'amd64',
      })
    ).rejects.toBe(error);
  });
});
