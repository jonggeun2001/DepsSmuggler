/**
 * Docker 관련 상수
 */

export const DOCKER_CONSTANTS = {
  /** 카탈로그 캐시 TTL (1시간) */
  CATALOG_CACHE_TTL_MS: 3600000,

  /** 기본 토큰 만료 시간 (5분) */
  DEFAULT_TOKEN_EXPIRY_SEC: 300,

  /** API 타임아웃 (30초) */
  API_TIMEOUT_MS: 30000,

  /** 토큰 갱신 버퍼 - 만료 전 이 시간만큼 미리 갱신 (60초) */
  TOKEN_REFRESH_BUFFER_SEC: 60,

  /** 기본 레지스트리 */
  DEFAULT_REGISTRY: 'docker.io',

  /** Docker Hub API URL */
  HUB_API_URL: 'https://hub.docker.com/v2',

  /** Registry V2 API 경로 */
  REGISTRY_V2_PATH: '/v2',
} as const;

export type DockerConstants = typeof DOCKER_CONSTANTS;
