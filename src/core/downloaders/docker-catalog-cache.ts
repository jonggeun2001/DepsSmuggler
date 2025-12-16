import axios from 'axios';
import logger from '../../utils/logger';
import { DockerAuthClient } from './docker-auth-client';
import { DOCKER_CONSTANTS } from '../constants/docker';

/**
 * 카탈로그 캐시 데이터 인터페이스
 */
interface CatalogCacheEntry {
  registry: string;
  repositories: string[];
  fetchedAt: number;
  expiresAt: number;
}

/**
 * 카탈로그 캐시 상태 정보
 */
export interface CatalogCacheStatus {
  registry: string;
  repositoryCount: number;
  fetchedAt: number;
  expiresAt: number;
  isExpired: boolean;
}

/**
 * 기본 캐시 TTL (1시간) - 하위 호환성을 위해 유지
 * @deprecated DOCKER_CONSTANTS.CATALOG_CACHE_TTL_MS 사용 권장
 */
export const DEFAULT_CATALOG_CACHE_TTL = DOCKER_CONSTANTS.CATALOG_CACHE_TTL_MS;

/**
 * Docker Registry 카탈로그 캐시 관리자
 * 레지스트리의 저장소 목록을 캐싱합니다.
 */
export class DockerCatalogCache {
  private catalogCache: Map<string, CatalogCacheEntry> = new Map();
  private catalogCacheTTL: number = DEFAULT_CATALOG_CACHE_TTL;
  private authClient: DockerAuthClient;

  constructor(authClient: DockerAuthClient) {
    this.authClient = authClient;
  }

  /**
   * 캐시된 카탈로그 조회 (캐시 미스 시 API 호출)
   */
  async getCachedCatalog(registry: string): Promise<string[]> {
    const cached = this.catalogCache.get(registry);

    // 캐시가 유효한 경우 반환
    if (cached && cached.expiresAt > Date.now()) {
      logger.info(`카탈로그 캐시 히트: ${registry} (${cached.repositories.length}개 저장소)`);
      return cached.repositories;
    }

    // 캐시 미스 또는 만료 - API 호출 후 캐싱
    try {
      const repositories = await this.fetchCatalog(registry);
      const now = Date.now();

      this.catalogCache.set(registry, {
        registry,
        repositories,
        fetchedAt: now,
        expiresAt: now + this.catalogCacheTTL,
      });

      logger.info(
        `카탈로그 캐시 저장: ${registry} (${repositories.length}개 저장소, TTL: ${this.catalogCacheTTL / 1000}초)`
      );
      return repositories;
    } catch (error) {
      // 네트워크 오류 시 만료된 캐시라도 사용 (graceful degradation)
      if (cached) {
        logger.warn(`카탈로그 조회 실패, 만료된 캐시 사용: ${registry}`, { error });
        return cached.repositories;
      }
      logger.error(`레지스트리 ${registry}에서 카탈로그 조회 실패`, { error });
      return [];
    }
  }

  /**
   * 카탈로그 API 호출
   */
  private async fetchCatalog(registry: string): Promise<string[]> {
    const config = this.authClient.getRegistryConfig(registry);
    const token = await this.authClient.getTokenForRegistry(registry, '');

    const response = await axios.get(`${config.registryUrl}/_catalog`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { n: 1000 }, // 최대 1000개 저장소 조회
      timeout: DOCKER_CONSTANTS.API_TIMEOUT_MS,
    });

    return response.data.repositories || [];
  }

  /**
   * 카탈로그 캐시 강제 갱신
   */
  async refreshCatalogCache(registry: string): Promise<string[]> {
    // 기존 캐시 삭제
    this.catalogCache.delete(registry);
    // 새로 조회
    return this.getCachedCatalog(registry);
  }

  /**
   * 모든 카탈로그 캐시 삭제
   */
  clearCatalogCache(): void {
    this.catalogCache.clear();
    logger.info('모든 카탈로그 캐시 삭제됨');
  }

  /**
   * 카탈로그 캐시 TTL 설정
   */
  setCatalogCacheTTL(ttlMs: number): void {
    this.catalogCacheTTL = ttlMs;
    logger.info(`카탈로그 캐시 TTL 설정: ${ttlMs / 1000}초`);
  }

  /**
   * 카탈로그 캐시 TTL 조회
   */
  getCatalogCacheTTL(): number {
    return this.catalogCacheTTL;
  }

  /**
   * 카탈로그 캐시 상태 조회
   */
  getCatalogCacheStatus(): CatalogCacheStatus[] {
    const now = Date.now();
    const status: CatalogCacheStatus[] = [];

    this.catalogCache.forEach((cache) => {
      status.push({
        registry: cache.registry,
        repositoryCount: cache.repositories.length,
        fetchedAt: cache.fetchedAt,
        expiresAt: cache.expiresAt,
        isExpired: cache.expiresAt <= now,
      });
    });

    return status;
  }
}
