/**
 * Conda MatchSpec 파서 및 버전 비교
 *
 * Conda 공식 문서 기반 구현:
 * https://docs.conda.io/projects/conda/en/latest/user-guide/concepts/pkg-specs.html
 */

/**
 * MatchSpec 파싱 결과
 */
export interface MatchSpec {
  name: string;
  version?: string;
  build?: string;
  channel?: string;
  subdir?: string;
  namespace?: string;
}

/**
 * 버전 파트 타입
 */
interface VersionPart {
  type: 'num' | 'str' | 'dev' | 'post' | 'alpha' | 'beta' | 'rc';
  value: number | string;
}

/**
 * MatchSpec 문자열 파싱
 *
 * 지원 형식:
 * - numpy
 * - numpy 1.8*
 * - numpy >=1.8
 * - numpy >=1.8,<2
 * - numpy 1.8.1 py39_0
 * - numpy=1.8.1=py39_0
 * - channel::numpy
 * - conda-forge/linux-64::numpy
 * - pytorch=1.8.*=*cuda*
 */
export function parseMatchSpec(spec: string): MatchSpec {
  let remaining = spec.trim();

  const result: MatchSpec = { name: '' };

  // 채널/subdir 파싱: channel::package 또는 channel/subdir::package
  if (remaining.includes('::')) {
    const [channelPart, rest] = remaining.split('::');
    remaining = rest;

    if (channelPart.includes('/')) {
      const [channel, subdir] = channelPart.split('/');
      result.channel = channel;
      result.subdir = subdir;
    } else {
      result.channel = channelPart;
    }
  }

  // = 구분자 형식: name=version=build
  if (remaining.includes('=') && !remaining.includes(' ')) {
    const parts = remaining.split('=').filter(p => p);
    result.name = parts[0];
    if (parts.length >= 2) {
      result.version = parts[1];
    }
    if (parts.length >= 3) {
      result.build = parts[2];
    }
    return result;
  }

  // 공백 구분자 형식: name version build
  const parts = remaining.split(/\s+/);
  result.name = parts[0];

  if (parts.length >= 2) {
    result.version = parts[1];
  }
  if (parts.length >= 3) {
    result.build = parts[2];
  }

  return result;
}

/**
 * 버전 문자열을 비교 가능한 파트 배열로 파싱
 *
 * Conda 버전 순서:
 * - dev < alpha < beta < rc < 정식 < post
 * - 숫자는 숫자로 비교
 * - 문자는 문자열로 비교
 */
export function parseCondaVersion(version: string): VersionPart[] {
  const parts: VersionPart[] = [];

  // epoch 제거 (예: 1!2.0.0 -> 2.0.0)
  let versionStr = version;
  let epoch = 0;
  if (version.includes('!')) {
    const [epochStr, rest] = version.split('!');
    epoch = parseInt(epochStr, 10) || 0;
    versionStr = rest;
    parts.push({ type: 'num', value: epoch });
  } else {
    parts.push({ type: 'num', value: 0 }); // 기본 epoch
  }

  // local 버전 분리 (예: 1.0.0+local -> 1.0.0)
  const [mainVersion] = versionStr.split('+');

  // 세그먼트 분리 (. 또는 _)
  const segments = mainVersion.split(/[._]/);

  for (const seg of segments) {
    // 숫자와 문자 분리: "3a1" -> ["3", "a", "1"]
    const subparts = seg.match(/(\d+|[a-zA-Z]+)/g) || [];

    for (let i = 0; i < subparts.length; i++) {
      const part = subparts[i];

      if (/^\d+$/.test(part)) {
        parts.push({ type: 'num', value: parseInt(part, 10) });
      } else {
        const lower = part.toLowerCase();

        // 특수 태그 처리
        if (lower === 'dev') {
          parts.push({ type: 'dev', value: lower });
        } else if (lower === 'post') {
          parts.push({ type: 'post', value: lower });
        } else if (lower === 'a' || lower === 'alpha') {
          parts.push({ type: 'alpha', value: lower });
        } else if (lower === 'b' || lower === 'beta') {
          parts.push({ type: 'beta', value: lower });
        } else if (lower === 'rc' || lower === 'c') {
          parts.push({ type: 'rc', value: lower });
        } else {
          // 문자가 시작하면 0 삽입 (conda 규칙)
          if (i === 0 && parts.length > 1) {
            parts.push({ type: 'num', value: 0 });
          }
          parts.push({ type: 'str', value: lower });
        }
      }
    }
  }

  return parts;
}

/**
 * 버전 파트 타입 순서
 * dev < alpha < beta < rc < (숫자/일반) < post
 */
function getTypeOrder(type: VersionPart['type']): number {
  switch (type) {
    case 'dev': return -3;
    case 'alpha': return -2;
    case 'beta': return -1;
    case 'rc': return 0;
    case 'num': return 1;
    case 'str': return 1;
    case 'post': return 2;
    default: return 0;
  }
}

/**
 * Conda 스타일 버전 비교
 *
 * @param a 첫 번째 버전
 * @param b 두 번째 버전
 * @returns a > b면 양수, a < b면 음수, 같으면 0
 */
export function compareCondaVersions(a: string, b: string): number {
  const partsA = parseCondaVersion(a);
  const partsB = parseCondaVersion(b);

  const maxLen = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < maxLen; i++) {
    const partA = partsA[i];
    const partB = partsB[i];

    // 하나가 없으면 0으로 처리 (1.1 == 1.1.0)
    if (!partA && !partB) continue;
    if (!partA) {
      // B가 dev/alpha/beta/rc면 A가 더 큼
      if (partB && ['dev', 'alpha', 'beta', 'rc'].includes(partB.type)) {
        return 1;
      }
      return partB && partB.type === 'post' ? -1 : (partB && partB.value !== 0 ? -1 : 0);
    }
    if (!partB) {
      // A가 dev/alpha/beta/rc면 B가 더 큼
      if (['dev', 'alpha', 'beta', 'rc'].includes(partA.type)) {
        return -1;
      }
      return partA.type === 'post' ? 1 : (partA.value !== 0 ? 1 : 0);
    }

    // 타입이 다르면 타입 순서로 비교
    const typeOrderA = getTypeOrder(partA.type);
    const typeOrderB = getTypeOrder(partB.type);
    if (typeOrderA !== typeOrderB) {
      return typeOrderA - typeOrderB;
    }

    // 같은 타입끼리 비교
    if (partA.type === 'num' && partB.type === 'num') {
      const diff = (partA.value as number) - (partB.value as number);
      if (diff !== 0) return diff;
    } else {
      const strA = String(partA.value);
      const strB = String(partB.value);
      if (strA !== strB) {
        return strA.localeCompare(strB);
      }
    }
  }

  return 0;
}

/**
 * 버전이 MatchSpec 버전 조건과 호환되는지 확인
 *
 * 지원 연산자:
 * - *: 와일드카드 (1.8.*)
 * - >=, <=, ==, !=, >, <
 * - ,: AND (>=1.8,<2.0)
 * - |: OR (1.8|1.9)
 */
export function matchesVersionSpec(version: string, spec: string): boolean {
  if (!spec || spec === '*') return true;

  // OR 처리 (|)
  if (spec.includes('|')) {
    const orParts = spec.split('|');
    return orParts.some(part => matchesVersionSpec(version, part.trim()));
  }

  // AND 처리 (,)
  if (spec.includes(',')) {
    const andParts = spec.split(',');
    return andParts.every(part => matchesVersionSpec(version, part.trim()));
  }

  // 단일 조건 처리
  return checkSingleVersionCondition(version, spec);
}

/**
 * 단일 버전 조건 체크
 */
function checkSingleVersionCondition(version: string, condition: string): boolean {
  condition = condition.trim();

  // 연산자별 처리
  if (condition.startsWith('>=')) {
    return compareCondaVersions(version, condition.slice(2).trim()) >= 0;
  }
  if (condition.startsWith('<=')) {
    return compareCondaVersions(version, condition.slice(2).trim()) <= 0;
  }
  if (condition.startsWith('!=')) {
    return version !== condition.slice(2).trim();
  }
  if (condition.startsWith('==')) {
    const target = condition.slice(2).trim();
    return matchWildcard(version, target);
  }
  if (condition.startsWith('>')) {
    return compareCondaVersions(version, condition.slice(1).trim()) > 0;
  }
  if (condition.startsWith('<')) {
    return compareCondaVersions(version, condition.slice(1).trim()) < 0;
  }

  // 연산자 없으면 와일드카드 또는 정확 매칭
  return matchWildcard(version, condition);
}

/**
 * 와일드카드 패턴 매칭
 * 예: 1.8.* matches 1.8.0, 1.8.1, 1.8.99
 */
function matchWildcard(version: string, pattern: string): boolean {
  if (pattern.includes('*')) {
    // 와일드카드를 정규식으로 변환
    const regex = new RegExp(
      '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$'
    );
    return regex.test(version);
  }

  // 정확 매칭 (1.8 == 1.8.0)
  return compareCondaVersions(version, pattern) === 0;
}

/**
 * 빌드 문자열 매칭
 * 예: *cuda* matches py39_cuda11_0
 */
export function matchesBuildSpec(build: string, spec: string): boolean {
  if (!spec || spec === '*') return true;

  // 와일드카드를 정규식으로 변환
  const regex = new RegExp(
    '^' + spec.replace(/\*/g, '.*') + '$'
  );
  return regex.test(build);
}

/**
 * PackageRecord가 MatchSpec과 일치하는지 확인
 */
export function matchesSpec(
  pkg: { name: string; version: string; build?: string },
  spec: MatchSpec
): boolean {
  // 이름 비교 (대소문자 무시)
  if (pkg.name.toLowerCase() !== spec.name.toLowerCase()) {
    return false;
  }

  // 버전 비교
  if (spec.version && !matchesVersionSpec(pkg.version, spec.version)) {
    return false;
  }

  // 빌드 문자열 비교
  if (spec.build && pkg.build && !matchesBuildSpec(pkg.build, spec.build)) {
    return false;
  }

  return true;
}
