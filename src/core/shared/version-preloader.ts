/**
 * 버전 목록 사전 로딩 시스템
 * 앱 시작 시 Python, CUDA 버전 목록을 백그라운드에서 병렬로 로딩하고 캐시 관리
 */

import logger from '../../utils/logger';
import { fetchPythonVersions, fetchCudaVersions } from './version-fetcher';

interface BrowserCacheContext {
  window: unknown;
  localStorage: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
  };
}

// DOM 타입에 의존하지 않아 Electron main과 renderer에서 함께 사용할 수 있다.
const isBrowser = (context: typeof globalThis): context is typeof globalThis & BrowserCacheContext => {
  return typeof context !== 'undefined' &&
         'window' in context && typeof context.window !== 'undefined' &&
         'localStorage' in context && typeof context.localStorage !== 'undefined';
};

/**
 * 버전 로딩 상태
 */
export interface VersionLoadingStatus {
  python: 'idle' | 'loading' | 'success' | 'error';
  cuda: 'idle' | 'loading' | 'success' | 'error';
}

export interface VersionLoadingError {
  source: 'python' | 'cuda';
  error: string;
  timestamp: number;
}

export interface PreloadResult {
  success: boolean;
  status: VersionLoadingStatus;
  errors: VersionLoadingError[];
  duration: number; // ms
}

/**
 * 버전별 캐시 TTL (밀리초)
 */
export const VERSION_CACHE_TTL = {
  python: 24 * 60 * 60 * 1000,  // 24시간
  cuda: 7 * 24 * 60 * 60 * 1000, // 7일
} as const;

/**
 * 로컬 스토리지 키
 */
const CACHE_KEYS = {
  python: 'depssmuggler:python-versions',
  cuda: 'depssmuggler:cuda-versions',
  pythonTimestamp: 'depssmuggler:python-versions-timestamp',
  cudaTimestamp: 'depssmuggler:cuda-versions-timestamp',
} as const;

/**
 * 네트워크 실패 시 사용할 폴백 버전 목록
 */
const FALLBACK_VERSIONS = {
  python: ['3.13', '3.12', '3.11', '3.10', '3.9'],
  cuda: ['12.6', '12.5', '12.4', '12.1', '12.0', '11.8'],
} as const;

/**
 * 캐시 유효성 검증
 */
export function isCacheValid(source: keyof typeof VERSION_CACHE_TTL): boolean {
  if (!isBrowser(globalThis)) return false; // Node.js 환경

  const timestampKey = `${source}Timestamp` as const;
  const timestamp = globalThis.localStorage.getItem(CACHE_KEYS[timestampKey]);

  if (!timestamp) return false;

  const cacheAge = Date.now() - parseInt(timestamp, 10);
  return cacheAge < VERSION_CACHE_TTL[source];
}

/**
 * 캐시에서 버전 목록 가져오기
 */
function getFromCache(source: keyof typeof VERSION_CACHE_TTL): string[] | null {
  if (!isBrowser(globalThis)) return null;

  if (!isCacheValid(source)) return null;

  const cached = globalThis.localStorage.getItem(CACHE_KEYS[source]);

  if (!cached) return null;

  try {
    return JSON.parse(cached);
  } catch {
    return null;
  }
}

/**
 * 버전 목록 캐시 저장
 */
function saveToCache(source: keyof typeof VERSION_CACHE_TTL, versions: string[]): void {
  if (!isBrowser(globalThis)) return;

  const timestampKey = `${source}Timestamp` as const;

  globalThis.localStorage.setItem(CACHE_KEYS[source], JSON.stringify(versions));
  globalThis.localStorage.setItem(CACHE_KEYS[timestampKey], Date.now().toString());
}

/**
 * Python 버전 로딩 (캐시 우선, 실패 시 폴백)
 */
async function loadPythonVersions(): Promise<string[]> {
  // 1. 캐시 확인
  const cached = getFromCache('python');
  if (cached) {
    logger.info('[Preloader] Using cached Python versions');
    return cached;
  }

  // 2. API 호출
  try {
    const versions = await fetchPythonVersions();

    if (versions && versions.length > 0) {
      saveToCache('python', versions);
      logger.info(`[Preloader] Loaded ${versions.length} Python versions from API`);
      return versions;
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn('[Preloader] Failed to fetch Python versions:', { error: errorMsg });
  }

  // 3. 폴백
  logger.warn('[Preloader] Using fallback Python versions');
  return [...FALLBACK_VERSIONS.python];
}

/**
 * CUDA 버전 로딩 (캐시 우선, 실패 시 폴백)
 */
async function loadCudaVersions(): Promise<string[]> {
  const cached = getFromCache('cuda');
  if (cached) {
    logger.info('[Preloader] Using cached CUDA versions');
    return cached;
  }

  try {
    const versions = await fetchCudaVersions();

    if (versions && versions.length > 0) {
      saveToCache('cuda', versions);
      logger.info(`[Preloader] Loaded ${versions.length} CUDA versions from API`);
      return versions;
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn('[Preloader] Failed to fetch CUDA versions:', { error: errorMsg });
  }

  logger.warn('[Preloader] Using fallback CUDA versions');
  return [...FALLBACK_VERSIONS.cuda];
}

/**
 * 모든 버전 목록 병렬 사전 로딩
 */
export async function preloadAllVersions(): Promise<PreloadResult> {
  const startTime = Date.now();
  const status: VersionLoadingStatus = {
    python: 'loading',
    cuda: 'loading',
  };
  const errors: VersionLoadingError[] = [];

  logger.info('[Preloader] Starting version preload...');

  // 병렬 실행
  const [pythonResult, cudaResult] = await Promise.allSettled([
    loadPythonVersions(),
    loadCudaVersions(),
  ]);

  // 결과 처리
  if (pythonResult.status === 'fulfilled') {
    status.python = 'success';
  } else {
    status.python = 'error';
    errors.push({
      source: 'python',
      error: pythonResult.reason?.message || 'Unknown error',
      timestamp: Date.now(),
    });
  }

  if (cudaResult.status === 'fulfilled') {
    status.cuda = 'success';
  } else {
    status.cuda = 'error';
    errors.push({
      source: 'cuda',
      error: cudaResult.reason?.message || 'Unknown error',
      timestamp: Date.now(),
    });
  }

  const duration = Date.now() - startTime;
  const success = errors.length === 0;

  logger.info(`[Preloader] Preload completed in ${duration}ms (success: ${success}, errors: ${errors.length})`);

  return {
    success,
    status,
    errors,
    duration,
  };
}

/**
 * 백그라운드 갱신 (만료된 캐시만)
 */
export async function refreshExpiredCaches(): Promise<void> {
  const tasks: Promise<unknown>[] = [];

  if (!isCacheValid('python')) {
    logger.info('[Preloader] Refreshing expired Python cache...');
    tasks.push(loadPythonVersions());
  }

  if (!isCacheValid('cuda')) {
    logger.info('[Preloader] Refreshing expired CUDA cache...');
    tasks.push(loadCudaVersions());
  }

  if (tasks.length > 0) {
    await Promise.allSettled(tasks);
    logger.info('[Preloader] Background refresh completed');
  }
}

/**
 * 캐시 나이 계산 (밀리초)
 */
export function getCacheAge(source: 'python' | 'cuda'): number | undefined {
  if (!isBrowser(globalThis)) return undefined;

  const timestampKey = `${source}Timestamp` as const;
  const timestamp = globalThis.localStorage.getItem(CACHE_KEYS[timestampKey]);

  if (!timestamp) return undefined;

  return Date.now() - parseInt(timestamp, 10);
}
