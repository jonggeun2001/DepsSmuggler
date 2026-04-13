import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cacheClearCommand,
  cacheStatsCommand,
  downloadCommand,
} from './os';

const {
  downloadOSPackages,
  getOSPackageCacheStats,
  clearOSPackageCache,
  getConfig,
} = vi.hoisted(() => ({
  downloadOSPackages: vi.fn(),
  getOSPackageCacheStats: vi.fn(),
  clearOSPackageCache: vi.fn(),
  getConfig: vi.fn(),
}));

vi.mock('../../core/downloaders/os-shared/cli-backend', () => ({
  downloadOSPackages,
  getOSPackageCacheStats,
  clearOSPackageCache,
}));

vi.mock('../../core/config', () => ({
  getConfigManager: vi.fn(() => ({
    getConfig,
  })),
}));

const createInterface = vi.fn();

vi.mock('readline', () => ({
  createInterface,
}));

describe('os CLI commands', () => {
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
      directory: '/tmp/depssmuggler-cache/os-packages',
      entryCount: 3,
      totalSize: 1024,
    });
    clearOSPackageCache.mockResolvedValue({
      directory: '/tmp/depssmuggler-cache/os-packages',
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
        cacheDirectory: '/tmp/depssmuggler-cache/os-packages',
      })
    );
  });

  it('cacheStatsCommand는 OS 캐시 통계를 backend에서 조회한다', async () => {
    await cacheStatsCommand();

    expect(getOSPackageCacheStats).toHaveBeenCalledWith(
      '/tmp/depssmuggler-cache/os-packages'
    );
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
