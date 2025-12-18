/**
 * 버전 정보 관련 IPC 핸들러
 */

import { ipcMain } from 'electron';
import { fetchPythonVersions, fetchCudaVersions } from '../src/core/shared/version-fetcher';
import {
  preloadAllVersions,
  refreshExpiredCaches,
  isCacheValid,
  getCacheAge,
  type PreloadResult
} from '../src/core/shared/version-preloader';
import { createScopedLogger } from './utils/logger';

const log = createScopedLogger('VersionHandlers');

// 앱 시작 시 백그라운드 로드
let pythonVersionsCache: string[] | null = null;
let cudaVersionsCache: string[] | null = null;

/**
 * 버전 정보 관련 IPC 핸들러 등록
 */
export function registerVersionHandlers(): void {
  // Python 버전 목록 요청
  ipcMain.handle('versions:python', async () => {
    try {
      // 캐시가 있으면 즉시 반환
      if (pythonVersionsCache && pythonVersionsCache.length > 0) {
        log.debug('Python 버전 캐시 반환');
        return pythonVersionsCache;
      }

      log.info('Python 버전 목록 로드 시작');
      const versions = await fetchPythonVersions();
      pythonVersionsCache = versions;
      log.info(`Python 버전 ${versions.length}개 로드 완료`);
      return versions;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error('Python 버전 가져오기 실패', { error: errorMsg });
      // 폴백 목록 반환
      return ['3.13', '3.12', '3.11', '3.10', '3.9'];
    }
  });

  // CUDA 버전 목록 요청
  ipcMain.handle('versions:cuda', async () => {
    try {
      // 캐시가 있으면 즉시 반환
      if (cudaVersionsCache && cudaVersionsCache.length > 0) {
        log.debug('CUDA 버전 캐시 반환');
        return cudaVersionsCache;
      }

      log.info('CUDA 버전 목록 로드 시작');
      const versions = await fetchCudaVersions();
      cudaVersionsCache = versions;
      log.info(`CUDA 버전 ${versions.length}개 로드 완료`);
      return versions;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error('CUDA 버전 가져오기 실패', { error: errorMsg });
      // 폴백 목록 반환
      return ['12.6', '12.5', '12.4', '12.1', '12.0', '11.8'];
    }
  });

  // 버전 목록 수동 사전 로딩 (설정 화면에서 "새로고침" 버튼 클릭 시)
  ipcMain.handle('versions:preload', async (): Promise<PreloadResult> => {
    log.info('Manual version preload requested');
    return await preloadAllVersions();
  });

  // 만료된 캐시만 백그라운드 갱신
  ipcMain.handle('versions:refresh-expired', async (): Promise<void> => {
    log.info('Background refresh requested');
    await refreshExpiredCaches();
  });

  // 버전 캐시 상태 조회
  ipcMain.handle('versions:cache-status', (): Record<string, { valid: boolean; age?: number }> => {
    return {
      python: {
        valid: isCacheValid('python'),
        age: getCacheAge('python'),
      },
      cuda: {
        valid: isCacheValid('cuda'),
        age: getCacheAge('cuda'),
      },
    };
  });

  log.info('버전 핸들러 등록 완료');

  // 백그라운드에서 미리 로드
  fetchPythonVersions()
    .then((versions) => {
      pythonVersionsCache = versions;
      log.info(`Python 버전 ${versions.length}개 사전 로드 완료`);
    })
    .catch((err) => {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.warn('Python 버전 사전 로드 실패', { error: errorMsg });
    });

  fetchCudaVersions()
    .then((versions) => {
      cudaVersionsCache = versions;
      log.info(`CUDA 버전 ${versions.length}개 사전 로드 완료`);
    })
    .catch((err) => {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.warn('CUDA 버전 사전 로드 실패', { error: errorMsg });
    });
}
