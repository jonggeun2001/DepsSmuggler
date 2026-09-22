export type QueryErrorCode =
  | 'TLS_CERTIFICATE'
  | 'TIMEOUT'
  | 'HTTP'
  | 'NETWORK'
  | 'INVALID_RESPONSE'
  | 'UNAVAILABLE'
  | 'UNKNOWN';

/** Plain data that survives Electron IPC serialization. */
export interface QueryFailure {
  code: QueryErrorCode;
  message: string;
  status?: number;
}
