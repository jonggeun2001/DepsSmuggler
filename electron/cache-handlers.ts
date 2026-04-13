/**
 * 캐시 관련 IPC 핸들러
 */

import { ipcMain } from 'electron';
import { createScopedLogger } from './utils/logger';

// 캐시 모듈 import
import * as pipCache from '../src/core/shared/pip-cache';
import * as npmCache from '../src/core/shared/npm-cache';
import * as mavenCache from '../src/core/shared/maven-cache';
import * as condaCache from '../src/core/shared/conda-cache';
import { getDockerDownloader } from '../src/core';

const log = createScopedLogger('Cache');

async function collectPackageCacheStats() {
  const [pipStats, npmStats, mavenStats, condaStats] = await Promise.all([
    Promise.resolve(pipCache.getCacheStats()),
    Promise.resolve(npmCache.getNpmCacheStats()),
    Promise.resolve(mavenCache.getMavenCacheStats()),
    condaCache.getCacheStats(),
  ]);

  const totalSize = (pipStats.diskSize || 0) + (mavenStats.diskSize || 0) + (condaStats.totalSize || 0);
  const entryCount =
    (pipStats.memoryEntries || 0) +
    (npmStats.entries || 0) +
    (mavenStats.memoryEntries || 0) +
    (condaStats.entries?.length || 0);

  return {
    scope: 'package-metadata',
    excludes: ['version caches', 'renderer localStorage'],
    totalSize,
    entryCount,
    details: {
      pip: pipStats,
      npm: npmStats,
      maven: mavenStats,
      conda: condaStats,
    },
  };
}

/**
 * 캐시 관련 IPC 핸들러 등록
 */
export function registerCacheHandlers(): void {
  // 캐시 전체 크기 조회
  ipcMain.handle('cache:get-size', async () => {
    log.debug('Getting package cache size...');
    const stats = await collectPackageCacheStats();
    return stats.totalSize;
  });

  // 캐시 통계 조회
  ipcMain.handle('cache:stats', async () => {
    log.debug('Getting package cache stats...');
    try {
      return await collectPackageCacheStats();
    } catch (error) {
      log.error('Failed to get cache stats:', error);
      throw error;
    }
  });

  // 캐시 전체 삭제
  ipcMain.handle('cache:clear', async () => {
    log.info('Clearing package metadata caches...');
    try {
      await Promise.all([
        Promise.resolve(pipCache.clearAllCache()),
        Promise.resolve(npmCache.clearNpmCache()),
        Promise.all([mavenCache.clearMemoryCache(), mavenCache.clearDiskCache()]),
        condaCache.clearCache(),
      ]);
      log.info('Package metadata caches cleared');
      return { success: true };
    } catch (error) {
      log.error('Failed to clear caches:', error);
      throw error;
    }
  });

  // Docker 카탈로그 캐시 갱신
  ipcMain.handle('docker:cache:refresh', async (_event, registry: string = 'docker.io') => {
    const dockerDownloader = getDockerDownloader();
    await dockerDownloader.refreshCatalogCache(registry);
    return { success: true };
  });

  // Docker 카탈로그 캐시 상태 조회
  ipcMain.handle('docker:cache:status', async () => {
    const dockerDownloader = getDockerDownloader();
    return dockerDownloader.getCatalogCacheStatus();
  });

  // Docker 카탈로그 캐시 삭제
  ipcMain.handle('docker:cache:clear', async () => {
    const dockerDownloader = getDockerDownloader();
    dockerDownloader.clearCatalogCache();
    return { success: true };
  });

  log.info('캐시 핸들러 등록 완료');
}
