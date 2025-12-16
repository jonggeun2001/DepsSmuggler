/**
 * npm 관련 상수
 */

export const NPM_CONSTANTS = {
  /** 최대 재시도 횟수 */
  MAX_RETRIES: 3,

  /** API 타임아웃 (30초) */
  API_TIMEOUT_MS: 30000,

  /** 다운로드 타임아웃 (5분) */
  DOWNLOAD_TIMEOUT_MS: 300000,

  /** 기본 의존성 최대 깊이 */
  DEFAULT_MAX_DEPTH: 50,

  /** 기본 레지스트리 URL */
  DEFAULT_REGISTRY_URL: 'https://registry.npmjs.org',

  /** 기본 검색 URL */
  DEFAULT_SEARCH_URL: 'https://registry.npmjs.org/-/v1/search',

  /** 검색 결과 기본 크기 */
  DEFAULT_SEARCH_SIZE: 20,
} as const;

export type NpmConstants = typeof NPM_CONSTANTS;
