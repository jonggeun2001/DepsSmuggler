/**
 * pip/PyPI 관련 상수
 */

export const PIP_CONSTANTS = {
  /** API 타임아웃 (30초) */
  API_TIMEOUT_MS: 30000,

  /** 캐시 TTL (10분) */
  CACHE_TTL_MS: 600000,

  /** 최대 캐시 항목 수 */
  MAX_CACHE_ENTRIES: 1000,

  /** PyPI JSON API URL */
  PYPI_API_URL: 'https://pypi.org/pypi',

  /** Simple API URL */
  SIMPLE_API_URL: 'https://pypi.org/simple',
} as const;

export type PipConstants = typeof PIP_CONSTANTS;
