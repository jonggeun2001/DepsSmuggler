import type { QueryErrorCode, QueryFailure } from '../types/query-error';

const messages: Record<QueryErrorCode, string> = {
  TLS_CERTIFICATE:
    '서버 인증서를 신뢰할 수 없습니다. 회사망에서는 IT에서 제공한 CA를 설정의 추가 루트 CA 인증서에 등록한 뒤 앱을 재시작하세요.',
  TIMEOUT: '서버 응답 시간이 초과되었습니다. 잠시 후 다시 시도하세요.',
  HTTP: '패키지 서버가 요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.',
  NETWORK: '패키지 서버에 연결하지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도하세요.',
  INVALID_RESPONSE: '패키지 서버의 응답을 읽을 수 없습니다. 잠시 후 다시 시도하세요.',
  UNAVAILABLE:
    '현재 환경에서는 이 검색 기능에 연결할 수 없습니다. 데스크톱 앱에서 다시 시도하세요.',
  UNKNOWN: '요청을 처리하지 못했습니다. 다시 시도하고 문제가 계속되면 오류 로그를 확인하세요.',
};

export class QueryRequestError extends Error {
  readonly failure: QueryFailure;
  constructor(code: QueryErrorCode, status?: number) {
    const safeCode = Object.prototype.hasOwnProperty.call(messages, code) ? code : 'UNKNOWN';
    const safeStatus =
      typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599
        ? status
        : undefined;
    const message = messages[safeCode] + (safeStatus ? ` (HTTP ${safeStatus})` : '');
    super(message);
    this.name = 'QueryRequestError';
    this.failure = { code: safeCode, message, ...(safeStatus ? { status: safeStatus } : {}) };
  }
}

/** Classify known transport failures without exposing URLs, credentials, paths or stack traces. */
export function toQueryFailure(error: unknown): QueryFailure {
  if (error instanceof QueryRequestError) return error.failure;
  let current: unknown = error;
  const details: string[] = [];
  let status: number | undefined;
  for (let depth = 0; current && depth < 5; depth++) {
    if (typeof current === 'string') {
      details.push(current);
      break;
    }
    if (typeof current !== 'object') break;
    const value = current as {
      code?: unknown;
      name?: unknown;
      message?: unknown;
      cause?: unknown;
      response?: { status?: unknown };
      status?: unknown;
    };
    details.push(
      ...[value.code, value.name, value.message].filter(
        (part): part is string => typeof part === 'string'
      )
    );
    const candidate = value.response?.status ?? value.status;
    if (typeof candidate === 'number' && candidate >= 400 && candidate <= 599) status = candidate;
    current = value.cause;
  }
  const text = details.join(' ');
  let code: QueryErrorCode = 'UNKNOWN';
  if (
    /SELF_SIGNED_CERT|CERT_HAS_EXPIRED|CERT_NOT_YET_VALID|UNABLE_TO_(?:VERIFY|GET_ISSUER)|ERR_TLS_CERT|self.signed certificate|certificate.*(?:chain|expired)/i.test(
      text
    )
  )
    code = 'TLS_CERTIFICATE';
  else if (
    /ETIMEDOUT|ECONNABORTED|TimeoutError|AbortError|timed?\s*out|timeout|시간.*초과/i.test(text)
  )
    code = 'TIMEOUT';
  else if (status || /status code [45]\d\d/i.test(text)) {
    code = 'HTTP';
    status ??= Number(text.match(/status code ([45]\d\d)/i)?.[1]);
  } else if (
    /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENETUNREACH|EHOSTUNREACH|ERR_NETWORK|network\s*(?:error|request)|fetch failed|failed to fetch|socket hang up/i.test(
      text
    )
  )
    code = 'NETWORK';
  else if (/SyntaxError|TypeError|Unexpected token|JSON|Invalid .*API response/i.test(text))
    code = 'INVALID_RESPONSE';
  return new QueryRequestError(code, status).failure;
}
