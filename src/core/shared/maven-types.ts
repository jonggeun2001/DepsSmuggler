/**
 * Maven BF 알고리즘 관련 타입 정의
 *
 * 문서 참고: docs/maven-dependency-resolution.md
 * Maven Resolver의 BF(Breadth-First) + Skipper 알고리즘 구현을 위한 타입들
 */

import { DependencyScope } from '../../types';

// ============================================
// POM 파싱 관련 타입
// ============================================

/** POM 의존성 */
export interface PomDependency {
  groupId: string;
  artifactId: string;
  version?: string;
  scope?: string;
  optional?: string | boolean;
  type?: string;
  classifier?: string;
  exclusions?: {
    exclusion: PomExclusion | PomExclusion[];
  };
}

/** POM Exclusion */
export interface PomExclusion {
  groupId: string;
  artifactId: string;
}

/** POM 플러그인 */
export interface PomPlugin {
  groupId?: string;
  artifactId: string;
  version?: string;
}

/** POM Parent */
export interface PomParent {
  groupId?: string;
  artifactId: string;
  version?: string;
  relativePath?: string;
}

/** POM 프로젝트 */
export interface PomProject {
  groupId?: string;
  artifactId?: string;
  version?: string;
  packaging?: string;
  parent?: PomParent;
  properties?: Record<string, string>;
  dependencies?: {
    dependency: PomDependency | PomDependency[];
  };
  dependencyManagement?: {
    dependencies?: {
      dependency: PomDependency | PomDependency[];
    };
  };
  build?: {
    plugins?: {
      plugin: PomPlugin | PomPlugin[];
    };
    pluginManagement?: {
      plugins?: {
        plugin: PomPlugin | PomPlugin[];
      };
    };
  };
}

// ============================================
// BF 알고리즘 관련 타입
// ============================================

/** Maven 아티팩트 좌표 */
export interface MavenCoordinate {
  groupId: string;
  artifactId: string;
  version: string;
  classifier?: string;
  type?: string;
}

/** 노드 좌표 (BF 알고리즘에서 위치 추적) */
export interface NodeCoordinate {
  depth: number;
  sequence: number;
}

/** 의존성 처리 컨텍스트 (BF 큐 아이템) */
export interface DependencyProcessingContext {
  /** Maven 좌표 */
  coordinate: MavenCoordinate;
  /** 부모 노드 경로 (순환 감지용) */
  parentPath: string[];
  /** 현재 깊이 */
  depth: number;
  /** BF 좌표 (충돌 조정용) */
  nodeCoordinate: NodeCoordinate;
  /** 적용될 scope */
  scope: DependencyScope;
  /** 원래 scope (전이 전) */
  originalScope: DependencyScope;
  /** exclusions */
  exclusions: Set<string>;
  /** 부모에서 dependencyManagement로 강제된 버전인지 */
  managedVersion: boolean;
}

/** Skipper 결과 */
export interface SkipResult {
  /** 건너뛰기 여부 */
  skip: boolean;
  /** 건너뛰기 이유 */
  reason?: 'version_conflict' | 'duplicate';
  /** 강제 해결 여부 (중복이지만 왼쪽이라 해결 필요) */
  forceResolution?: boolean;
}

/** 충돌 조정 결과 */
export interface ConflictResolutionResult {
  /** 승자 버전 */
  winnerVersion: string;
  /** 승자 경로 */
  winnerPath: string[];
  /** 충돌 유형 */
  type: 'nearest' | 'first_declaration' | 'managed';
}

/** 해결된 의존성 노드 (내부용) */
export interface ResolvedDependencyNode {
  coordinate: MavenCoordinate;
  scope: DependencyScope;
  depth: number;
  nodeCoordinate: NodeCoordinate;
  path: string[];
  children: ResolvedDependencyNode[];
  /** 충돌로 인해 생략됨 */
  omitted?: boolean;
  omitReason?: 'conflict' | 'duplicate';
  /** 충돌 시 승자 버전 */
  winnerVersion?: string;
}

/** Scope 전이 매트릭스 키 */
export type ScopeTransitionKey = 'compile' | 'provided' | 'runtime' | 'test';

/** Scope 전이 결과 */
export type ScopeTransitionResult = DependencyScope | null;

// ============================================
// 캐시 관련 타입
// ============================================

/** POM 캐시 엔트리 */
export interface PomCacheEntry {
  pom: PomProject;
  fetchedAt: number;
  effectiveGroupId: string;
  effectiveVersion: string;
}

/** 의존성 캐시 키 (G:A:V 기준, exclusions 무관) */
export type DependencyCacheKey = string;

/** 해결된 의존성 캐시 */
export interface ResolvedDependencyCache {
  coordinate: MavenCoordinate;
  dependencies: MavenCoordinate[];
  scope: DependencyScope;
}

// ============================================
// 병렬 처리 관련 타입
// ============================================

/** POM 다운로드 작업 */
export interface PomDownloadTask {
  coordinate: MavenCoordinate;
  promise: Promise<PomProject>;
}

/** 병렬 다운로더 옵션 */
export interface ParallelDownloaderOptions {
  /** 동시 다운로드 수 (기본값: 5) */
  concurrency?: number;
  /** 요청 타임아웃 (ms) */
  timeout?: number;
  /** 재시도 횟수 */
  retries?: number;
}

// ============================================
// 헬퍼 함수
// ============================================

/**
 * Maven 좌표를 문자열로 변환 (G:A:V)
 */
export function coordinateToString(coord: MavenCoordinate): string {
  const base = `${coord.groupId}:${coord.artifactId}:${coord.version}`;
  if (coord.classifier) {
    return `${base}:${coord.classifier}`;
  }
  return base;
}

/**
 * Maven 좌표를 키로 변환 (G:A, 버전 제외)
 */
export function coordinateToKey(coord: MavenCoordinate): string {
  return `${coord.groupId}:${coord.artifactId}`;
}

/**
 * 문자열을 Maven 좌표로 파싱
 */
export function parseCoordinate(str: string): MavenCoordinate | null {
  const parts = str.split(':');
  if (parts.length < 3) return null;

  return {
    groupId: parts[0],
    artifactId: parts[1],
    version: parts[2],
    classifier: parts[3],
  };
}

/**
 * Exclusion 키 생성 (G:A)
 */
export function exclusionKey(groupId: string, artifactId: string): string {
  // 와일드카드 처리
  const g = groupId === '*' ? '*' : groupId;
  const a = artifactId === '*' ? '*' : artifactId;
  return `${g}:${a}`;
}

/**
 * Exclusion 매칭 확인
 */
export function matchesExclusion(
  coordinate: MavenCoordinate,
  exclusions: Set<string>
): boolean {
  const exactKey = exclusionKey(coordinate.groupId, coordinate.artifactId);
  if (exclusions.has(exactKey)) return true;

  // 와일드카드 체크
  if (exclusions.has(`*:${coordinate.artifactId}`)) return true;
  if (exclusions.has(`${coordinate.groupId}:*`)) return true;
  if (exclusions.has('*:*')) return true;

  return false;
}

/**
 * Scope 전이 매트릭스
 * 직접 의존성의 scope → 전이적 의존성의 원래 scope → 결과 scope
 */
export const SCOPE_TRANSITION_MATRIX: Record<
  ScopeTransitionKey,
  Record<ScopeTransitionKey, ScopeTransitionResult>
> = {
  compile: {
    compile: 'compile',
    provided: null,
    runtime: 'runtime',
    test: null,
  },
  provided: {
    compile: 'provided',
    provided: null,
    runtime: 'provided',
    test: null,
  },
  runtime: {
    compile: 'runtime',
    provided: null,
    runtime: 'runtime',
    test: null,
  },
  test: {
    compile: 'test',
    provided: null,
    runtime: 'test',
    test: null,
  },
};

/**
 * Scope 전이 계산
 * @param parentScope 부모의 scope
 * @param childOriginalScope 자식의 원래 scope
 * @returns 전이된 scope 또는 null (포함하지 않음)
 */
export function transitScope(
  parentScope: DependencyScope,
  childOriginalScope: DependencyScope
): DependencyScope | null {
  // system scope는 전이되지 않음
  if (childOriginalScope === 'system') return null;

  const parent = parentScope as ScopeTransitionKey;
  const child = childOriginalScope as ScopeTransitionKey;

  if (parent in SCOPE_TRANSITION_MATRIX && child in SCOPE_TRANSITION_MATRIX[parent]) {
    return SCOPE_TRANSITION_MATRIX[parent][child];
  }

  return null;
}
