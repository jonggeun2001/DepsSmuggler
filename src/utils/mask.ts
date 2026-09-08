/**
 * 민감 정보 마스킹 유틸리티 (CWE-532 대응)
 * 로그에 출력되는 민감 정보를 마스킹하여 보안 강화
 */

// 마스킹 대상 필드명 패턴 (대소문자 무시)
const SENSITIVE_FIELD_PATTERNS = [
  // 인증 관련
  'password',
  'passwd',
  'pass',
  'pwd',
  'secret',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'apikey',
  'api_key',
  'apitoken',
  'api_token',
  // 'auth'는 제외 - 보통 중첩 객체이며 내부에 user, pass 등 포함
  'authorization', // HTTP Authorization 헤더 값
  'credential',
  'credentials',
  'bearer',
  // 개인 정보
  'ssn',
  'social',
  'creditcard',
  'credit_card',
  'cardnumber',
  'card_number',
  'cvv',
  'cvc',
  'pin',
  // 암호화 관련
  'privatekey',
  'private_key',
  'secretkey',
  'secret_key',
  'encryptionkey',
  'encryption_key',
  // 기타
  'session',
  'sessionid',
  'session_id',
  'cookie',
];

// 민감 필드 패턴 정규식 (키 이름 매칭용)
const SENSITIVE_KEY_REGEX = new RegExp(
  `^(${SENSITIVE_FIELD_PATTERNS.join('|')})$`,
  'i'
);

// URL 내 민감 정보 패턴 (쿼리 파라미터)
const URL_SENSITIVE_PARAM_REGEX = new RegExp(
  `([?&])(${SENSITIVE_FIELD_PATTERNS.join('|')})=([^&\\s]+)`,
  'gi'
);

// 일반 텍스트에서 key=value 패턴의 민감 정보
const KEY_VALUE_SENSITIVE_REGEX = new RegExp(
  `\\b(${SENSITIVE_FIELD_PATTERNS.join('|')})=([^\\s&]+)`,
  'gi'
);

// Bearer 토큰 패턴
const BEARER_TOKEN_REGEX = /Bearer\s+[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]*/gi;

// 기본 API 키 패턴 (일반적인 형태)
const API_KEY_REGEX = /\b[A-Za-z0-9]{32,}\b/g;

// 마스킹 문자열
const MASK = '***MASKED***';

/**
 * 문자열 내 민감 정보를 마스킹합니다.
 */
export function maskString(input: string): string {
  if (typeof input !== 'string') {
    return input;
  }

  let result = input;

  // Bearer 토큰 마스킹
  result = result.replace(BEARER_TOKEN_REGEX, `Bearer ${MASK}`);

  // URL 내 민감 파라미터 마스킹
  result = result.replace(URL_SENSITIVE_PARAM_REGEX, `$1$2=${MASK}`);

  // 일반 텍스트 내 key=value 패턴 민감 정보 마스킹
  result = result.replace(KEY_VALUE_SENSITIVE_REGEX, `$1=${MASK}`);

  return result;
}

/**
 * 키 이름이 민감한 필드인지 확인합니다.
 */
export function isSensitiveKey(key: string): boolean {
  if (typeof key !== 'string') {
    return false;
  }
  return SENSITIVE_KEY_REGEX.test(key);
}

/**
 * 객체 내 민감 정보를 재귀적으로 마스킹합니다.
 */
export function maskObject(obj: unknown, depth: number = 0): unknown {
  try {
    return maskObjectValue(obj, depth);
  } catch {
    // 오류 객체의 getter/proxy도 실패할 수 있다. 로그 처리 중 원본을 노출하거나 재실패하지 않는다.
    return '[UNREADABLE]';
  }
}

function maskObjectValue(obj: unknown, depth: number): unknown {
  // 순환 참조 방지를 위한 깊이 제한
  const MAX_DEPTH = 10;
  if (depth > MAX_DEPTH) {
    return '[MAX_DEPTH_EXCEEDED]';
  }

  // null 또는 undefined
  if (obj === null || obj === undefined) {
    return obj;
  }

  // 문자열
  if (typeof obj === 'string') {
    return maskString(obj);
  }

  // 숫자, 불리언
  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return obj;
  }
  if (typeof obj === 'bigint') return obj.toString();

  // 배열
  if (Array.isArray(obj)) {
    return obj.map(item => maskObject(item, depth + 1));
  }

  // Date
  if (obj instanceof Date) {
    return obj;
  }

  // Error 객체
  if (obj instanceof Error) {
    return {
      name: obj.name,
      message: maskString(obj.message),
      stack: obj.stack ? maskString(obj.stack) : undefined,
    };
  }

  // 일반 객체
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};

    for (const key of Object.keys(obj)) {
      let value: unknown;
      if (isSensitiveKey(key)) {
        // 민감한 키의 값은 완전히 마스킹
        value = MASK;
      } else {
        try {
          value = maskObject((obj as Record<string, unknown>)[key], depth + 1);
        } catch {
          value = '[UNREADABLE]';
        }
      }
      Object.defineProperty(result, key, { value, enumerable: true, configurable: true, writable: true });
    }

    return result;
  }

  // 기타 타입은 그대로 반환
  return obj;
}

/**
 * 로그 인자들을 마스킹합니다.
 * 로거에서 사용하기 위한 메인 함수입니다.
 */
export function maskSensitiveData(...args: unknown[]): unknown[] {
  return args.map(arg => maskObject(arg));
}

/**
 * 단일 값의 민감 정보를 마스킹합니다.
 */
export function mask(value: unknown): unknown {
  return maskObject(value);
}

/**
 * 민감 필드 패턴을 추가합니다.
 * 애플리케이션 특정 필드를 추가할 때 사용합니다.
 */
export function addSensitivePattern(pattern: string): void {
  if (!SENSITIVE_FIELD_PATTERNS.includes(pattern.toLowerCase())) {
    SENSITIVE_FIELD_PATTERNS.push(pattern.toLowerCase());
    // 정규식 재생성
    (SENSITIVE_KEY_REGEX as RegExp).compile(
      `^(${SENSITIVE_FIELD_PATTERNS.join('|')})$`,
      'i'
    );
  }
}

/**
 * 현재 등록된 민감 필드 패턴 목록을 반환합니다.
 */
export function getSensitivePatterns(): readonly string[] {
  return [...SENSITIVE_FIELD_PATTERNS];
}
