/**
 * npm Registry Packument 공유 캐시
 * NpmDownloader와 NpmResolver가 공유하여 중복 API 호출 방지
 */

import axios, { AxiosInstance } from 'axios';
import logger from '../../utils/logger';
import { NpmPackument, PackumentCacheEntry } from './npm-types';

/** 기본 TTL: 5분 */
const DEFAULT_TTL = 5 * 60 * 1000;

/** 기본 레지스트리 URL */
const DEFAULT_REGISTRY_URL = 'https://registry.npmjs.org';

/**
 * 모듈 레벨 공유 캐시
 */
const packumentCache: Map<string, PackumentCacheEntry> = new Map();

/**
 * 진행 중인 요청 추적 (중복 요청 방지)
 */
const pendingRequests: Map<string, Promise<NpmPackument>> = new Map();

/**
 * Axios 클라이언트 (싱글톤)
 */
let sharedClient: AxiosInstance | null = null;

function getClient(registryUrl: string = DEFAULT_REGISTRY_URL): AxiosInstance {
  if (!sharedClient || (sharedClient.defaults.baseURL !== registryUrl)) {
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
 * Packument 가져오기 (공유 캐시 사용)
 * NpmDownloader와 NpmResolver가 이 함수를 공유
 */
export async function fetchPackument(
  name: string,
  options: NpmCacheOptions = {}
): Promise<NpmPackument> {
  const {
    registryUrl = DEFAULT_REGISTRY_URL,
    ttl = DEFAULT_TTL,
    forceRefresh = false,
  } = options;

  const cacheKey = `${registryUrl}:${name}`;
  const now = Date.now();

  // 1. 캐시 확인
  if (!forceRefresh) {
    const cached = packumentCache.get(cacheKey);
    if (cached && now - cached.fetchedAt < ttl) {
      logger.debug('npm 캐시 히트', {
        package: name,
        age: Math.round((now - cached.fetchedAt) / 1000),
      });
      return cached.packument;
    }
  }

  // 2. 진행 중인 동일 요청 대기
  const pendingKey = cacheKey;
  const pending = pendingRequests.get(pendingKey);
  if (pending) {
    logger.debug('npm 중복 요청 대기', { package: name });
    return pending;
  }

  // 3. API 요청
  const requestPromise = (async (): Promise<NpmPackument> => {
    try {
      // scoped 패키지 처리 (@scope/name -> @scope%2Fname)
      const encodedName = name.startsWith('@') ? name.replace('/', '%2F') : name;
      const client = getClient(registryUrl);

      logger.debug('npm API 요청', { package: name });

      const response = await client.get<NpmPackument>(`/${encodedName}`);
      const packument = response.data;

      // 캐시 저장
      packumentCache.set(cacheKey, {
        packument,
        fetchedAt: Date.now(),
      });

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
    } finally {
      pendingRequests.delete(pendingKey);
    }
  })();

  pendingRequests.set(pendingKey, requestPromise);
  return requestPromise;
}

/**
 * 캐시 결과와 함께 Packument 가져오기
 */
export async function fetchPackumentWithCacheInfo(
  name: string,
  options: NpmCacheOptions = {}
): Promise<NpmCacheResult> {
  const {
    registryUrl = DEFAULT_REGISTRY_URL,
    ttl = DEFAULT_TTL,
    forceRefresh = false,
  } = options;

  const cacheKey = `${registryUrl}:${name}`;
  const now = Date.now();

  // 캐시 확인
  if (!forceRefresh) {
    const cached = packumentCache.get(cacheKey);
    if (cached && now - cached.fetchedAt < ttl) {
      return { packument: cached.packument, fromCache: true };
    }
  }

  const packument = await fetchPackument(name, options);
  return { packument, fromCache: false };
}

/**
 * 메모리 캐시 초기화
 */
export function clearNpmCache(): void {
  const size = packumentCache.size;
  packumentCache.clear();
  pendingRequests.clear();
  logger.info('npm 캐시 초기화', { clearedEntries: size });
}

/**
 * 특정 패키지 캐시 삭제
 */
export function invalidatePackage(name: string, registryUrl: string = DEFAULT_REGISTRY_URL): void {
  const cacheKey = `${registryUrl}:${name}`;
  packumentCache.delete(cacheKey);
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
  let oldest: number | null = null;
  let newest: number | null = null;

  packumentCache.forEach((entry) => {
    if (oldest === null || entry.fetchedAt < oldest) {
      oldest = entry.fetchedAt;
    }
    if (newest === null || entry.fetchedAt > newest) {
      newest = entry.fetchedAt;
    }
  });

  return {
    entries: packumentCache.size,
    oldestEntry: oldest,
    newestEntry: newest,
  };
}

/**
 * 만료된 캐시 정리
 */
export function pruneExpiredNpmCache(ttl: number = DEFAULT_TTL): number {
  const now = Date.now();
  let pruned = 0;

  packumentCache.forEach((entry, key) => {
    if (now - entry.fetchedAt >= ttl) {
      packumentCache.delete(key);
      pruned++;
    }
  });

  if (pruned > 0) {
    logger.info('npm 만료된 캐시 정리', { pruned });
  }

  return pruned;
}

/**
 * 캐시에서 직접 조회 (API 호출 없음)
 */
export function getPackumentFromCache(
  name: string,
  registryUrl: string = DEFAULT_REGISTRY_URL
): NpmPackument | null {
  const cacheKey = `${registryUrl}:${name}`;
  const cached = packumentCache.get(cacheKey);
  return cached?.packument ?? null;
}

/**
 * 캐시 유효성 확인
 */
export function isPackumentCached(
  name: string,
  registryUrl: string = DEFAULT_REGISTRY_URL,
  ttl: number = DEFAULT_TTL
): boolean {
  const cacheKey = `${registryUrl}:${name}`;
  const cached = packumentCache.get(cacheKey);
  if (!cached) return false;
  return Date.now() - cached.fetchedAt < ttl;
}
