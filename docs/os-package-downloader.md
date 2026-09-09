# OS 패키지 다운로더 (OS Package Downloader)

## 개요

- **목적**: Linux OS 패키지(rpm, deb, apk) 검색, 의존성 해결, 다운로드 및 패키징
- **위치**: `src/core/downloaders/{yum,apt,apk}.ts`, `src/core/downloaders/os-shared/`
- **지원 패키지 관리자**: YUM/RPM, APT/DEB, APK

---

## 아키텍처

### 디렉토리 구조

```
src/core/downloaders/
├── yum.ts                   # YumDownloader + YumMetadataParser
├── apt.ts                   # AptDownloader + AptMetadataParser
├── apk.ts                   # ApkDownloader + ApkMetadataParser
└── os-shared/               # OS 패키지 공유 모듈
    ├── index.ts             # 통합 익스포트
    ├── types.ts             # 공통 타입 정의
    ├── base-downloader.ts   # BaseOSDownloader 추상 클래스
    ├── base-resolver.ts     # BaseOSDependencyResolver 추상 클래스
    ├── cli-backend.ts       # CLI 검색·다운로드·캐시 조합
    ├── package-file-utils.ts # 파일명 및 다운로드 파일 키
    ├── dependency-tree.ts   # OSDependencyTree 의존성 트리
    ├── repositories.ts      # OS 배포판 및 저장소 프리셋
    ├── distribution-fetcher.ts  # 동적 배포판 버전 정보 조회
    ├── cache-manager.ts     # OsPackageCache (LRU + TTL)
    ├── gpg-verifier.ts      # GPGVerifier
    ├── script-generator.ts  # OSScriptGenerator
    ├── archive-packager.ts  # OSArchivePackager (zip/tar.gz)
    ├── repo-packager.ts     # OSRepoPackager (로컬 저장소)
    └── repos/               # 저장소 설정
        ├── index.ts
        ├── repository-utils.ts
        ├── rhel-repos.ts    # RHEL 계열 저장소
        ├── debian-repos.ts  # Debian/Ubuntu 저장소
        └── alpine-repos.ts  # Alpine 저장소

src/core/resolver/
├── yum-resolver.ts          # YumDependencyResolver
├── apt-resolver.ts          # AptDependencyResolver
└── apk-resolver.ts          # ApkDependencyResolver
```

### 클래스 다이어그램

```
                         ┌─────────────────────────────────────┐
                         │        BaseOSDownloader             │
                         │        (os-shared/)                 │
                         └──────────────┬──────────────────────┘
                                        │
        ┌───────────────────────────────┼───────────────────────────────┐
        │                               │                               │
        ▼                               ▼                               ▼
┌───────────────┐              ┌───────────────┐              ┌───────────────┐
│ YumDownloader │              │ AptDownloader │              │ ApkDownloader │
│   (yum.ts)    │              │   (apt.ts)    │              │   (apk.ts)    │
├───────────────┤              ├───────────────┤              ├───────────────┤
│YumMetadataParser│            │AptMetadataParser│            │ApkMetadataParser│
└───────┬───────┘              └───────┬───────┘              └───────┬───────┘
        │                               │                               │
        ▼                               ▼                               ▼
┌───────────────┐              ┌───────────────┐              ┌───────────────┐
│YumDependency  │              │AptDependency  │              │ApkDependency  │
│  Resolver     │              │  Resolver     │              │  Resolver     │
│(yum-resolver) │              │(apt-resolver) │              │(apk-resolver) │
└───────────────┘              └───────────────┘              └───────────────┘
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
  | 'armv7l' | 'armhf' | 'armv7' // 32비트 ARM
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
  aptControlFields?: Record<string, string>; // APT 원본 Control 필드 (JSON 캐시 가능)
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

## OS 패키지 작업 조합과 공통 다운로더

### 위치

실행 클래스는 `BaseOSDownloader`를 상속한 `YumDownloader`, `AptDownloader`, `ApkDownloader`입니다. 검색과 의존성 해결은 별도의 `*DependencyResolver`가 담당합니다. CLI는 `os-shared/cli-backend.ts`, Electron은 `electron/services/os-download-orchestrator.ts`에서 이를 조합합니다.

`os-shared/types.ts`에는 `OSPackageDownloader`, `OSPackageSearchOptions`, `OSPackageDownloadOptions` 같은 계약 타입이 남아 있습니다. `OSPackageDownloader`라는 통합 실행 클래스나 `os/downloader.ts` 파일은 없습니다. 해당 인터페이스를 `new OSPackageDownloader()`로 생성하지 않습니다.

### 메서드

| 소유 모듈 | 메서드 | 반환값 | 설명 |
|-----------|--------|--------|------|
| `*DependencyResolver` | `searchPackages(query, matchType?)` | `Promise<OSPackageSearchResult[]>` | 이름별 검색 결과 |
| `BaseOSDependencyResolver` | `resolveDependencies(packages)` | `Promise<DependencyResolutionResult>` | 의존성 해결 |
| `BaseOSDownloader` | `downloadPackage(pkg)` | `Promise<OSPackageDownloadResult>` | 단일 파일 다운로드 |
| `BaseOSDownloader` | `downloadPackages(packages)` | `Promise<DownloadPackagesResult>` | 동시 다운로드 |
| `cli-backend.ts` | `searchOSPackages(options)` | `Promise<OSPackageSearchResult[]>` | 캐시와 resolver를 조합한 검색 |
| `cli-backend.ts` | `downloadOSPackages(options)` | `Promise<DownloadOSPackagesResult>` | 검색·해결·다운로드·패키징 |
| `cli-backend.ts` | `getOSPackageCacheStats(directory)` / `clearOSPackageCache(directory)` | Promise | 디스크 메타데이터 캐시 관리 |

### 검색 옵션

공통 계약 타입의 검색 조건은 다음과 같습니다. 실제 resolver에는 distribution/architecture/repositories를 생성자 옵션으로 전달하고, `searchPackages()`에는 query와 matchType만 전달합니다.

```typescript
interface OSPackageSearchOptions {
  query: string;
  distribution: OSDistribution;
  architecture: OSArchitecture;
  repositories?: Repository[];
  matchType?: 'exact' | 'partial' | 'wildcard';
  includeVersions?: boolean;
  limit?: number;
}
```

### 검색 결과 타입

```typescript
interface OSPackageSearchResult {
  name: string;
  versions: OSPackageInfo[]; // 이름별 버전 목록
  latest: OSPackageInfo;
}
```

resolver와 CLI backend는 이 객체의 배열을 반환합니다. Electron `os:search`는 최신 버전만 추려 `{ packages: OSPackageInfo[], totalCount: number }`로 변환합니다. `hasMore` 필드는 반환하지 않습니다.

### 다운로드 옵션

실행 다운로더의 생성자 옵션과 반환값은 다음과 같습니다.

```typescript
interface BaseDownloaderOptions {
  outputDir: string;
  distribution: OSDistribution;
  architecture: OSArchitecture;
  repositories: Repository[];
  concurrency: number;
  gpgVerifier?: GPGVerifier;
  abortSignal?: AbortSignal;
  onProgress?: (progress: OSDownloadProgress) => void;
  onError?: (error: OSDownloadError) => Promise<OSErrorAction>;
}

interface OSPackageDownloadResult {
  success: boolean;
  filePath?: string;
  error?: Error;
  skipped?: boolean;
  cancelled?: boolean;
  verification?: VerificationResult;
}

interface DownloadPackagesResult {
  success: OSPackageInfo[];
  failed: Array<{ package: OSPackageInfo; error: Error }>;
  downloadedFiles: Map<string, string>;
}
```

`downloadedFiles`의 키는 `getDownloadedFileKey(pkg)`로 생성하며 이름·버전·RPM release·아키텍처를 구분합니다. 패키저에도 반환된 Map을 그대로 전달합니다.

계약 타입 `OSPackageDownloadOptions`는 `packages`, `outputDir`, `resolveDependencies`, `includeOptionalDeps`, `concurrency`, `verifyGPG`, `cacheMode`가 필수이고 `onProgress`/`onError`가 선택입니다. `cacheMode`의 값은 `session | persistent | none`입니다. 실행 클래스의 `downloadPackage()`가 이 전체 옵션 객체를 받는 것은 아닙니다.

### 사용 예시

```typescript
import { YumDownloader } from './core/downloaders/yum';
import { YumDependencyResolver } from './core/resolver/yum-resolver';
import { getDistributionById } from './core/downloaders/os-shared/repositories';
import { OsPackageCache } from './core/downloaders/os-shared/cache-manager';

const distribution = getDistributionById('rocky-9')!;
const repositories = [...distribution.defaultRepos, ...distribution.extendedRepos]
  .filter(repo => repo.enabled);
const resolver = new YumDependencyResolver({
  distribution,
  architecture: 'x86_64',
  repositories,
  cacheManager: new OsPackageCache({ type: 'session' }),
  includeOptional: false,
  includeRecommends: false,
});

const searchResults = await resolver.searchPackages('httpd', 'exact');
if (!searchResults.length) throw new Error('httpd 패키지를 찾지 못했습니다.');
const depResult = await resolver.resolveDependencies([searchResults[0].latest]);

const downloader = new YumDownloader({
  distribution,
  architecture: 'x86_64',
  repositories,
  outputDir: '/tmp/packages',
  concurrency: 3,
  onProgress: progress => console.log(
    `${progress.currentPackage}: ${progress.bytesDownloaded}/${progress.totalBytes}`
  ),
});
const downloadResult = await downloader.downloadPackages(depResult.packages);
console.log(downloadResult.downloadedFiles);
```

이 저수준 예제에서는 패키지 파일만 저장합니다. CLI backend는 여기에 충돌 후보 병합, 아카이브/저장소 생성, staging 정리를 추가합니다. 충돌 후보를 모두 함께 내려받더라도 동시에 설치할 수 있다는 의미는 아니며, CLI는 충돌이 있으면 자동 설치 스크립트를 생략하고 경고를 반환합니다.

---

## 패키지 관리자별 구현

### YumDownloader

- **위치**: `src/core/downloaders/yum.ts`
- **Resolver 위치**: `src/core/resolver/yum-resolver.ts`
- **지원 배포판**: CentOS 7, Rocky Linux 8/9, AlmaLinux 8/9 (정적 프리셋)
- **파일 형식**: `.rpm`
- **메타데이터**: `repodata/repomd.xml`, `primary.xml.gz`

#### 메타데이터 파싱 (YumMetadataParser)

Rocky의 큰 primary XML에 포함된 표준 엔티티를 처리하도록 `fast-xml-parser`의 엔티티 처리를 유지하면서 파서가 집계하는 치환 횟수를 100,000회로 제한합니다. DTD 선언 수 100개, 단일 엔티티 크기 10,000, DTD 치환에 따른 누적 확장 길이 100,000의 기존 제한도 명시적으로 유지합니다. `&amp;` 같은 표준 XML 값은 디코딩되며, 제한을 넘는 입력은 파싱 오류로 보고합니다. 이 값은 전체 XML이나 압축 해제 크기의 상한이 아닙니다.

`YumDependencyResolver`는 모든 활성 저장소의 로딩이 성공한 뒤 패키지·provides 인덱스를 반영합니다. primary 누락이나 조회·파싱 실패를 빈 검색 결과로 숨기지 않으며, 실패한 시도의 일부 목록은 다음 재시도에서 사용하지 않습니다. 정상적으로 저장한 저장소별 디스크 캐시는 재사용합니다.

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
${baseUrl}/${repomd.primary.location}  # 실제 파일명은 repomd.xml에서 읽음
${baseUrl}/${pkg.location}            # 저장소 메타데이터의 location 사용
```

---

### AptDownloader

- **위치**: `src/core/downloaders/apt.ts`
- **Resolver 위치**: `src/core/resolver/apt-resolver.ts`
- **지원 배포판**: Ubuntu 20.04/22.04/24.04, Debian 11/12
- **파일 형식**: `.deb`
- **메타데이터**: `Packages.gz` 등 패키지 인덱스와 `Release` 파서 (InRelease 서명 검증은 구현되지 않음)

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

- **위치**: `src/core/downloaders/apk.ts`
- **Resolver 위치**: `src/core/resolver/apk-resolver.ts`
- **지원 배포판**: Alpine Linux 3.18/3.19/3.20
- **파일 형식**: `.apk`
- **메타데이터**: `APKINDEX.tar.gz`

#### 메타데이터 파싱 (ApkMetadataParser)

`D:`의 `so:`, `cmd:`, `pc:` 항목을 시스템에 이미 설치된 것으로 간주해 버리지 않고 의존성으로 보존합니다. Resolver는 호환 아키텍처의 `p:` provides에서 제공자를 찾아 전이 목록에 포함합니다. 버전 조건이 있으면 제공 APK 자체의 버전 대신 같은 capability의 제공 버전을 비교하며, 버전 없는 제공은 버전 조건을 충족한 것으로 간주하지 않습니다. 제공자가 없거나 버전이 맞지 않으면 기존 unresolved/warning 결과에 남깁니다.

서로 다른 APK가 같은 capability나 `/bin/sh` 같은 경로를 제공하면 기존 최선 후보 선택 규칙으로 하나의 제공 패키지 이름을 선택하며, 이를 같은 패키지의 여러 버전과 구분합니다. APKINDEX 파싱 결과 캐시에는 스키마 버전을 저장하므로 capability를 누락한 이전 캐시는 다시 파싱하고 이후 요청부터 새 결과를 재사용합니다.

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
- `p`: Provides (버전이 있는 capability 포함)

---

## 의존성 해결

### BaseOSDependencyResolver

- **위치**: `src/core/downloaders/os-shared/base-resolver.ts`
- **방식**: API 우선/메타데이터 폴백 확장 지점을 제공하며, 현재 YUM·APT·APK의 API 구현은 모두 null을 반환하여 메타데이터 사용
- **알고리즘**: BFS 큐 기반

#### 알고리즘

> 기존 재귀적 의존성 해결에서 BFS 큐 기반으로 변경하여 순환 의존성을 안전하게 처리하고 깊은 의존성 트리에서도 call stack overflow가 발생하지 않습니다.

1. **BFS 큐**로 의존성 그래프 구성 (순환 의존성 방지)
2. **이름·버전·RPM release·아키텍처 키**로 큐 중복과 이미 처리한 패키지의 재방문 차단. 릴리스가 다른 후보는 각각 탐색합니다.
3. **provides/virtual 패키지** 해결
4. **버전 제약 조건** 확인
5. **위상 정렬 (Topological Sort)**로 설치 순서 결정
6. **충돌 감지**: 기존 후보 선택 정책이 유지한 여러 버전을 conflict에 기록합니다. 최선 후보를 부모의 의존성 엣지로 연결하고, 다운로드에 포함될 충돌 버전도 같은 큐에서 처리해 각 버전의 하위 의존성·추가 충돌·미해결 항목을 결과에 반영합니다.
7. **MAX_ITERATIONS (10000)**: 단일 루트 탐색에서 새로 처리하는 고유 패키지 수를 제한합니다. 정확히 10,000개로 작업이 끝나면 정상 반환하고, 그 뒤에도 처리할 패키지가 남으면 오류로 종료합니다. 중복 엣지가 처리 횟수를 소모하거나 부분 결과가 성공으로 반환되지 않도록 합니다.

버전·아키텍처 필터링 후 `selectCandidatesForDependency` 확장 지점을 거칩니다. 기본 구현은 후보를 그대로 유지하고, APK 구현은 서로 다른 제공 패키지 이름 중 하나를 선택한 뒤 그 패키지의 버전 충돌을 계산합니다.

#### DependencyResolutionResult

```typescript
interface DependencyResolutionResult {
  packages: OSPackageInfo[];      // 해결된 패키지 목록 (설치 순서)
  unresolved: PackageDependency[]; // 해결 실패 의존성
  conflicts: Array<{ package: string; versions: OSPackageInfo[] }>;
  warnings: string[];
}
```

### OSDependencyTree

- **위치**: `src/core/downloaders/os-shared/dependency-tree.ts`
- **기능**: 의존성 그래프 관리 및 시각화 데이터 제공

```typescript
class OSDependencyTree {
  addNode(pkg: OSPackageInfo): void;
  addEdge(parent: OSPackageInfo, child: OSPackageInfo, dependency: PackageDependency): void;
  addMissingDependency(pkg: OSPackageInfo, dep: PackageDependency): void;

  getInstallOrder(): OSPackageInfo[];           // 위상 정렬된 설치 순서
  getAllPackages(): OSPackageInfo[];            // 모든 패키지
  getMissingDependencies(): MissingDependency[];
  getConflicts(): VersionConflict[];
  toVisualizationData(): VisualizationData;     // 시각화용 데이터
}
```

노드 ID와 엣지의 source/target은 `getDownloadedFileKey(pkg)`와 같은 `[name, version, release 또는 빈 문자열, architecture]`의 JSON 문자열입니다. ID를 하이픈으로 분해하지 않고 연결용 식별자로 사용합니다. 같은 버전의 RPM도 release가 다르면 별도 노드와 충돌 후보로 유지됩니다.

---

## 유틸리티 모듈

### OsPackageCache

- **위치**: `src/core/downloaders/os-shared/cache-manager.ts`
- **특징**: LRU 캐시 + TTL 지원

```typescript
interface OSCacheConfig {
  type: CacheMode;               // 'session' | 'persistent' | 'none'
  ttl: number;                   // TTL (초, 기본 3600)
  maxSize: number;               // 추정 데이터 크기 한도 (바이트, 생성자 기본 500MiB)
  directory?: string;            // persistent 모드 저장 경로
}

class OsPackageCache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, data: T): Promise<void>;
  invalidate(pattern?: string): Promise<void>;
  getStats(): CacheStats;
  // 전체 삭제는 invalidate() 호출
}
```

`searchOSPackages`와 `downloadOSPackages`는 선택적인 `cacheMaxSize`를 `OsPackageCache.maxSize`에 전달합니다. 직접 호출하면서 생략하면 생성자의 500MiB 기본값을 유지합니다. CLI는 설정한 `maxCacheSize` 또는 CLI 기본값 10GiB를 명시적으로 전달합니다. `cacheEnabled=false`이면 캐시 모드는 `none`이며 새 메타데이터 파일을 저장하지 않습니다.

크기는 기존 `JSON.stringify(data).length * 2` 추정값으로 계산하므로 실제 JSON 파일 크기와 다를 수 있습니다. 저장하거나 기존 캐시를 다시 읽을 때 한도를 넘으면 오래 접근하지 않은 항목부터 제거합니다. 새 항목 하나가 한도보다 크면 다른 항목을 제거하지 않고 저장을 생략합니다. 같은 키의 이전 값이 있다면 그 값은 제거해 오래된 데이터가 다시 조회되지 않도록 합니다.

persistent 캐시 조회 시 최근 접근 시각을 JSON 파일에도 기록해 다음 실행의 LRU 정리에 반영합니다. 이 기록은 기존 캐시 파일을 다시 쓰며, TTL 기준인 최초 저장 시각은 갱신하지 않습니다. 접근 시각 저장에 실패해도 캐시에서 읽은 데이터는 반환하고 경고를 기록합니다.

APT resolver는 원본 Control 필드를 함께 보존하는 `{ schemaVersion: 1, packages }` 값을 저장합니다. 이전 배열 캐시나 알 수 없는 스키마는 다시 파싱해 같은 키에 저장하고, 현재 스키마는 재사용합니다. 원본 필드는 JSON 객체이므로 persistent 캐시를 거쳐도 의존성 연산자·대안·여러 줄 설명이 유지됩니다.

### GPGVerifier

- **위치**: `src/core/downloaders/os-shared/gpg-verifier.ts`
- **기능**: 설정에 따라 공식 저장소 패키지의 체크섬 검증; 실제 GPG 서명 검증은 미구현

```typescript
interface VerificationResult {
  verified: boolean;
  skipped: boolean;
  reason?: 'non-official-repo' | 'gpg-disabled' | 'key-not-found'
    | 'signature-invalid' | 'checksum-mismatch';
  error?: Error;
  keyId?: string;
}

class GPGVerifier {
  importKey(keyUrl: string, repositoryId: string): Promise<GPGKey | null>;
  preloadRepositoryKeys(repos: Repository[]): Promise<void>;
  verifyChecksum(pkg: OSPackageInfo, filePath: string): Promise<VerificationResult>;
  verifyPackage(pkg: OSPackageInfo, filePath: string): Promise<VerificationResult>;
}
```

기본 설정은 `enabled: true`, `officialOnly: true`, `continueOnKeyError: true`입니다. `verifyPackage()`는 저장소의 `gpgCheck`와 공식 저장소 여부를 확인한 뒤 체크섬을 검사합니다. RPM/DEB/APK 서명 검증 메서드는 현재 성공을 반환하는 확장 지점이므로 결과의 `verified`를 실제 GPG 검증 완료로 해석하지 않습니다. `BaseOSDownloader`는 verifier가 주입된 경우에만 호출하며 CLI backend는 기본적으로 이를 주입하지 않습니다.

### OSScriptGenerator

- **위치**: `src/core/downloaders/os-shared/script-generator.ts`
- **기능**: 설치 스크립트 생성 (bash + PowerShell)

```typescript
interface GeneratedScripts {
  bash: string;
  powershell: string;
}

type ScriptType = 'dependency-order' | 'local-repo';

interface ScriptGeneratorOptions {
  repoName?: string;              // 기본 'depssmuggler-local'
  packageDir?: string;            // 기본 './packages'
  stopOnError?: boolean;          // 기본 true
  showProgress?: boolean;         // 기본 true
  includeKoreanComments?: boolean; // 기본 true
}

class OSScriptGenerator {
  generateDependencyOrderScript(
    packages: OSPackageInfo[],
    packageManager: OSPackageManager,
    options?: ScriptGeneratorOptions
  ): GeneratedScripts;

  generateLocalRepoScript(
    packages: OSPackageInfo[],
    packageManager: OSPackageManager,
    options?: ScriptGeneratorOptions
  ): GeneratedScripts;
}
```

---

## 패키저 모듈

### OSArchivePackager

- **위치**: `src/core/downloaders/os-shared/archive-packager.ts`
- **기능**: 패키지를 zip 또는 tar.gz 아카이브로 패키징

```typescript
interface ArchiveOptions {
  format: ArchiveFormat;         // 'zip' | 'tar.gz'
  outputPath: string;
  includeScripts: boolean;
  scriptTypes: ScriptType[];
  packageManager: OSPackageManager;
  repoName?: string;
  includeMetadata?: boolean;    // 기본 true
  includeReadme?: boolean;      // 기본 true
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
├── install.sh                  # 의존성 순서 설치
├── install.ps1                 # Windows에서 WSL을 통한 실행
├── setup-repo.sh               # 로컬 저장소 설정
├── setup-repo.ps1
├── metadata.json               # 패키지 메타데이터
└── README.txt                  # 사용 안내
```

### OSRepoPackager

- **위치**: `src/core/downloaders/os-shared/repo-packager.ts`
- **기능**: 로컬 저장소 구조 생성

```typescript
interface RepoOptions {
  outputPath: string;
  packageManager: OSPackageManager;
  repoName: string;
  includeSetupScript?: boolean; // 기본 true
}

interface RepoResult {
  repoPath: string;
  packageCount: number;
  totalSize: number;
  metadataFiles: string[];
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

| PM | 메타데이터 파일 | 현재 생성 방식 |
|----|-----------------|-----------|
| YUM | `repodata/repomd.xml`, `primary.xml.gz`, `filelists.xml.gz`, `other.xml.gz` | TypeScript XML 생성 + gzip |
| APT | `Packages`, `Packages.gz`, `Release` | TypeScript Control 텍스트 생성 + gzip |
| APK | `APKINDEX.tar.gz` | `APKINDEX` 항목 하나를 담은 gzip tar 아카이브를 Node `tar`로 생성 |

현재 패키저는 `createrepo`, `dpkg-scanpackages`, `apk index`를 실행하지 않습니다. YUM은 `Packages/` 하위에, APT/APK는 저장소 루트에 파일을 복사합니다.

APT는 수신한 `Packages`의 `aptControlFields`에서 의존성 조건과 대안, `Pre-Depends`, `Provides`, `Conflicts`, `Breaks`, `Replaces`, `Multi-Arch`, `Installed-Size` 등 Control 필드를 보존합니다. 여러 줄 값이 있으면 Debian continuation 문법으로 출력하므로 설명의 들여쓰기와 빈 문단 표기도 유지됩니다. 상위 저장소가 짧은 설명과 `Description-md5`만 제공하면 그 값을 유지하며, 별도 Translation 파일을 받거나 DEB의 긴 설명을 추출하지는 않습니다. `Packages.gz`에는 같은 `Packages` 내용을 압축합니다.

`Package`·`Version`·`Architecture`는 선택한 패키지에서, `Filename`·`Size`·`SHA256`은 실제 복사한 파일에서 생성합니다. 상위 저장소의 경로나 오래된 체크섬을 그대로 전달하지 않으며, 필요한 로컬 파일이 없으면 저장소 생성에 실패합니다. API 호출자가 원본 필드를 제공하지 않으면 공통 패키지 정보로 생성하되 의존성 연산자와 제공·충돌 정보를 반영하고, 설치 크기는 `installedSize`가 있을 때 사용합니다. 원본 필드 보존은 전달 저장소의 정보 보존이며, 앱 resolver가 모든 Debian 의존성 표현을 해결한다는 뜻은 아닙니다.

APK 인덱스는 별도 임시 디렉터리에서 아카이브를 완성한 뒤 최종 `APKINDEX.tar.gz`로 교체합니다. 아카이브 생성 중 오류가 발생하면 기존 인덱스를 유지하고 오류를 전달하며, 사용자가 미리 둔 평문 `APKINDEX`를 임시 파일로 사용하거나 삭제하지 않습니다. 생성한 gzip tar 구조는 실제 `ApkMetadataParser`로 검증합니다. 체크섬 인코딩·의존성 조건·provides·설치 크기 보존 문제는 [#97](https://github.com/jonggeun2001/DepsSmuggler/issues/97)에 남아 있으므로, tar 구조 검증을 네이티브 `apk update`·설치 성공으로 간주하지 않습니다.

---

## Distribution Fetcher (동적 배포판 정보)

### 위치
`src/core/downloaders/os-shared/distribution-fetcher.ts`

### 개요
인터넷에서 OS 배포판 버전 정보를 조회하고 24시간 캐시하는 모듈입니다. 정적 프리셋(`repositories.ts`)과 별도의 목록을 반환합니다. 이 목록에는 정적 프리셋에 없는 버전이 포함될 수 있으며, `convertToOSDistributions()`는 저장소 설정을 생성하지 않습니다. GUI 검색·다운로드는 정적 `getDistributionById()`로 다시 확인하므로 동적 목록에 보이는 모든 버전이 다운로드 가능한 것은 아닙니다.

### 주요 타입

#### DistributionVersion
```typescript
interface DistributionVersion {
  id: string;           // 'alpine-3.21'
  name: string;         // 'Alpine Linux 3.21'
  version: string;      // '3.21'
  codename?: string;    // 코드명 (Ubuntu/Debian)
  status: 'current' | 'lts' | 'eol' | 'supported';
  releaseDate?: string;
  eolDate?: string;
}
```

#### DistributionFamily
```typescript
interface DistributionFamily {
  id: string;                    // 'alpine'
  name: string;                  // 'Alpine Linux'
  packageManager: OSPackageManager;
  architectures: OSArchitecture[];
  versions: DistributionVersion[];
}
```

### 지원 배포판 및 데이터 소스

| 배포판 | 패키지 관리자 | 데이터 소스 URL |
|--------|--------------|-----------------|
| Alpine Linux | apk | `dl-cdn.alpinelinux.org/alpine/` |
| Ubuntu | apt | `changelogs.ubuntu.com/meta-release-lts` |
| Debian | apt | `deb.debian.org/debian/dists/` |
| Rocky Linux | yum | `dl.rockylinux.org/pub/rocky/` |
| AlmaLinux | yum | `repo.almalinux.org/almalinux/` |
| CentOS | yum | 정적 데이터 (레거시) |

### 주요 함수

| 함수 | 반환값 | 설명 |
|------|--------|------|
| `fetchAllDistributions()` | `Promise<DistributionFamily[]>` | 모든 배포판 정보 (병렬 조회) |
| `convertToOSDistributions(families)` | `Omit<OSDistribution, 'defaultRepos' \| 'extendedRepos'>[]` | 저장소를 제외한 배포판 정보 변환 |
| `getSimplifiedDistributions()` | `Promise<SimplifiedDistro[]>` | 설정 페이지용 간소화 목록 |
| `getDistributionsByPackageManager(pm)` | `Promise<DistributionFamily[]>` | 패키지 관리자별 필터 |
| `invalidateDistributionCache()` | `void` | 캐시 무효화 |

### 캐싱
- **TTL**: 24시간 (86,400,000ms)
- 메모리 캐시 사용 (모듈 레벨 변수)
- 네트워크 오류 시 폴백 데이터 반환

### 사용 예시

```typescript
import {
  fetchAllDistributions,
  getDistributionsByPackageManager,
  getSimplifiedDistributions
} from './distribution-fetcher';

// 모든 배포판 가져오기
const families = await fetchAllDistributions();
// [{ id: 'rocky', name: 'Rocky Linux', versions: [...] }, ...]

// YUM 계열만 가져오기
const rhelFamilies = await getDistributionsByPackageManager('yum');

// 설정 페이지용 간소화 목록
const simplified = await getSimplifiedDistributions();
// [{ id: 'rocky-9', name: 'Rocky Linux 9', packageManager: 'yum', ... }]
```

### 폴백 동작
네트워크 오류 시 각 배포판별로 소스에 하드코딩된 대체 버전 정보를 반환합니다. 다음은 코드의 fallback 목록이며 현재 배포판 지원 기간을 보장하는 표가 아닙니다:
- Alpine: 3.21, 3.20, 3.19, 3.18
- Ubuntu: 24.04, 22.04, 20.04 (LTS만)
- Debian: 13, 12, 11
- Rocky/AlmaLinux: 9, 8
- CentOS: Stream 9, 7 (정적 목록)

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
declare function getDistributionById(id: string): OSDistribution | undefined;
declare function getDistributionsByPackageManager(pm: OSPackageManager): OSDistribution[];

// 추천 배포판
declare function getRecommendedDistributions(useCase: string): OSDistribution[];

// 용도별 추천
declare const USE_CASE_RECOMMENDATIONS: UseCaseRecommendation[];
// 각 항목: id, name, description, distributions
// - enterprise: ['rocky-9', 'almalinux-9', 'ubuntu-22.04', 'debian-12']
// - legacy: ['centos-7', 'ubuntu-20.04', 'debian-11']
// - container: ['alpine-3.20', 'alpine-3.19', 'debian-12']
// - development: ['ubuntu-24.04', 'debian-12', 'rocky-9', 'alpine-3.20']

// 아키텍처 유틸리티
declare function normalizeArchitecture(arch: string): OSArchitecture;
declare function isArchitectureCompatible(pkg: OSArchitecture, target: OSArchitecture): boolean;

// 저장소 URL 처리
declare function resolveRepoUrl(baseUrl: string, arch: OSArchitecture, distribution: OSDistribution): string;
declare function createCustomRepository(
  id: string, name: string, baseUrl: string,
  options?: Partial<Omit<Repository, 'id' | 'name' | 'baseUrl'>>
): Repository;
```

---

## IPC 핸들러 (Electron)

### 위치
- `electron/search-handlers.ts` - OS 패키지 검색 핸들러
- `electron/download-handlers.ts` - OS 패키지 다운로드 핸들러

### 등록된 핸들러

| 채널 | 파라미터 | 반환값 | 설명 |
|------|----------|--------|------|
| `os:search` | options | `{ packages, totalCount }` | 최신 버전의 OS 패키지 검색 |
| `os:resolveDependencies` | options | 해결 결과 | OS 의존성 해결 |
| `os:download:start` | options | 다운로드 결과 | OS 전용 다운로드 시작 |
| `os:download:cancel` | - | 취소 결과 | OS 작업 취소 |
| `os:cache:stats` / `os:cache:clear` | - | 캐시 결과 | OS 캐시 관리 |
| `download:start` | data | 일반 다운로드 결과 | 일반 장바구니 다운로드 진입점 |

### 진행 상황 이벤트

| 이벤트 | 데이터 | 설명 |
|--------|--------|------|
| `os:download:progress` | `OSDownloadProgress` | OS 전용 다운로드 진행 |
| `download:progress` | 일반 다운로드 진행 이벤트 | 일반 장바구니 다운로드 진행 |

---

## 에러 처리

### OSDownloadError

```typescript
interface OSDownloadError {
  package?: OSPackageInfo;
  message: string;
  type: 'network' | 'checksum' | 'gpg' | 'dependency' | 'unknown';
  cause?: Error;
  retryable: boolean;
}
```

### OSErrorAction

```typescript
type OSErrorAction = 'retry' | 'skip' | 'cancel';
```

### 에러 핸들링 흐름

1. `BaseOSDownloader`는 최대 3번 시도하며 시도 사이에 1초, 2초 대기합니다.
2. 모두 실패한 뒤 `onError`가 있으면 호출합니다.
3. `retry`는 3번의 시도 묶음을 다시 시작하고, `skip`은 `skipped: true` 결과를 반환하며, `cancel`은 오류를 던집니다. 별도의 `AbortSignal` 취소는 `cancelled: true` 결과로 처리합니다.
4. 현재 이 콜백에 전달하는 오류 유형은 `network`로 고정되므로 실제 검증 오류도 메시지와 cause를 함께 확인해야 합니다.

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
- `--format <type>`: 출력 형식 (archive | repository | both, 기본: archive)
- `--archive-format <type>`: 아카이브 형식 (zip | tar.gz, 기본: zip)
- `--no-deps`: 의존성 미포함
- `--concurrency <n>`: 동시 다운로드 수 (기본: 3)
- `--scripts`: 설치 스크립트 포함

예시:
```bash
# 기본 다운로드
depssmuggler os download httpd nginx --distro rocky-9

# 아카이브만 생성
depssmuggler os download apache2 --distro ubuntu-22.04 --format archive --archive-format zip

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

`os cache`는 OS 메타데이터 캐시(`~/.depssmuggler/cache/os-packages`)만 대상으로 동작합니다.

---

## 관련 문서

- [Downloaders 개요](./downloaders.md)
- [아키텍처 개요](./architecture-overview.md)
- [설계 문서](./os-package-downloader-design.md)
- [Electron/Renderer 문서](./electron-renderer.md)
