# Shared Utilities 모듈

## 개요
- 목적: 메인 프로세스와 다른 모듈에서 공통으로 사용하는 유틸리티 함수 및 타입
- 위치: `src/core/shared/`

---

## 모듈 구조

```
src/core/shared/
├── index.ts              # 모듈 진입점
├── types.ts              # 공통 타입 정의
├── pip-types.ts          # PyPI 관련 타입 정의
├── conda-types.ts        # Conda 관련 타입 정의
├── version-utils.ts      # 버전 비교/호환성 유틸리티
├── pypi-utils.ts         # PyPI 다운로드 URL 조회
├── conda-utils.ts        # Conda 패키지 URL 조회
├── dependency-resolver.ts # 의존성 해결 유틸리티
├── file-utils.ts         # 파일 다운로드/압축 유틸리티
└── script-utils.ts       # 설치 스크립트 생성
```

---

## 공통 타입 (`types.ts`)

### DownloadPackage

다운로드할 패키지 정보

```typescript
interface DownloadPackage {
  id: string;
  type: string;           // 'pip' | 'conda' | 'maven' | 'yum' | 'docker'
  name: string;           // 패키지명
  version: string;        // 버전
  architecture?: string;  // 아키텍처 (예: 'x86_64', 'arm64')
}
```

### DownloadOptions

다운로드 옵션

```typescript
interface DownloadOptions {
  outputDir: string;                       // 출력 디렉토리
  outputFormat: 'zip' | 'tar.gz' | 'mirror'; // 출력 형식
  includeScripts: boolean;                 // 설치 스크립트 포함 여부
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

## 관련 문서
- [아키텍처 개요](./architecture-overview.md)
- [Downloaders 문서](./downloaders.md)
- [Resolvers 문서](./resolvers.md)
