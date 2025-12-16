/**
 * Maven POM 파싱 유틸리티 함수
 *
 * MavenResolver에서 분리된 순수 유틸리티 함수들
 * 상태를 가지지 않으며, 입력에 대해 결정적인 출력을 반환
 */

import {
  PomProject,
  PomDependency,
  MavenCoordinate,
  coordinateToString,
  exclusionKey,
} from './maven-types';
import logger from '../../utils/logger';

/**
 * POM에서 의존성 목록 추출
 *
 * @param pom - 파싱된 POM 프로젝트
 * @param coordinate - 현재 POM의 좌표
 * @param isRoot - 루트 POM 여부
 * @returns 의존성 목록
 */
export function extractDependencies(
  pom: PomProject,
  coordinate: MavenCoordinate,
  isRoot = false
): PomDependency[] {
  // 실제 <dependencies> 섹션만 반환
  const deps = pom.dependencies?.dependency;
  if (deps) {
    return Array.isArray(deps) ? deps : [deps];
  }

  // <dependencies>가 없으면 빈 배열 반환
  // Parent POM / BOM의 dependencyManagement는 버전 관리용이므로 의존성으로 처리하지 않음
  // (dependencyManagement의 630개 이상 항목을 모두 다운로드하면 스택 오버플로우 및 불필요한 다운로드 발생)
  if (isRoot && pom.packaging === 'pom') {
    logger.info(
      `Parent/BOM POM 감지: ${coordinateToString(coordinate)} - 실제 의존성 없음 (dependencyManagement는 버전 관리용)`
    );
  }

  return [];
}

/**
 * 의존성에서 제외 항목 추출
 *
 * @param dep - POM 의존성
 * @returns 제외 항목 Set (groupId:artifactId 형식)
 */
export function extractExclusions(dep: PomDependency): Set<string> {
  const exclusions = new Set<string>();

  if (dep.exclusions?.exclusion) {
    const excls = Array.isArray(dep.exclusions.exclusion)
      ? dep.exclusions.exclusion
      : [dep.exclusions.exclusion];

    for (const excl of excls) {
      exclusions.add(exclusionKey(excl.groupId, excl.artifactId));
    }
  }

  return exclusions;
}

/**
 * Maven 버전 범위를 구체적인 버전으로 해결
 *
 * @param version - 버전 문자열 (범위 포함 가능)
 * @returns 해결된 버전 문자열
 *
 * @example
 * resolveVersionRange('[1.0,2.0)') // '1.0'
 * resolveVersionRange('1.0.0') // '1.0.0'
 */
export function resolveVersionRange(version: string): string {
  // [1.0,2.0) 같은 범위 표기 처리
  if (version.startsWith('[') || version.startsWith('(')) {
    const match = version.match(/[[(]([^,\])]+)/);
    if (match) {
      return match[1];
    }
  }
  return version;
}

/**
 * Maven 프로퍼티 치환
 *
 * ${property.name} 형태의 플레이스홀더를 실제 값으로 치환
 *
 * @param value - 치환할 문자열
 * @param properties - 프로퍼티 맵
 * @returns 치환된 문자열
 *
 * @example
 * resolveProperty('${spring.version}', { 'spring.version': '5.3.0' }) // '5.3.0'
 */
export function resolveProperty(
  value: string,
  properties?: Record<string, string>
): string {
  if (!value) return value;

  // value가 문자열이 아닌 경우 문자열로 변환
  let resolved = typeof value === 'string' ? value : String(value);
  let iterations = 0;
  const maxIterations = 10; // 무한 루프 방지

  while (resolved.includes('${') && iterations < maxIterations) {
    const before = resolved;
    resolved = resolved.replace(/\$\{([^}]+)\}/g, (_, key) => {
      // 특수 키 처리
      if (key === 'project.version' || key === 'pom.version') {
        return properties?.['version'] || _;
      }
      if (key === 'project.groupId' || key === 'pom.groupId') {
        return properties?.['groupId'] || _;
      }
      if (key === 'project.artifactId' || key === 'pom.artifactId') {
        return properties?.['artifactId'] || _;
      }
      return properties?.[key] || _;
    });

    if (resolved === before) break; // 더 이상 치환할 것이 없음
    iterations++;
  }

  return resolved;
}

/**
 * 의존성 좌표 해결
 *
 * 프로퍼티 치환 및 dependencyManagement에서 버전 조회
 *
 * @param dep - POM 의존성
 * @param properties - 프로퍼티 맵
 * @param dependencyManagement - 버전 관리 맵
 * @returns 해결된 Maven 좌표 또는 null
 */
export function resolveDependencyCoordinate(
  dep: PomDependency,
  properties?: Record<string, string>,
  dependencyManagement?: Map<string, string>
): MavenCoordinate | null {
  let version = resolveProperty(dep.version || '', properties);

  // dependencyManagement에서 버전 찾기
  if (!version && dependencyManagement) {
    const managedKey = `${dep.groupId}:${dep.artifactId}`;
    version = dependencyManagement.get(managedKey) || '';
  }

  if (!version) {
    logger.debug('버전 정보 없음', { groupId: dep.groupId, artifactId: dep.artifactId });
    return null;
  }

  // 버전 범위 처리 (단순화: 범위의 첫 번째 버전 사용)
  version = resolveVersionRange(version);

  return {
    groupId: dep.groupId,
    artifactId: dep.artifactId,
    version,
    classifier: dep.classifier,
    type: dep.type,
  };
}
