// 버전 비교 및 호환성 체크 유틸리티 (pip/conda/maven 공용)

/**
 * 버전 문자열을 정규화하여 비교 가능한 배열로 변환
 * 알파/베타/rc 등 프리릴리스 태그도 처리
 */
function normalizeVersion(version: string): (number | string)[] {
  // 버전에서 프리릴리스 태그 분리 (예: 1.2.3rc1 -> 1.2.3, rc1)
  const cleanVersion = version.replace(/[a-zA-Z].*$/, '');

  return cleanVersion.split(/[.-]/).map((part) => {
    const num = parseInt(part, 10);
    return isNaN(num) ? part : num;
  });
}

interface MatchableVersion {
  epoch: number;
  release: number[];
  suffix: string;
  local: string | null;
}

function normalizeVersionSuffix(suffix: string): string {
  let normalized = suffix.toLowerCase().replace(/[-_.]+/g, '');

  // PEP 440에서 허용하는 prerelease/post-release 별칭을 정규화한다.
  normalized = normalized
    .replace(/^alpha/, 'a')
    .replace(/^beta/, 'b')
    .replace(/^(preview|pre)/, 'rc')
    .replace(/^c(?=\d|$)/, 'rc')
    .replace(/rev/g, 'post')
    .replace(/r(?=\d|$)/g, 'post');

  // 1.0-1은 1.0.post1의 암시적 표기다.
  if (/^\d+$/.test(normalized)) {
    return `post${Number(normalized)}`;
  }

  return normalized.replace(
    /(a|b|rc|post|dev)(\d*)/g,
    (_match, label: string, number: string) =>
      `${label}${Number(number || '0')}`,
  );
}

function parseMatchableVersion(version: string): MatchableVersion | null {
  let normalized = version.trim().toLowerCase().replace(/^v(?=\d)/, '');

  const localSeparator = normalized.indexOf('+');
  const local =
    localSeparator === -1
      ? null
      : normalized
          .slice(localSeparator + 1)
          .split(/[-_.]+/)
          .filter(Boolean)
          .join('.');
  if (localSeparator !== -1) {
    normalized = normalized.slice(0, localSeparator);
  }

  let epoch = 0;
  const epochMatch = /^(\d+)!/.exec(normalized);
  if (epochMatch) {
    epoch = Number(epochMatch[1]);
    normalized = normalized.slice(epochMatch[0].length);
  }

  const releaseMatch = /^(\d+(?:\.\d+)*)/.exec(normalized);
  if (!releaseMatch) {
    return null;
  }

  return {
    epoch,
    release: releaseMatch[1].split('.').map(Number),
    suffix: normalizeVersionSuffix(
      normalized.slice(releaseMatch[0].length),
    ),
    local,
  };
}

function releasesEqual(a: number[], b: number[]): boolean {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) {
      return false;
    }
  }
  return true;
}

function matchesExactVersion(version: string, target: string): boolean {
  const parsedVersion = parseMatchableVersion(version);
  const parsedTarget = parseMatchableVersion(target);

  if (!parsedVersion || !parsedTarget) {
    return version === target;
  }

  if (
    parsedVersion.epoch !== parsedTarget.epoch ||
    !releasesEqual(parsedVersion.release, parsedTarget.release) ||
    parsedVersion.suffix !== parsedTarget.suffix
  ) {
    return false;
  }

  // specifier에 local version이 없으면 candidate의 local label은 무시한다.
  return (
    parsedTarget.local === null ||
    parsedVersion.local === parsedTarget.local
  );
}

interface OrderedVersionSuffix {
  prePhase: number;
  preNumber: number;
  postNumber: number;
  devNumber: number;
}

function parseOrderedVersionSuffix(
  suffix: string,
): OrderedVersionSuffix | null {
  const match =
    /^(?:(a|b|rc)(\d+))?(?:post(\d+))?(?:dev(\d+))?$/.exec(
      suffix,
    );
  if (!match) {
    return null;
  }

  const [, preLabel, preNumber, postNumber, devNumber] = match;
  const prePhaseMap: Record<string, number> = {
    a: 0,
    b: 1,
    rc: 2,
  };

  let prePhase: number;
  if (preLabel) {
    prePhase = prePhaseMap[preLabel];
  } else if (devNumber !== undefined && postNumber === undefined) {
    // prerelease가 없는 dev release는 모든 prerelease보다 앞선다.
    prePhase = -1;
  } else {
    // final 및 post release는 모든 prerelease보다 뒤에 온다.
    prePhase = 3;
  }

  return {
    prePhase,
    preNumber: Number(preNumber ?? 0),
    postNumber:
      postNumber === undefined ? -1 : Number(postNumber),
    devNumber:
      devNumber === undefined ? Number.POSITIVE_INFINITY : Number(devNumber),
  };
}

/**
 * PEP 440 prerelease 또는 development release인지 확인한다.
 */
export function isPrereleaseVersion(version: string): boolean {
  const parsed = parseMatchableVersion(version);
  if (!parsed) {
    return /(?:a|b|rc|alpha|beta|pre|preview|dev)\d*/i.test(
      version,
    );
  }

  const suffix = parseOrderedVersionSuffix(parsed.suffix);
  return Boolean(
    suffix &&
      (suffix.prePhase < 3 ||
        suffix.devNumber !== Number.POSITIVE_INFINITY),
  );
}

function comparePep440PublicVersions(
  a: string,
  b: string,
): number {
  const parsedA = parseMatchableVersion(a);
  const parsedB = parseMatchableVersion(b);
  if (!parsedA || !parsedB) {
    return compareVersions(a, b);
  }

  if (parsedA.epoch !== parsedB.epoch) {
    return parsedA.epoch - parsedB.epoch;
  }

  const releaseLength = Math.max(
    parsedA.release.length,
    parsedB.release.length,
  );
  for (let index = 0; index < releaseLength; index++) {
    const difference =
      (parsedA.release[index] ?? 0) -
      (parsedB.release[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }

  const suffixA = parseOrderedVersionSuffix(parsedA.suffix);
  const suffixB = parseOrderedVersionSuffix(parsedB.suffix);
  if (!suffixA || !suffixB) {
    return parsedA.suffix.localeCompare(parsedB.suffix);
  }

  const orderedFields: Array<keyof OrderedVersionSuffix> = [
    'prePhase',
    'preNumber',
    'postNumber',
    'devNumber',
  ];
  for (const field of orderedFields) {
    if (suffixA[field] !== suffixB[field]) {
      return suffixA[field] < suffixB[field] ? -1 : 1;
    }
  }

  return 0;
}

function comparePep440LocalVersions(
  left: string | null,
  right: string | null,
): number {
  if (left === right) {
    return 0;
  }
  if (left === null) {
    return -1;
  }
  if (right === null) {
    return 1;
  }

  const leftSegments = left.split('.');
  const rightSegments = right.split('.');
  const segmentCount = Math.max(
    leftSegments.length,
    rightSegments.length,
  );

  for (let index = 0; index < segmentCount; index++) {
    const leftSegment = leftSegments[index];
    const rightSegment = rightSegments[index];
    if (leftSegment === undefined) {
      return -1;
    }
    if (rightSegment === undefined) {
      return 1;
    }

    const leftIsNumber = /^\d+$/.test(leftSegment);
    const rightIsNumber = /^\d+$/.test(rightSegment);
    if (leftIsNumber && rightIsNumber) {
      const difference =
        Number(leftSegment) - Number(rightSegment);
      if (difference !== 0) {
        return difference;
      }
      continue;
    }
    if (leftIsNumber !== rightIsNumber) {
      return leftIsNumber ? 1 : -1;
    }

    if (leftSegment !== rightSegment) {
      return leftSegment < rightSegment ? -1 : 1;
    }
  }

  return 0;
}

/**
 * 후보 선택용 전체 PEP 440 순서 비교.
 * 공개 버전이 같으면 local version segment까지 비교한다.
 */
export function comparePep440Versions(
  a: string,
  b: string,
): number {
  const publicResult = comparePep440PublicVersions(a, b);
  if (publicResult !== 0) {
    return publicResult;
  }

  const parsedA = parseMatchableVersion(a);
  const parsedB = parseMatchableVersion(b);
  if (!parsedA || !parsedB) {
    return 0;
  }

  return comparePep440LocalVersions(parsedA.local, parsedB.local);
}

function isSameRelease(
  a: MatchableVersion,
  b: MatchableVersion,
): boolean {
  return a.epoch === b.epoch && releasesEqual(a.release, b.release);
}

function matchesExclusiveGreaterThan(
  version: string,
  target: string,
): boolean {
  if (comparePep440PublicVersions(version, target) <= 0) {
    return false;
  }

  const parsedVersion = parseMatchableVersion(version);
  const parsedTarget = parseMatchableVersion(target);
  if (
    !parsedVersion ||
    !parsedTarget ||
    !isSameRelease(parsedVersion, parsedTarget)
  ) {
    return true;
  }

  const suffixVersion = parseOrderedVersionSuffix(parsedVersion.suffix);
  const suffixTarget = parseOrderedVersionSuffix(parsedTarget.suffix);
  if (!suffixVersion || !suffixTarget) {
    return true;
  }

  const isPostReleaseOfTarget =
    suffixTarget.postNumber === -1 &&
    suffixVersion.postNumber >= 0 &&
    suffixVersion.prePhase === suffixTarget.prePhase &&
    suffixVersion.preNumber === suffixTarget.preNumber;

  return !isPostReleaseOfTarget;
}

function matchesExclusiveLessThan(
  version: string,
  target: string,
): boolean {
  if (comparePep440PublicVersions(version, target) >= 0) {
    return false;
  }

  const parsedVersion = parseMatchableVersion(version);
  const parsedTarget = parseMatchableVersion(target);
  if (
    !parsedVersion ||
    !parsedTarget ||
    !isSameRelease(parsedVersion, parsedTarget)
  ) {
    return true;
  }

  const suffixVersion = parseOrderedVersionSuffix(parsedVersion.suffix);
  const suffixTarget = parseOrderedVersionSuffix(parsedTarget.suffix);
  if (!suffixVersion || !suffixTarget) {
    return true;
  }

  const isPrereleaseOfFinalTarget =
    suffixTarget.prePhase === 3 &&
    suffixVersion.prePhase < 3;

  return !isPrereleaseOfFinalTarget;
}

function matchesWildcardVersion(version: string, pattern: string): boolean {
  const prefix = pattern
    .replace(/\*.*$/, '')
    .replace(/[._-]+$/, '');

  if (!prefix) {
    return true;
  }

  const parsedVersion = parseMatchableVersion(version);
  const parsedPrefix = parseMatchableVersion(prefix);
  if (!parsedVersion || !parsedPrefix) {
    return version === prefix || version.startsWith(`${prefix}.`);
  }

  if (parsedVersion.epoch !== parsedPrefix.epoch) {
    return false;
  }

  return parsedPrefix.release.every(
    (segment, index) =>
      (parsedVersion.release[index] ?? 0) === segment,
  );
}

/**
 * 버전 문자열 비교 (semver 스타일)
 * @param a 첫 번째 버전
 * @param b 두 번째 버전
 * @returns a > b면 양수, a < b면 음수, 같으면 0
 */
export function compareVersions(a: string, b: string): number {
  const partsA = normalizeVersion(a);
  const partsB = normalizeVersion(b);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const partA = partsA[i] ?? 0;
    const partB = partsB[i] ?? 0;

    if (typeof partA === 'number' && typeof partB === 'number') {
      if (partA !== partB) return partA - partB;
    } else {
      const strA = String(partA);
      const strB = String(partB);
      if (strA !== strB) return strA.localeCompare(strB);
    }
  }
  return 0;
}

/**
 * 단일 버전 조건 체크
 * 지원: >=, <=, ==, !=, ~=, >, <, 와일드카드(*)
 */
function checkSingleCondition(version: string, condition: string): boolean {
  condition = condition.trim();

  if (condition.startsWith('>=')) {
    const target = condition.slice(2).trim();
    return comparePep440PublicVersions(version, target) >= 0;
  }
  if (condition.startsWith('<=')) {
    const target = condition.slice(2).trim();
    return comparePep440PublicVersions(version, target) <= 0;
  }
  if (condition.startsWith('!=')) {
    const target = condition.slice(2).trim();
    if (target.includes('*')) {
      return !matchesWildcardVersion(version, target);
    }
    return !matchesExactVersion(version, target);
  }
  if (condition.startsWith('==')) {
    const target = condition.slice(2).trim();
    if (target.includes('*')) {
      return matchesWildcardVersion(version, target);
    }
    return matchesExactVersion(version, target);
  }
  if (condition.startsWith('~=')) {
    // 호환 릴리스 (예: ~=2.1은 >=2.1, ==2.*)
    const base = condition.slice(2).trim();
    const parsedBase = parseMatchableVersion(base);
    const releasePrefix = parsedBase?.release.slice(0, -1) ?? [];
    const prefix = parsedBase
      ? `${parsedBase.epoch ? `${parsedBase.epoch}!` : ''}${releasePrefix.join('.')}`
      : base.split('.').slice(0, -1).join('.');
    return (
      comparePep440PublicVersions(version, base) >= 0 &&
      matchesWildcardVersion(version, `${prefix}.*`)
    );
  }
  if (condition.startsWith('>')) {
    const target = condition.slice(1).trim();
    return matchesExclusiveGreaterThan(version, target);
  }
  if (condition.startsWith('<')) {
    const target = condition.slice(1).trim();
    return matchesExclusiveLessThan(version, target);
  }
  if (condition.includes('*')) {
    return matchesWildcardVersion(version, condition.trim());
  }

  // 특수 조건이 없으면 true
  return true;
}

/**
 * 버전 스펙 호환성 체크 (pip/conda 공용)
 * 지원: >=, <=, ==, !=, ~=, >, <, 와일드카드(*), 콤마 구분 AND, 파이프 구분 OR
 * @param version 체크할 버전
 * @param spec 버전 스펙 (예: ">=1.0,<2.0", ">=1.0|>=2.0,<3.0")
 * @returns 호환되면 true
 */
export function isVersionCompatible(version: string, spec: string): boolean {
  // 콤마로 분리된 여러 조건 처리 (AND 연산)
  const conditions = spec.split(',').map((s) => s.trim());

  return conditions.every((condition) => {
    // 파이프(|)로 분리된 OR 조건
    if (condition.includes('|')) {
      const orConditions = condition.split('|').map((s) => s.trim());
      return orConditions.some((oc) => checkSingleCondition(version, oc));
    }
    return checkSingleCondition(version, condition);
  });
}

/**
 * 버전 배열을 내림차순으로 정렬
 * @param versions 버전 문자열 배열
 * @returns 내림차순 정렬된 버전 배열
 */
export function sortVersionsDescending(versions: string[]): string[] {
  return [...versions].sort((a, b) => compareVersions(b, a));
}

/**
 * 버전 배열을 오름차순으로 정렬
 * @param versions 버전 문자열 배열
 * @returns 오름차순 정렬된 버전 배열
 */
export function sortVersionsAscending(versions: string[]): string[] {
  return [...versions].sort((a, b) => compareVersions(a, b));
}

/**
 * 버전 스펙에 맞는 최신 버전 찾기
 * @param versions 사용 가능한 버전 배열
 * @param spec 버전 스펙 (예: ">=1.0,<2.0")
 * @returns 호환되는 최신 버전 또는 null
 */
export function findLatestCompatibleVersion(versions: string[], spec: string): string | null {
  const sorted = sortVersionsDescending(versions);

  for (const version of sorted) {
    if (isVersionCompatible(version, spec)) {
      return version;
    }
  }

  return null;
}
