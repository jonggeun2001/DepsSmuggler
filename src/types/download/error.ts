export type DownloadErrorCode =
  | 'network'
  | 'checksum'
  | 'verification'
  | 'cancelled'
  | 'unknown';

export interface DownloadError {
  code: DownloadErrorCode;
  message: string;
  packageId?: string;
  retryable?: boolean;
  cause?: unknown;
}
