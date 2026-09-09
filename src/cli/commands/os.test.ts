import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cacheClearCommand,
  cacheStatsCommand,
  downloadCommand,
} from './os';

const {
  downloadOSPackages,
  searchOSPackages,
  getOSPackageCacheStats,
  clearOSPackageCache,
  getConfig,
  createInterface,
} = vi.hoisted(() => ({
  downloadOSPackages: vi.fn(),
  searchOSPackages: vi.fn(),
  getOSPackageCacheStats: vi.fn(),
  clearOSPackageCache: vi.fn(),
  getConfig: vi.fn(),
  createInterface: vi.fn(),
}));

vi.mock('../../core/downloaders/os-shared/cli-backend', () => ({
  downloadOSPackages,
  searchOSPackages,
  getOSPackageCacheStats,
  clearOSPackageCache,
}));

vi.mock('../../core/config', () => ({
  getConfigManager: vi.fn(() => ({
    getConfig,
  })),
}));

vi.mock('readline', () => ({
  createInterface,
}));

describe('os CLI commands', () => {
  const expectedCacheDirectory = join('/tmp/depssmuggler-cache', 'os-packages');

  beforeEach(() => {
    vi.clearAllMocks();
    getConfig.mockReturnValue({
      concurrentDownloads: 5,
      cacheEnabled: true,
      cachePath: '/tmp/depssmuggler-cache',
      maxCacheSize: 1024,
      logLevel: 'info',
    });
    downloadOSPackages.mockResolvedValue({
      requestedPackages: [],
      packages: [],
      artifacts: [{ type: 'archive', path: '/tmp/bundle.zip' }],
      warnings: [],
      unresolved: [],
      conflicts: [],
    });
    getOSPackageCacheStats.mockResolvedValue({
      directory: expectedCacheDirectory,
      entryCount: 3,
      totalSize: 1024,
    });
    clearOSPackageCache.mockResolvedValue({
      directory: expectedCacheDirectory,
      clearedEntries: 3,
      clearedSize: 1024,
    });
  });

  it('downloadCommand는 설정 기반 캐시 경로와 출력 옵션을 backend로 전달한다', async () => {
    await downloadCommand(['httpd'], {
      distro: 'rocky-9',
      arch: 'x86_64',
      output: './os-packages',
      format: 'both',
      archiveFormat: 'zip',
      deps: true,
      scripts: true,
      concurrency: '7',
    });

    expect(downloadOSPackages).toHaveBeenCalledWith(
      expect.objectContaining({
        packageNames: ['httpd'],
        outputType: 'both',
        archiveFormat: 'zip',
        concurrency: 7,
        cacheEnabled: true,
        cacheMaxSize: 1024,
        cacheDirectory: expectedCacheDirectory,
      })
    );
  });

  it.each(['1.5', '0.5', '.5', '.5e-999', '+.5e-999', '1abc', '9007199254740992', '1.0000000000000001'])(
    '양의 정수가 아닌 동시성 입력은 backend 전에 실패한다: %j',
    async (concurrency) => {
      const exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {
          throw new Error('process.exit');
        }) as never);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      try {
        await expect(downloadCommand(['httpd'], {
          distro: 'rocky-9',
          arch: 'x86_64',
          output: './os-packages',
          format: 'both',
          archiveFormat: 'zip',
          deps: true,
          scripts: true,
          concurrency,
        })).rejects.toThrow('process.exit');
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('양의 정수'));
      } finally {
        errorSpy.mockRestore();
        exitSpy.mockRestore();
      }

      expect(downloadOSPackages).not.toHaveBeenCalled();
    },
  );

  it.each(['0', '-1', 'abc'])('legacy 동시성 입력은 설정 fallback을 유지한다: %j', async (concurrency) => {
    await downloadCommand(['httpd'], {
      distro: 'rocky-9',
      arch: 'x86_64',
      output: './os-packages',
      format: 'both',
      archiveFormat: 'zip',
      deps: true,
      scripts: true,
      concurrency,
    });

    expect(downloadOSPackages).toHaveBeenCalledWith(expect.objectContaining({
      concurrency: 5,
    }));
  });

  it('searchCommand는 설정된 OS 캐시 크기를 backend로 전달한다', async () => {
    searchOSPackages.mockResolvedValue([]);

    const { searchCommand } = await import('./os');
    await searchCommand('httpd', { distro: 'rocky-9', arch: 'x86_64', limit: '5' });

    expect(searchOSPackages).toHaveBeenCalledWith(expect.objectContaining({
      cacheEnabled: true,
      cacheMaxSize: 1024,
      cacheDirectory: expectedCacheDirectory,
    }));
  });

  it('cacheStatsCommand는 OS 캐시 통계를 backend에서 조회한다', async () => {
    await cacheStatsCommand();

    expect(getOSPackageCacheStats).toHaveBeenCalledWith(expectedCacheDirectory);
  });

  it('cacheClearCommand는 확인이 거부되면 삭제를 호출하지 않는다', async () => {
    createInterface.mockReturnValue({
      question: (_question: string, callback: (answer: string) => void) => {
        callback('n');
      },
      close: vi.fn(),
    });

    await cacheClearCommand({ force: false });

    expect(clearOSPackageCache).not.toHaveBeenCalled();
  });
});
