/**
 * Windows 호환 파일명 처리 유틸리티
 * Windows에서 허용되지 않는 파일명 특수문자와 예약어를 안전하게 처리합니다.
 */

/**
 * Windows에서 금지된 파일명 문자
 * < > : " / \ | ? * 및 제어 문자 (0x00-0x1F)
 */
const WINDOWS_FORBIDDEN_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;

/**
 * Windows 예약 파일명
 * 이 이름들은 확장자가 있어도 파일명으로 사용할 수 없음
 */
const WINDOWS_RESERVED_NAMES = [
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
];

/**
 * 파일명을 Windows와 Unix 모두에서 안전하게 사용할 수 있도록 변환
 *
 * @param name 원본 파일명
 * @param maxLength 최대 길이 (기본값: 200)
 * @returns 안전한 파일명
 *
 * @example
 * sanitizeFilename('file<>:name') // 'file___name'
 * sanitizeFilename('CON') // '_CON'
 * sanitizeFilename('@types/node') // '_types_node'
 */
export function sanitizeFilename(name: string, maxLength = 200): string {
  if (!name) {
    return '_empty_';
  }

  let safe = name
    // Windows 금지 문자를 언더스코어로 변환
    .replace(WINDOWS_FORBIDDEN_CHARS, '_')
    // 연속된 언더스코어를 하나로
    .replace(/_{2,}/g, '_')
    // 앞뒤 언더스코어 제거
    .replace(/^_+|_+$/g, '');

  // 빈 문자열이 되면 기본값 반환
  if (!safe) {
    safe = '_unnamed_';
  }

  // Windows 예약어 처리 (대소문자 무시, 확장자 무시)
  const baseName = safe.replace(/\.[^.]*$/, '').toUpperCase();
  if (WINDOWS_RESERVED_NAMES.includes(baseName)) {
    safe = `_${safe}`;
  }

  // Windows에서 파일명은 마침표나 공백으로 끝날 수 없음
  safe = safe.replace(/[. ]+$/, '');

  // 빈 문자열이 되면 기본값 반환
  if (!safe) {
    safe = '_unnamed_';
  }

  // 최대 길이 제한
  if (safe.length > maxLength) {
    // 확장자가 있으면 보존
    const extMatch = safe.match(/\.[^.]+$/);
    if (extMatch) {
      const ext = extMatch[0];
      const nameWithoutExt = safe.slice(0, safe.length - ext.length);
      const maxNameLength = maxLength - ext.length;
      safe = nameWithoutExt.slice(0, maxNameLength) + ext;
    } else {
      safe = safe.slice(0, maxLength);
    }
  }

  return safe;
}

/**
 * 캐시 키로 사용할 안전한 파일명 생성
 * 더 엄격한 규칙 적용 (알파벳, 숫자, 점, 대시, 언더스코어만 허용)
 *
 * @param name 원본 이름
 * @param maxLength 최대 길이 (기본값: 100)
 * @returns 캐시 키용 안전한 파일명
 */
export function sanitizeCacheKey(name: string, maxLength = 100): string {
  if (!name) {
    return '_empty_';
  }

  let safe = name
    // 허용된 문자만 유지
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    // 연속된 언더스코어를 하나로
    .replace(/_{2,}/g, '_')
    // 앞뒤 언더스코어 제거
    .replace(/^_+|_+$/g, '');

  if (!safe) {
    safe = '_unnamed_';
  }

  return safe.slice(0, maxLength);
}

/**
 * Docker 이미지 태그를 파일명으로 안전하게 변환
 *
 * @param tag Docker 태그 (예: 'library/nginx:latest')
 * @returns 안전한 파일명
 */
export function sanitizeDockerTag(tag: string): string {
  return sanitizeFilename(tag, 200);
}

/**
 * 전체 경로의 길이가 Windows 최대 경로 길이를 초과하는지 확인
 *
 * @param fullPath 전체 경로
 * @param maxLength 최대 길이 (기본값: 260, Windows MAX_PATH)
 * @returns 경로 길이가 유효한지 여부
 */
export function isPathLengthValid(fullPath: string, maxLength = 260): boolean {
  return fullPath.length <= maxLength;
}

/**
 * 경로 길이 문제 시 경고 메시지 생성
 *
 * @param fullPath 전체 경로
 * @returns 경고 메시지 또는 null (문제 없을 경우)
 */
export function getPathLengthWarning(fullPath: string): string | null {
  if (fullPath.length > 260) {
    return `경로가 너무 깁니다 (${fullPath.length}자). Windows에서는 260자 이하로 제한됩니다.`;
  }
  if (fullPath.length > 200) {
    return `경로가 길어 일부 환경에서 문제가 발생할 수 있습니다 (${fullPath.length}자).`;
  }
  return null;
}

/**
 * Windows에서 긴 경로를 지원하기 위한 UNC 경로 변환
 * Windows 10 이상에서 긴 경로 지원이 활성화된 경우에만 동작
 *
 * @param fullPath 원본 경로
 * @returns UNC 접두사가 추가된 경로 (Windows) 또는 원본 경로 (기타)
 */
export function toLongPath(fullPath: string): string {
  // 이미 UNC 경로인 경우 그대로 반환
  if (fullPath.startsWith('\\\\?\\') || fullPath.startsWith('//?/')) {
    return fullPath;
  }

  // Windows에서만 처리
  if (process.platform === 'win32' && fullPath.length > 260) {
    // 절대 경로인 경우에만 UNC 변환
    if (/^[A-Za-z]:/.test(fullPath)) {
      return `\\\\?\\${fullPath}`;
    }
  }

  return fullPath;
}

/**
 * 파일 확장자 추출
 *
 * @param filename 파일명
 * @returns 확장자 (점 포함) 또는 빈 문자열
 */
export function getExtension(filename: string): string {
  const match = filename.match(/\.[^.]+$/);
  return match ? match[0] : '';
}

/**
 * 파일명에서 확장자 제거
 *
 * @param filename 파일명
 * @returns 확장자가 제거된 파일명
 */
export function removeExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, '');
}
