/**
 * PyPI 패키지 메타데이터 캐시 관리
 * 메모리 + 디스크 캐시로 중복 네트워크 요청 방지
 *
 * CacheManager를 사용하여 메모리 캐싱 로직 통합
 * 디스크 캐시는 기존 형식 유지 (호환성)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import axios from 'axios';
import logger from '../../utils/logger';
import { CacheManager, createMemoryCache, CacheEntry } from './cache-manager';
import { DEFAULT_MEMORY_TTL_MS, DEFAULT_DISK_TTL_MS } from './cache-utils';

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
  releases?: Record<string, PyPIRelease[]>; // 특정 버전 조회 시 없을 수 있음
  urls?: PyPIRelease[]; // 특정 버전 조회 시 포함
}

/**
 * 디스크 캐시 항목 형식 (하위 호환성)
 */
interface DiskCacheEntry {
  data: PyPIResponse;
  meta: {
    cachedAt: number;
    ttl: number;
    packageName: string;
    version?: string;
  };
}

/** 기본 TTL: 5분 (의존성 해결 세션 동안 유효) */
const DEFAULT_TTL = DEFAULT_MEMORY_TTL_MS / 1000; // 초 단위 (하위 호환성)

/** 디스크 캐시 TTL: 1시간 (더 긴 유효기간) */
const DISK_CACHE_TTL = DEFAULT_DISK_TTL_MS / 1000; // 초 단위

/**
 * 기본 캐시 디렉토리
 */
function getDefaultCacheDir(): string {
  return path.join(os.homedir(), '.depssmuggler', 'cache', 'pip');
}

/**
 * pip 메모리 캐시 매니저
 */
const memCacheManager = createMemoryCache<PyPIResponse>('PyPI', DEFAULT_MEMORY_TTL_MS);

/**
 * 캐시 키 생성
 */
function getCacheKey(packageName: string, version?: string): string {
  const normalizedName = packageName.toLowerCase().replace(/_/g, '-');
  return version ? `${normalizedName}@${version}` : normalizedName;
}

/**
 * 패키지별 캐시 파일 경로 (기존 형식 유지)
 */
function getCachePath(cacheDir: string, packageName: string, version?: string): string {
  const normalizedName = packageName.toLowerCase().replace(/_/g, '-');
  if (version) {
    return path.join(cacheDir, normalizedName, `${version}.json`);
  }
  return path.join(cacheDir, normalizedName, 'latest.json');
}

/**
 * 디스크 캐시 유효성 확인
 */
function isDiskCacheValid(meta: DiskCacheEntry['meta']): boolean {
  const now = Date.now();
  const age = (now - meta.cachedAt) / 1000;
  return age < meta.ttl;
}

/**
 * 디스크에서 캐시 읽기
 */
function readDiskCache(cachePath: string): DiskCacheEntry | null {
  try {
    if (fs.existsSync(cachePath)) {
      const content = fs.readFileSync(cachePath, 'utf-8');
      const entry = JSON.parse(content) as DiskCacheEntry;
      if (isDiskCacheValid(entry.meta)) {
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
function writeDiskCache(cachePath: string, entry: DiskCacheEntry): void {
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

  // 1. 메모리 캐시 확인 (CacheManager 사용)
  if (useMemoryCache && !forceRefresh) {
    const memoryCached = memCacheManager.get(cacheKey);
    if (memoryCached) {
      logger.debug('PyPI 메모리 캐시 히트', {
        package: packageName,
        version,
      });
      return {
        data: memoryCached,
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
        memCacheManager.set(cacheKey, diskCached.data);
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

  // 3. CacheManager의 dedupeFetch 사용 (중복 요청 방지)
  try {
    const result = await memCacheManager.getOrFetch(
      cacheKey,
      async () => {
        const url = version
          ? `${baseUrl}/${packageName}/${version}/json`
          : `${baseUrl}/${packageName}/json`;

        logger.debug('PyPI API 요청', { package: packageName, version, url });

        const response = await axios.get<PyPIResponse>(url, {
          timeout,
          headers: {
            'User-Agent': 'DepsSmuggler/1.0',
          },
        });

        const data = response.data;

        // 디스크 캐시 저장
        if (useDiskCache) {
          const diskEntry: DiskCacheEntry = {
            data,
            meta: {
              cachedAt: Date.now(),
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
      },
      { forceRefresh }
    );

    return {
      data: result.data,
      fromCache: result.fromCache,
      cacheType: result.fromCache ? 'memory' : undefined,
    };
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
  }
}

/**
 * 메모리 캐시 초기화
 */
export function clearMemoryCache(): void {
  memCacheManager.clear();
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
    memoryEntries: memCacheManager.size,
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
  pruned += memCacheManager.prune();

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
              const cached = JSON.parse(content) as DiskCacheEntry;
              if (!isDiskCacheValid(cached.meta)) {
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

// ============================================================================
// 하위 호환성을 위한 export (deprecated)
// ============================================================================

/** @deprecated CacheManager로 이전됨 */
export const memoryCache = {
  get size() {
    return memCacheManager.size;
  },
  clear() {
    memCacheManager.clear();
  },
};

/** @deprecated CacheManager로 이전됨 */
export const pendingRequests = {
  get: () => undefined,
  set: () => {},
  delete: () => {},
  clear: () => {},
};
