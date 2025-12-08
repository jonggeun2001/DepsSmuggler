# OS 패키지 다운로더 (OS Package Downloader)

## 개요

- **목적**: Linux OS 패키지(rpm, deb, apk) 검색, 의존성 해결, 다운로드 및 패키징
- **위치**: `src/core/downloaders/os/`
- **지원 패키지 관리자**: YUM/RPM, APT/DEB, APK

---

## 아키텍처

### 디렉토리 구조

```
src/core/downloaders/os/
├── index.ts                 # 통합 익스포트
├── types.ts                 # 공통 타입 정의
├── downloader.ts            # OSPackageDownloader 통합 클래스
├── base-downloader.ts       # BaseOSDownloader 추상 클래스
├── base-resolver.ts         # BaseOSDependencyResolver 추상 클래스
├── dependency-tree.ts       # OSDependencyTree 의존성 트리
├── repositories.ts          # OS 배포판 및 저장소 프리셋
├── yum/                     # YUM/RPM 구현
│   ├── index.ts
│   ├── downloader.ts        # YumDownloader
│   ├── metadata-parser.ts   # YumMetadataParser
│   └── resolver.ts          # YumDependencyResolver
├── apt/                     # APT/DEB 구현
│   ├── index.ts
│   ├── downloader.ts        # AptDownloader
│   ├── metadata-parser.ts   # AptMetadataParser
│   └── resolver.ts          # AptDependencyResolver
├── apk/                     # APK 구현
│   ├── index.ts
│   ├── downloader.ts        # ApkDownloader
│   ├── metadata-parser.ts   # ApkMetadataParser
│   └── resolver.ts          # ApkDependencyResolver
├── utils/
│   ├── index.ts
│   ├── cache-manager.ts     # OSCacheManager (LRU + TTL)
│   ├── gpg-verifier.ts      # GPGVerifier
│   └── script-generator.ts  # OSScriptGenerator
└── packager/
    ├── index.ts
    ├── archive-packager.ts  # OSArchivePackager (zip/tar.gz)
    └── repo-packager.ts     # OSRepoPackager (로컬 저장소)
```

### 클래스 다이어그램

```
OSPackageDownloader (통합 인터페이스)
    ├── YumDownloader ─── YumMetadataParser
    │                 └── YumDependencyResolver
    ├── AptDownloader ─── AptMetadataParser
    │                 └── AptDependencyResolver
    ├── ApkDownloader ─── ApkMetadataParser
    │                 └── ApkDependencyResolver
    ├── OSCacheManager
    ├── GPGVerifier
    ├── OSScriptGenerator
    ├── OSArchivePackager
    └── OSRepoPackager
```

---

## 핵심 타입

### OSPackageManager

```typescript
type OSPackageManager = 'yum' | 'apt' | 'apk';
```

### OSArchitecture

```typescript
type OSArchitecture =
  | 'x86_64' | 'amd64'      // 64비트 x86
  | 'aarch64' | 'arm64'     // 64비트 ARM
  | 'i686' | 'i386' | 'x86' // 32비트 x86
  | 'armv7l' | 'armhf'      // 32비트 ARM
  | 'noarch' | 'all';       // 아키텍처 무관
```

### OSDistribution

```typescript
interface OSDistribution {
  id: string;                    // 'centos-7', 'ubuntu-22.04', 'alpine-3.20'
  name: string;                  // 표시 이름
  version: string;               // 버전
  codename?: string;             // 코드네임 (jammy, bookworm 등)
  packageManager: OSPackageManager;
  architectures: OSArchitecture[];
  defaultRepos: Repository[];    // 기본 저장소
  extendedRepos: Repository[];   // 확장 저장소 (EPEL, Universe 등)
  isRecommended?: boolean;       // 추천 여부
}
```

### Repository

```typescript
interface Repository {
  id: string;
  name: string;
  baseUrl: string;               // 저장소 URL ($basearch, $releasever 변수 포함)
  enabled: boolean;
  gpgCheck: boolean;
  gpgKeyUrl?: string;
  priority?: number;
  isOfficial: boolean;
}
```

### OSPackageInfo

```typescript
interface OSPackageInfo {
  name: string;
  version: string;
  release?: string;              // RPM: 1.el7
  epoch?: number;                // RPM epoch
  architecture: OSArchitecture;
  size: number;
  installedSize?: number;
  checksum: Checksum;
  location: string;              // 저장소 내 상대 경로
  repository: Repository;
  description?: string;
  summary?: string;
  license?: string;
  dependencies: PackageDependency[];
  provides?: string[];
  conflicts?: string[];
  obsoletes?: string[];
  suggests?: string[];           // DEB: Suggests
  recommends?: string[];         // DEB: Recommends
}
```

### PackageDependency

```typescript
interface PackageDependency {
  name: string;
  version?: string;
  operator?: VersionOperator;    // '=' | '<' | '>' | '<=' | '>=' | '<<' | '>>'
  isOptional?: boolean;
}
```

---

## OSPackageDownloader (통합 클래스)

### 위치
`src/core/downloaders/os/downloader.ts`

### 메서드

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `search` | options: OSPackageSearchOptions | Promise<OSPackageSearchResult> | 패키지 검색 |
| `resolveDependencies` | packages, distribution, architecture, options? | Promise<DependencyResolutionResult> | 의존성 해결 |
| `download` | options: OSPackageDownloadOptions | Promise<OSPackageDownloadResult> | 패키지 다운로드 |
| `getCacheStats` | - | CacheStats | 캐시 통계 조회 |
| `clearCache` | - | Promise<void> | 캐시 초기화 |

### 검색 옵션

```typescript
interface OSPackageSearchOptions {
  query: string;
  distribution: OSDistribution;
  architecture: OSArchitecture;
  repositories?: Repository[];
  matchType?: MatchType;         // 'exact' | 'contains' | 'startsWith' | 'wildcard'
  includeVersions?: boolean;
  limit?: number;
}
```

### 다운로드 옵션

```typescript
interface OSPackageDownloadOptions {
  packages: OSPackageInfo[];
  outputDir: string;
  resolveDependencies?: boolean;
  includeOptionalDeps?: boolean;
  verifyGPG?: boolean;
  concurrency?: number;
  cacheMode: CacheMode;          // 'session' | 'persistent' | 'disabled'
  onProgress?: (progress: OSDownloadProgress) => void;
  onError?: (error: OSDownloadError) => Promise<OSErrorAction>;
}
```

### 사용 예시

```typescript
import { OSPackageDownloader, getDistributionById } from './core/downloaders/os';

const downloader = new OSPackageDownloader({ concurrency: 5 });

// 배포판 선택
const distribution = getDistributionById('rocky-9')!;

// 패키지 검색
const searchResult = await downloader.search({
  query: 'httpd',
  distribution,
  architecture: 'x86_64',
  matchType: 'contains',
  limit: 50,
});

// 의존성 해결
const depResult = await downloader.resolveDependencies(
  searchResult.packages.slice(0, 1),
  distribution,
  'x86_64',
  { includeOptional: false }
);

// 다운로드
const downloadResult = await downloader.download({
  packages: depResult.packages,
  outputDir: '/tmp/packages',
  resolveDependencies: true,
  concurrency: 3,
  cacheMode: 'session',
  onProgress: (progress) => console.log(`${progress.currentPackage}: ${progress.percent}%`),
});
```

---

## 패키지 관리자별 구현

### YumDownloader

- **위치**: `src/core/downloaders/os/yum/downloader.ts`
- **지원 배포판**: CentOS 7, Rocky Linux 8/9, AlmaLinux 8/9, Fedora
- **파일 형식**: `.rpm`
- **메타데이터**: `repodata/repomd.xml`, `primary.xml.gz`

#### 메타데이터 파싱 (YumMetadataParser)

```typescript
interface RepomdInfo {
  revision: string;
  primary: RepomdDataInfo | null;    // primary.xml.gz 위치
  filelists: RepomdDataInfo | null;
  other: RepomdDataInfo | null;
}
```

#### 저장소 URL 패턴

```
${baseUrl}/repodata/repomd.xml
${baseUrl}/repodata/primary.xml.gz
${baseUrl}/Packages/${filename}.rpm
```

---

### AptDownloader

- **위치**: `src/core/downloaders/os/apt/downloader.ts`
- **지원 배포판**: Ubuntu 20.04/22.04/24.04, Debian 11/12
- **파일 형식**: `.deb`
- **메타데이터**: `Packages.gz`, `Release`, `InRelease`

#### 메타데이터 파싱 (AptMetadataParser)

Debian Control 파일 형식 파싱:

```
Package: nginx
Version: 1.18.0-0ubuntu1
Architecture: amd64
Depends: libc6 (>= 2.28), libpcre3
...
```

#### 저장소 URL 패턴

```
${baseUrl}/dists/${codename}/Release
${baseUrl}/dists/${codename}/${component}/binary-${arch}/Packages.gz
${baseUrl}/pool/${component}/${prefix}/${name}/${filename}.deb
```

---

### ApkDownloader

- **위치**: `src/core/downloaders/os/apk/downloader.ts`
- **지원 배포판**: Alpine Linux 3.18/3.19/3.20
- **파일 형식**: `.apk`
- **메타데이터**: `APKINDEX.tar.gz`

#### 메타데이터 파싱 (ApkMetadataParser)

APK INDEX 형식:

```
P:nginx
V:1.24.0-r6
A:x86_64
D:pcre2 zlib
...
```

필드 매핑:
- `P`: Package name
- `V`: Version
- `A`: Architecture
- `D`: Dependencies
- `S`: Size
- `T`: Description
- `C`: Checksum

---

## 의존성 해결

### BaseOSDependencyResolver

- **위치**: `src/core/downloaders/os/base-resolver.ts`
- **방식**: 하이브리드 (API 우선 → 메타데이터 파싱 폴백)

#### 알고리즘

1. **너비 우선 탐색 (BFS)**으로 의존성 그래프 구성
2. **provides/virtual 패키지** 해결
3. **버전 제약 조건** 확인
4. **위상 정렬 (Topological Sort)**로 설치 순서 결정
5. **충돌 감지** 및 모든 후보 버전 포함

#### DependencyResolutionResult

```typescript
interface DependencyResolutionResult {
  packages: OSPackageInfo[];      // 해결된 패키지 목록 (설치 순서)
  tree: OSDependencyTree;         // 의존성 트리
  missing: MissingDependency[];   // 해결 실패 의존성
  conflicts: VersionConflict[];   // 버전 충돌
}
```

### OSDependencyTree

- **위치**: `src/core/downloaders/os/dependency-tree.ts`
- **기능**: 의존성 그래프 관리 및 시각화 데이터 제공

```typescript
class OSDependencyTree {
  addNode(pkg: OSPackageInfo): void;
  addEdge(parent: OSPackageInfo, child: OSPackageInfo, dependency: PackageDependency): void;
  addMissingDependency(pkg: OSPackageInfo, dep: PackageDependency): void;

  getInstallOrder(): OSPackageInfo[];           // 위상 정렬된 설치 순서
  getAllPackages(): OSPackageInfo[];            // 모든 패키지
  getMissingDependencies(): MissingDependency[];
  getVersionConflicts(): VersionConflict[];
  toVisualizationData(): VisualizationData;     // 시각화용 데이터
}
```

---

## 유틸리티 모듈

### OSCacheManager

- **위치**: `src/core/downloaders/os/utils/cache-manager.ts`
- **특징**: LRU 캐시 + TTL 지원

```typescript
interface OSCacheConfig {
  mode: CacheMode;               // 'session' | 'persistent' | 'disabled'
  ttl: number;                   // TTL (밀리초)
  maxSize: number;               // 최대 크기 (바이트)
  maxItems: number;              // 최대 항목 수
  directory?: string;            // persistent 모드 저장 경로
}

class OSCacheManager {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, data: T): Promise<void>;
  invalidate(pattern?: string): Promise<void>;
  getStats(): CacheStats;
  clear(): Promise<void>;
}
```

### GPGVerifier

- **위치**: `src/core/downloaders/os/utils/gpg-verifier.ts`
- **기능**: 패키지 서명 검증 (공식 저장소만)

```typescript
interface VerificationResult {
  verified: boolean;
  skipped: boolean;
  reason?: string;
  error?: Error;
}

class GPGVerifier {
  importKey(keyUrl: string): Promise<void>;
  verifyPackage(pkg: OSPackageInfo, filePath: string): Promise<VerificationResult>;
}
```

### OSScriptGenerator

- **위치**: `src/core/downloaders/os/utils/script-generator.ts`
- **기능**: 설치 스크립트 생성 (bash + PowerShell)

```typescript
interface GeneratedScripts {
  bash: string;
  powershell: string;
}

type ScriptType = 'dependency-order' | 'local-repo';

class OSScriptGenerator {
  generateDependencyOrderScript(
    packages: OSPackageInfo[],
    packageManager: OSPackageManager
  ): GeneratedScripts;

  generateLocalRepoScript(
    packages: OSPackageInfo[],
    packageManager: OSPackageManager,
    repoName: string
  ): GeneratedScripts;
}
```

---

## 패키저 모듈

### OSArchivePackager

- **위치**: `src/core/downloaders/os/packager/archive-packager.ts`
- **기능**: 패키지를 zip 또는 tar.gz 아카이브로 패키징

```typescript
interface ArchiveOptions {
  format: ArchiveFormat;         // 'zip' | 'tar.gz'
  outputPath: string;
  includeScripts: boolean;
  scriptTypes: ScriptType[];
  repoName?: string;
}

class OSArchivePackager {
  createArchive(
    packages: OSPackageInfo[],
    downloadedFiles: Map<string, string>,
    options: ArchiveOptions
  ): Promise<string>;
}
```

#### 출력 구조

```
output.zip/
├── packages/                   # 패키지 파일
│   ├── httpd-2.4.6-97.el7.rpm
│   ├── apr-1.4.8-7.el7.rpm
│   └── ...
├── scripts/                    # 설치 스크립트
│   ├── install.sh              # 의존성 순서 설치
│   ├── setup-repo.sh           # 로컬 저장소 설정
│   └── install.ps1             # Windows WSL 안내
├── metadata.json               # 패키지 메타데이터
└── README.txt                  # 사용 안내
```

### OSRepoPackager

- **위치**: `src/core/downloaders/os/packager/repo-packager.ts`
- **기능**: 로컬 저장소 구조 생성

```typescript
interface RepoOptions {
  outputPath: string;
  packageManager: OSPackageManager;
  createMetadata: boolean;       // 저장소 메타데이터 생성 여부
}

interface RepoResult {
  repoPath: string;
  metadataGenerated: boolean;
  packages: PackageMetadata[];
}

class OSRepoPackager {
  createLocalRepo(
    packages: OSPackageInfo[],
    downloadedFiles: Map<string, string>,
    options: RepoOptions
  ): Promise<RepoResult>;
}
```

#### 패키지 관리자별 메타데이터

| PM | 메타데이터 파일 | 생성 도구 |
|----|-----------------|-----------|
| YUM | `repodata/repomd.xml`, `primary.xml.gz` | createrepo |
| APT | `Packages.gz`, `Release` | dpkg-scanpackages |
| APK | `APKINDEX.tar.gz` | apk index |

---

## 지원 배포판 프리셋

### repositories.ts

`OS_DISTRIBUTIONS` 상수에 정의된 배포판 목록:

#### RHEL 계열 (YUM)
- CentOS 7
- Rocky Linux 8, 9
- AlmaLinux 8, 9

#### Debian 계열 (APT)
- Ubuntu 20.04 LTS (Focal)
- Ubuntu 22.04 LTS (Jammy)
- Ubuntu 24.04 LTS (Noble)
- Debian 11 (Bullseye)
- Debian 12 (Bookworm)

#### Alpine (APK)
- Alpine Linux 3.18
- Alpine Linux 3.19
- Alpine Linux 3.20

### 유틸리티 함수

```typescript
// 배포판 조회
getDistributionById(id: string): OSDistribution | undefined;
getDistributionsByPackageManager(pm: OSPackageManager): OSDistribution[];

// 추천 배포판
getRecommendedDistributions(): OSDistribution[];

// 용도별 추천
USE_CASE_RECOMMENDATIONS: Record<string, string[]>;
// - enterprise: ['rocky-9', 'alma-9', 'ubuntu-22.04']
// - legacy: ['centos-7', 'ubuntu-20.04', 'debian-11']
// - container: ['alpine-3.20', 'alpine-3.19']
// - development: ['ubuntu-24.04', 'debian-12', 'rocky-9']

// 아키텍처 유틸리티
normalizeArchitecture(arch: string): OSArchitecture;
isArchitectureCompatible(pkg: OSArchitecture, target: OSArchitecture): boolean;

// 저장소 URL 처리
resolveRepoUrl(baseUrl: string, arch: OSArchitecture): string;
createCustomRepository(options: Partial<Repository>): Repository;
```

---

## IPC 핸들러 (Electron)

### 위치
`electron/os-package-handlers.ts`

### 등록된 핸들러

| 채널 | 파라미터 | 반환값 | 설명 |
|------|----------|--------|------|
| `os:getDistributions` | osType: OSPackageManager | OSDistribution[] | 배포판 목록 |
| `os:getAllDistributions` | - | OSDistribution[] | 전체 배포판 |
| `os:getDistribution` | distributionId: string | OSDistribution \| undefined | 특정 배포판 |
| `os:search` | options | OSPackageSearchResult | 패키지 검색 |
| `os:resolveDependencies` | options | DependencyResolutionResult | 의존성 해결 |
| `os:download:start` | options | OSPackageDownloadResult | 다운로드 시작 |
| `os:cache:stats` | - | CacheStats | 캐시 통계 |
| `os:cache:clear` | - | { success: boolean } | 캐시 초기화 |

### 진행 상황 이벤트

| 이벤트 | 데이터 | 설명 |
|--------|--------|------|
| `os:resolveDependencies:progress` | { message, current, total } | 의존성 해결 진행 |
| `os:download:progress` | OSDownloadProgress | 다운로드 진행 |

---

## Vite 개발 서버 API

### 위치
`vite-plugin-download-api.ts`

### 엔드포인트

| 경로 | 메서드 | 설명 |
|------|--------|------|
| `/api/os/distributions` | GET | 모든 배포판 조회 |
| `/api/os/distributions/:type` | GET | 타입별 배포판 조회 |
| `/api/os/search` | POST | 패키지 검색 |
| `/api/os/resolve-dependencies` | POST | 의존성 해결 |
| `/api/os/download/start` | POST | 다운로드 시작 |

---

## 에러 처리

### OSDownloadError

```typescript
interface OSDownloadError {
  package?: OSPackageInfo;
  message: string;
  code?: string;
  retryCount?: number;
}
```

### OSErrorAction

```typescript
type OSErrorAction = 'retry' | 'skip' | 'cancel';
```

### 에러 핸들링 흐름

1. 다운로드 오류 발생
2. `onError` 콜백 호출 (UI에서 다이얼로그 표시)
3. 사용자 선택에 따라:
   - `retry`: 재시도 (최대 3회)
   - `skip`: 해당 패키지 건너뛰기
   - `cancel`: 전체 다운로드 취소

---

## CLI 명령어

### 위치
`src/cli/commands/os.ts`

### 명령어 목록

#### 배포판 목록 조회
```bash
depssmuggler os list-distros [--type <yum|apt|apk>]
```

#### 패키지 검색
```bash
depssmuggler os search <query> --distro <distro-id> [--arch <arch>] [--limit <n>]
```

예시:
```bash
depssmuggler os search nginx --distro rocky-9 --arch x86_64 --limit 20
```

#### 패키지 다운로드
```bash
depssmuggler os download <packages...> --distro <distro-id> [options]
```

옵션:
- `--distro <id>`: 배포판 ID (필수)
- `--arch <arch>`: 아키텍처 (기본: x86_64)
- `--output <path>`: 출력 경로 (기본: ./os-packages)
- `--format <type>`: 출력 형식 (archive | repository | both, 기본: both)
- `--archive-format <type>`: 아카이브 형식 (zip | tar.gz, 기본: tar.gz)
- `--no-deps`: 의존성 미포함
- `--include-optional`: 선택적 의존성 포함
- `--no-verify`: GPG 검증 생략
- `--concurrency <n>`: 동시 다운로드 수 (기본: 3)
- `--scripts`: 설치 스크립트 포함

예시:
```bash
# 기본 다운로드
depssmuggler os download httpd nginx --distro rocky-9

# 아카이브만 생성
depssmuggler os download httpd --distro ubuntu-22.04 --format archive --archive-format zip

# 로컬 저장소 생성 + 스크립트
depssmuggler os download httpd --distro rocky-9 --format repository --scripts
```

#### 캐시 관리
```bash
# 캐시 통계 조회
depssmuggler os cache stats

# 캐시 삭제
depssmuggler os cache clear
```

---

## 관련 문서

- [Downloaders 개요](./downloaders.md)
- [아키텍처 개요](./architecture-overview.md)
- [설계 문서](./os-package-downloader-design.md)
- [Electron/Renderer 문서](./electron-renderer.md)
