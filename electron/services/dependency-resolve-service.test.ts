import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveAllDependencies } from '../../src/core/shared';
import { createDependencyResolveService } from './dependency-resolve-service';

vi.mock('../../src/core/shared', () => ({ resolveAllDependencies: vi.fn() }));
vi.mock('../utils/logger', () => ({ createScopedLogger: () => ({ info: vi.fn() }) }));

describe('dependency resolution service boundary', () => {
  beforeEach(() => vi.resetAllMocks());

  it('preserves original requests, partial failures and trees while forwarding all resolution options and progress', async () => {
    const packages = [
      { id: 'requests', type: 'pip' as const, name: 'requests', version: '2.32.0' },
    ];
    const allPackages = [
      ...packages,
      { id: 'certifi', type: 'pip' as const, name: 'certifi', version: '2024.1.0' },
    ];
    const failedPackages = [{ name: 'missing', error: 'not found' }];
    const dependencyTrees = [{ package: packages[0], dependencies: [] }];
    const progress = {
      current: 1,
      total: 1,
      packageName: 'requests',
      packageType: 'pip',
      status: 'success' as const,
    };
    const options = {
      includeDependencies: true,
      targetOS: 'linux',
      architecture: 'arm64',
      pythonVersion: '3.12',
      cudaVersion: null,
      yumDistribution: { id: 'rocky-9', architecture: 'aarch64' },
      aptDistribution: { id: 'ubuntu-24.04', architecture: 'arm64' },
      apkDistribution: { id: 'alpine-3.20', architecture: 'aarch64' },
      includeRecommends: true,
    };
    vi.mocked(resolveAllDependencies).mockImplementation(async (_packages, forwarded) => {
      forwarded?.onProgress?.(progress);
      return { originalPackages: [], allPackages, dependencyTrees, failedPackages } as never;
    });
    const sender = { send: vi.fn() };
    const result = await createDependencyResolveService().resolveDependencies(
      packages,
      options,
      sender
    );

    expect(resolveAllDependencies).toHaveBeenCalledWith(packages, {
      ...options,
      onProgress: expect.any(Function),
    });
    expect(result).toEqual({
      originalPackages: packages,
      allPackages,
      dependencyTrees,
      failedPackages,
    });
    expect(result.originalPackages).toBe(packages);
    expect(sender.send).toHaveBeenCalledExactlyOnceWith('dependency:progress', progress);
  });

  it('accepts an empty request with omitted options and returns empty resolution collections', async () => {
    vi.mocked(resolveAllDependencies).mockResolvedValue({
      originalPackages: [],
      allPackages: [],
      dependencyTrees: [],
      failedPackages: [],
    });
    const sender = { send: vi.fn() };
    await expect(
      createDependencyResolveService().resolveDependencies([], undefined, sender)
    ).resolves.toEqual({
      originalPackages: [],
      allPackages: [],
      dependencyTrees: [],
      failedPackages: [],
    });
    expect(resolveAllDependencies).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        includeDependencies: undefined,
        cudaVersion: undefined,
        onProgress: expect.any(Function),
      })
    );
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('propagates resolver rejection without emitting a fabricated progress event', async () => {
    const error = new Error('repository unavailable');
    vi.mocked(resolveAllDependencies).mockRejectedValue(error);
    const sender = { send: vi.fn() };
    await expect(createDependencyResolveService().resolveDependencies([], {}, sender)).rejects.toBe(
      error
    );
    expect(sender.send).not.toHaveBeenCalled();
  });
});
