/**
 * 제네릭 캐시 매니저
 * pip, npm, maven, conda 등에서 공통으로 사용되는 캐싱 로직을 통합
 */

import * as fs from 'fs';
import * as path from 'path';
import logger from '../../utils/logger';

// ============================================================================
// 타입 정의
// ============================================================================

/**
 * 캐시 항목
 */
export interface CacheEntry<T> {
  /** 캐시된 데이터 */
  data: T;
  /** 캐시 저장 시간 (Unix timestamp ms) */
  cachedAt: number;
}

/**
 * 캐시 옵션
 */
export interface CacheManagerOptions<T> {
  /** 캐시 이름 (로깅용) */
  name: string;
  /** TTL (밀리초) */
  ttlMs: number;
  /** 최대 항목 수 (선택적, 초과 시 LRU 방식으로 제거) */
  maxSize?: number;
  /** 디스크 캐시 경로 (설정 시 디스크 캐시 활성화) */
  diskCachePath?: string;
  /** 디스크 캐시 TTL (밀리초, 기본값: ttlMs) */
  diskTtlMs?: number;
  /** 직렬화 함수 (디스크 캐시용) */
  serialize?: (value: T) => string;
  /** 역직렬화 함수 (디스크 캐시용) */
  deserialize?: (data: string) => T;
}

/**
 * 캐시 통계
 */
export interface CacheManagerStats {
  /** 캐시 이름 */
  name: string;
  /** 메모리 캐시 항목 수 */
  memoryEntries: number;
  /** 캐시 히트 수 */
  hits: number;
  /** 캐시 미스 수 */
  misses: number;
  /** 만료로 제거된 항목 수 */
  evictions: number;
  /** 가장 오래된 항목 시간 */
  oldestEntry: number | null;
  /** 가장 최근 항목 시간 */
  newestEntry: number | null;
  /** 진행 중인 요청 수 */
  pendingRequests: number;
}

/**
 * 캐시 결과
 */
export interface CacheGetResult<T> {
  /** 데이터 */
  data: T;
  /** 캐시에서 가져왔는지 */
  fromCache: boolean;
  /** 캐시 유형 */
  cacheType: 'memory' | 'disk' | 'network';
}

// ============================================================================
// CacheManager 클래스
// ============================================================================

/**
 * 제네릭 캐시 매니저 클래스
 * 메모리 캐시 + 선택적 디스크 캐시 + 중복 요청 방지
 */
export class CacheManager<T> {
  private readonly name: string;
  private readonly ttlMs: number;
  private readonly maxSize?: number;
  private readonly diskCachePath?: string;
  private readonly diskTtlMs: number;
  private readonly serialize: (value: T) => string;
  private readonly deserialize: (data: string) => T;

  /** 메모리 캐시 */
  private cache: Map<string, CacheEntry<T>> = new Map();

  /** 진행 중인 요청 (중복 요청 방지) */
  private pendingRequests: Map<string, Promise<T | null>> = new Map();

  /** 통계 */
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
  };

  constructor(options: CacheManagerOptions<T>) {
    this.name = options.name;
    this.ttlMs = options.ttlMs;
    this.maxSize = options.maxSize;
    this.diskCachePath = options.diskCachePath;
    this.diskTtlMs = options.diskTtlMs ?? options.ttlMs;
    this.serialize = options.serialize ?? JSON.stringify;
    this.deserialize = options.deserialize ?? JSON.parse;
  }

  // ========== 기본 캐시 연산 ==========

  /**
   * 캐시에서 값 가져오기
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (entry && this.isValid(entry)) {
      this.stats.hits++;
      return entry.data;
    }

    // 만료된 항목 삭제
    if (entry) {
      this.cache.delete(key);
      this.stats.evictions++;
    }

    this.stats.misses++;
    return undefined;
  }

  /**
   * 캐시에 값 저장
   */
  set(key: string, value: T): void {
    // maxSize 제한 체크
    if (this.maxSize && this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    const entry: CacheEntry<T> = {
      data: value,
      cachedAt: Date.now(),
    };
    this.cache.set(key, entry);

    // 디스크 캐시에도 저장
    if (this.diskCachePath) {
      this.writeToDisk(key, entry);
    }
  }

  /**
   * 캐시에 키가 있는지 확인
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (entry && this.isValid(entry)) {
      return true;
    }
    return false;
  }

  /**
   * 캐시에서 항목 삭제
   */
  delete(key: string): boolean {
    const deleted = this.cache.delete(key);

    // 디스크 캐시에서도 삭제
    if (this.diskCachePath) {
      this.deleteFromDisk(key);
    }

    return deleted;
  }

  /**
   * 캐시 전체 초기화
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.pendingRequests.clear();

    // 디스크 캐시도 초기화
    if (this.diskCachePath) {
      this.clearDisk();
    }

    logger.info(`${this.name} 캐시 초기화`, { clearedEntries: size });
  }

  /**
   * 캐시 항목 수
   */
  get size(): number {
    return this.cache.size;
  }

  // ========== 디스크 캐시 연산 ==========

  /**
   * 디스크 캐시에서 읽기
   */
  getFromDisk(key: string): T | undefined {
    if (!this.diskCachePath) return undefined;

    const filePath = this.getDiskPath(key);
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const entry = JSON.parse(content) as CacheEntry<string>;

        if (this.isDiskEntryValid(entry)) {
          const data = this.deserialize(entry.data);

          // 메모리 캐시에도 저장
          this.cache.set(key, { data, cachedAt: entry.cachedAt });

          this.stats.hits++;
          return data;
        } else {
          // 만료된 항목 삭제
          fs.unlinkSync(filePath);
        }
      }
    } catch (error) {
      logger.debug(`${this.name} 디스크 캐시 읽기 실패`, { key, error });
    }

    return undefined;
  }

  /**
   * 디스크에 저장
   */
  private writeToDisk(key: string, entry: CacheEntry<T>): void {
    if (!this.diskCachePath) return;

    const filePath = this.getDiskPath(key);
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const diskEntry: CacheEntry<string> = {
        data: this.serialize(entry.data),
        cachedAt: entry.cachedAt,
      };
      fs.writeFileSync(filePath, JSON.stringify(diskEntry));
    } catch (error) {
      logger.debug(`${this.name} 디스크 캐시 저장 실패`, { key, error });
    }
  }

  /**
   * 디스크에서 삭제
   */
  private deleteFromDisk(key: string): void {
    if (!this.diskCachePath) return;

    const filePath = this.getDiskPath(key);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      logger.debug(`${this.name} 디스크 캐시 삭제 실패`, { key, error });
    }
  }

  /**
   * 디스크 캐시 전체 삭제
   */
  private clearDisk(): void {
    if (!this.diskCachePath) return;

    try {
      if (fs.existsSync(this.diskCachePath)) {
        fs.rmSync(this.diskCachePath, { recursive: true });
        logger.info(`${this.name} 디스크 캐시 초기화`, { path: this.diskCachePath });
      }
    } catch (error) {
      logger.error(`${this.name} 디스크 캐시 초기화 실패`, { error });
    }
  }

  /**
   * 디스크 캐시 파일 경로 생성
   */
  private getDiskPath(key: string): string {
    // 키를 안전한 파일명으로 변환
    const safeKey = key.replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(this.diskCachePath!, `${safeKey}.json`);
  }

  // ========== 중복 요청 방지 ==========

  /**
   * 캐시에서 가져오거나 fetch 실행
   * 중복 요청 자동 방지
   */
  async getOrFetch(
    key: string,
    fetcher: () => Promise<T>,
    options: { forceRefresh?: boolean } = {}
  ): Promise<CacheGetResult<T>> {
    const { forceRefresh = false } = options;

    // 1. 메모리 캐시 확인
    if (!forceRefresh) {
      const cached = this.get(key);
      if (cached !== undefined) {
        logger.debug(`${this.name} 메모리 캐시 히트`, { key });
        return { data: cached, fromCache: true, cacheType: 'memory' };
      }

      // 2. 디스크 캐시 확인
      if (this.diskCachePath) {
        const diskCached = this.getFromDisk(key);
        if (diskCached !== undefined) {
          logger.debug(`${this.name} 디스크 캐시 히트`, { key });
          return { data: diskCached, fromCache: true, cacheType: 'disk' };
        }
      }
    }

    // 3. 진행 중인 요청 확인
    const pendingEntry = this.pendingRequests.get(key);
    if (pendingEntry) {
      logger.debug(`${this.name} 중복 요청 대기`, { key });
      const result = await pendingEntry;
      if (result !== null) {
        return { data: result, fromCache: true, cacheType: 'memory' };
      }
      throw new Error(`${this.name}: Failed to fetch ${key}`);
    }

    // 4. 새 요청 실행 (원본 에러 전파)
    let fetchError: Error | null = null;
    const requestPromise = (async (): Promise<T | null> => {
      try {
        logger.debug(`${this.name} 데이터 요청`, { key });
        const data = await fetcher();
        this.set(key, data);
        return data;
      } catch (error) {
        fetchError = error as Error;
        logger.warn(`${this.name} 데이터 요청 실패`, { key, error });
        return null;
      } finally {
        this.pendingRequests.delete(key);
      }
    })();

    this.pendingRequests.set(key, requestPromise);
    const result = await requestPromise;

    if (result !== null) {
      return { data: result, fromCache: false, cacheType: 'network' };
    }

    // 원본 에러가 있으면 그대로 전파
    if (fetchError) {
      throw fetchError;
    }
    throw new Error(`${this.name}: Failed to fetch ${key}`);
  }

  /**
   * 중복 요청 방지 fetch만 수행 (캐시 확인 없음)
   */
  async dedupeFetch(key: string, fetcher: () => Promise<T | null>): Promise<T | null> {
    const pending = this.pendingRequests.get(key);
    if (pending) {
      return pending;
    }

    const requestPromise = (async (): Promise<T | null> => {
      try {
        const result = await fetcher();
        if (result !== null) {
          this.set(key, result);
        }
        return result;
      } finally {
        this.pendingRequests.delete(key);
      }
    })();

    this.pendingRequests.set(key, requestPromise);
    return requestPromise;
  }

  // ========== 유틸리티 ==========

  /**
   * 만료된 캐시 정리
   */
  prune(): number {
    let pruned = 0;
    const now = Date.now();

    this.cache.forEach((entry, key) => {
      if (now - entry.cachedAt >= this.ttlMs) {
        this.cache.delete(key);
        pruned++;
      }
    });

    // 디스크 캐시도 정리
    if (this.diskCachePath) {
      pruned += this.pruneDisk();
    }

    if (pruned > 0) {
      logger.info(`${this.name} 만료된 캐시 정리`, { pruned });
      this.stats.evictions += pruned;
    }

    return pruned;
  }

  /**
   * 디스크 캐시 정리
   */
  private pruneDisk(): number {
    if (!this.diskCachePath || !fs.existsSync(this.diskCachePath)) {
      return 0;
    }

    let pruned = 0;
    try {
      const files = fs.readdirSync(this.diskCachePath);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = path.join(this.diskCachePath, file);
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const entry = JSON.parse(content) as CacheEntry<string>;

          if (!this.isDiskEntryValid(entry)) {
            fs.unlinkSync(filePath);
            pruned++;
          }
        } catch {
          // 파싱 실패한 파일 삭제
          fs.unlinkSync(filePath);
          pruned++;
        }
      }
    } catch (error) {
      logger.debug(`${this.name} 디스크 캐시 정리 실패`, { error });
    }

    return pruned;
  }

  /**
   * 가장 오래된 항목 제거 (LRU)
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    this.cache.forEach((entry, key) => {
      if (entry.cachedAt < oldestTime) {
        oldestTime = entry.cachedAt;
        oldestKey = key;
      }
    });

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.evictions++;
    }
  }

  /**
   * 메모리 캐시 항목 유효성 검사
   */
  private isValid(entry: CacheEntry<T>): boolean {
    return Date.now() - entry.cachedAt < this.ttlMs;
  }

  /**
   * 디스크 캐시 항목 유효성 검사
   */
  private isDiskEntryValid(entry: CacheEntry<string>): boolean {
    return Date.now() - entry.cachedAt < this.diskTtlMs;
  }

  /**
   * 캐시 통계 조회
   */
  getStats(): CacheManagerStats {
    let oldest: number | null = null;
    let newest: number | null = null;

    this.cache.forEach((entry) => {
      if (oldest === null || entry.cachedAt < oldest) {
        oldest = entry.cachedAt;
      }
      if (newest === null || entry.cachedAt > newest) {
        newest = entry.cachedAt;
      }
    });

    return {
      name: this.name,
      memoryEntries: this.cache.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      evictions: this.stats.evictions,
      oldestEntry: oldest,
      newestEntry: newest,
      pendingRequests: this.pendingRequests.size,
    };
  }

  /**
   * 모든 키 순회
   */
  keys(): IterableIterator<string> {
    return this.cache.keys();
  }

  /**
   * 모든 값 순회 (유효한 항목만)
   */
  *values(): IterableIterator<T> {
    for (const [, entry] of this.cache) {
      if (this.isValid(entry)) {
        yield entry.data;
      }
    }
  }

  /**
   * forEach
   */
  forEach(callback: (value: T, key: string) => void): void {
    this.cache.forEach((entry, key) => {
      if (this.isValid(entry)) {
        callback(entry.data, key);
      }
    });
  }
}

// ============================================================================
// 팩토리 함수
// ============================================================================

/**
 * 메모리 전용 캐시 매니저 생성
 */
export function createMemoryCache<T>(
  name: string,
  ttlMs: number,
  maxSize?: number
): CacheManager<T> {
  return new CacheManager<T>({
    name,
    ttlMs,
    maxSize,
  });
}

/**
 * 메모리 + 디스크 캐시 매니저 생성
 */
export function createDiskCache<T>(
  name: string,
  ttlMs: number,
  diskCachePath: string,
  options: {
    diskTtlMs?: number;
    maxSize?: number;
    serialize?: (value: T) => string;
    deserialize?: (data: string) => T;
  } = {}
): CacheManager<T> {
  return new CacheManager<T>({
    name,
    ttlMs,
    diskCachePath,
    ...options,
  });
}
