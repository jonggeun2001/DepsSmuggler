/**
 * npm Registry Packument 공유 캐시
 * NpmDownloader와 NpmResolver가 공유하여 중복 API 호출 방지
 *
 * CacheStore를 사용하여 캐싱 로직 통합
 */

import axios, { AxiosInstance } from 'axios';
import logger from '../../utils/logger';
import { NpmPackument } from './npm-types';
import { createMemoryCache } from './cache/cache-store';
import { DEFAULT_MEMORY_TTL_MS } from './cache-utils';

/** 기본 TTL: 5분 */
const DEFAULT_TTL = DEFAULT_MEMORY_TTL_MS;

/** 기본 레지스트리 URL */
const DEFAULT_REGISTRY_URL = 'https://registry.npmjs.org';

/**
 * npm packument 캐시 매니저
 */
const cacheManager = createMemoryCache<NpmPackument>('npm', DEFAULT_TTL);

/**
 * Axios 클라이언트 (싱글톤)
 */
let sharedClient: AxiosInstance | null = null;

function getClient(registryUrl: string = DEFAULT_REGISTRY_URL): AxiosInstance {
  if (!sharedClient || sharedClient.defaults.baseURL !== registryUrl) {
    sharedClient = axios.create({
      baseURL: registryUrl,
      timeout: 30000,
      headers: {
        Accept: 'application/json',
      },
    });
  }
  return sharedClient;
}

/**
 * 캐시 옵션
 */
export interface NpmCacheOptions {
  /** 레지스트리 URL */
  registryUrl?: string;
  /** TTL (ms) */
  ttl?: number;
  /** 강제 새로고침 */
  forceRefresh?: boolean;
}

/**
 * 캐시 결과
 */
export interface NpmCacheResult {
  packument: NpmPackument;
  fromCache: boolean;
}

/**
 * 캐시 키 생성
 */
function getCacheKey(name: string, registryUrl: string): string {
  return `${registryUrl}:${name}`;
}

/**
 * Packument 가져오기 (공유 캐시 사용)
 * NpmDownloader와 NpmResolver가 이 함수를 공유
 */
export async function fetchPackument(
  name: string,
  options: NpmCacheOptions = {}
): Promise<NpmPackument> {
  const { registryUrl = DEFAULT_REGISTRY_URL, forceRefresh = false } = options;

  const cacheKey = getCacheKey(name, registryUrl);

  // CacheStore의 getOrFetch 사용
  const result = await cacheManager.getOrFetch(
    cacheKey,
    async () => {
      // scoped 패키지 처리 (@scope/name -> @scope%2Fname)
      const encodedName = name.startsWith('@') ? name.replace('/', '%2F') : name;
      const client = getClient(registryUrl);

      logger.debug('npm API 요청', { package: name });

      try {
        const response = await client.get<NpmPackument>(`/${encodedName}`);
        const packument = response.data;

        logger.debug('npm API 응답 캐시 저장', {
          package: name,
          versions: Object.keys(packument.versions).length,
        });

        return packument;
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          throw new Error(`패키지를 찾을 수 없습니다: ${name}`);
        }
        throw error;
      }
    },
    { forceRefresh }
  );

  return result.data;
}

/**
 * 캐시 결과와 함께 Packument 가져오기
 */
export async function fetchPackumentWithCacheInfo(
  name: string,
  options: NpmCacheOptions = {}
): Promise<NpmCacheResult> {
  const { registryUrl = DEFAULT_REGISTRY_URL, forceRefresh = false } = options;

  const cacheKey = getCacheKey(name, registryUrl);

  const result = await cacheManager.getOrFetch(
    cacheKey,
    async () => {
      const encodedName = name.startsWith('@') ? name.replace('/', '%2F') : name;
      const client = getClient(registryUrl);

      const response = await client.get<NpmPackument>(`/${encodedName}`);
      return response.data;
    },
    { forceRefresh }
  );

  return {
    packument: result.data,
    fromCache: result.fromCache,
  };
}

/**
 * 메모리 캐시 초기화
 */
export function clearNpmCache(): void {
  cacheManager.clear();
}

/**
 * 특정 패키지 캐시 삭제
 */
export function invalidatePackage(
  name: string,
  registryUrl: string = DEFAULT_REGISTRY_URL
): void {
  const cacheKey = getCacheKey(name, registryUrl);
  cacheManager.delete(cacheKey);
}

/**
 * 캐시 통계
 */
export interface NpmCacheStats {
  entries: number;
  oldestEntry: number | null;
  newestEntry: number | null;
}

export function getNpmCacheStats(): NpmCacheStats {
  const stats = cacheManager.getStats();
  return {
    entries: stats.memoryEntries,
    oldestEntry: stats.oldestEntry,
    newestEntry: stats.newestEntry,
  };
}

/**
 * 만료된 캐시 정리
 */
export function pruneExpiredNpmCache(ttl: number = DEFAULT_TTL): number {
  return cacheManager.prune();
}

/**
 * 캐시에서 직접 조회 (API 호출 없음)
 */
export function getPackumentFromCache(
  name: string,
  registryUrl: string = DEFAULT_REGISTRY_URL
): NpmPackument | null {
  const cacheKey = getCacheKey(name, registryUrl);
  return cacheManager.get(cacheKey) ?? null;
}

/**
 * 캐시 유효성 확인
 */
export function isPackumentCached(
  name: string,
  registryUrl: string = DEFAULT_REGISTRY_URL,
  ttl: number = DEFAULT_TTL
): boolean {
  const cacheKey = getCacheKey(name, registryUrl);
  return cacheManager.has(cacheKey);
}

// ============================================================================
// 하위 호환성을 위한 export (deprecated)
// ============================================================================

/** @deprecated CacheStore로 이전됨 */
export const packumentCache = {
  get size() {
    return cacheManager.size;
  },
  clear() {
    cacheManager.clear();
  },
};

/** @deprecated CacheStore로 이전됨 */
export const pendingManager = {
  get size() {
    return cacheManager.getStats().pendingRequests;
  },
  clear() {
    // CacheStore 내부에서 관리됨
  },
};

/** @deprecated CacheStore로 이전됨 */
export const pendingRequests = {
  get: () => undefined,
  set: () => {},
  delete: () => {},
  clear: () => {},
};
