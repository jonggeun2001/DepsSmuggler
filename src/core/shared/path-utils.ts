/**
 * 크로스 플랫폼 경로 처리 유틸리티
 * Windows와 Unix 환경에서 일관된 경로 처리를 지원합니다.
 */

import * as path from 'path';

/**
 * 경로를 정규화하고 forward slash로 통일
 * 주로 내부 처리용으로 사용
 */
export function normalizePath(p: string): string {
  return path.normalize(p).replace(/\\/g, '/');
}

/**
 * 경로를 Windows 스타일(백슬래시)로 변환
 * PowerShell 스크립트 생성 시 사용
 */
export function toWindowsPath(p: string): string {
  return p.replace(/\//g, '\\');
}

/**
 * 경로를 Unix 스타일(슬래시)로 변환
 * Bash 스크립트 생성 및 ZIP 아카이브 내부 경로에 사용
 */
export function toUnixPath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * 선행 './' 또는 '.\\' 제거
 * Windows와 Unix 모두 지원
 */
export function stripLeadingDotSlash(p: string): string {
  return p.replace(/^\.[\\/]/, '');
}

/**
 * ZIP 아카이브 내부 경로용으로 forward slash 보장
 * ZIP 표준에서는 forward slash만 사용
 */
export function ensureForwardSlashForArchive(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * 경로에서 상대 경로 부분 추출 (forward slash 사용)
 * baseDir 기준으로 relativePath 반환
 */
export function getRelativePath(fullPath: string, baseDir: string): string {
  const relative = path.relative(baseDir, fullPath);
  return toUnixPath(relative);
}

/**
 * 경로 결합 후 정규화 (플랫폼 독립적)
 */
export function joinAndNormalize(...paths: string[]): string {
  return normalizePath(path.join(...paths));
}

/**
 * 경로 결합 후 플랫폼에 맞는 형식으로 반환
 */
export function joinPath(...paths: string[]): string {
  return path.join(...paths);
}

/**
 * 경로가 절대 경로인지 확인
 */
export function isAbsolutePath(p: string): boolean {
  return path.isAbsolute(p);
}

/**
 * 경로 정규화 (플랫폼 네이티브)
 */
export function resolvePath(...paths: string[]): string {
  return path.resolve(...paths);
}

/**
 * PowerShell 스크립트에서 사용할 경로 문자열 생성
 * 백슬래시를 이스케이프 처리
 */
export function toPowerShellPath(p: string): string {
  // 먼저 Windows 스타일로 변환 후, 작은따옴표 내에서는 이스케이프 불필요
  return toWindowsPath(p);
}

/**
 * PowerShell Join-Path 구문 생성
 */
export function psJoinPath(base: string, childPath: string): string {
  // 작은따옴표 내 작은따옴표는 '' 로 이스케이프
  const escapedChild = childPath.replace(/'/g, "''");
  return `Join-Path -Path ${base} -ChildPath '${escapedChild}'`;
}

/**
 * PowerShell에서 안전하게 사용할 수 있도록 경로를 따옴표로 감싸기
 */
export function psQuotePath(p: string): string {
  // 작은따옴표 이스케이프
  return `'${p.replace(/'/g, "''")}'`;
}

/**
 * Bash 스크립트에서 사용할 경로 문자열 생성
 */
export function toBashPath(p: string): string {
  return toUnixPath(p);
}

/**
 * 플랫폼에 따른 스크립트용 경로 변환
 * @param p 경로
 * @param scriptType 스크립트 타입 ('bash' | 'powershell')
 */
export function toScriptPath(p: string, scriptType: 'bash' | 'powershell'): string {
  if (scriptType === 'powershell') {
    return toPowerShellPath(p);
  }
  return toBashPath(p);
}

/**
 * 경로 조작 공격(Path Traversal)을 방지하기 위해 입력값을 정규화합니다.
 * 패키지명, 버전, 태그 등 외부 입력이 경로에 사용될 때 호출합니다.
 *
 * - 경로 구분자(/, \) 제거
 * - 상위 디렉토리 이동(..) 제거
 * - 현재 디렉토리(.) 제거
 * - 널 바이트 제거
 * - 허용되지 않은 특수문자를 언더스코어로 대체
 *
 * @param input - 정규화할 문자열 (패키지명, 버전 등)
 * @param allowedChars - 추가로 허용할 문자 정규식 (기본: 알파벳, 숫자, 점, 하이픈, 언더스코어, @)
 * @returns 정규화된 안전한 문자열
 *
 * @example
 * sanitizePath('../etc/passwd') // 'etc_passwd'
 * sanitizePath('package/../../secret') // 'package_secret'
 * sanitizePath('@scope/package') // '@scope_package'
 */
export function sanitizePath(
  input: string,
  allowedChars: RegExp = /[^a-zA-Z0-9._\-@]/g
): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  let sanitized = input
    // 널 바이트 제거
    .replace(/\0/g, '')
    // 연속된 점(..) 제거 - 상위 디렉토리 이동 방지
    .replace(/\.{2,}/g, '')
    // 경로 구분자를 언더스코어로 대체
    .replace(/[/\\]/g, '_')
    // 허용되지 않은 문자를 언더스코어로 대체
    .replace(allowedChars, '_')
    // 연속된 언더스코어 정리
    .replace(/_+/g, '_')
    // 앞뒤 언더스코어 제거
    .replace(/^_+|_+$/g, '');

  // 빈 문자열이 되면 기본값 반환
  if (!sanitized) {
    return 'unnamed';
  }

  return sanitized;
}

/**
 * 경로가 기준 디렉토리 내에 있는지 검증합니다.
 * path.join() 후 결과가 기준 디렉토리를 벗어나지 않는지 확인합니다.
 *
 * @param basePath - 기준 디렉토리 (절대 경로)
 * @param targetPath - 검증할 대상 경로 (절대 경로)
 * @returns 기준 디렉토리 내에 있으면 true
 *
 * @example
 * isPathWithinBase('/downloads', '/downloads/package') // true
 * isPathWithinBase('/downloads', '/etc/passwd') // false
 */
export function isPathWithinBase(basePath: string, targetPath: string): boolean {
  const normalizedBase = normalizePath(basePath);
  const normalizedTarget = normalizePath(targetPath);

  // 대상 경로가 기준 경로로 시작하는지 확인
  return normalizedTarget.startsWith(normalizedBase + '/') || normalizedTarget === normalizedBase;
}

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
 * 플랫폼에 따른 파일 모드 반환
 * Windows에서는 mode 옵션이 무시되므로 undefined 반환
 * @param executable 실행 파일 여부
 * @returns Unix에서는 권한 값, Windows에서는 undefined
 */
export function getFileMode(executable: boolean): number | undefined {
  if (isWindows) {
    return undefined;
  }
  return executable ? 0o755 : 0o644;
}

/**
 * fs.writeFile 옵션에 사용할 WriteOptions 생성
 * Windows에서는 mode 없이, Unix에서는 mode 포함
 * @param executable 실행 파일 여부
 */
export function getWriteOptions(executable: boolean): { encoding: BufferEncoding; mode?: number } {
  const mode = getFileMode(executable);
  if (mode !== undefined) {
    return { encoding: 'utf-8', mode };
  }
  return { encoding: 'utf-8' };
}

/**
 * 현재 플랫폼의 경로 구분자
 */
export const pathSeparator = path.sep;
