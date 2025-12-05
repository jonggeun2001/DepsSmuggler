/**
 * PEP 425 호환성 태그 생성기
 * pip의 compatibility_tags.py를 TypeScript로 포팅
 *
 * 참고:
 * - https://peps.python.org/pep-0425/
 * - https://github.com/pypa/pip/blob/main/src/pip/_internal/utils/compatibility_tags.py
 */

/**
 * PEP 425 태그 형식: {python_tag}-{abi_tag}-{platform_tag}
 */
export interface PlatformTag {
  pythonTag: string; // cp311, py3, py2.py3
  abiTag: string; // cp311, abi3, none
  platformTag: string; // manylinux_2_17_x86_64, win_amd64, any
}

/**
 * 타겟 Python 환경 설정
 */
export interface TargetPythonConfig {
  /** Python 버전 (예: "3.11", "3.10") */
  version: string;
  /** Python 구현체 (예: "cp" for CPython, "pp" for PyPy) */
  implementation?: string;
  /** ABI 태그 목록 (지정하지 않으면 자동 생성) */
  abis?: string[];
  /** 플랫폼 태그 목록 */
  platforms?: string[];
}

/**
 * 플랫폼 타입
 */
export type PlatformType = 'windows' | 'macos' | 'linux' | 'any';

/**
 * 아키텍처 타입
 */
export type ArchType = 'x86_64' | 'amd64' | 'arm64' | 'aarch64' | 'i386' | 'i686' | 'universal2' | 'any';

/**
 * PEP 425 태그를 문자열로 변환
 */
export function tagToString(tag: PlatformTag): string {
  return `${tag.pythonTag}-${tag.abiTag}-${tag.platformTag}`;
}

/**
 * 문자열에서 PEP 425 태그 파싱
 */
export function parseTag(tagString: string): PlatformTag | null {
  const parts = tagString.split('-');
  if (parts.length !== 3) return null;

  return {
    pythonTag: parts[0],
    abiTag: parts[1],
    platformTag: parts[2],
  };
}

/**
 * Python 버전을 nodot 형식으로 변환 (3.11 -> 311)
 */
export function versionToNodot(version: string): string {
  const parts = version.split('.');
  return parts.slice(0, 2).join('');
}

/**
 * CPython 태그 생성
 * pip의 cpython_tags() 함수와 동일한 로직
 */
export function generateCPythonTags(config: TargetPythonConfig): PlatformTag[] {
  const tags: PlatformTag[] = [];
  const nodot = versionToNodot(config.version);
  const [major, minor] = config.version.split('.').map(Number);
  const impl = config.implementation || 'cp';

  const platforms = config.platforms || ['any'];
  const abis = config.abis || [`${impl}${nodot}`, 'abi3', 'none'];

  // 1. 현재 버전 + ABI + 플랫폼 조합
  for (const abi of abis) {
    for (const platform of platforms) {
      tags.push({
        pythonTag: `${impl}${nodot}`,
        abiTag: abi,
        platformTag: platform,
      });
    }
  }

  // 2. abi3 태그 (stable ABI) - 이전 버전들도 포함
  if (major >= 3) {
    for (let m = minor; m >= 2; m--) {
      const pyTag = `${impl}${major}${m}`;
      for (const platform of platforms) {
        tags.push({
          pythonTag: pyTag,
          abiTag: 'abi3',
          platformTag: platform,
        });
      }
    }
  }

  return tags;
}

/**
 * 범용 Python 태그 생성 (순수 Python 패키지용)
 * pip의 compatible_tags() 함수와 동일한 로직
 */
export function generateCompatibleTags(config: TargetPythonConfig): PlatformTag[] {
  const tags: PlatformTag[] = [];
  const [major, minor] = config.version.split('.').map(Number);
  const impl = config.implementation || 'cp';

  const platforms = config.platforms || ['any'];

  // py{major}{minor} 부터 py{major}0 까지
  for (let m = minor; m >= 0; m--) {
    const pyTag = `py${major}${m}`;
    for (const platform of platforms) {
      tags.push({
        pythonTag: pyTag,
        abiTag: 'none',
        platformTag: platform,
      });
    }
  }

  // py{major} 태그
  for (const platform of platforms) {
    tags.push({
      pythonTag: `py${major}`,
      abiTag: 'none',
      platformTag: platform,
    });
  }

  return tags;
}

/**
 * 지원되는 태그 목록 생성 (우선순위 순)
 * pip의 get_supported() 함수와 동일한 로직
 */
export function getSupportedTags(config: TargetPythonConfig): PlatformTag[] {
  const tags: PlatformTag[] = [];
  const impl = config.implementation || 'cp';

  // 1. 구현체별 태그 (CPython 기준)
  if (impl === 'cp') {
    tags.push(...generateCPythonTags(config));
  }

  // 2. 범용 Python 태그
  tags.push(...generateCompatibleTags(config));

  return tags;
}

/**
 * 태그를 인덱스 맵으로 변환 (빠른 조회용)
 */
export function tagsToIndexMap(tags: PlatformTag[]): Map<string, number> {
  const map = new Map<string, number>();
  tags.forEach((tag, index) => {
    const key = tagToString(tag);
    if (!map.has(key)) {
      map.set(key, index);
    }
  });
  return map;
}

/**
 * Linux 플랫폼 태그 생성
 */
export function generateLinuxPlatformTags(arch: ArchType): string[] {
  const tags: string[] = [];
  const normalizedArch = normalizeArch(arch);

  // manylinux 태그 (최신 -> 오래된 순)
  // PEP 600: manylinux_x_y_arch (x, y는 glibc 버전)
  const glibcVersions = [
    [2, 35], [2, 34], [2, 31], [2, 28], [2, 27], [2, 24], [2, 17], [2, 12], [2, 5],
  ];

  for (const [major, minor] of glibcVersions) {
    tags.push(`manylinux_${major}_${minor}_${normalizedArch}`);
  }

  // 레거시 manylinux 태그
  if (normalizedArch === 'x86_64' || normalizedArch === 'i686') {
    tags.push(`manylinux2014_${normalizedArch}`);
    tags.push(`manylinux2010_${normalizedArch}`);
    tags.push(`manylinux1_${normalizedArch}`);
  } else if (normalizedArch === 'aarch64') {
    tags.push(`manylinux2014_${normalizedArch}`);
  }

  // 기본 linux 태그
  tags.push(`linux_${normalizedArch}`);

  return tags;
}

/**
 * macOS 플랫폼 태그 생성
 */
export function generateMacOSPlatformTags(arch: ArchType, minVersion?: [number, number]): string[] {
  const tags: string[] = [];
  const normalizedArch = normalizeArch(arch);

  // macOS 버전 (최신 -> 오래된 순)
  const startVersion = minVersion || (normalizedArch === 'arm64' ? [11, 0] : [10, 9]);
  const [startMajor, startMinor] = startVersion;

  if (startMajor >= 11) {
    // macOS 11+ (Big Sur 이상)
    for (let v = 15; v >= startMajor; v--) {
      tags.push(`macosx_${v}_0_${normalizedArch}`);

      // universal2 지원 (arm64 + x86_64)
      if (normalizedArch === 'arm64' || normalizedArch === 'x86_64') {
        tags.push(`macosx_${v}_0_universal2`);
      }
    }
  }

  // macOS 10.x
  for (let minor = 16; minor >= 9; minor--) {
    tags.push(`macosx_10_${minor}_${normalizedArch}`);
    tags.push(`macosx_10_${minor}_intel`);
    tags.push(`macosx_10_${minor}_universal`);
  }

  return tags;
}

/**
 * Windows 플랫폼 태그 생성
 */
export function generateWindowsPlatformTags(arch: ArchType): string[] {
  const normalizedArch = normalizeArch(arch);

  switch (normalizedArch) {
    case 'x86_64':
    case 'amd64':
      return ['win_amd64'];
    case 'arm64':
      return ['win_arm64'];
    case 'i386':
    case 'i686':
      return ['win32'];
    default:
      return [`win_${normalizedArch}`];
  }
}

/**
 * 타겟 플랫폼에 맞는 플랫폼 태그 생성
 */
export function generatePlatformTags(
  platform: PlatformType,
  arch: ArchType
): string[] {
  switch (platform) {
    case 'linux':
      return [...generateLinuxPlatformTags(arch), 'any'];
    case 'macos':
      return [...generateMacOSPlatformTags(arch), 'any'];
    case 'windows':
      return [...generateWindowsPlatformTags(arch), 'any'];
    case 'any':
    default:
      return ['any'];
  }
}

/**
 * 아키텍처 이름 정규화
 */
export function normalizeArch(arch: ArchType): string {
  switch (arch) {
    case 'amd64':
      return 'x86_64';
    case 'i386':
      return 'i686';
    case 'aarch64':
      return 'aarch64';
    case 'arm64':
      return 'arm64';
    default:
      return arch;
  }
}

/**
 * 전체 지원 태그 목록 생성 (실제 pip과 동일한 순서)
 */
export function getFullSupportedTags(
  pythonVersion: string,
  platform: PlatformType,
  arch: ArchType,
  implementation: string = 'cp'
): PlatformTag[] {
  const platformTags = generatePlatformTags(platform, arch);

  const config: TargetPythonConfig = {
    version: pythonVersion,
    implementation,
    platforms: platformTags,
  };

  return getSupportedTags(config);
}

/**
 * 두 태그가 호환되는지 확인
 */
export function isTagCompatible(fileTag: PlatformTag, supportedTags: PlatformTag[]): boolean {
  const fileTagStr = tagToString(fileTag);
  return supportedTags.some((t) => tagToString(t) === fileTagStr);
}

/**
 * 파일 태그의 우선순위 반환 (낮을수록 좋음)
 * -1이면 호환되지 않음
 */
export function getTagPriority(fileTag: PlatformTag, supportedTags: PlatformTag[]): number {
  const fileTagStr = tagToString(fileTag);
  const index = supportedTags.findIndex((t) => tagToString(t) === fileTagStr);
  return index;
}
