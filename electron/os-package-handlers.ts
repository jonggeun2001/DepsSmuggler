/**
 * OS Package IPC Handlers
 * OS 패키지 관련 IPC 핸들러
 */

import { ipcMain, BrowserWindow, dialog } from 'electron';
import {
  OSPackageDownloader,
  OS_DISTRIBUTIONS,
  getDistributionsByPackageManager,
  getDistributionById,
  getSimplifiedDistributions,
  invalidateDistributionCache,
} from '../src/core/downloaders/os';
import type {
  OSPackageManager,
  OSDistribution,
  OSArchitecture,
  OSPackageInfo,
  OSPackageSearchOptions,
  OSPackageDownloadOptions,
  OSDownloadProgress,
  OSErrorAction,
  Repository,
  MatchType,
} from '../src/core/downloaders/os/types';

// 싱글톤 다운로더 인스턴스
let osDownloader: OSPackageDownloader | null = null;

function getOSDownloader(): OSPackageDownloader {
  if (!osDownloader) {
    osDownloader = new OSPackageDownloader({
      concurrency: 3,
    });
  }
  return osDownloader;
}

/**
 * OS 패키지 IPC 핸들러 등록
 */
export function registerOSPackageHandlers(getMainWindow: () => BrowserWindow | null): void {
  // 배포판 목록 조회
  ipcMain.handle(
    'os:getDistributions',
    async (_event, osType: OSPackageManager): Promise<OSDistribution[]> => {
      return getDistributionsByPackageManager(osType);
    }
  );

  // 전체 배포판 목록 (인터넷에서 가져오기)
  ipcMain.handle(
    'os:getAllDistributions',
    async (
      _event,
      options?: { source?: 'internet' | 'local'; refresh?: boolean }
    ): Promise<{
      id: string;
      name: string;
      version: string;
      osType: string;
      packageManager: string;
      architectures: string[];
    }[]> => {
      const source = options?.source || 'internet';
      const refresh = options?.refresh || false;

      if (source === 'internet') {
        try {
          if (refresh) {
            invalidateDistributionCache();
          }
          return await getSimplifiedDistributions();
        } catch (error) {
          console.error('Failed to fetch distributions from internet, falling back to local:', error);
          // 폴백: 로컬 데이터
          return OS_DISTRIBUTIONS.map(d => ({
            id: d.id,
            name: d.name,
            version: d.version,
            osType: 'linux',
            packageManager: d.packageManager,
            architectures: d.architectures as string[],
          }));
        }
      } else {
        // 로컬 하드코딩된 목록
        return OS_DISTRIBUTIONS.map(d => ({
          id: d.id,
          name: d.name,
          version: d.version,
          osType: 'linux',
          packageManager: d.packageManager,
          architectures: d.architectures as string[],
        }));
      }
    }
  );

  // 특정 배포판 조회
  ipcMain.handle(
    'os:getDistribution',
    async (_event, distributionId: string): Promise<OSDistribution | undefined> => {
      return getDistributionById(distributionId);
    }
  );

  // 패키지 검색
  ipcMain.handle(
    'os:search',
    async (
      _event,
      options: {
        query: string;
        distribution: OSDistribution;
        architecture: OSArchitecture;
        matchType?: MatchType;
        limit?: number;
      }
    ) => {
      const downloader = getOSDownloader();

      const searchOptions: OSPackageSearchOptions = {
        query: options.query,
        distribution: options.distribution,
        architecture: options.architecture,
        matchType: options.matchType || 'contains' as MatchType,
        limit: options.limit || 50,
      };

      return await downloader.search(searchOptions);
    }
  );

  // 의존성 해결
  ipcMain.handle(
    'os:resolveDependencies',
    async (
      _event,
      options: {
        packages: OSPackageInfo[];
        distribution: OSDistribution;
        architecture: OSArchitecture;
        includeOptional?: boolean;
        includeRecommends?: boolean;
      }
    ) => {
      const downloader = getOSDownloader();
      const mainWindow = getMainWindow();

      return await downloader.resolveDependencies(
        options.packages,
        options.distribution,
        options.architecture,
        {
          includeOptional: options.includeOptional,
          includeRecommends: options.includeRecommends,
          onProgress: (message, current, total) => {
            mainWindow?.webContents.send('os:resolveDependencies:progress', {
              message,
              current,
              total,
            });
          },
        }
      );
    }
  );

  // 다운로드 시작
  ipcMain.handle(
    'os:download:start',
    async (
      _event,
      options: {
        packages: OSPackageInfo[];
        outputDir: string;
        resolveDependencies?: boolean;
        includeOptionalDeps?: boolean;
        verifyGPG?: boolean;
        concurrency?: number;
      }
    ) => {
      const downloader = getOSDownloader();
      const mainWindow = getMainWindow();

      const downloadOptions: OSPackageDownloadOptions = {
        packages: options.packages,
        outputDir: options.outputDir,
        resolveDependencies: options.resolveDependencies ?? true,
        includeOptionalDeps: options.includeOptionalDeps ?? false,
        verifyGPG: options.verifyGPG ?? false,
        concurrency: options.concurrency ?? 3,
        cacheMode: 'session',
        onProgress: (progress: OSDownloadProgress) => {
          mainWindow?.webContents.send('os:download:progress', progress);
        },
        onError: async (error): Promise<OSErrorAction> => {
          // 에러 다이얼로그 표시
          const pkgName = error.package?.name || '알 수 없는 패키지';
          const result = await dialog.showMessageBox(mainWindow!, {
            type: 'error',
            title: '다운로드 오류',
            message: `패키지 다운로드 중 오류가 발생했습니다.\n\n${pkgName}: ${error.message}`,
            buttons: ['재시도', '건너뛰기', '취소'],
            defaultId: 0,
            cancelId: 2,
          });

          switch (result.response) {
            case 0:
              return 'retry';
            case 1:
              return 'skip';
            default:
              return 'cancel';
          }
        },
      };

      return await downloader.download(downloadOptions);
    }
  );

  // 캐시 통계
  ipcMain.handle('os:cache:stats', async () => {
    const downloader = getOSDownloader();
    return downloader.getCacheStats();
  });

  // 캐시 초기화
  ipcMain.handle('os:cache:clear', async () => {
    const downloader = getOSDownloader();
    await downloader.clearCache();
    return { success: true };
  });
}

/**
 * OS 패키지 IPC 핸들러 해제
 */
export function unregisterOSPackageHandlers(): void {
  ipcMain.removeHandler('os:getDistributions');
  ipcMain.removeHandler('os:getAllDistributions');
  ipcMain.removeHandler('os:getDistribution');
  ipcMain.removeHandler('os:search');
  ipcMain.removeHandler('os:resolveDependencies');
  ipcMain.removeHandler('os:download:start');
  ipcMain.removeHandler('os:cache:stats');
  ipcMain.removeHandler('os:cache:clear');

  // 다운로더 정리
  osDownloader = null;
}
