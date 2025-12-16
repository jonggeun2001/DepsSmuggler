/**
 * 다운로드 관련 상수
 */

export const DOWNLOAD_CONSTANTS = {
  /** 기본 동시 다운로드 수 */
  DEFAULT_CONCURRENT_DOWNLOADS: 3,

  /** 속도 샘플 크기 */
  SPEED_SAMPLE_SIZE: 10,

  /** 최대 재시도 횟수 */
  MAX_RETRIES: 3,

  /** 재시도 지연 시간 (1초) */
  RETRY_DELAY_MS: 1000,

  /** 속도 샘플 업데이트 간격 (ms) */
  SPEED_SAMPLE_INTERVAL_MS: 500,

  /** 기본 청크 크기 (64KB) */
  DEFAULT_CHUNK_SIZE: 65536,
} as const;

export type DownloadConstants = typeof DOWNLOAD_CONSTANTS;
