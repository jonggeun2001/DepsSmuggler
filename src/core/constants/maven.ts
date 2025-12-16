/**
 * Maven 관련 상수
 */

export const MAVEN_CONSTANTS = {
  /** 기본 의존성 최대 깊이 */
  DEFAULT_MAX_DEPTH: 20,

  /** API 타임아웃 (30초) */
  API_TIMEOUT_MS: 30000,

  /** HEAD 요청 타임아웃 (5초) - 파일 존재 여부 확인용 */
  HEAD_REQUEST_TIMEOUT_MS: 5000,

  /** 캐시 TTL (10분) */
  CACHE_TTL_MS: 600000,

  /** Maven Central Repository URL */
  CENTRAL_REPO_URL: 'https://repo1.maven.org/maven2',

  /** 기본 scope */
  DEFAULT_SCOPE: 'compile',

  /** POM 파일 기본 패키징 */
  DEFAULT_PACKAGING: 'jar',
} as const;

export type MavenConstants = typeof MAVEN_CONSTANTS;
