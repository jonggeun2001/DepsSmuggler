/// <reference types="vitest/globals" />

/**
 * 플랫폼별 테스트 유틸리티
 * Windows, macOS, Linux에서 조건부 테스트 실행을 지원합니다.
 */

/**
 * 현재 플랫폼이 Windows인지 확인
 */
export const isWindows = process.platform === 'win32';

/**
 * 현재 플랫폼이 macOS인지 확인
 */
export const isMac = process.platform === 'darwin';

/**
 * 현재 플랫폼이 Linux인지 확인
 */
export const isLinux = process.platform === 'linux';

/**
 * 현재 플랫폼 이름
 */
export const platformName = isWindows ? 'Windows' : isMac ? 'macOS' : 'Linux';

/**
 * Windows에서만 테스트 실행
 * @example
 * describeOnWindows('Windows specific tests', () => {
 *   it('handles UNC paths', () => { ... });
 * });
 */
export const describeOnWindows = isWindows ? describe : describe.skip;

/**
 * Windows가 아닌 환경에서만 테스트 실행
 */
export const describeNotOnWindows = !isWindows ? describe : describe.skip;

/**
 * macOS에서만 테스트 실행
 */
export const describeOnMac = isMac ? describe : describe.skip;

/**
 * Linux에서만 테스트 실행
 */
export const describeOnLinux = isLinux ? describe : describe.skip;

/**
 * Unix 계열(Linux, macOS)에서만 테스트 실행
 */
export const describeOnUnix = !isWindows ? describe : describe.skip;

/**
 * Windows에서만 테스트 실행 (단일 테스트용)
 */
export const itOnWindows = isWindows ? it : it.skip;

/**
 * Windows가 아닌 환경에서만 테스트 실행 (단일 테스트용)
 */
export const itNotOnWindows = !isWindows ? it : it.skip;

/**
 * Unix 계열에서만 테스트 실행 (단일 테스트용)
 */
export const itOnUnix = !isWindows ? it : it.skip;

/**
 * 테스트용 임시 경로 생성
 * Windows와 Unix에서 다른 경로 형식 사용
 */
export function getTempPath(subPath: string): string {
  if (isWindows) {
    return `C:\\temp\\${subPath.replace(/\//g, '\\')}`;
  }
  return `/tmp/${subPath}`;
}

/**
 * 플랫폼에 맞는 줄바꿈 문자
 */
export const EOL = isWindows ? '\r\n' : '\n';

/**
 * 플랫폼에 맞는 경로 구분자
 */
export const PATH_SEP = isWindows ? '\\' : '/';

/**
 * 테스트용 긴 경로 생성 (Windows MAX_PATH 테스트용)
 * @param length 원하는 경로 길이
 */
export function generateLongPath(length: number): string {
  const base = isWindows ? 'C:\\test\\' : '/test/';
  const remaining = length - base.length;
  if (remaining <= 0) return base;

  const segment = 'a';
  return base + segment.repeat(remaining);
}

/**
 * 테스트 스킵 이유 메시지 생성
 */
export function skipReason(reason: string): string {
  return `Skipped on ${platformName}: ${reason}`;
}
