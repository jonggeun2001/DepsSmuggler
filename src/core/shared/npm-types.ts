/**
 * npm Registry API 및 의존성 해결 관련 타입 정의
 * Arborist 알고리즘 기반
 */

// ====================
// npm Registry API 타입
// ====================

/**
 * npm registry 패키지 메타데이터 (packument)
 */
export interface NpmPackument {
  _id: string;
  _rev?: string;
  name: string;
  'dist-tags': Record<string, string>;
  versions: Record<string, NpmPackageVersion>;
  time?: Record<string, string>;
  maintainers?: NpmPerson[];
  description?: string;
  homepage?: string;
  keywords?: string[];
  repository?: NpmRepository;
  author?: NpmPerson;
  bugs?: { url?: string; email?: string };
  license?: string;
  readme?: string;
  readmeFilename?: string;
}

/**
 * 특정 버전의 패키지 정보
 */
export interface NpmPackageVersion {
  name: string;
  version: string;
  description?: string;
  main?: string;
  types?: string;
  typings?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, PeerDependencyMeta>;
  optionalDependencies?: Record<string, string>;
  bundleDependencies?: string[];
  bundledDependencies?: string[];
  engines?: Record<string, string>;
  os?: string[];
  cpu?: string[];
  dist: NpmDist;
  repository?: NpmRepository;
  author?: NpmPerson;
  maintainers?: NpmPerson[];
  keywords?: string[];
  license?: string;
  homepage?: string;
  bugs?: { url?: string; email?: string };
  deprecated?: string;
  _id?: string;
  _npmVersion?: string;
  _nodeVersion?: string;
  _npmUser?: NpmPerson;
  _hasShrinkwrap?: boolean;
}

export interface NpmDist {
  tarball: string;
  shasum: string;
  integrity?: string;
  fileCount?: number;
  unpackedSize?: number;
  signatures?: NpmSignature[];
}

export interface NpmSignature {
  keyid: string;
  sig: string;
}

export interface NpmPerson {
  name?: string;
  email?: string;
  url?: string;
}

export interface NpmRepository {
  type?: string;
  url?: string;
  directory?: string;
}

export interface PeerDependencyMeta {
  optional?: boolean;
}

// ====================
// Arborist 그래프 타입
// ====================

/**
 * 의존성 유형
 */
export type DependencyType =
  | 'prod'          // dependencies
  | 'dev'           // devDependencies
  | 'peer'          // peerDependencies
  | 'peerOptional'  // peerDependencies with optional: true
  | 'optional';     // optionalDependencies

/**
 * Edge - 두 노드 간의 의존성 관계
 */
export interface NpmEdge {
  from: string;        // 의존하는 패키지 (name@version)
  to: string | null;   // 의존되는 패키지 (해결된 경우)
  name: string;        // 패키지명
  type: DependencyType;
  spec: string;        // 버전 요구사항 (예: "^1.0.0")
  valid: boolean;      // 현재 만족 여부
}

/**
 * Node - 의존성 트리의 노드
 */
export interface NpmNode {
  name: string;
  version: string;
  depth: number;
  path: string;        // node_modules 경로
  parent: string | null;
  children: Map<string, NpmNode>;
  edgesOut: Map<string, NpmEdge>;
  edgesIn: Set<NpmEdge>;
  packageInfo: NpmPackageVersion;
  isRoot: boolean;
  optional: boolean;
  dev: boolean;
  peer: boolean;
}

/**
 * 배치 결과
 */
export type PlacementResult = 'OK' | 'KEEP' | 'REPLACE' | 'CONFLICT';

/**
 * 배치 정보
 */
export interface PlaceDepResult {
  result: PlacementResult;
  target: string | null;      // 배치될 위치
  existing: string | null;    // 기존 패키지 (있는 경우)
}

// ====================
// 의존성 해결 타입
// ====================

/**
 * 해결된 의존성 노드
 */
export interface NpmResolvedNode {
  name: string;
  version: string;
  dist: NpmDist;
  dependencies: NpmResolvedNode[];
  devDependencies?: NpmResolvedNode[];
  peerDependencies?: NpmResolvedNode[];
  optionalDependencies?: NpmResolvedNode[];
  depth: number;
  hoistedPath: string;     // 호이스팅된 경로
  type: DependencyType;
  optional: boolean;
}

/**
 * 의존성 해결 결과
 */
export interface NpmResolutionResult {
  root: NpmResolvedNode;
  flatList: NpmFlatPackage[];
  conflicts: NpmConflict[];
  totalSize: number;
  totalPackages: number;
  maxDepth: number;
}

/**
 * 평탄화된 패키지 정보
 */
export interface NpmFlatPackage {
  name: string;
  version: string;
  tarball: string;
  integrity?: string;
  shasum: string;
  size?: number;
  hoistedPath: string;
  dependencies?: Record<string, string>;
}

/**
 * 의존성 충돌 정보
 */
export interface NpmConflict {
  type: 'version' | 'peer';
  packageName: string;
  requestedVersions: string[];
  resolvedVersion: string;
  reason?: string;
}

// ====================
// 리졸버 옵션
// ====================

/**
 * npm 리졸버 옵션
 */
export interface NpmResolverOptions {
  /** 최대 탐색 깊이 (기본값: 50) */
  maxDepth?: number;

  /** devDependencies 포함 여부 (기본값: false) */
  includeDev?: boolean;

  /** optionalDependencies 포함 여부 (기본값: false) */
  includeOptional?: boolean;

  /** peerDependencies 자동 설치 (기본값: true, npm v7+ 동작) */
  installPeers?: boolean;

  /** 중복 최소화 우선 (기본값: false) */
  preferDedupe?: boolean;

  /** 레거시 peer deps 모드 (충돌 시 경고만, 기본값: false) */
  legacyPeerDeps?: boolean;

  /** 엄격한 peer deps 모드 (충돌 시 에러, 기본값: false) */
  strictPeerDeps?: boolean;

  /** 설치 전략 */
  installStrategy?: 'hoisted' | 'nested' | 'shallow';

  /** 특정 Node.js 버전 (engines 필터링용) */
  nodeVersion?: string;

  /** package-lock.json 내용 (있으면 버전 고정) */
  lockfile?: NpmLockfile;
}

// ====================
// package-lock.json 타입
// ====================

/**
 * package-lock.json (lockfileVersion 2/3)
 */
export interface NpmLockfile {
  name: string;
  version: string;
  lockfileVersion: 2 | 3;
  requires?: boolean;
  packages: Record<string, NpmLockfilePackage>;
}

export interface NpmLockfilePackage {
  version: string;
  resolved?: string;
  integrity?: string;
  dev?: boolean;
  optional?: boolean;
  peer?: boolean;
  devOptional?: boolean;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, PeerDependencyMeta>;
  optionalDependencies?: Record<string, string>;
  engines?: Record<string, string>;
  os?: string[];
  cpu?: string[];
  bin?: Record<string, string> | string;
}

// ====================
// 다운로더 타입
// ====================

/**
 * npm 패키지 검색 결과
 */
export interface NpmSearchResult {
  package: {
    name: string;
    scope?: string;
    version: string;
    description?: string;
    keywords?: string[];
    date?: string;
    links?: {
      npm?: string;
      homepage?: string;
      repository?: string;
      bugs?: string;
    };
    author?: NpmPerson;
    publisher?: NpmPerson;
    maintainers?: NpmPerson[];
  };
  score: {
    final: number;
    detail: {
      quality: number;
      popularity: number;
      maintenance: number;
    };
  };
  searchScore: number;
}

export interface NpmSearchResponse {
  objects: NpmSearchResult[];
  total: number;
  time: string;
}

// ====================
// 유틸리티 타입
// ====================

/**
 * Semver 범위 파싱 결과
 */
export interface SemverRange {
  raw: string;
  operator: '^' | '~' | '>' | '>=' | '<' | '<=' | '=' | '' | '*' | 'x';
  major?: number;
  minor?: number;
  patch?: number;
  prerelease?: string[];
}

/**
 * 의존성 큐 아이템
 */
export interface DepsQueueItem {
  name: string;
  spec: string;
  type: DependencyType;
  depth: number;
  path: string;
  parent: string | null;
  edge: NpmEdge;
}

/**
 * 메타데이터 캐시 엔트리
 */
export interface PackumentCacheEntry {
  packument: NpmPackument;
  fetchedAt: number;
}

/**
 * 해결된 버전 캐시 키
 */
export interface VersionCacheKey {
  name: string;
  spec: string;
}
