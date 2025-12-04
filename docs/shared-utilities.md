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
├── dependency-resolver.ts # 의존성 해결 유틸리티
├── pypi-utils.ts         # PyPI 다운로드 URL 조회
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

---

## 의존성 해결 (`dependency-resolver.ts`)

### 주요 함수

| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `resolveAllDependencies` | `packages: DownloadPackage[]`, `options?: DependencyResolverOptions` | `Promise<ResolvedPackageList>` | 모든 패키지의 의존성 해결 |
| `resolveSinglePackageDependencies` | `pkg: DownloadPackage`, `options?: DependencyResolverOptions` | `Promise<ResolvedPackageList>` | 단일 패키지 의존성 해결 |

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
});

console.log(`총 ${result.allPackages.length}개 패키지 (의존성 포함)`);
```

---

## PyPI 유틸리티 (`pypi-utils.ts`)

### getPyPIDownloadUrl

PyPI 패키지의 다운로드 URL 조회

```typescript
async function getPyPIDownloadUrl(
  packageName: string,
  version: string,
  architecture?: string
): Promise<DownloadUrlResult | null>
```

- 아키텍처에 맞는 wheel 파일 우선 선택
- wheel이 없으면 sdist(소스 배포판) 선택
- 지원 아키텍처: `x86_64`, `amd64`, `arm64`, `aarch64`, `noarch`

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

// PyPI 유틸리티
export { getPyPIDownloadUrl } from './pypi-utils';

// 파일 유틸리티
export { downloadFile, createZipArchive, createTarGzArchive } from './file-utils';
export type { ProgressCallback } from './file-utils';

// 스크립트 유틸리티
export { generateInstallScripts } from './script-utils';

// 의존성 해결 유틸리티
export { resolveAllDependencies, resolveSinglePackageDependencies } from './dependency-resolver';
export type { ResolvedPackageList, DependencyResolverOptions } from './dependency-resolver';
```

---

## 관련 문서
- [아키텍처 개요](./architecture-overview.md)
- [Downloaders 문서](./downloaders.md)
- [Resolvers 문서](./resolvers.md)
