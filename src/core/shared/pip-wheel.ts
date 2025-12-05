/**
 * Wheel 파일 파싱 및 태그 매칭
 * pip의 models/wheel.py를 TypeScript로 포팅
 *
 * 참고:
 * - https://peps.python.org/pep-0427/ (Wheel 형식)
 * - https://github.com/pypa/pip/blob/main/src/pip/_internal/models/wheel.py
 */

import {
  PlatformTag,
  tagToString,
  parseTag,
} from './pip-tags';

/**
 * Wheel 파일 정보
 */
export interface WheelInfo {
  /** 원본 파일명 */
  filename: string;
  /** 패키지 이름 (정규화됨) */
  name: string;
  /** 버전 */
  version: string;
  /** 빌드 태그 (선택적) */
  buildTag?: BuildTag;
  /** 파일 태그 목록 */
  fileTags: Set<string>;
  /** 파싱된 태그 목록 */
  parsedTags: PlatformTag[];
}

/**
 * 빌드 태그 (빌드 번호 + 빌드 문자열)
 */
export type BuildTag = [number, string] | [];

/**
 * Wheel 파일명 파싱 정규식
 * 형식: {distribution}-{version}(-{build tag})?-{python tag}-{abi tag}-{platform tag}.whl
 */
const WHEEL_FILENAME_REGEX =
  /^(?<name>[A-Za-z0-9](?:[A-Za-z0-9._]*[A-Za-z0-9])?)-(?<version>[A-Za-z0-9_.!+]+?)(?:-(?<build>\d+[^-]*))?-(?<pyver>[^-]+)-(?<abi>[^-]+)-(?<plat>[^-]+)\.whl$/;

/**
 * 패키지 이름 정규화 (PEP 503)
 */
export function normalizePackageName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '_');
}

/**
 * Wheel 파일명 파싱
 */
export function parseWheelFilename(filename: string): WheelInfo | null {
  const match = filename.match(WHEEL_FILENAME_REGEX);
  if (!match || !match.groups) {
    return null;
  }

  const { name, version, build, pyver, abi, plat } = match.groups;

  // 빌드 태그 파싱
  let buildTag: BuildTag = [];
  if (build) {
    const buildNum = parseInt(build, 10);
    const buildStr = build.replace(/^\d+/, '');
    buildTag = [buildNum, buildStr];
  }

  // 태그 조합 생성 (압축 태그셋 확장)
  const fileTags = new Set<string>();
  const parsedTags: PlatformTag[] = [];

  const pyTags = pyver.split('.');
  const abiTags = abi.split('.');
  const platTags = plat.split('.');

  for (const py of pyTags) {
    for (const ab of abiTags) {
      for (const pl of platTags) {
        const tagStr = `${py}-${ab}-${pl}`;
        fileTags.add(tagStr);
        parsedTags.push({
          pythonTag: py,
          abiTag: ab,
          platformTag: pl,
        });
      }
    }
  }

  return {
    filename,
    name: normalizePackageName(name),
    version,
    buildTag,
    fileTags,
    parsedTags,
  };
}

/**
 * Wheel이 특정 태그 목록과 호환되는지 확인
 */
export function isWheelSupported(wheel: WheelInfo, supportedTags: PlatformTag[]): boolean {
  const supportedSet = new Set(supportedTags.map(tagToString));
  for (const tag of wheel.fileTags) {
    if (supportedSet.has(tag)) {
      return true;
    }
  }
  return false;
}

/**
 * Wheel의 최소 지원 인덱스 반환 (pip의 support_index_min)
 * 낮을수록 더 선호됨
 * 호환되지 않으면 -1 반환
 */
export function getWheelSupportIndex(wheel: WheelInfo, supportedTags: PlatformTag[]): number {
  let minIndex = Infinity;

  for (let i = 0; i < supportedTags.length; i++) {
    const tagStr = tagToString(supportedTags[i]);
    if (wheel.fileTags.has(tagStr)) {
      minIndex = Math.min(minIndex, i);
    }
  }

  return minIndex === Infinity ? -1 : minIndex;
}

/**
 * Wheel의 최선호 태그 우선순위 반환 (빠른 조회용)
 */
export function getWheelTagPriority(
  wheel: WheelInfo,
  tagToPriority: Map<string, number>
): number {
  let minPriority = Infinity;

  for (const tag of wheel.fileTags) {
    const priority = tagToPriority.get(tag);
    if (priority !== undefined) {
      minPriority = Math.min(minPriority, priority);
    }
  }

  return minPriority === Infinity ? -1 : minPriority;
}

/**
 * 파일명이 wheel 파일인지 확인
 */
export function isWheelFile(filename: string): boolean {
  return filename.endsWith('.whl');
}

/**
 * 파일명이 source distribution인지 확인
 */
export function isSourceDist(filename: string): boolean {
  return filename.endsWith('.tar.gz') || filename.endsWith('.zip');
}

/**
 * 파일 유형 판별
 */
export type PackageFileType = 'wheel' | 'sdist' | 'unknown';

export function getPackageFileType(filename: string): PackageFileType {
  if (isWheelFile(filename)) return 'wheel';
  if (isSourceDist(filename)) return 'sdist';
  return 'unknown';
}

/**
 * Wheel 파일명에서 Python 버전 요구사항 추출
 */
export function getWheelPythonVersions(wheel: WheelInfo): string[] {
  const versions: Set<string> = new Set();

  for (const tag of wheel.parsedTags) {
    const pyTag = tag.pythonTag;

    // cp311, py3, py311 등에서 버전 추출
    if (pyTag.startsWith('cp') || pyTag.startsWith('pp')) {
      const ver = pyTag.slice(2);
      if (ver.length >= 2) {
        versions.add(`${ver[0]}.${ver.slice(1)}`);
      }
    } else if (pyTag.startsWith('py')) {
      const ver = pyTag.slice(2);
      if (ver.length === 1) {
        versions.add(ver); // py3 -> "3"
      } else if (ver.length >= 2) {
        versions.add(`${ver[0]}.${ver.slice(1)}`);
      }
    }
  }

  return Array.from(versions);
}

/**
 * Wheel 파일명에서 플랫폼 정보 추출
 */
export interface WheelPlatformInfo {
  /** 순수 Python 패키지인지 (any 플랫폼) */
  isPureWheel: boolean;
  /** Windows 지원 */
  supportsWindows: boolean;
  /** macOS 지원 */
  supportsMacOS: boolean;
  /** Linux 지원 */
  supportsLinux: boolean;
  /** 지원 아키텍처 목록 */
  architectures: string[];
}

export function getWheelPlatformInfo(wheel: WheelInfo): WheelPlatformInfo {
  const platforms = new Set(wheel.parsedTags.map((t) => t.platformTag));
  const architectures: Set<string> = new Set();

  let isPureWheel = false;
  let supportsWindows = false;
  let supportsMacOS = false;
  let supportsLinux = false;

  for (const platform of platforms) {
    if (platform === 'any') {
      isPureWheel = true;
      continue;
    }

    if (platform.startsWith('win')) {
      supportsWindows = true;
      if (platform === 'win_amd64') architectures.add('x86_64');
      else if (platform === 'win32') architectures.add('i686');
      else if (platform === 'win_arm64') architectures.add('arm64');
    } else if (platform.startsWith('macosx')) {
      supportsMacOS = true;
      if (platform.includes('x86_64')) architectures.add('x86_64');
      if (platform.includes('arm64')) architectures.add('arm64');
      if (platform.includes('universal2')) {
        architectures.add('x86_64');
        architectures.add('arm64');
      }
    } else if (platform.includes('linux') || platform.includes('manylinux') || platform.includes('musllinux')) {
      supportsLinux = true;
      if (platform.includes('x86_64')) architectures.add('x86_64');
      if (platform.includes('i686')) architectures.add('i686');
      if (platform.includes('aarch64')) architectures.add('aarch64');
      if (platform.includes('arm64')) architectures.add('arm64');
    }
  }

  return {
    isPureWheel,
    supportsWindows,
    supportsMacOS,
    supportsLinux,
    architectures: Array.from(architectures),
  };
}

/**
 * Wheel 목록을 지원 태그 우선순위로 정렬
 */
export function sortWheelsByPriority(
  wheels: WheelInfo[],
  supportedTags: PlatformTag[]
): WheelInfo[] {
  const tagToPriority = new Map<string, number>();
  supportedTags.forEach((tag, index) => {
    const key = tagToString(tag);
    if (!tagToPriority.has(key)) {
      tagToPriority.set(key, index);
    }
  });

  return [...wheels].sort((a, b) => {
    const priorityA = getWheelTagPriority(a, tagToPriority);
    const priorityB = getWheelTagPriority(b, tagToPriority);

    // 호환되지 않는 wheel은 뒤로
    if (priorityA === -1 && priorityB === -1) return 0;
    if (priorityA === -1) return 1;
    if (priorityB === -1) return -1;

    return priorityA - priorityB;
  });
}

/**
 * 호환되는 wheel만 필터링
 */
export function filterCompatibleWheels(
  wheels: WheelInfo[],
  supportedTags: PlatformTag[]
): WheelInfo[] {
  return wheels.filter((wheel) => isWheelSupported(wheel, supportedTags));
}

/**
 * 최적의 wheel 선택
 */
export function selectBestWheel(
  wheels: WheelInfo[],
  supportedTags: PlatformTag[]
): WheelInfo | null {
  const compatible = filterCompatibleWheels(wheels, supportedTags);
  if (compatible.length === 0) return null;

  const sorted = sortWheelsByPriority(compatible, supportedTags);
  return sorted[0];
}
