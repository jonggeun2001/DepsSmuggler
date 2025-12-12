/**
 * PyPI 패키지 메타데이터 캐시 관리
 * 메모리 + 디스크 캐시로 중복 네트워크 요청 방지
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import axios from 'axios';
import logger from '../../utils/logger';

/**
 * PyPI 패키지 메타데이터 (JSON API 응답)
 */
export interface PyPIPackageInfo {
  name: string;
  version: string;
  requires_dist?: string[];
  requires_python?: string;
}

export interface PyPIRelease {
  filename: string;
  url: string;
  packagetype: string;
  python_version: string;
  requires_python?: string;
  digests: {
    sha256: string;
    md5?: string;
  };
  size: number;
}

export interface PyPIResponse {
  info: PyPIPackageInfo;
  releases?: Record<string, PyPIRelease[]>;  // 특정 버전 조회 시 없을 수 있음
  urls?: PyPIRelease[];  // 특정 버전 조회 시 포함
}

/**
 * 캐시 메타데이터
 */
interface CacheMeta {
  /** 캐시 저장 시간 (Unix timestamp ms) */
  cachedAt: number;
  /** TTL (초) */
  ttl: number;
  /** 패키지 이름 */
  packageName: string;
  /** 버전 (특정 버전 캐시 시) */
  version?: string;
}

/**
 * 캐시 항목
 */
interface CacheEntry<T> {
  data: T;
  meta: CacheMeta;
}

/** 기본 TTL: 5분 (의존성 해결 세션 동안 유효) */
const DEFAULT_TTL = 300;

/** 디스크 캐시 TTL: 1시간 (더 긴 유효기간) */
const DISK_CACHE_TTL = 3600;

/**
 * 모듈 레벨 메모리 캐시
 * key: packageName 또는 packageName@version
 */
const memoryCache: Map<string, CacheEntry<PyPIResponse>> = new Map();

/**
 * 진행 중인 요청 추적 (중복 요청 방지)
 */
const pendingRequests: Map<string, Promise<PyPIResponse | null>> = new Map();

/**
 * 기본 캐시 디렉토리
 */
function getDefaultCacheDir(): string {
  return path.join(os.homedir(), '.depssmuggler', 'cache', 'pip');
}

/**
 * 패키지별 캐시 파일 경로
 */
function getCachePath(cacheDir: string, packageName: string, version?: string): string {
  const normalizedName = packageName.toLowerCase().replace(/_/g, '-');
  if (version) {
    return path.join(cacheDir, normalizedName, `${version}.json`);
  }
  return path.join(cacheDir, normalizedName, 'latest.json');
}

/**
 * 캐시 키 생성
 */
function getCacheKey(packageName: string, version?: string): string {
  const normalizedName = packageName.toLowerCase().replace(/_/g, '-');
  return version ? `${normalizedName}@${version}` : normalizedName;
}

/**
 * 캐시가 유효한지 확인
 */
function isCacheValid(meta: CacheMeta): boolean {
  const now = Date.now();
  const age = (now - meta.cachedAt) / 1000;
  return age < meta.ttl;
}

/**
 * 디스크에서 캐시 읽기
 */
function readDiskCache(cachePath: string): CacheEntry<PyPIResponse> | null {
  try {
    if (fs.existsSync(cachePath)) {
      const content = fs.readFileSync(cachePath, 'utf-8');
      const entry = JSON.parse(content) as CacheEntry<PyPIResponse>;
      if (isCacheValid(entry.meta)) {
        return entry;
      }
    }
  } catch (error) {
    logger.debug('디스크 캐시 읽기 실패', { cachePath, error });
  }
  return null;
}

/**
 * 디스크에 캐시 저장
 */
function writeDiskCache(cachePath: string, entry: CacheEntry<PyPIResponse>): void {
  try {
    const dir = path.dirname(cachePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(cachePath, JSON.stringify(entry));
  } catch (error) {
    logger.debug('디스크 캐시 저장 실패', { cachePath, error });
  }
}

/**
 * PyPI 캐시 옵션
 */
export interface PipCacheOptions {
  /** PyPI 기본 URL */
  baseUrl?: string;
  /** 캐시 디렉토리 */
  cacheDir?: string;
  /** 메모리 캐시 사용 (기본: true) */
  useMemoryCache?: boolean;
  /** 디스크 캐시 사용 (기본: true) */
  useDiskCache?: boolean;
  /** 메모리 캐시 TTL (초, 기본: 300) */
  memoryTtl?: number;
  /** 디스크 캐시 TTL (초, 기본: 3600) */
  diskTtl?: number;
  /** 강제 새로고침 */
  forceRefresh?: boolean;
  /** 요청 타임아웃 (ms) */
  timeout?: number;
}

/**
 * 캐시 결과
 */
export interface PipCacheResult {
  data: PyPIResponse;
  fromCache: boolean;
  cacheType?: 'memory' | 'disk';
}

/**
 * PyPI 패키지 메타데이터 가져오기 (캐시 지원)
 */
export async function fetchPackageMetadata(
  packageName: string,
  version?: string,
  options: PipCacheOptions = {}
): Promise<PipCacheResult | null> {
  const {
    baseUrl = 'https://pypi.org/pypi',
    cacheDir = getDefaultCacheDir(),
    useMemoryCache = true,
    useDiskCache = true,
    memoryTtl = DEFAULT_TTL,
    diskTtl = DISK_CACHE_TTL,
    forceRefresh = false,
    timeout = 30000,
  } = options;

  const cacheKey = getCacheKey(packageName, version);
  const cachePath = getCachePath(cacheDir, packageName, version);

  // 1. 메모리 캐시 확인
  if (useMemoryCache && !forceRefresh) {
    const memoryCached = memoryCache.get(cacheKey);
    if (memoryCached && isCacheValid(memoryCached.meta)) {
      logger.debug('PyPI 메모리 캐시 히트', {
        package: packageName,
        version,
        age: Math.round((Date.now() - memoryCached.meta.cachedAt) / 1000),
      });
      return {
        data: memoryCached.data,
        fromCache: true,
        cacheType: 'memory',
      };
    }
  }

  // 2. 디스크 캐시 확인
  if (useDiskCache && !forceRefresh) {
    const diskCached = readDiskCache(cachePath);
    if (diskCached) {
      // 메모리 캐시에도 저장
      if (useMemoryCache) {
        memoryCache.set(cacheKey, diskCached);
      }
      logger.debug('PyPI 디스크 캐시 히트', {
        package: packageName,
        version,
        age: Math.round((Date.now() - diskCached.meta.cachedAt) / 1000),
      });
      return {
        data: diskCached.data,
        fromCache: true,
        cacheType: 'disk',
      };
    }
  }

  // 3. 진행 중인 동일 요청 대기 (중복 요청 방지)
  const pendingKey = cacheKey;
  const pending = pendingRequests.get(pendingKey);
  if (pending) {
    logger.debug('PyPI 중복 요청 대기', { package: packageName, version });
    const result = await pending;
    if (result) {
      return { data: result, fromCache: true, cacheType: 'memory' };
    }
    return null;
  }

  // 4. API 요청
  const url = version
    ? `${baseUrl}/${packageName}/${version}/json`
    : `${baseUrl}/${packageName}/json`;

  const requestPromise = (async (): Promise<PyPIResponse | null> => {
    try {
      logger.debug('PyPI API 요청', { package: packageName, version, url });

      const response = await axios.get<PyPIResponse>(url, {
        timeout,
        headers: {
          'User-Agent': 'DepsSmuggler/1.0',
        },
      });

      const data = response.data;

      // 캐시 저장
      const now = Date.now();

      // 메모리 캐시
      if (useMemoryCache) {
        const memoryEntry: CacheEntry<PyPIResponse> = {
          data,
          meta: {
            cachedAt: now,
            ttl: memoryTtl,
            packageName,
            version,
          },
        };
        memoryCache.set(cacheKey, memoryEntry);
      }

      // 디스크 캐시
      if (useDiskCache) {
        const diskEntry: CacheEntry<PyPIResponse> = {
          data,
          meta: {
            cachedAt: now,
            ttl: diskTtl,
            packageName,
            version,
          },
        };
        writeDiskCache(cachePath, diskEntry);
      }

      logger.debug('PyPI API 응답 캐시 저장', {
        package: packageName,
        version,
        releases: data.releases ? Object.keys(data.releases).length : 0,
      });

      return data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        logger.debug('PyPI 패키지 없음', { package: packageName, version });
      } else {
        const errorInfo = axios.isAxiosError(error)
          ? {
              message: error.message,
              code: error.code,
              status: error.response?.status,
              statusText: error.response?.statusText,
            }
          : error instanceof Error
            ? { message: error.message, name: error.name }
            : { message: String(error) };
        logger.warn('PyPI API 요청 실패', { package: packageName, version, error: errorInfo });
      }
      return null;
    } finally {
      pendingRequests.delete(pendingKey);
    }
  })();

  pendingRequests.set(pendingKey, requestPromise);
  const result = await requestPromise;

  if (result) {
    return { data: result, fromCache: false };
  }
  return null;
}

/**
 * 메모리 캐시 초기화
 */
export function clearMemoryCache(): void {
  const size = memoryCache.size;
  memoryCache.clear();
  pendingRequests.clear();
  logger.info('PyPI 메모리 캐시 초기화', { clearedEntries: size });
}

/**
 * 디스크 캐시 초기화
 */
export function clearDiskCache(cacheDir: string = getDefaultCacheDir()): void {
  try {
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true });
      logger.info('PyPI 디스크 캐시 초기화', { cacheDir });
    }
  } catch (error) {
    logger.error('PyPI 디스크 캐시 초기화 실패', { cacheDir, error });
  }
}

/**
 * 전체 캐시 초기화
 */
export function clearAllCache(cacheDir: string = getDefaultCacheDir()): void {
  clearMemoryCache();
  clearDiskCache(cacheDir);
}

/**
 * 캐시 통계
 */
export interface PipCacheStats {
  memoryEntries: number;
  diskSize: number;
  diskEntries: number;
}

export function getCacheStats(cacheDir: string = getDefaultCacheDir()): PipCacheStats {
  const stats: PipCacheStats = {
    memoryEntries: memoryCache.size,
    diskSize: 0,
    diskEntries: 0,
  };

  try {
    if (fs.existsSync(cacheDir)) {
      const countFiles = (dir: string): void => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            countFiles(fullPath);
          } else if (entry.name.endsWith('.json')) {
            stats.diskEntries++;
            stats.diskSize += fs.statSync(fullPath).size;
          }
        }
      };
      countFiles(cacheDir);
    }
  } catch (error) {
    logger.debug('캐시 통계 조회 실패', { error });
  }

  return stats;
}

/**
 * 만료된 캐시 정리
 */
export function pruneExpiredCache(cacheDir: string = getDefaultCacheDir()): number {
  let pruned = 0;

  // 메모리 캐시 정리
  memoryCache.forEach((entry, key) => {
    if (!isCacheValid(entry.meta)) {
      memoryCache.delete(key);
      pruned++;
    }
  });

  // 디스크 캐시 정리
  try {
    if (fs.existsSync(cacheDir)) {
      const pruneDir = (dir: string): void => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            pruneDir(fullPath);
            // 빈 디렉토리 삭제
            if (fs.readdirSync(fullPath).length === 0) {
              fs.rmdirSync(fullPath);
            }
          } else if (entry.name.endsWith('.json')) {
            try {
              const content = fs.readFileSync(fullPath, 'utf-8');
              const cached = JSON.parse(content) as CacheEntry<PyPIResponse>;
              if (!isCacheValid(cached.meta)) {
                fs.unlinkSync(fullPath);
                pruned++;
              }
            } catch {
              // 파싱 실패한 파일 삭제
              fs.unlinkSync(fullPath);
              pruned++;
            }
          }
        }
      };
      pruneDir(cacheDir);
    }
  } catch (error) {
    logger.debug('만료된 캐시 정리 실패', { error });
  }

  if (pruned > 0) {
    logger.info('PyPI 만료된 캐시 정리', { pruned });
  }

  return pruned;
}
