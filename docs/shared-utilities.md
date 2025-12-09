# Shared Utilities 모듈

## 개요
- 목적: 메인 프로세스와 다른 모듈에서 공통으로 사용하는 유틸리티 함수 및 타입
- 위치: `src/core/shared/`

---

## 모듈 구조

```
src/core/shared/
├── index.ts                      # 모듈 진입점
├── types.ts                      # 공통 타입 정의
├── pip-types.ts                  # PyPI 관련 타입 정의
├── conda-types.ts                # Conda 관련 타입 정의
├── npm-types.ts                  # npm 관련 타입 정의
├── maven-types.ts                # Maven 관련 타입 정의
├── version-utils.ts              # 버전 비교/호환성 유틸리티
├── pypi-utils.ts                 # PyPI 다운로드 URL 조회
├── conda-utils.ts                # Conda 패키지 URL 조회
├── dependency-resolver.ts        # 의존성 해결 유틸리티
├── file-utils.ts                 # 파일 다운로드/압축 유틸리티
├── script-utils.ts               # 설치 스크립트 생성
│
│   # pip 고급 의존성 해결 모듈
├── pip-backtracking-resolver.ts  # pip 백트래킹 Resolver
├── pip-candidate.ts              # 후보 평가기
├── pip-provider.ts               # resolvelib Provider 구현
├── pip-tags.ts                   # PEP 425 태그 생성/매칭
├── pip-wheel.ts                  # Wheel 파일 파싱/선택
│
│   # conda 고급 모듈
├── conda-cache.ts                # repodata 캐싱 시스템
├── conda-matchspec.ts            # MatchSpec 파싱/매칭
│
│   # maven 고급 모듈
├── maven-skipper.ts              # 의존성 스킵/캐시 관리
│
│   # 검색 유틸리티
└── search-utils.ts               # 검색 결과 정렬/관련성 점수 계산
```

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
  /** Docker 이미지 메타데이터 (레지스트리 정보 등) */
  metadata?: Record<string, unknown>;
}
```

### DownloadOptions

다운로드 옵션

```typescript
interface DownloadOptions {
  outputDir: string;                       // 출력 디렉토리
  outputFormat: 'zip' | 'tar.gz' | 'mirror'; // 출력 형식
  includeScripts: boolean;                 // 설치 스크립트 포함 여부
  targetOS?: TargetOS;                     // 타겟 OS
  architecture?: Architecture;             // 아키텍처
  includeDependencies?: boolean;           // 의존성 포함 여부
  pythonVersion?: string;                  // Python 버전 (pip/conda용)
  concurrency?: number;                    // 동시 다운로드 수 (기본: 3)
}
```

### DownloadProgress

다운로드 진행 상태

```typescript
interface DownloadProgress {
  packageId: string;
  status: 'pending' | 'downloading' | 'completed' | 'failed';
  progress: number;         // 0-100
  downloadedBytes: number;
  totalBytes: number;
  speed: number;            // bytes/sec
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
  releases: Record<string, PyPIRelease[]>;
  urls: PyPIRelease[];
}
```

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

## 버전 유틸리티 (`version-utils.ts`)

버전 비교 및 호환성 체크 유틸리티 (pip/conda/maven 공용)

### 주요 함수

| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `compareVersions` | a: string, b: string | number | 버전 비교 (a > b면 양수) |
| `isVersionCompatible` | version: string, spec: string | boolean | 버전 스펙 호환성 체크 |
| `sortVersionsDescending` | versions: string[] | string[] | 버전 내림차순 정렬 |
| `sortVersionsAscending` | versions: string[] | string[] | 버전 오름차순 정렬 |
| `findLatestCompatibleVersion` | versions: string[], spec: string | string \| null | 호환되는 최신 버전 찾기 |

### 지원 버전 스펙

- `>=`, `<=`, `>`, `<` - 비교 연산자
- `==` - 정확히 일치 (와일드카드 `*` 지원)
- `!=` - 불일치
- `~=` - 호환 릴리스 (예: `~=2.1`은 `>=2.1, ==2.*`)
- `,` - AND 연산
- `|` - OR 연산

### 사용 예시

```typescript
import { isVersionCompatible, findLatestCompatibleVersion } from './version-utils';

// 버전 호환성 체크
isVersionCompatible('2.5.0', '>=2.0,<3.0'); // true
isVersionCompatible('1.9.0', '>=2.0,<3.0'); // false

// 호환되는 최신 버전 찾기
const versions = ['1.0.0', '2.0.0', '2.5.0', '3.0.0'];
findLatestCompatibleVersion(versions, '>=2.0,<3.0'); // '2.5.0'
```

---

## PyPI 유틸리티 (`pypi-utils.ts`)

### 주요 함수

| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `getPyPIDownloadUrl` | packageName, version, pythonVersion?, os?, architecture? | Promise<DownloadUrlResult \| null> | 최적 wheel/sdist URL 조회 |
| `parseWheelTags` | filename: string | WheelTags \| null | wheel 파일명에서 태그 파싱 |
| `generateSupportedTags` | pythonVersion?, os?, arch? | SupportedTag[] | 지원 태그 목록 생성 |
| `selectBestRelease` | releases, supportedTags | PyPIRelease \| null | 최적 릴리스 선택 |
| `isCompatiblePlatform` | platformTag, os?, arch? | boolean | 플랫폼 호환성 체크 |

### getPyPIDownloadUrl

PyPI 패키지의 최적 다운로드 URL 조회

```typescript
async function getPyPIDownloadUrl(
  packageName: string,
  version: string,
  pythonVersion?: string,  // 예: '3.11'
  targetOS?: string,       // 예: 'linux', 'macos', 'windows'
  architecture?: string    // 예: 'x86_64', 'arm64'
): Promise<DownloadUrlResult | null>
```

- Python 버전, OS, 아키텍처에 맞는 wheel 파일 우선 선택
- wheel이 없으면 sdist(소스 배포판) 선택
- PEP 425, PEP 427 표준 준수

### 사용 예시

```typescript
import { getPyPIDownloadUrl } from './pypi-utils';

// Python 3.11, Linux x86_64 용 wheel 찾기
const result = await getPyPIDownloadUrl(
  'numpy',
  '1.26.0',
  '3.11',
  'linux',
  'x86_64'
);

console.log(result);
// {
//   url: 'https://files.pythonhosted.org/.../numpy-1.26.0-cp311-cp311-manylinux_2_17_x86_64.whl',
//   filename: 'numpy-1.26.0-cp311-cp311-manylinux_2_17_x86_64.whl',
//   size: 18012345
// }
```

---

## Conda 유틸리티 (`conda-utils.ts`)

### 주요 함수

| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `getCondaDownloadUrl` | packageName, version, architecture?, targetOS?, channel?, pythonVersion? | Promise<DownloadUrlResult \| null> | Conda 패키지 URL 조회 |
| `getCondaSubdir` | targetOS?, architecture? | string | OS/아키텍처에서 conda subdir 결정 |

### getCondaDownloadUrl

Conda 패키지의 다운로드 URL 조회 (repodata.json 기반)

```typescript
async function getCondaDownloadUrl(
  packageName: string,
  version: string,
  architecture?: string,    // 예: 'x86_64', 'arm64'
  targetOS?: string,        // 예: 'linux', 'macos', 'windows'
  channel?: string,         // 예: 'conda-forge' (기본값)
  pythonVersion?: string    // 예: '3.12'
): Promise<DownloadUrlResult | null>
```

### 특징

- **repodata.json.zst 지원**: zstd 압축 파일 우선 사용 (더 빠른 다운로드)
- **캐싱**: repodata 캐싱으로 중복 요청 방지
- **Python 버전 필터링**: py312, py311 등 build 태그로 Python 버전에 맞는 패키지 선택
- **noarch 지원**: 아키텍처 독립 패키지 자동 탐색
- **Anaconda API fallback**: RC 버전 등 특수 라벨 패키지 지원

### Subdir 매핑

| OS | 아키텍처 | Subdir |
|----|----------|--------|
| linux | x86_64 | linux-64 |
| linux | arm64/aarch64 | linux-aarch64 |
| macos/darwin | x86_64 | osx-64 |
| macos/darwin | arm64 | osx-arm64 |
| windows | x86_64 | win-64 |
| windows | arm64 | win-arm64 |

### 사용 예시

```typescript
import { getCondaDownloadUrl, getCondaSubdir } from './conda-utils';

// subdir 결정
const subdir = getCondaSubdir('linux', 'arm64'); // 'linux-aarch64'

// 패키지 URL 조회
const result = await getCondaDownloadUrl(
  'numpy',
  '1.26.0',
  'x86_64',
  'linux',
  'conda-forge',
  '3.12'
);

console.log(result);
// {
//   url: 'https://conda.anaconda.org/conda-forge/linux-64/numpy-1.26.0-py312h8753938_0.conda',
//   filename: 'numpy-1.26.0-py312h8753938_0.conda',
//   size: 6789012
// }
```

---

## 의존성 해결 (`dependency-resolver.ts`)

### 주요 함수

| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `resolveAllDependencies` | packages: DownloadPackage[], options?: DependencyResolverOptions | Promise<ResolvedPackageList> | 모든 패키지의 의존성 해결 |
| `resolveSinglePackageDependencies` | pkg: DownloadPackage, options?: DependencyResolverOptions | Promise<ResolvedPackageList> | 단일 패키지 의존성 해결 |

### 지원 패키지 타입

| 타입 | 리졸버 | 비고 |
|------|--------|------|
| `pip` | PipResolver | PyPI 의존성 |
| `conda` | CondaResolver | Conda 의존성 |
| `maven` | MavenResolver | Maven 의존성 |
| `npm` | NpmResolver | npm 의존성 (신규) |
| `yum` | YumResolver | RPM 의존성 |

> **참고**: apt, apk 리졸버는 인터페이스가 달라 별도 어댑터 필요

### ResolvedPackageList

```typescript
interface ResolvedPackageList {
  originalPackages: DownloadPackage[];  // 원본 패키지 목록
  allPackages: DownloadPackage[];       // 의존성 포함 전체 목록
  dependencyTrees: DependencyResolutionResult[];  // 의존성 트리
  failedPackages: { name: string; version: string; error: string }[];  // 실패 목록
}
```

### DependencyResolverOptions

```typescript
interface DependencyResolverOptions {
  maxDepth?: number;        // 최대 탐색 깊이 (기본: 5)
  includeOptional?: boolean; // 선택적 의존성 포함 (기본: false)
  condaChannel?: string;    // conda 채널 (기본: 'conda-forge')
  yumRepoUrl?: string;      // yum 저장소 URL
  architecture?: string;    // 아키텍처 (기본: 'x86_64')
  pythonVersion?: string;   // Python 버전 (예: '3.12')
  targetOS?: string;        // 타겟 OS (예: 'linux')
}
```

### 사용 예시

```typescript
import { resolveAllDependencies, DownloadPackage } from '../shared';

const packages: DownloadPackage[] = [
  { id: '1', type: 'pip', name: 'requests', version: '2.28.0' },
  { id: '2', type: 'maven', name: 'org.springframework:spring-core', version: '5.3.0' },
];

const result = await resolveAllDependencies(packages, {
  maxDepth: 3,
  includeOptional: false,
  pythonVersion: '3.11',
  targetOS: 'linux',
  architecture: 'x86_64',
});

console.log(`총 ${result.allPackages.length}개 패키지 (의존성 포함)`);
```

---

## 파일 유틸리티 (`file-utils.ts`)

### downloadFile

파일 다운로드 (진행률 콜백 지원)

```typescript
async function downloadFile(
  url: string,
  destPath: string,
  onProgress: (downloaded: number, total: number) => void
): Promise<void>
```

- HTTP/HTTPS 모두 지원
- 리다이렉트 자동 처리

### createZipArchive

ZIP 압축 파일 생성

```typescript
async function createZipArchive(
  sourceDir: string,
  outputPath: string
): Promise<void>
```

### createTarGzArchive

tar.gz 압축 파일 생성

```typescript
async function createTarGzArchive(
  sourceDir: string,
  outputPath: string
): Promise<void>
```

---

## 스크립트 유틸리티 (`script-utils.ts`)

### generateInstallScripts

설치 스크립트 생성 (Bash + PowerShell)

```typescript
function generateInstallScripts(
  outputDir: string,
  packages: DownloadPackage[]
): void
```

- `install.sh` (Bash): Linux/macOS용
- `install.ps1` (PowerShell): Windows용
- `docker-load.sh` (Bash): Docker 이미지 로드용 (Docker 패키지 포함 시 자동 생성)
- `docker-load.ps1` (PowerShell): Docker 이미지 로드용 (Docker 패키지 포함 시 자동 생성)

### 생성되는 스크립트 예시

**install.sh:**
```bash
#!/bin/bash
# DepsSmuggler 설치 스크립트
set -e
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# pip 패키지 설치
pip install --no-index --find-links="$SCRIPT_DIR/packages" requests==2.28.0
```

**docker-load.sh:** (Docker 이미지 포함 시 자동 생성)
```bash
#!/bin/bash
# DepsSmuggler Docker 이미지 로드 스크립트
set -e
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Docker 설치 확인
if ! command -v docker &> /dev/null; then
    echo "Error: Docker가 설치되어 있지 않습니다."
    exit 1
fi

# Docker 데몬 실행 확인
if ! docker info &> /dev/null; then
    echo "Error: Docker 데몬이 실행 중이지 않습니다."
    exit 1
fi

# 이미지 로드
echo "Loading nginx:latest..."
docker load -i "$SCRIPT_DIR/packages/nginx-latest.tar"
echo "  ✓ nginx:latest 로드 완료"
```

**docker-load.ps1:** (Windows PowerShell)
```powershell
# DepsSmuggler Docker 이미지 로드 스크립트
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Docker 설치 확인
try { docker --version | Out-Null } catch {
    Write-Host "Error: Docker가 설치되어 있지 않습니다." -ForegroundColor Red
    exit 1
}

# 이미지 로드
Write-Host "Loading nginx:latest..."
docker load -i "$ScriptDir\packages\nginx-latest.tar"
Write-Host "  [OK] nginx:latest 로드 완료" -ForegroundColor Green
```

---

## 모듈 진입점 (`index.ts`)

모든 공유 유틸리티를 단일 진입점에서 내보냄

```typescript
// 타입
export * from './types';
export * from './conda-types';
export * from './pip-types';

// 버전 비교 유틸리티
export {
  compareVersions,
  isVersionCompatible,
  sortVersionsDescending,
  sortVersionsAscending,
  findLatestCompatibleVersion,
} from './version-utils';

// PyPI 유틸리티
export { getPyPIDownloadUrl } from './pypi-utils';

// Conda 유틸리티
export { getCondaDownloadUrl, getCondaSubdir } from './conda-utils';

// 파일 유틸리티
export { downloadFile, createZipArchive, createTarGzArchive } from './file-utils';
export type { ProgressCallback } from './file-utils';

// 스크립트 유틸리티
export { generateInstallScripts } from './script-utils';

// 의존성 해결 유틸리티
export {
  resolveAllDependencies,
  resolveSinglePackageDependencies,
} from './dependency-resolver';
export type {
  ResolvedPackageList,
  DependencyResolverOptions,
} from './dependency-resolver';
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

## pip 백트래킹 Resolver (`pip-backtracking-resolver.ts`)

resolvelib 스타일의 백트래킹 의존성 해결 알고리즘 구현

### BacktrackingResolver

```typescript
class BacktrackingResolver {
  constructor(provider: PipProvider);

  // 메인 해결 메서드
  async resolve(requirements: Requirement[]): Promise<ResolutionResult>;

  // 내부 메서드
  private addRequirement(state: ResolutionState, requirement: Requirement): void;
  private backtrack(state: ResolutionState): boolean;
  private selectNextIdentifier(state: ResolutionState): string | null;
  private async findCandidates(identifier: string, state: ResolutionState): Promise<Candidate[]>;
}
```

### ResolutionResult

```typescript
interface ResolutionResult {
  success: boolean;
  resolutions: Map<string, Candidate>;  // 해결된 패키지들
  conflicts?: ConflictInfo[];           // 충돌 정보
  backtrackCount: number;               // 백트래킹 횟수
}
```

### ResolverConfig

```typescript
interface ResolverConfig {
  maxBacktracks?: number;  // 최대 백트래킹 횟수 (기본: 100)
  maxRounds?: number;      // 최대 라운드 수 (기본: 2000000)
}
```

### 사용 예시

```typescript
import { BacktrackingResolver, resolveDependencies } from './pip-backtracking-resolver';

// 간편 함수 사용
const result = await resolveDependencies(
  ['flask>=2.0', 'requests', 'numpy>=1.20'],
  {
    pythonVersion: '3.11',
    targetOS: 'linux',
    architecture: 'x86_64',
  }
);

if (result.success) {
  console.log('해결된 패키지:', [...result.resolutions.entries()]);
} else {
  console.log('충돌:', result.conflicts);
}
```

---

## pip 후보 평가기 (`pip-candidate.ts`)

### CandidateEvaluator

wheel/sdist 후보를 평가하고 최적 파일을 선택하는 클래스

```typescript
class CandidateEvaluator {
  constructor(config: CandidateEvaluatorConfig);

  // 후보 적용 가능 여부 검사
  isApplicable(candidate: InstallationCandidate): boolean;

  // 정렬 키 계산
  getSortingKey(candidate: InstallationCandidate): CandidateSortingKey;

  // 적용 가능한 후보 필터링
  getApplicableCandidates(candidates: InstallationCandidate[]): InstallationCandidate[];

  // 최적 후보 계산
  computeBestCandidate(candidates: InstallationCandidate[]): BestCandidateResult;
}
```

### CandidateSortingKey

정렬 우선순위 (pip 공식 구현과 동일)

```typescript
interface CandidateSortingKey {
  hasAllowedHash: boolean;  // 1. 해시 일치
  isYanked: boolean;        // 2. 철회 여부 (false가 좋음)
  binaryPreference: number; // 3. wheel > sdist
  version: string;          // 4. 버전 (높을수록 좋음)
  tagPriority?: number;     // 5. 태그 우선순위 (낮을수록 좋음)
  buildTag?: number;        // 6. 빌드 번호
}
```

### InstallationCandidate

```typescript
interface InstallationCandidate {
  name: string;
  version: string;
  url: string;
  filename: string;
  isWheel: boolean;
  requiresPython?: string;
  yanked?: boolean;
  digests?: { sha256?: string };
}
```

---

## pip Provider (`pip-provider.ts`)

resolvelib 스타일 Provider 인터페이스 구현

### PipProvider

```typescript
class PipProvider {
  constructor(config: ProviderConfig);

  // 패키지 식별자 반환
  identify(requirement: Requirement): string;

  // 요구사항 선택 축소 (백트래킹 최적화)
  narrowRequirementSelection(
    identifiers: Iterable<string>,
    resolutions: Map<string, Candidate>,
    candidates: Map<string, Iterable<Candidate>>,
    information: Map<string, Iterable<RequirementInformation>>,
    backtrackCauses: Iterable<RequirementInformation>
  ): Iterable<string>;

  // 우선순위 계산
  getPreference(
    identifier: string,
    resolutions: Map<string, Candidate>,
    candidates: Map<string, Iterable<Candidate>>,
    information: Map<string, Iterable<RequirementInformation>>,
    backtrackCauses: Iterable<RequirementInformation>
  ): Preference;

  // 후보 검색
  async findMatches(
    identifier: string,
    requirements: Map<string, Iterable<Requirement>>,
    incompatibilities: Map<string, Iterable<Candidate>>
  ): Promise<Iterable<Candidate>>;

  // 후보가 요구사항을 만족하는지 검사
  isSatisfiedBy(requirement: Requirement, candidate: Candidate): boolean;

  // 의존성 조회
  async getDependencies(candidate: Candidate): Promise<Requirement[]>;
}
```

### ProviderConfig

```typescript
interface ProviderConfig {
  pythonVersion: string;        // 예: '3.11'
  targetOS: string;             // 예: 'linux'
  architecture: string;         // 예: 'x86_64'
  allowPrereleases?: boolean;   // 사전 릴리스 허용
}
```

---

## pip 태그 (`pip-tags.ts`)

PEP 425 호환 태그 생성 및 매칭

### 주요 함수

| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `getSupportedTags` | pythonVersion, os, arch | PlatformTag[] | 지원 태그 목록 생성 |
| `generateCompatibleTags` | config: TargetPythonConfig | PlatformTag[] | 호환 태그 생성 |
| `isTagCompatible` | tag: PlatformTag, supportedTags: PlatformTag[] | boolean | 태그 호환성 검사 |
| `getTagPriority` | tag: PlatformTag, supportedTags: PlatformTag[] | number | 태그 우선순위 반환 |
| `parseTag` | tagString: string | PlatformTag | 태그 문자열 파싱 |

### PlatformTag

```typescript
interface PlatformTag {
  python: string;    // 예: 'cp311', 'py3'
  abi: string;       // 예: 'cp311', 'abi3', 'none'
  platform: string;  // 예: 'manylinux_2_17_x86_64', 'win_amd64'
}
```

### 태그 우선순위 (CPython 3.11, Linux x86_64 예시)

```
1. cp311-cp311-linux_x86_64          (현재 버전 + ABI + 플랫폼)
2. cp311-cp311-manylinux_2_17_x86_64 (manylinux)
3. cp311-abi3-manylinux_2_17_x86_64  (stable ABI)
4. cp311-none-manylinux_2_17_x86_64  (ABI 무관)
5. cp310-cp310-manylinux_2_17_x86_64 (이전 버전)
...
N. py3-none-any                       (순수 Python)
```

### 사용 예시

```typescript
import { getSupportedTags, isTagCompatible, parseTag } from './pip-tags';

// 지원 태그 생성
const tags = getSupportedTags('3.11', 'linux', 'x86_64');

// 태그 호환성 검사
const wheelTag = parseTag('cp311-cp311-manylinux_2_17_x86_64');
const compatible = isTagCompatible(wheelTag, tags); // true
```

---

## pip Wheel 유틸리티 (`pip-wheel.ts`)

Wheel 파일명 파싱 및 선택

### 주요 함수

| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `parseWheelFilename` | filename: string | WheelInfo \| null | wheel 파일명 파싱 |
| `isWheelFile` | filename: string | boolean | wheel 파일 여부 확인 |
| `isSourceDist` | filename: string | boolean | sdist 여부 확인 |
| `isWheelSupported` | wheelInfo: WheelInfo, supportedTags: PlatformTag[] | boolean | wheel 호환성 검사 |
| `selectBestWheel` | wheels: WheelInfo[], supportedTags: PlatformTag[] | WheelInfo \| null | 최적 wheel 선택 |
| `filterCompatibleWheels` | wheels: WheelInfo[], supportedTags: PlatformTag[] | WheelInfo[] | 호환 wheel 필터링 |
| `getWheelSupportIndex` | wheel: WheelInfo, supportedTags: PlatformTag[] | number | wheel 우선순위 인덱스 |

### WheelInfo

```typescript
interface WheelInfo {
  name: string;           // 패키지명 (정규화됨)
  version: string;        // 버전
  buildTag?: string;      // 빌드 태그
  pythonTags: string[];   // Python 태그들
  abiTags: string[];      // ABI 태그들
  platformTags: string[]; // 플랫폼 태그들
  filename: string;       // 원본 파일명
}
```

### Wheel 파일명 형식

```
{distribution}-{version}(-{build tag})?-{python tag}-{abi tag}-{platform tag}.whl

예시:
- numpy-1.26.0-cp311-cp311-manylinux_2_17_x86_64.manylinux2014_x86_64.whl
- requests-2.31.0-py3-none-any.whl
```

### 사용 예시

```typescript
import { parseWheelFilename, selectBestWheel, getSupportedTags } from './pip-wheel';

const wheelInfo = parseWheelFilename('numpy-1.26.0-cp311-cp311-manylinux_2_17_x86_64.whl');
// {
//   name: 'numpy',
//   version: '1.26.0',
//   pythonTags: ['cp311'],
//   abiTags: ['cp311'],
//   platformTags: ['manylinux_2_17_x86_64'],
//   filename: 'numpy-1.26.0-cp311-cp311-manylinux_2_17_x86_64.whl'
// }

// 여러 wheel 중 최적 선택
const wheels = [...];
const supportedTags = getSupportedTags('3.11', 'linux', 'x86_64');
const best = selectBestWheel(wheels, supportedTags);
```

---

## Conda 캐시 (`conda-cache.ts`)

repodata.json 캐싱 및 조회 시스템

### 주요 함수

| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `fetchRepodata` | channel, subdir, options? | Promise<CacheResult> | repodata 가져오기 (캐시 지원) |
| `isCacheValid` | cachePath: string, maxAge: number | Promise<boolean> | 캐시 유효성 검사 |
| `clearCache` | channel?, subdir? | Promise<void> | 캐시 삭제 |
| `getCacheStats` | - | Promise<CacheStats> | 캐시 통계 조회 |
| `pruneExpiredCache` | maxAge: number | Promise<number> | 만료 캐시 정리 |

### CacheResult

```typescript
interface CacheResult {
  data: RepoData;        // repodata 내용
  fromCache: boolean;    // 캐시에서 로드 여부
  etag?: string;         // HTTP ETag
  lastModified?: string; // 마지막 수정 시간
}
```

### FetchRepodataOptions

```typescript
interface FetchRepodataOptions {
  maxAge?: number;           // 캐시 최대 수명 (ms)
  forceRefresh?: boolean;    // 강제 새로고침
  preferZstd?: boolean;      // zstd 압축 우선 사용
}
```

### 캐시 위치

```
~/.depssmuggler/cache/conda/
├── conda-forge/
│   ├── linux-64/
│   │   ├── repodata.json
│   │   └── repodata.meta.json
│   └── osx-arm64/
│       └── ...
└── main/
    └── ...
```

---

## Conda MatchSpec (`conda-matchspec.ts`)

Conda 패키지 스펙 파싱 및 매칭

### 주요 함수

| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `parseMatchSpec` | spec: string | MatchSpec | MatchSpec 문자열 파싱 |
| `matchesSpec` | package: RepoDataPackage, spec: MatchSpec | boolean | 패키지가 스펙에 일치하는지 검사 |
| `matchesVersionSpec` | version: string, versionSpec: string | boolean | 버전 스펙 일치 검사 |
| `matchesBuildSpec` | build: string, buildSpec: string | boolean | 빌드 스펙 일치 검사 |
| `compareCondaVersions` | a: string, b: string | number | Conda 버전 비교 |

### MatchSpec

```typescript
interface MatchSpec {
  name: string;
  version?: string;      // 버전 제약 (예: '>=1.0,<2.0')
  build?: string;        // 빌드 패턴 (예: 'py312*')
  channel?: string;      // 채널 (예: 'conda-forge')
  subdir?: string;       // subdir (예: 'linux-64')
  namespace?: string;    // 네임스페이스
}
```

### 버전 스펙 문법

```
>=1.0          # 1.0 이상
<2.0           # 2.0 미만
>=1.0,<2.0     # 1.0 이상 2.0 미만
1.0.*          # 1.0.x 와일드카드
1.0|2.0        # 1.0 또는 2.0
!=1.5          # 1.5 제외
```

### 사용 예시

```typescript
import { parseMatchSpec, matchesSpec } from './conda-matchspec';

const spec = parseMatchSpec('numpy>=1.20,<2.0 py312*');
// { name: 'numpy', version: '>=1.20,<2.0', build: 'py312*' }

const pkg = { name: 'numpy', version: '1.26.0', build: 'py312h8753938_0', ... };
const matches = matchesSpec(pkg, spec); // true
```

---

## Maven 스킵/캐시 관리 (`maven-skipper.ts`)

Maven 의존성 해결 최적화를 위한 스킵 로직 및 캐시

### DependencyResolutionSkipper

```typescript
class DependencyResolutionSkipper {
  // 의존성 스킵 여부 결정
  shouldSkip(coordinate: MavenCoordinate, context: DependencyProcessingContext): SkipResult;

  // 스킵 이유 조회
  getSkipReason(coordinate: MavenCoordinate): string | null;
}
```

### SkipResult

```typescript
interface SkipResult {
  skip: boolean;
  reason?: 'already_resolved' | 'excluded' | 'optional' | 'test_scope' | 'system_scope';
  resolvedVersion?: string;  // 이미 해결된 버전
}
```

### CoordinateManager

좌표 관리 및 버전 충돌 처리

```typescript
class CoordinateManager {
  // 좌표 등록
  register(coordinate: MavenCoordinate, depth: number): void;

  // 충돌 확인
  hasConflict(coordinate: MavenCoordinate): boolean;

  // 선택된 버전 조회 (Nearest wins)
  getSelectedVersion(groupId: string, artifactId: string): string | null;
}
```

### CacheManager

POM 캐시 관리

```typescript
class CacheManager {
  // POM 캐시 조회
  getPom(coordinate: MavenCoordinate): PomCacheEntry | null;

  // POM 캐시 저장
  setPom(coordinate: MavenCoordinate, pom: PomProject): void;

  // 해결된 의존성 캐시
  getResolved(coordinate: MavenCoordinate): ResolvedDependencyNode[] | null;
  setResolved(coordinate: MavenCoordinate, deps: ResolvedDependencyNode[]): void;
}
```

---

## 검색 유틸리티 (`search-utils.ts`)

패키지 검색 결과를 쿼리와의 관련성에 따라 정렬하는 유틸리티

### 주요 함수

| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `levenshteinDistance` | a: string, b: string | number | 두 문자열 간의 편집 거리 계산 |
| `normalizeForSearch` | str: string | string | 검색용 문자열 정규화 (소문자, 특수문자 제거) |
| `calculateRelevanceScore` | name: string, query: string | number | 패키지명과 쿼리의 관련성 점수 계산 (0~100) |
| `sortByRelevance` | results: T[], query: string, type?: PackageType | T[] | 검색 결과를 관련성 순으로 정렬 |

### PackageType

```typescript
type PackageType = 'pip' | 'conda' | 'maven' | 'npm' | 'docker' | 'yum' | 'default';
```

### SortableSearchResult

```typescript
interface SortableSearchResult {
  name: string;
  [key: string]: unknown;
}
```

### 관련성 점수 계산 기준

1. **정확 일치** (100점): 쿼리와 패키지명이 정확히 일치
2. **접두사 일치** (90점): 패키지명이 쿼리로 시작
3. **포함 일치** (70점): 패키지명에 쿼리가 포함됨
4. **편집 거리 기반** (0~60점): Levenshtein 거리에 따른 유사도

### 패키지 타입별 핵심명 추출

각 패키지 타입별로 관련성 비교 시 핵심 이름을 추출:

| 타입 | 입력 예시 | 핵심명 추출 |
|------|-----------|-------------|
| maven | `org.springframework:spring-core` | `spring-core` |
| docker | `library/nginx` | `nginx` |
| npm | `@types/node` | `node` |
| 기타 | `requests` | `requests` |

### 사용 예시

```typescript
import { sortByRelevance, calculateRelevanceScore } from './search-utils';

// 관련성 점수 계산
const score = calculateRelevanceScore('requests', 'req');  // 높은 점수 (접두사 일치)
const score2 = calculateRelevanceScore('flask', 'req');    // 낮은 점수

// 검색 결과 정렬
const results = [
  { name: 'requests-mock', version: '1.0.0' },
  { name: 'requests', version: '2.28.0' },
  { name: 'urllib3-requests', version: '1.0.0' },
];

const sorted = sortByRelevance(results, 'requests', 'pip');
// [
//   { name: 'requests', version: '2.28.0' },           // 정확 일치
//   { name: 'requests-mock', version: '1.0.0' },       // 접두사 일치
//   { name: 'urllib3-requests', version: '1.0.0' },    // 포함 일치
// ]

// Maven 아티팩트 정렬
const mavenResults = [
  { name: 'org.apache:commons-lang3' },
  { name: 'org.springframework:spring-core' },
  { name: 'org.springframework:spring-beans' },
];

const sortedMaven = sortByRelevance(mavenResults, 'spring', 'maven');
// spring-core, spring-beans가 상위로 정렬됨 (artifactId 기준)
```

---

## 관련 문서
- [아키텍처 개요](./architecture-overview.md)
- [Downloaders 문서](./downloaders.md)
- [Resolvers 문서](./resolvers.md)
- [pip 의존성 해결 알고리즘](./pip-dependency-resolution.md)
- [conda 의존성 해결 알고리즘](./conda-dependency-resolution.md)
- [Maven 의존성 해결 알고리즘](./maven-dependency-resolution.md)
- [npm 의존성 해결 알고리즘](./npm-dependency-resolution.md)
