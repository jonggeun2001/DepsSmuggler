# Shared Types (공통 타입 정의)

## 개요
- 목적: 모든 모듈에서 공통으로 사용하는 타입 정의
- 위치: `src/core/shared/types.ts`, `src/types/download/*.ts`, `src/types/platform/*.ts`, `*-types.ts`

---

## 공통 타입 (`types.ts`)

### DownloadPackage

다운로드할 패키지 정보

```typescript
interface DownloadPackage {
  id: string;
  type: string;           // 'pip' | 'conda' | 'maven' | 'npm' | 'yum' | 'apt' | 'apk' | 'docker'
  name: string;           // 패키지명
  version: string;        // 버전
  architecture?: string;  // 아키텍처 (예: 'x86_64', 'arm64')
  /** OS 패키지의 다운로드 URL (yum/apt/apk 등) */
  downloadUrl?: string;
  /** OS 패키지의 저장소 정보 */
  repository?: { baseUrl: string; name?: string };
  /** OS 패키지의 파일 경로 (저장소 내 위치) */
  location?: string;
  /** pip 커스텀 인덱스 URL (예: PyTorch CUDA) */
  indexUrl?: string;
  /** pip extras 의존성 (예: ['cuda'], ['security', 'socks']) */
  extras?: string[];
  /** Maven classifier (예: 'natives-linux', 'linux-x86_64') */
  classifier?: string;
  /** Docker 이미지 메타데이터 (레지스트리 정보 등) */
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
  concurrency?: number;                    // 동시 다운로드 수 (기본: 3)
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
  releases?: Record<string, PyPIRelease[]>;  // 특정 버전 조회 시 없을 수 있음
  urls?: PyPIRelease[];  // 특정 버전 조회 시 포함
}
```

> **참고**: PyPI API는 버전 지정 여부에 따라 응답 구조가 다릅니다:
> - 버전 없이 조회 (`/pypi/{package}/json`): `releases` 포함
> - 버전 지정 조회 (`/pypi/{package}/{version}/json`): `urls` 포함, `releases` 없음

### WheelTags

Wheel 파일 태그 정보 (PEP 425)

```typescript
interface WheelTags {
  pythonTags: string[];   // 예: ['cp311', 'cp3', 'py3', 'py311']
  abiTags: string[];      // 예: ['cp311', 'abi3', 'none']
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
  name: string;
  'dist-tags': Record<string, string>;  // 예: { latest: '1.0.0' }
  versions: Record<string, NpmPackageVersion>;
  time?: Record<string, string>;        // 버전별 발행 시간
}
```

### NpmPackageVersion

특정 버전의 패키지 정보

```typescript
interface NpmPackageVersion {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, PeerDependencyMeta>;
  dist: NpmDist;
}
```

### NpmDist

배포 파일 정보

```typescript
interface NpmDist {
  tarball: string;      // 다운로드 URL
  shasum: string;       // SHA1 해시
  integrity?: string;   // SHA512 SRI 해시
  fileCount?: number;
  unpackedSize?: number;
}
```

### NpmResolutionResult

의존성 해결 결과

```typescript
interface NpmResolutionResult {
  packages: NpmFlatPackage[];  // 플랫 패키지 목록
  conflicts: NpmConflict[];    // 충돌 목록
  tree: NpmNode;               // 의존성 트리
}
```

### NpmNode

의존성 트리 노드

```typescript
interface NpmNode {
  name: string;
  version: string;
  path: string;                      // node_modules 경로
  dependencies?: Record<string, NpmNode>;
  depth: number;
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
  packaging?: string;
}
```

### PomProject

POM 프로젝트 정보

```typescript
interface PomProject {
  groupId?: string;
  artifactId: string;
  version?: string;
  packaging?: string;
  parent?: PomParent;
  properties?: Record<string, string>;
  dependencyManagement?: { dependencies: PomDependency[] };
  dependencies?: PomDependency[];
  build?: { plugins?: PomPlugin[] };
}
```

### PomDependency

POM 의존성 정보

```typescript
interface PomDependency {
  groupId: string;
  artifactId: string;
  version?: string;
  scope?: 'compile' | 'provided' | 'runtime' | 'test' | 'system';
  optional?: boolean;
  exclusions?: PomExclusion[];
  classifier?: string;
  type?: string;
}
```

### ResolvedDependencyNode

해결된 의존성 노드

```typescript
interface ResolvedDependencyNode {
  coordinate: MavenCoordinate;
  scope: string;
  depth: number;
  children: ResolvedDependencyNode[];
  downloadUrl?: string;
  parentPath: string[];
}
```

### Scope 전이 행렬

```typescript
const SCOPE_TRANSITION_MATRIX: Record<ScopeTransitionKey, ScopeTransitionResult> = {
  'compile:compile': 'compile',
  'compile:runtime': 'runtime',
  'compile:provided': null,      // 전이 안됨
  'compile:test': null,
  'runtime:compile': 'runtime',
  'runtime:runtime': 'runtime',
  'provided:compile': 'provided',
  'test:compile': 'test',
  // ...
};
```

---

## 관련 문서

- [Shared Utilities 개요](./shared-utilities.md)
- [pip 유틸리티](./shared-pip.md)
- [Conda 유틸리티](./shared-conda.md)
- [Maven 유틸리티](./shared-maven.md)
- [npm 유틸리티](./shared-npm.md)
