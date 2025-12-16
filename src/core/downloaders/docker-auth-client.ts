import logger from '../../utils/logger';
import {
  RegistryConfig,
  REGISTRY_CONFIGS,
  getRegistryType,
  createCustomRegistryConfig,
} from './docker-utils';
import { AuthStrategyRegistry, defaultAuthStrategyRegistry } from './docker-auth-strategies';
import { DOCKER_CONSTANTS } from '../constants/docker';

/**
 * 캐시된 토큰 정보
 */
interface CachedToken {
  token: string;
  expires: number;
}

/**
 * Docker Registry 인증 클라이언트
 * 토큰 획득 및 캐싱을 담당합니다.
 *
 * Strategy Pattern을 사용하여 각 레지스트리별 인증 로직 처리
 */
export class DockerAuthClient {
  private tokenCache: Map<string, CachedToken> = new Map();
  private registryConfigCache: Map<string, RegistryConfig> = new Map();
  private strategyRegistry: AuthStrategyRegistry;

  constructor(strategyRegistry?: AuthStrategyRegistry) {
    this.strategyRegistry = strategyRegistry || defaultAuthStrategyRegistry;
  }

  /**
   * 레지스트리 설정 가져오기
   */
  getRegistryConfig(registry: string): RegistryConfig {
    // 캐시 확인
    const cached = this.registryConfigCache.get(registry);
    if (cached) {
      return cached;
    }

    // 알려진 레지스트리 설정 확인
    const registryType = getRegistryType(registry);
    const config =
      registryType !== 'custom'
        ? REGISTRY_CONFIGS[registryType]
        : createCustomRegistryConfig(registry);

    // 캐시에 저장
    this.registryConfigCache.set(registry, config);
    return config;
  }

  /**
   * Docker Hub용 토큰 획득 (편의 메서드)
   */
  async getToken(repository: string): Promise<string> {
    return this.getTokenForRegistry('docker.io', repository);
  }

  /**
   * 레지스트리별 토큰 획득
   *
   * Strategy Pattern을 사용하여 레지스트리 타입에 맞는 인증 전략 선택
   */
  async getTokenForRegistry(registry: string, repository: string): Promise<string> {
    const cacheKey = `${registry}:${repository}`;
    const cached = this.tokenCache.get(cacheKey);

    if (cached && cached.expires > Date.now()) {
      return cached.token;
    }

    const config = this.getRegistryConfig(registry);
    const registryType = getRegistryType(registry);

    try {
      // Strategy Pattern: 레지스트리 타입에 맞는 전략 선택 및 실행
      const strategy = this.strategyRegistry.getStrategy(registryType);
      const result = await strategy.getToken(config, repository);

      const expires = Date.now() + (result.expiresIn - DOCKER_CONSTANTS.TOKEN_REFRESH_BUFFER_SEC) * 1000;
      this.tokenCache.set(cacheKey, { token: result.token, expires });

      return result.token;
    } catch (error) {
      logger.error('Docker 토큰 획득 실패', { registry, repository, error });
      throw error;
    }
  }

  /**
   * 토큰 캐시 초기화
   */
  clearTokenCache(): void {
    this.tokenCache.clear();
  }

  /**
   * 특정 레지스트리의 토큰 캐시 삭제
   */
  clearTokenCacheForRegistry(registry: string): void {
    for (const key of this.tokenCache.keys()) {
      if (key.startsWith(`${registry}:`)) {
        this.tokenCache.delete(key);
      }
    }
  }

  /**
   * 전략 레지스트리 반환 (테스트용)
   */
  getStrategyRegistry(): AuthStrategyRegistry {
    return this.strategyRegistry;
  }
}
