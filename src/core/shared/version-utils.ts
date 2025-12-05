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
    return compareVersions(version, target) >= 0;
  }
  if (condition.startsWith('<=')) {
    const target = condition.slice(2).trim();
    return compareVersions(version, target) <= 0;
  }
  if (condition.startsWith('!=')) {
    const target = condition.slice(2).trim();
    return version !== target;
  }
  if (condition.startsWith('==')) {
    const target = condition.slice(2).trim();
    if (target.includes('*')) {
      // 와일드카드 처리 (예: ==2.*)
      const prefix = target.replace(/\*.*$/, '');
      return version.startsWith(prefix);
    }
    return version === target;
  }
  if (condition.startsWith('~=')) {
    // 호환 릴리스 (예: ~=2.1은 >=2.1, ==2.*)
    const base = condition.slice(2).trim();
    const parts = base.split('.');
    parts.pop();
    const prefix = parts.join('.');
    return (
      compareVersions(version, base) >= 0 &&
      version.startsWith(prefix)
    );
  }
  if (condition.startsWith('>')) {
    const target = condition.slice(1).trim();
    return compareVersions(version, target) > 0;
  }
  if (condition.startsWith('<')) {
    const target = condition.slice(1).trim();
    return compareVersions(version, target) < 0;
  }
  if (condition.includes('*')) {
    // 와일드카드만 있는 경우 (예: 2.*)
    const prefix = condition.replace(/\*.*$/, '').trim();
    return version.startsWith(prefix);
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
