/**
 * 공통 캐시 유틸리티
 * pip, npm, maven, conda 캐시에서 공통으로 사용되는 타입과 함수들
 */

import logger from '../../utils/logger';

// ============================================================================
// 공통 타입 정의
// ============================================================================

/**
 * 기본 캐시 항목 구조
 */
export interface BaseCacheEntry<T> {
  /** 캐시된 데이터 */
  data: T;
  /** 캐시 저장 시간 (Unix timestamp ms) */
  cachedAt: number;
  /** TTL (밀리초) */
  ttl: number;
}

/**
 * 메타데이터가 포함된 캐시 항목
 */
export interface CacheEntryWithMeta<T, M = Record<string, unknown>> extends BaseCacheEntry<T> {
  /** 추가 메타데이터 */
  metadata?: M;
}

/**
 * 캐시 조회 옵션
 */
export interface CacheOptions {
  /** TTL (밀리초) */
  ttl?: number;
  /** 강제 새로고침 */
  forceRefresh?: boolean;
}

/**
 * 캐시 결과
 */
export interface CacheResult<T> {
  /** 데이터 */
  data: T;
  /** 캐시에서 가져왔는지 */
  fromCache: boolean;
  /** 캐시 유형 */
  cacheType?: 'memory' | 'disk' | 'network';
}

/**
 * 캐시 통계
 */
export interface CacheStats {
  /** 항목 수 */
  entries: number;
  /** 가장 오래된 항목 시간 (ms) */
  oldestEntry: number | null;
  /** 가장 최근 항목 시간 (ms) */
  newestEntry: number | null;
}

/**
 * 확장된 캐시 통계 (디스크 캐시 포함)
 */
export interface ExtendedCacheStats extends CacheStats {
  /** 메모리 캐시 항목 수 */
  memoryEntries: number;
  /** 디스크 캐시 크기 (바이트) */
  diskSize?: number;
  /** 디스크 캐시 항목 수 */
  diskEntries?: number;
  /** 진행 중인 요청 수 */
  pendingRequests?: number;
}

// ============================================================================
// 유틸리티 함수
// ============================================================================

/**
 * 캐시 유효성 확인
 * @param cachedAt 캐시 저장 시간 (ms)
 * @param ttl TTL (밀리초)
 * @returns 캐시가 유효하면 true
 */
export function isCacheValid(cachedAt: number, ttl: number): boolean {
  const now = Date.now();
  const age = now - cachedAt;
  return age < ttl;
}

/**
 * 캐시 항목이 유효한지 확인
 * @param entry 캐시 항목
 * @returns 캐시가 유효하면 true
 */
export function isCacheEntryValid<T>(entry: BaseCacheEntry<T>): boolean {
  return isCacheValid(entry.cachedAt, entry.ttl);
}

/**
 * 캐시 항목 생성
 * @param data 캐시할 데이터
 * @param ttl TTL (밀리초)
 * @param metadata 추가 메타데이터
 */
export function createCacheEntry<T, M = Record<string, unknown>>(
  data: T,
  ttl: number,
  metadata?: M
): CacheEntryWithMeta<T, M> {
  return {
    data,
    cachedAt: Date.now(),
    ttl,
    metadata,
  };
}

/**
 * Map 기반 캐시에서 만료된 항목 제거
 * @param cache Map 캐시
 * @param ttlOverride 선택적 TTL 오버라이드 (없으면 각 항목의 ttl 사용)
 * @returns 제거된 항목 수
 */
export function pruneExpiredEntries<K, T>(
  cache: Map<K, BaseCacheEntry<T>>,
  ttlOverride?: number
): number {
  let pruned = 0;
  const now = Date.now();

  cache.forEach((entry, key) => {
    const ttl = ttlOverride ?? entry.ttl;
    if (now - entry.cachedAt >= ttl) {
      cache.delete(key);
      pruned++;
    }
  });

  return pruned;
}

/**
 * Map 기반 캐시 통계 계산
 * @param cache Map 캐시
 */
export function calculateCacheStats<K, T>(cache: Map<K, BaseCacheEntry<T>>): CacheStats {
  let oldest: number | null = null;
  let newest: number | null = null;

  cache.forEach((entry) => {
    if (oldest === null || entry.cachedAt < oldest) {
      oldest = entry.cachedAt;
    }
    if (newest === null || entry.cachedAt > newest) {
      newest = entry.cachedAt;
    }
  });

  return {
    entries: cache.size,
    oldestEntry: oldest,
    newestEntry: newest,
  };
}

/**
 * 캐시 키 정규화 (소문자, 하이픈으로 통일)
 * @param key 원본 키
 */
export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/_/g, '-');
}

// ============================================================================
// 중복 요청 방지 헬퍼
// ============================================================================

/**
 * 중복 요청 방지를 위한 pending 요청 관리자 생성
 * @returns pending 요청 관리 함수들
 */
export function createPendingRequestManager<T>() {
  const pendingRequests = new Map<string, Promise<T | null>>();

  return {
    /**
     * 진행 중인 요청이 있는지 확인
     */
    has(key: string): boolean {
      return pendingRequests.has(key);
    },

    /**
     * 진행 중인 요청 가져오기
     */
    get(key: string): Promise<T | null> | undefined {
      return pendingRequests.get(key);
    },

    /**
     * 새 요청 등록
     */
    set(key: string, promise: Promise<T | null>): void {
      pendingRequests.set(key, promise);
    },

    /**
     * 요청 완료 후 삭제
     */
    delete(key: string): void {
      pendingRequests.delete(key);
    },

    /**
     * 모든 pending 요청 초기화
     */
    clear(): void {
      pendingRequests.clear();
    },

    /**
     * pending 요청 수
     */
    get size(): number {
      return pendingRequests.size;
    },

    /**
     * 요청 실행 (중복 방지 포함)
     * @param key 캐시 키
     * @param fetcher 데이터 가져오기 함수
     * @param onComplete 완료 콜백 (성공 시)
     */
    async execute(
      key: string,
      fetcher: () => Promise<T | null>,
      onComplete?: (data: T) => void
    ): Promise<T | null> {
      // 이미 진행 중인 요청이 있으면 대기
      const existing = pendingRequests.get(key);
      if (existing) {
        logger.debug('중복 요청 대기', { key });
        return existing;
      }

      // 새 요청 시작
      const requestPromise = (async (): Promise<T | null> => {
        try {
          const result = await fetcher();
          if (result && onComplete) {
            onComplete(result);
          }
          return result;
        } finally {
          pendingRequests.delete(key);
        }
      })();

      pendingRequests.set(key, requestPromise);
      return requestPromise;
    },
  };
}

// ============================================================================
// 타입 가드
// ============================================================================

/**
 * 캐시 항목인지 확인
 */
export function isBaseCacheEntry<T>(obj: unknown): obj is BaseCacheEntry<T> {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'data' in obj &&
    'cachedAt' in obj &&
    'ttl' in obj &&
    typeof (obj as BaseCacheEntry<T>).cachedAt === 'number' &&
    typeof (obj as BaseCacheEntry<T>).ttl === 'number'
  );
}

// ============================================================================
// 상수
// ============================================================================

/** 기본 메모리 캐시 TTL: 5분 */
export const DEFAULT_MEMORY_TTL_MS = 5 * 60 * 1000;

/** 기본 디스크 캐시 TTL: 1시간 */
export const DEFAULT_DISK_TTL_MS = 60 * 60 * 1000;

/** 긴 디스크 캐시 TTL: 24시간 */
export const LONG_DISK_TTL_MS = 24 * 60 * 60 * 1000;
