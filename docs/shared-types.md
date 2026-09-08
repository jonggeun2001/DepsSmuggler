# Shared Types (공통 타입 정의)

## 개요
- 목적: 모든 모듈에서 공통으로 사용하는 타입 정의
- 위치: `src/core/shared/types.ts`, `src/types/download/*.ts`, `src/types/platform/*.ts`, `*-types.ts`

중복 정의가 달라지는 것을 방지하기 위해 다음 타입은 한곳에서 관리합니다. 기존 import 경로는 타입 alias 또는 re-export로 유지하며, 런타임 데이터 형식은 바뀌지 않습니다. renderer와 Electron 타입 검사로 양쪽 사용처의 호환성을 확인합니다.

| 타입 | 공통 정의 | 재사용 위치 |
|------|-----------|------------|
| `DownloadPackageResult` | `src/core/shared/types.ts` | Electron 다운로드 라우터 |
| `ArchiveType` (`ArchiveFormat`) | `src/types/packaging.ts` | 일반·OS 패키저 |
| `OSDistributionSetting` | `src/types/platform/os-target.ts` | 설정 스토어·의존성 해결 |
| `WheelTags`, `SupportedTag` | `src/core/shared/pip-types.ts` | PyPI 태그 유틸리티 |

---

## 공통 타입 (`types.ts`)

### DownloadPackage

다운로드할 패키지 정보

```typescript
interface DownloadPackage {
  id: string;
  type: string;
  name: string;
  version: string;
  architecture?: string;
  /** 패키지 크기 (바이트) */
  size?: number;
  /** OS 패키지의 다운로드 URL (yum/apt/apk 등) */
  downloadUrl?: string;
  /** OS 패키지의 저장소 정보 */
  repository?: { baseUrl: string; name?: string };
  /** OS 패키지의 파일 경로 (저장소 내 위치) */
  location?: string;
  /** 실제 다운로드될 파일명 (예: numpy-1.24.0-py311h64a7726_0.conda, requests-2.28.0-py3-none-any.whl) */
  filename?: string;
  /** pip 커스텀 인덱스 URL (예: https://download.pytorch.org/whl/cu121) */
  indexUrl?: string;
  /** pip extras 의존성 (예: ['cuda'], ['security', 'socks']) */
  extras?: string[];
  /** Maven classifier (예: natives-linux, linux-x86_64) */
  classifier?: string;
  /** 추가 메타데이터 (Docker registry 등) */
  metadata?: Record<string, unknown>;
}
```

### DownloadOptions

다운로드 옵션

- canonical 정의: `src/types/download/options.ts`
- `src/core/shared/types.ts`는 위 canonical 모듈을 그대로 re-export 하는 shim입니다.

```typescript
interface DownloadOptions {
  outputDir: string;                       // 출력 디렉토리
  outputFormat: 'zip' | 'tar.gz';         // GUI/IPC 출력 형식
  includeScripts: boolean;                 // 설치 스크립트 포함 여부
  targetOS?: TargetOS;                     // 타겟 OS
  architecture?: Architecture;             // 아키텍처
  includeDependencies?: boolean;           // false면 의존성 해결 단계를 생략하고 원본만 사용
  pythonVersion?: string;                  // Python 버전 (pip/conda용)
  concurrency?: number;                    // 동시 다운로드 수 (기본값은 호출부에서 결정)
  deliveryMethod?: 'local' | 'email';
  email?: { to: string; from?: string; subject?: string };
  fileSplit?: { enabled: boolean; maxSizeMB: number };
  smtp?: { host: string; port: number; user?: string; password?: string; from?: string; secure?: boolean };
}
```

### DownloadProgress

다운로드 진행 상태

- canonical 정의: `src/types/download/progress.ts`

```typescript
interface DownloadProgress {
  packageId: string;
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'paused';
  progress: number;         // 0-100
  downloadedBytes: number;
  totalBytes: number;
  speed: number;            // bytes/sec
  error?: string;
}
```

### DownloadPackageResult

개별 패키지 다운로드 처리 결과

```typescript
interface DownloadPackageResult {
  id: string;
  success: boolean;
  error?: string;
}
```

### DownloadUrlResult

다운로드 URL 조회 결과

```typescript
interface DownloadUrlResult {
  url: string;
  filename: string;
  size?: number;
}
```

---

## PyPI 타입 (`pip-types.ts`)

### PyPIRelease

PyPI 릴리스 파일 정보

```typescript
interface PyPIRelease {
  filename: string;
  url: string;
  size: number;
  md5_digest: string;
  digests: {
    md5: string;
    sha256: string;
  };
  packagetype: 'sdist' | 'bdist_wheel' | 'bdist_egg';
  python_version: string;
  requires_python?: string;
  yanked?: boolean;
}
```

### PyPIInfo

PyPI 패키지 메타데이터

```typescript
interface PyPIInfo {
  name: string;
  version: string;
  summary?: string;
  author?: string;
  author_email?: string;
  license?: string;
  home_page?: string;
  project_url?: string;
  requires_dist?: string[];
  requires_python?: string;
}
```

### PyPIResponse

PyPI API 응답

```typescript
interface PyPIResponse {
  info: PyPIInfo;
  releases: Record<string, PyPIRelease[]>;
  urls: PyPIRelease[];
}
```

> **참고**: 위 내용은 이 저장소의 TypeScript 선언입니다. `releases`와 `urls`를 모두 필수로 선언하지만, 실제 원격 응답은 조회 엔드포인트에 따라 다를 수 있으므로 `pip-cache.ts`의 별도 응답 타입은 두 필드를 선택으로 선언하고, `pypi-utils.ts`의 버전별 조회는 `urls`를 사용합니다. API 응답 형식과 로컬 타입의 필수 여부를 구분해야 합니다.

### WheelTags

Wheel 파일 태그 정보 (PEP 425)

```typescript
interface WheelTags {
  pythonTags: string[];  // 예: ['cp311', 'cp3', 'py3', 'py311']
  abiTags: string[];     // 예: ['cp311', 'abi3', 'none']
  platformTags: string[]; // 예: ['manylinux_2_17_x86_64', 'linux_x86_64', 'any']
}
```

### SupportedTag

지원 태그

```typescript
interface SupportedTag {
  python: string;
  abi: string;
  platform: string;
}
```

---

## Conda 타입 (`conda-types.ts`)

### RepoDataPackage

repodata.json 패키지 구조

```typescript
interface RepoDataPackage {
  name: string;
  version: string;
  build: string;
  build_number: number;
  depends: string[];
  subdir: string;
  md5?: string;
  sha256?: string;
  size?: number;
  timestamp?: number;
}
```

### RepoData

repodata.json 전체 구조

```typescript
interface RepoData {
  info?: { subdir: string };
  packages: Record<string, RepoDataPackage>;
  'packages.conda'?: Record<string, RepoDataPackage>;
}
```

### CondaPackageFile

Anaconda API 파일 정보

```typescript
interface CondaPackageFile {
  version: string;
  basename: string;
  size: number;
  md5: string;
  sha256?: string;
  upload_time: string;
  ndownloads?: number;
  attrs: {
    subdir: string;
    build: string;
    build_number: number;
    arch?: string;
    platform?: string;
    depends?: string[];
  };
}
```

### AnacondaFileInfo

Anaconda API 파일 응답

```typescript
interface AnacondaFileInfo {
  basename: string;
  version: string;
  size: number;
  attrs: {
    subdir: string;
    build: string;
    build_number: number;
  };
  download_url: string;
}
```

---

## npm 타입 (`npm-types.ts`)

### NpmPackument

npm 패키지 전체 메타데이터 (registry에서 조회)

```typescript
interface NpmPackument {
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
```

### NpmPackageVersion

특정 버전의 패키지 정보

```typescript
interface NpmPackageVersion {
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
```

### NpmDist

배포 파일 정보

```typescript
interface NpmDist {
  tarball: string;
  shasum: string;
  integrity?: string;
  fileCount?: number;
  unpackedSize?: number;
  signatures?: NpmSignature[];
}
```

### NpmResolutionResult

의존성 해결 결과

```typescript
interface NpmResolutionResult {
  root: NpmResolvedNode;
  flatList: NpmFlatPackage[];
  conflicts: NpmConflict[];
  totalSize: number;
  totalPackages: number;
  maxDepth: number;
}
```

### NpmNode

의존성 트리 노드

```typescript
interface NpmNode {
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
```

---

## Maven 타입 (`maven-types.ts`)

### MavenCoordinate

Maven GAV 좌표

```typescript
interface MavenCoordinate {
  groupId: string;
  artifactId: string;
  version: string;
  classifier?: string;
  type?: string;
}
```

### PomProject

POM 프로젝트 정보

```typescript
interface PomProject {
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
```

### PomDependency

POM 의존성 정보

```typescript
interface PomDependency {
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
```

### ResolvedDependencyNode

해결된 의존성 노드

```typescript
interface ResolvedDependencyNode {
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
```

### Scope 전이 행렬

```typescript
const SCOPE_TRANSITION_MATRIX: Record<
  ScopeTransitionKey,
  Record<ScopeTransitionKey, ScopeTransitionResult>
> = {
  compile: { compile: 'compile', provided: null, runtime: 'runtime', test: null },
  provided: { compile: 'provided', provided: null, runtime: 'provided', test: null },
  runtime: { compile: 'runtime', provided: null, runtime: 'runtime', test: null },
  test: { compile: 'test', provided: null, runtime: 'test', test: null },
};
```

---

`ScopeTransitionKey`는 `compile | provided | runtime | test`입니다. `transitScope(parentScope, childOriginalScope)`는 이 중첩 행렬을 조회하며 `system` 자식이나 지원하지 않는 조합에는 `null`을 반환합니다.

## 관련 문서

- [Shared Utilities 개요](./shared-utilities.md)
- [pip 유틸리티](./shared-pip.md)
- [Conda 유틸리티](./shared-conda.md)
- [Maven 유틸리티](./shared-maven.md)
- [npm 유틸리티](./shared-npm.md)
