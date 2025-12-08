# Downloaders

## 개요
- 목적: 각 패키지 관리자별 패키지 검색 및 다운로드 구현
- 위치: `src/core/downloaders/`

---

## PipDownloader

### 개요
- 목적: PyPI 패키지 검색 및 다운로드
- 위치: `src/core/downloaders/pip.ts`

### 클래스 구조

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `searchPackages` | query: string | Promise<PackageInfo[]> | PyPI에서 패키지 검색 |
| `getVersions` | packageName: string | Promise<string[]> | 패키지의 사용 가능한 버전 목록 조회 |
| `getPackageMetadata` | name: string, version?: string | Promise<PackageMetadata> | 패키지 상세 메타데이터 조회 |
| `downloadPackage` | name: string, version: string, destDir: string, options? | Promise<DownloadResult> | 패키지 파일 다운로드 |
| `getReleasesForArch` | releases: PyPIRelease[], arch?: string | PyPIRelease[] | 특정 아키텍처용 릴리즈 필터링 |
| `verifyChecksum` | filePath: string, expectedHash: string | Promise<boolean> | SHA256 체크섬 검증 |

### 내부 메서드

| 메서드 | 설명 |
|--------|------|
| `selectBestRelease` | Python 버전, OS, 아키텍처에 맞는 최적 릴리즈 선택 |

### 속성

| 속성 | 타입 | 설명 |
|------|------|------|
| `type` | PackageType | 'pip' |
| `baseUrl` | string | PyPI API URL |
| `client` | AxiosInstance | HTTP 클라이언트 |

### 다운로드 옵션

```typescript
interface PipDownloadOptions {
  pythonVersion?: string;   // 타겟 Python 버전 (예: '3.11')
  targetOS?: string;        // 타겟 OS (예: 'linux', 'macos', 'windows')
  architecture?: string;    // 타겟 아키텍처 (예: 'x86_64', 'arm64')
  preferWheel?: boolean;    // wheel 파일 우선 선택 (기본: true)
}
```

### 사용 예시
```typescript
import { getPipDownloader } from './core/downloaders/pip';

const downloader = getPipDownloader();
const results = await downloader.searchPackages('requests');
const versions = await downloader.getVersions('requests');

// 특정 Python/OS/아키텍처용 패키지 다운로드
const result = await downloader.downloadPackage('numpy', '1.26.0', '/tmp/downloads', {
  pythonVersion: '3.11',
  targetOS: 'linux',
  architecture: 'x86_64',
});
```

---

## CondaDownloader

### 개요
- 목적: Anaconda/Conda-forge 패키지 검색 및 다운로드
- 위치: `src/core/downloaders/conda.ts`

### 클래스 구조

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `searchPackages` | query: string, channel?: string | Promise<PackageInfo[]> | Anaconda에서 패키지 검색 |
| `getVersions` | packageName: string, channel?: string | Promise<string[]> | 패키지 버전 목록 조회 |
| `getPackageMetadata` | name: string, version?: string | Promise<PackageMetadata> | 패키지 메타데이터 조회 |
| `downloadPackage` | name: string, version: string, destDir: string, options? | Promise<DownloadResult> | 패키지 다운로드 |
| `getPackageFiles` | name: string, version: string, channel?: string | Promise<CondaPackageFile[]> | 패키지 파일 목록 조회 |
| `verifyChecksum` | filePath: string, expectedHash: string | Promise<boolean> | SHA256/MD5 체크섬 검증 |
| `clearCache` | - | void | repodata 캐시 초기화 |

### 내부 메서드

| 메서드 | 설명 |
|--------|------|
| `getRepoData` | repodata.json 가져오기 (zstd 압축 지원, 캐싱) |
| `findPackageInRepoData` | repodata에서 패키지 검색 |
| `selectBestFile` | Python 버전, OS, 아키텍처에 맞는 최적 파일 선택 |
| `getPackageMetadataFallback` | Anaconda API fallback 조회 |
| `mapArch` | 아키텍처 매핑 (x86_64 → linux-64 등) |

### 속성

| 속성 | 타입 | 설명 |
|------|------|------|
| `type` | PackageType | 'conda' |
| `apiUrl` | string | Anaconda API URL |
| `condaUrl` | string | Conda 패키지 저장소 URL |
| `repodataCache` | Map<string, RepoData> | repodata 캐시 |
| `client` | AxiosInstance | HTTP 클라이언트 |

### 다운로드 옵션

```typescript
interface CondaDownloadOptions {
  channel?: string;        // 채널 (기본: 'conda-forge')
  pythonVersion?: string;  // 타겟 Python 버전 (예: '3.12')
  targetOS?: string;       // 타겟 OS (예: 'linux', 'macos', 'windows')
  architecture?: string;   // 타겟 아키텍처 (예: 'x86_64', 'arm64')
}
```

### 채널 설정
```typescript
const CondaChannel = {
  CONDA_FORGE: 'conda-forge',
  MAIN: 'main',
  R: 'r',
  BIOCONDA: 'bioconda'
} as const;
```

### Subdir 매핑

| OS + 아키텍처 | Subdir |
|---------------|--------|
| linux + x86_64 | linux-64 |
| linux + arm64/aarch64 | linux-aarch64 |
| macos + x86_64 | osx-64 |
| macos + arm64 | osx-arm64 |
| windows + x86_64 | win-64 |
| windows + arm64 | win-arm64 |

### 특징

- **repodata.json.zst 지원**: zstd 압축 파일 우선 사용 (대역폭 절약)
- **캐싱**: repodata 캐싱으로 중복 요청 방지
- **Python 버전 필터링**: py312, py311 등 build 태그로 Python 버전에 맞는 패키지 선택
- **noarch 지원**: 아키텍처 독립 패키지 자동 탐색
- **Anaconda API fallback**: RC 버전 등 특수 라벨 패키지 지원

### 사용 예시
```typescript
import { getCondaDownloader, CondaChannel } from './core/downloaders/conda';

const downloader = getCondaDownloader();
const results = await downloader.searchPackages('numpy', CondaChannel.CONDA_FORGE);

// Python 3.12, Linux x86_64용 패키지 다운로드
const result = await downloader.downloadPackage('numpy', '1.26.0', '/tmp/downloads', {
  channel: 'conda-forge',
  pythonVersion: '3.12',
  targetOS: 'linux',
  architecture: 'x86_64',
});

// 다운로드 후 체크섬 검증
const valid = await downloader.verifyChecksum(result.filePath, result.sha256);
```

---

## MavenDownloader

### 개요
- 목적: Maven Central 아티팩트 검색 및 다운로드
- 위치: `src/core/downloaders/maven.ts`

### 클래스 구조

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `searchPackages` | query: string | Promise<PackageInfo[]> | Maven Central에서 아티팩트 검색 |
| `getVersions` | artifactId: string, groupId?: string | Promise<string[]> | 아티팩트 버전 목록 조회 |
| `getPackageMetadata` | name: string, version?: string | Promise<PackageMetadata> | 아티팩트 메타데이터 조회 |
| `downloadPackage` | name: string, version: string, destDir: string | Promise<DownloadResult> | 아티팩트 완전 다운로드 (jar, pom, 체크섬 포함) |
| `downloadArtifact` | artifact: MavenArtifact, destDir: string, options? | Promise<DownloadResult> | 특정 타입 아티팩트 다운로드 |
| `downloadChecksumFile` | groupId, artifactId, version, destDir, extension | Promise<void> | 체크섬 파일 (.sha1) 다운로드 |
| `downloadPom` | artifact: MavenArtifact, destDir: string | Promise<DownloadResult> | POM 파일 다운로드 |
| `downloadSources` | artifact: MavenArtifact, destDir: string | Promise<DownloadResult> | 소스 JAR 다운로드 |
| `downloadJavadoc` | artifact: MavenArtifact, destDir: string | Promise<DownloadResult> | Javadoc JAR 다운로드 |
| `verifyChecksum` | filePath: string, checksumUrl: string | Promise<boolean> | SHA1 체크섬 검증 |

### 내부 메서드

| 메서드 | 설명 |
|--------|------|
| `buildDownloadUrl` | Maven 저장소 URL 생성 |
| `buildFileName` | 다운로드 파일명 생성 |
| `compareVersions` | Maven 버전 비교 |
| `parseCoordinates` | GAV 좌표 파싱 (groupId:artifactId:version) |

### 아티팩트 타입
```typescript
const ArtifactType = {
  JAR: 'jar',
  POM: 'pom',
  SOURCES: 'sources',
  JAVADOC: 'javadoc',
  WAR: 'war',
  EAR: 'ear'
} as const;
```

### 완전 다운로드 (downloadPackage)

`downloadPackage` 메서드는 오프라인 Maven 저장소 구성에 필요한 모든 파일을 다운로드합니다:

1. **JAR 파일** (`.jar`) - 컴파일된 바이트코드
2. **JAR 체크섬** (`.jar.sha1`) - JAR 무결성 검증용
3. **POM 파일** (`.pom`) - 프로젝트 메타데이터 및 의존성 정보
4. **POM 체크섬** (`.pom.sha1`) - POM 무결성 검증용

이를 통해 다운로드된 패키지를 폐쇄망의 로컬 Maven 저장소로 직접 사용할 수 있습니다.

### 사용 예시
```typescript
import { getMavenDownloader } from './core/downloaders/maven';

const downloader = getMavenDownloader();
const results = await downloader.searchPackages('spring-core');

// 완전 다운로드 (jar, jar.sha1, pom, pom.sha1 모두 다운로드)
const result = await downloader.downloadPackage(
  'org.springframework:spring-core',
  '5.3.0',
  '/tmp/downloads'
);

// 다운로드된 파일:
// /tmp/downloads/spring-core-5.3.0.jar
// /tmp/downloads/spring-core-5.3.0.jar.sha1
// /tmp/downloads/spring-core-5.3.0.pom
// /tmp/downloads/spring-core-5.3.0.pom.sha1

// 특정 아티팩트만 다운로드
const artifactResult = await downloader.downloadArtifact({
  groupId: 'org.springframework',
  artifactId: 'spring-core',
  version: '5.3.0'
}, '/tmp/downloads');
```

---

## OS 패키지 다운로더 (OS Package Downloader)

### 개요
- 목적: Linux OS 패키지(rpm, deb, apk) 검색, 의존성 해결, 다운로드 및 패키징
- 위치: `src/core/downloaders/os/`
- 지원 패키지 관리자: YUM/RPM, APT/DEB, APK
- **상세 문서**: [OS 패키지 다운로더 문서](./os-package-downloader.md)

### 통합 클래스: OSPackageDownloader

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `search` | OSPackageSearchOptions | Promise<OSPackageSearchResult> | 패키지 검색 |
| `resolveDependencies` | packages, distribution, architecture, options? | Promise<DependencyResolutionResult> | 의존성 해결 |
| `download` | OSPackageDownloadOptions | Promise<OSPackageDownloadResult> | 패키지 다운로드 |
| `getCacheStats` | - | CacheStats | 캐시 통계 |
| `clearCache` | - | Promise<void> | 캐시 초기화 |

### 패키지 관리자별 구현

| 클래스 | 패키지 관리자 | 파일 형식 | 메타데이터 |
|--------|--------------|----------|-----------|
| `YumDownloader` | yum/dnf | .rpm | repomd.xml, primary.xml.gz |
| `AptDownloader` | apt | .deb | Packages.gz, Release |
| `ApkDownloader` | apk | .apk | APKINDEX.tar.gz |

### 지원 배포판

| 패키지 관리자 | 배포판 |
|--------------|--------|
| YUM | CentOS 7, Rocky Linux 8/9, AlmaLinux 8/9 |
| APT | Ubuntu 20.04/22.04/24.04, Debian 11/12 |
| APK | Alpine Linux 3.18/3.19/3.20 |

### 주요 기능

- **의존성 자동 해결**: 하이브리드 방식 (API + 메타데이터 파싱)
- **메타데이터 캐싱**: LRU 캐시 + TTL 지원
- **GPG 서명 검증**: 공식 저장소 패키지 검증
- **스크립트 생성**: bash/PowerShell 설치 스크립트
- **출력 패키징**: zip/tar.gz 아카이브, 로컬 저장소 구조

### 사용 예시

```typescript
import { OSPackageDownloader, getDistributionById } from './core/downloaders/os';

const downloader = new OSPackageDownloader({ concurrency: 5 });
const distribution = getDistributionById('rocky-9')!;

// 패키지 검색
const result = await downloader.search({
  query: 'nginx',
  distribution,
  architecture: 'x86_64',
  matchType: 'contains',
});

// 의존성 포함 다운로드
const downloadResult = await downloader.download({
  packages: result.packages,
  outputDir: '/tmp/packages',
  resolveDependencies: true,
  cacheMode: 'session',
});
```

---

## YumDownloader (레거시)

> **참고**: 새로운 OS 패키지 다운로더(`src/core/downloaders/os/`)를 사용하세요.

### 개요
- 목적: YUM/RPM 패키지 검색 및 다운로드 (단순 구현)
- 위치: `src/core/downloaders/yum.ts`

### 클래스 구조

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `searchPackages` | query: string | Promise<PackageInfo[]> | YUM 저장소에서 패키지 검색 |
| `getVersions` | packageName: string | Promise<string[]> | 패키지 버전 목록 조회 |
| `getPackageMetadata` | name: string, version?: string | Promise<PackageMetadata> | 패키지 메타데이터 조회 |
| `downloadPackage` | name: string, version: string, destDir: string | Promise<DownloadResult> | RPM 패키지 다운로드 |

### 기본 저장소
```typescript
const DEFAULT_REPOS = [
  'https://mirror.centos.org/centos/7/os/x86_64/',
  'https://mirror.centos.org/centos/7/updates/x86_64/',
  'https://mirror.centos.org/centos/7/extras/x86_64/'
];
```

### 타입 정의

| 타입 | 설명 |
|------|------|
| `RepoMd` | 저장소 메타데이터 |
| `RepoMdData` | 저장소 데이터 정보 |
| `PrimaryPackage` | primary.xml 패키지 정보 |
| `RpmEntry` | RPM 의존성 엔트리 |

---

## NpmDownloader

### 개요
- 목적: npm 패키지 검색 및 다운로드
- 위치: `src/core/downloaders/npm.ts`

### 클래스 구조

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `searchPackages` | query: string | Promise<PackageInfo[]> | npm Registry에서 패키지 검색 |
| `getVersions` | packageName: string | Promise<string[]> | 패키지 버전 목록 조회 |
| `getPackageMetadata` | name: string, version?: string | Promise<PackageMetadata> | 패키지 메타데이터 조회 |
| `downloadPackage` | name: string, version: string, destDir: string | Promise<DownloadResult> | tarball 다운로드 |
| `downloadTarball` | url: string, destDir: string, filename: string | Promise<string> | tarball 직접 다운로드 |
| `getDistTags` | packageName: string | Promise<Record<string, string>> | dist-tags 조회 (latest 등) |
| `getPackageVersion` | name: string, version: string | Promise<NpmPackageVersion \| null> | 특정 버전 정보 조회 |
| `verifyIntegrity` | filePath: string, integrity: string | Promise<boolean> | SRI 무결성 검증 |
| `verifyShasum` | filePath: string, shasum: string | Promise<boolean> | SHA1 체크섬 검증 |
| `clearCache` | - | void | packument 캐시 초기화 |

### 내부 메서드

| 메서드 | 설명 |
|--------|------|
| `fetchPackument` | registry에서 전체 패키지 메타데이터(packument) 조회 |
| `resolveVersion` | 버전 범위를 실제 버전으로 해결 |
| `satisfies` | semver 범위 매칭 (^, ~, >=, <, = 등) |
| `satisfiesCaret` | ^ 범위 매칭 |
| `satisfiesTilde` | ~ 범위 매칭 |
| `compareVersions` | semver 버전 비교 |

### 속성

| 속성 | 타입 | 설명 |
|------|------|------|
| `type` | PackageType | 'npm' |
| `registryUrl` | string | npm Registry URL (기본: https://registry.npmjs.org) |
| `searchUrl` | string | npm 검색 API URL |
| `packumentCache` | Map<string, NpmPackument> | packument 캐시 |
| `client` | AxiosInstance | HTTP 클라이언트 |

### 버전 범위 지원

```typescript
// 지원되는 버전 범위 형식
'^1.2.3'    // ^: 호환되는 변경 (1.x.x)
'~1.2.3'    // ~: 패치 수준 변경 (1.2.x)
'>=1.0.0'   // 이상
'<2.0.0'    // 미만
'>=1.0 <2.0' // 범위
'1.2.3'     // 정확히 일치
'*'         // 모든 버전
'latest'    // 최신 버전
```

### 사용 예시

```typescript
import { getNpmDownloader } from './core/downloaders/npm';

const downloader = getNpmDownloader();

// 패키지 검색
const results = await downloader.searchPackages('express');

// 버전 목록 조회
const versions = await downloader.getVersions('lodash');

// 패키지 다운로드
const result = await downloader.downloadPackage('lodash', '4.17.21', '/tmp/downloads');

console.log(result.filePath);  // '/tmp/downloads/lodash-4.17.21.tgz'
console.log(result.integrity); // 'sha512-...'

// 무결성 검증
const valid = await downloader.verifyIntegrity(result.filePath, result.integrity);
```

### 특징

- **Packument 캐싱**: 전체 패키지 메타데이터 캐싱으로 중복 요청 방지
- **SRI 검증**: Subresource Integrity 해시 검증 지원
- **semver 호환**: npm의 버전 범위 문법 지원 (^, ~, >=, < 등)
- **dist-tags**: latest, next, beta 등 태그 지원

---

## DockerDownloader

### 개요
- 목적: Docker 이미지 검색 및 다운로드
- 위치: `src/core/downloaders/docker.ts`

### 클래스 구조

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `searchPackages` | query: string | Promise<PackageInfo[]> | Docker Hub에서 이미지 검색 |
| `getVersions` | imageName: string | Promise<string[]> | 이미지 태그 목록 조회 |
| `getPackageMetadata` | name: string, tag?: string | Promise<PackageMetadata> | 이미지 메타데이터 조회 |
| `downloadPackage` | name: string, tag: string, destDir: string | Promise<DownloadResult> | 이미지 레이어 다운로드 |

### 아키텍처 매핑
```typescript
const ARCH_MAP: Record<string, string> = {
  'x86_64': 'amd64',
  'amd64': 'amd64',
  'arm64': 'arm64',
  'aarch64': 'arm64'
};
```

### 타입 정의

| 타입 | 설명 |
|------|------|
| `TokenResponse` | Docker Registry 인증 토큰 |
| `DockerManifest` | 이미지 매니페스트 |
| `DockerSearchResult` | 검색 결과 항목 |
| `DockerSearchResponse` | 검색 응답 전체 |
| `DockerTag` | 태그 정보 |
| `DockerTagsResponse` | 태그 목록 응답 |

---

## 공통 인터페이스

모든 Downloader는 `IDownloader` 인터페이스를 구현:

```typescript
interface IDownloader {
  type: PackageType;
  searchPackages(query: string): Promise<PackageInfo[]>;
  getVersions(packageName: string): Promise<string[]>;
  getPackageMetadata(name: string, version?: string): Promise<PackageMetadata>;
  downloadPackage(name: string, version: string, destDir: string, options?: any): Promise<DownloadResult>;
  verifyChecksum?(filePath: string, expectedHash: string): Promise<boolean>;
}
```

---

## 관련 문서
- [아키텍처 개요](./architecture-overview.md)
- [Resolver 문서](./resolvers.md)
- [Shared Utilities 문서](./shared-utilities.md)
- [npm 의존성 해결 알고리즘](./npm-dependency-resolution.md)
- [OS 패키지 다운로더](./os-package-downloader.md)
