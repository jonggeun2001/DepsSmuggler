/**
 * 검색 결과 정렬을 위한 유사도 계산 및 정렬 유틸리티
 */

/**
 * Levenshtein 거리 계산 (편집 거리)
 */
export function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;

  // 빈 문자열 처리
  if (m === 0) return n;
  if (n === 0) return m;

  // DP 테이블 생성 (공간 최적화: 2행만 사용)
  let prev = Array(n + 1).fill(0);
  let curr = Array(n + 1).fill(0);

  // 초기화
  for (let j = 0; j <= n; j++) prev[j] = j;

  // DP 계산
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // 삭제
        curr[j - 1] + 1, // 삽입
        prev[j - 1] + cost // 치환
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

/**
 * 검색용 패키지명 정규화 (비교를 위해)
 * - 소문자 변환
 * - 언더스코어/하이픈 통일
 * - 특수문자 제거
 */
export function normalizeForSearch(name: string): string {
  return name
    .toLowerCase()
    .replace(/[-_]/g, '') // 언더스코어, 하이픈 제거
    .replace(/[^a-z0-9]/g, ''); // 영숫자 외 제거
}

/**
 * 검색 결과 정렬 점수 계산
 * @param packageName - 검색된 패키지명
 * @param query - 사용자가 입력한 검색어
 * @returns 정렬 점수 (낮을수록 우선순위 높음)
 */
export function calculateRelevanceScore(packageName: string, query: string): number {
  const normalizedPkg = normalizeForSearch(packageName);
  const normalizedQuery = normalizeForSearch(query);

  // 1순위: 정확히 일치 (점수: 0)
  if (normalizedPkg === normalizedQuery) {
    return 0;
  }

  // 2순위: 정규화된 이름이 쿼리로 시작 (점수: 1-10)
  if (normalizedPkg.startsWith(normalizedQuery)) {
    return 1 + (normalizedPkg.length - normalizedQuery.length) * 0.1;
  }

  // 3순위: 정규화된 이름에 쿼리가 포함 (점수: 10-50)
  if (normalizedPkg.includes(normalizedQuery)) {
    const index = normalizedPkg.indexOf(normalizedQuery);
    return 10 + index; // 앞에 있을수록 점수 낮음
  }

  // 4순위: Levenshtein 거리 기반 유사도 (점수: 50+)
  const distance = levenshteinDistance(normalizedPkg, normalizedQuery);
  return 50 + distance * 10;
}

/**
 * 검색 결과 정렬 인터페이스
 */
export interface SortableSearchResult {
  name: string;
  [key: string]: unknown;
}

/**
 * 패키지 타입에 따른 이름 추출기
 */
export type PackageType = 'pip' | 'conda' | 'maven' | 'npm' | 'docker' | 'yum' | 'default';

/**
 * 패키지 타입별 핵심 이름 추출
 */
function extractCoreName(name: string, type: PackageType): string {
  switch (type) {
    case 'maven':
      // groupId:artifactId 형식에서 artifactId 추출
      const mavenParts = name.split(':');
      return mavenParts.length > 1 ? mavenParts[1] : name;

    case 'docker':
      // namespace/image 형식에서 image 추출
      const dockerParts = name.split('/');
      return dockerParts.length > 1 ? dockerParts[dockerParts.length - 1] : name;

    case 'npm':
      // @org/package 형식에서 package 추출
      if (name.startsWith('@')) {
        const npmParts = name.split('/');
        return npmParts.length > 1 ? npmParts[1] : name;
      }
      return name;

    default:
      return name;
  }
}

/**
 * 검색 결과를 정확성 기준으로 정렬 (공통 함수)
 * @param results - 검색 결과 배열
 * @param query - 사용자가 입력한 검색어
 * @param type - 패키지 타입 (maven, docker, npm 등) - 타입별 이름 추출 로직 적용
 * @returns 정렬된 검색 결과
 */
export function sortByRelevance<T extends SortableSearchResult>(
  results: T[],
  query: string,
  type: PackageType = 'default'
): T[] {
  if (!query || query.trim().length === 0) {
    return results;
  }

  return [...results].sort((a, b) => {
    // 전체 이름 정확 일치 우선 (모든 타입)
    const fullScoreA = calculateRelevanceScore(a.name, query);
    const fullScoreB = calculateRelevanceScore(b.name, query);

    if (fullScoreA === 0) return -1;
    if (fullScoreB === 0) return 1;

    // 핵심 이름 기준 정렬
    const coreNameA = extractCoreName(a.name, type);
    const coreNameB = extractCoreName(b.name, type);

    const scoreA = calculateRelevanceScore(coreNameA, query);
    const scoreB = calculateRelevanceScore(coreNameB, query);

    return scoreA - scoreB;
  });
}
