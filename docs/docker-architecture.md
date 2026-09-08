# Docker 다운로더 아키텍처

## 개요
- 목적: Docker 컨테이너 이미지 검색 및 다운로드를 위한 모듈화된 아키텍처
- 위치: `src/core/downloaders/docker*.ts`

## 아키텍처 다이어그램

```
┌─────────────────────────────────────────────────────────────────┐
│                      DockerDownloader                           │
│                     (docker.ts - 메인 진입점)                    │
└──────────────────────────┬──────────────────────────────────────┘
                           │
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────────────┐
│ DockerSearch    │ │ DockerManifest  │ │ DockerBlobDownloader    │
│ Service         │ │ Service         │ │                         │
└────────┬────────┘ └────────┬────────┘ └────────────┬────────────┘
         │                   │                       │
         └───────────┬───────┴───────────────────────┘
                     ▼
         ┌─────────────────────┐
         │  DockerAuthClient   │
         │  (토큰 관리/캐싱)    │
         └──────────┬──────────┘
                    ▼
         ┌─────────────────────┐
         │ AuthStrategyRegistry │
         │ (레지스트리별 인증)   │
         └──────────┬──────────┘
                    ▼
    ┌───────────────┼───────────────┐
    ▼               ▼               ▼
┌─────────┐   ┌─────────┐   ┌──────────────┐
│DockerHub│   │  GHCR   │   │ CustomRegistry│
│Strategy │   │Strategy │   │   Strategy    │
└─────────┘   └─────────┘   └──────────────┘
```

전략 목록에는 위 그림의 Docker Hub·GHCR·custom 외에 `ECRAuthStrategy`와 `QuayAuthStrategy`도 포함됩니다. 검색 서비스는 `DockerCatalogCache`를 사용해 커스텀 레지스트리 목록을 재사용합니다.

---

## 모듈 구성

### 1. DockerAuthClient
- **위치**: `src/core/downloaders/docker-auth-client.ts`
- **목적**: 레지스트리 인증 토큰 획득 및 캐싱

| 메서드 | 설명 |
|--------|------|
| `getToken(repo)` | Docker Hub 토큰 획득 (캐시 우선) |
| `getTokenForRegistry(registry, repo)` | 레지스트리별 토큰 발급 |
| `getRegistryConfig(registry)` | 레지스트리 설정 조회 |
| `clearTokenCache()` | 전체 토큰 캐시 초기화 |
| `clearTokenCacheForRegistry(registry)` | 특정 레지스트리 캐시 초기화 |

### 2. AuthStrategyRegistry
- **위치**: `src/core/downloaders/docker-auth-strategies.ts`
- **목적**: 레지스트리별 인증 전략 관리

| 전략 | 레지스트리 | 설명 |
|------|-----------|------|
| `DockerHubAuthStrategy` | registry-1.docker.io | Docker Hub 기본 인증 |
| `GHCRAuthStrategy` | ghcr.io | GitHub Container Registry |
| `QuayAuthStrategy` | quay.io | Red Hat Quay |
| `ECRAuthStrategy` | public.ecr.aws (`ecr`) | AWS ECR Public |
| `CustomRegistryAuthStrategy` | 기타 | 범용 OCI 레지스트리 |

```typescript
// 인증 전략 인터페이스
interface RegistryAuthStrategy {
  isApplicable(registryType: RegistryType): boolean;
  getToken(config: RegistryConfig, repository: string): Promise<AuthResult>;
}
```

인증 전략은 공개 pull용 토큰 또는 익명 접근을 사용합니다. 사용자 자격 증명, GitHub PAT, AWS private ECR 인증을 받는 경로는 없습니다. `registerStrategy(strategy)`는 우선순위가 가장 높은 위치에 전략을 추가하고, `getStrategy(registryType)`으로 조회합니다.

### 3. DockerSearchService
- **위치**: `src/core/downloaders/docker-search-service.ts`
- **목적**: 컨테이너 이미지 검색 및 메타데이터 조회

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `searchPackages` | query, registry? | Promise\<PackageInfo[]\> | 이미지 검색 |
| `getVersions` | repository, registry? | Promise\<string[]\> | 태그 목록 조회 |
| `getPackageMetadata` | name, version | Promise\<PackageInfo\> | Docker Hub 이미지 메타데이터 |

내부 메서드:
- `searchDockerHub()`: Docker Hub 검색 API
- `searchQuay()`: Quay.io 검색 API
- `searchCustomRegistry()`: OCI catalog API 사용

GHCR·ECR Public 검색은 실제 검색 대신 `${registry}/${query}` 형식의 후보 하나를 제안합니다. 정확한 저장소 이름이 필요합니다. 태그 조회와 `downloadPackage()`는 이름의 레지스트리를 사용하지만, `getPackageMetadata()`는 현재 Docker Hub 경로에 고정되어 있습니다.

### 4. DockerCatalogCache
- **위치**: `src/core/downloaders/docker-catalog-cache.ts`
- **목적**: 레지스트리 카탈로그 캐싱 (커스텀 레지스트리용)

| 메서드 | 설명 |
|--------|------|
| `getCachedCatalog(registry)` | 캐시된 카탈로그 조회 (없으면 fetch) |
| `refreshCatalogCache(registry)` | 카탈로그 강제 갱신 |
| `clearCatalogCache()` | 카탈로그 캐시 초기화 |
| `getCatalogCacheStatus()` | 모든 캐시 상태를 `CatalogCacheStatus[]`로 조회 |
| `setCatalogCacheTTL(ttlMs)` / `getCatalogCacheTTL()` | TTL 설정/조회 (ms) |

```typescript
// src/core/constants/docker.ts의 값: 1시간
const DEFAULT_CATALOG_CACHE_TTL = 60 * 60 * 1000;
```

### 5. DockerManifestService
- **위치**: `src/core/downloaders/docker-manifest-service.ts`
- **목적**: OCI/Docker 매니페스트 조회 및 아키텍처 선택

| 메서드 | 설명 |
|--------|------|
| `getManifest(repository, reference, token, registry?)` | 매니페스트 조회 |
| `getManifestForArchitecture(repository, reference, token, registry, arch, variant?)` | 특정 아키텍처용 매니페스트 |
| `findArchitectureManifest(manifest, arch, variant?)` | 멀티-아키텍처 매니페스트에서 선택 |

멀티 아키텍처 매니페스트에서는 `platform.os === "linux"`와 요청한 architecture/variant가 일치하는 항목을 선택합니다. OS 인수를 받는 API는 없으며 Windows 컨테이너용 매니페스트 선택은 지원하지 않습니다.

### 6. DockerBlobDownloader
- **위치**: `src/core/downloaders/docker-blob-downloader.ts`
- **목적**: 이미지 레이어(blob) 다운로드 및 tar 생성

| 메서드 | 파라미터 | 설명 |
|--------|----------|------|
| `downloadBlob` | repository, digest, destPath, token, registry?, onChunk? | 단일 blob 다운로드 |
| `downloadBlobs` | repository, blobs, destDir, token, registry, onProgress? | 다중 blob 순차 다운로드 |
| `createImageTar` | sourceDir, tarPath | 준비된 디렉터리로 Docker 이미지 tar 생성 |
| `verifyChecksum` | filePath, expectedDigest | SHA256 체크섬 검증 |

```typescript
// 진행률 콜백
type BlobProgressCallback = (bytes: number) => void; // 해당 청크의 바이트 수
// downloadBlobs의 blobs: Array<{ digest: string; fileName: string }>
// downloadBlobs 콜백: (downloadedBytes: number, totalBytes: number) => void
// 현재 호출값은 청크 바이트와 0이며 누적 합계는 호출자가 관리한다.
```

---

## 지원 타입 정의

### docker-types.ts
- **위치**: `src/core/downloaders/docker-types.ts`

```typescript
// 레지스트리 설정은 docker-utils.ts에 정의
interface RegistryConfig {
  authUrl: string;
  service: string;
  registryUrl: string;
  hubUrl?: string;
}

// 매니페스트 타입
interface DockerManifest {
  schemaVersion: number;
  mediaType: string;
  config?: { mediaType: string; digest: string; size: number };
  layers?: Array<{ mediaType: string; digest: string; size: number }>;
  manifests?: DockerManifestEntry[];
}

interface DockerManifestEntry {
  mediaType: string;
  digest: string;
  size: number;
  platform: { architecture: string; os: string; variant?: string };
}
```

---

## 유틸리티

### docker-utils.ts
- **위치**: `src/core/downloaders/docker-utils.ts`

| 함수 | 설명 |
|------|------|
| `extractRegistry(fullName)` | 알려진 호스트 또는 점이 있는 첫 경로 요소를 레지스트리로 분리 |
| `parseImageName(name)` | 레지스트리를 제거하고 namespace/repo로 분리; 단일 이름은 library namespace 사용 |
| `getRegistryType(registry)` | Docker Hub/GHCR/ECR Public/Quay/custom 분류 |
| `createCustomRegistryConfig(registryUrl)` | `/v2` API와 `/v2/auth` 기본 인증 URL 구성 |
| `calculateSha256(filePath)` | 공통 checksum 유틸리티로 SHA256 계산 |
| `ARCH_MAP` | x86_64→amd64, ARM64, 386, arm/v7 variant 매핑 |

이미지 이름과 태그는 각각 전달합니다. `extractRegistry()`는 태그를 분리하는 함수가 아니며 `localhost:5000`처럼 점이 없는 주소는 이름에서 자동 추출되지 않습니다. 이 경우 registry 인수를 명시합니다.

---

## 사용 예시

```typescript
import { getDockerDownloader } from './core/downloaders/docker';

const downloader = getDockerDownloader();

// 이미지 검색
const images = await downloader.searchPackages('nginx');

// 태그 조회
const tags = await downloader.getVersions('nginx');

// Linux amd64 이미지 다운로드; 반환값은 tar 파일 경로
const tarPath = await downloader.downloadPackage(
  { type: 'docker', name: 'nginx', version: 'alpine', arch: 'amd64' },
  '/tmp/docker',
  (progress) => console.log(`${progress.progress}%`)
);

// 익명 접근을 허용하는 커스텀 레지스트리의 카탈로그 검색
const customImages = await downloader.searchPackages('myapp', 'registry.example.com');
```

---

## 캐싱 전략

### 토큰 캐싱
- 위치: `DockerAuthClient.tokenCache`
- TTL: 토큰 만료 시간 기반, 만료 60초 전 갱신 (기본 만료 300초)
- 키: `${registry}:${repository}`

### 카탈로그 캐싱
- 위치: `DockerCatalogCache.catalogCache`
- TTL: 기본 1시간 (설정 가능)
- 용도: 커스텀 레지스트리 이미지 목록

### 레지스트리 설정 캐싱
- 위치: `DockerAuthClient.registryConfigCache`
- TTL: 인스턴스 수명
- 용도: 레지스트리 API 엔드포인트 정보

---

## 에러 처리

```typescript
try {
  await downloader.downloadPackage(
    { type: 'docker', name: 'nginx', version: 'latest' },
    '/tmp/images'
  );
} catch (error) {
  // 인증/HTTP/매니페스트/체크섬 오류를 메시지로 확인한다.
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
}
```

`DockerAuthError` 같은 전용 오류 클래스나 `DockerDownloader.clearTokenCache()` 메서드는 없습니다. 토큰 초기화 API는 `DockerAuthClient`에 있습니다. blob의 SHA256 불일치 시 해당 파일을 삭제하고 오류를 던지며, `DockerDownloader`는 오류 메시지·스택을 로그에 남긴 뒤 호출자에게 전파합니다.

---

## 관련 문서
- [Downloaders 개요](./downloaders.md)
- [공유 유틸리티](./shared-utilities.md)
- [아키텍처 개요](./architecture-overview.md)
