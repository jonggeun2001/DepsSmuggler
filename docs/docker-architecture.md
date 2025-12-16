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

---

## 모듈 구성

### 1. DockerAuthClient
- **위치**: `src/core/downloaders/docker-auth-client.ts`
- **목적**: 레지스트리 인증 토큰 획득 및 캐싱

| 메서드 | 설명 |
|--------|------|
| `getToken(registry, repo)` | 토큰 획득 (캐시 우선) |
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
| `ECRAuthStrategy` | *.ecr.*.amazonaws.com | AWS ECR |
| `CustomRegistryAuthStrategy` | 기타 | 범용 OCI 레지스트리 |

```typescript
// 인증 전략 인터페이스
interface RegistryAuthStrategy {
  name: string;
  matches(registry: string): boolean;
  authenticate(registry: string, repository: string): Promise<AuthResult>;
}
```

### 3. DockerSearchService
- **위치**: `src/core/downloaders/docker-search-service.ts`
- **목적**: 컨테이너 이미지 검색 및 메타데이터 조회

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `searchPackages` | query, registry? | Promise\<PackageInfo[]\> | 이미지 검색 |
| `getVersions` | repository, registry? | Promise\<string[]\> | 태그 목록 조회 |
| `getPackageMetadata` | repo, tag?, registry? | Promise\<PackageMetadata\> | 이미지 메타데이터 |

내부 메서드:
- `searchDockerHub()`: Docker Hub 검색 API
- `searchQuay()`: Quay.io 검색 API
- `searchCustomRegistry()`: OCI catalog API 사용

### 4. DockerCatalogCache
- **위치**: `src/core/downloaders/docker-catalog-cache.ts`
- **목적**: 레지스트리 카탈로그 캐싱 (커스텀 레지스트리용)

| 메서드 | 설명 |
|--------|------|
| `getCachedCatalog(registry)` | 캐시된 카탈로그 조회 (없으면 fetch) |
| `refreshCatalogCache(registry)` | 카탈로그 강제 갱신 |
| `clearCatalogCache(registry?)` | 카탈로그 캐시 초기화 |
| `getCatalogCacheStatus(registry)` | 캐시 상태 조회 |
| `setCatalogCacheTTL(ttl)` | 캐시 TTL 설정 |

```typescript
// 기본 TTL: 10분
const DEFAULT_CATALOG_CACHE_TTL = 10 * 60 * 1000;
```

### 5. DockerManifestService
- **위치**: `src/core/downloaders/docker-manifest-service.ts`
- **목적**: OCI/Docker 매니페스트 조회 및 아키텍처 선택

| 메서드 | 설명 |
|--------|------|
| `getManifest(registry, repo, tag)` | 매니페스트 조회 |
| `getManifestForArchitecture(registry, repo, tag, arch, os)` | 특정 아키텍처용 매니페스트 |
| `findArchitectureManifest(manifests, arch, os)` | 멀티-아키텍처 매니페스트에서 선택 |

### 6. DockerBlobDownloader
- **위치**: `src/core/downloaders/docker-blob-downloader.ts`
- **목적**: 이미지 레이어(blob) 다운로드 및 tar 생성

| 메서드 | 파라미터 | 설명 |
|--------|----------|------|
| `downloadBlob` | registry, repo, digest, destPath, onProgress? | 단일 blob 다운로드 |
| `downloadBlobs` | registry, repo, layers[], destDir, onProgress? | 다중 blob 병렬 다운로드 |
| `createImageTar` | destDir, layers[], manifest, config | Docker 이미지 tar 생성 |
| `verifyChecksum` | filePath, expectedDigest | SHA256 체크섬 검증 |

```typescript
// 진행률 콜백
type BlobProgressCallback = (
  layer: number,
  totalLayers: number,
  bytesDownloaded: number,
  totalBytes: number
) => void;
```

---

## 지원 타입 정의

### docker-types.ts
- **위치**: `src/core/downloaders/docker-types.ts`

```typescript
// 레지스트리 설정
interface RegistryConfig {
  authUrl: string;
  service: string;
  apiVersion: string;
}

// 매니페스트 타입
interface DockerManifest {
  schemaVersion: number;
  mediaType: string;
  config: BlobDescriptor;
  layers: BlobDescriptor[];
}

interface BlobDescriptor {
  mediaType: string;
  digest: string;
  size: number;
}
```

---

## 유틸리티

### docker-utils.ts
- **위치**: `src/core/downloaders/docker-utils.ts`

| 함수 | 설명 |
|------|------|
| `normalizeRepository(repo)` | 리포지토리명 정규화 (library/ 처리) |
| `parseImageReference(ref)` | 이미지 참조 파싱 (registry/repo:tag) |
| `getRegistryUrl(registry)` | 레지스트리 API URL 생성 |
| `isOfficialImage(repo)` | Docker Hub 공식 이미지 여부 |

---

## 사용 예시

```typescript
import { getDockerDownloader } from './core/downloaders/docker';

const downloader = getDockerDownloader();

// 이미지 검색
const images = await downloader.searchPackages('nginx');

// 태그 조회
const tags = await downloader.getVersions('nginx');

// 이미지 다운로드
const result = await downloader.downloadPackage('nginx', 'alpine', '/tmp/docker', {
  architecture: 'amd64',
  os: 'linux',
  onProgress: (progress) => console.log(`${progress.percent}%`),
});

// 커스텀 레지스트리
const privateImages = await downloader.searchPackages('myapp', {
  registry: 'my-registry.example.com',
});
```

---

## 캐싱 전략

### 토큰 캐싱
- 위치: `DockerAuthClient.tokenCache`
- TTL: 토큰 만료 시간 기반 (토큰별 상이)
- 키: `${registry}:${repository}`

### 카탈로그 캐싱
- 위치: `DockerCatalogCache.catalogCache`
- TTL: 기본 10분 (설정 가능)
- 용도: 커스텀 레지스트리 이미지 목록

### 레지스트리 설정 캐싱
- 위치: `DockerAuthClient.registryConfigCache`
- TTL: 인스턴스 수명
- 용도: 레지스트리 API 엔드포인트 정보

---

## 에러 처리

```typescript
try {
  await downloader.downloadPackage('nginx', 'latest', '/tmp');
} catch (error) {
  if (error instanceof DockerAuthError) {
    // 인증 실패 - 토큰 캐시 초기화 후 재시도
    downloader.clearTokenCache();
  } else if (error instanceof DockerManifestError) {
    // 매니페스트 조회 실패 - 태그 확인 필요
  } else if (error instanceof DockerBlobError) {
    // blob 다운로드 실패 - 네트워크 재시도
  }
}
```

---

## 관련 문서
- [Downloaders 개요](./downloaders.md)
- [공유 유틸리티](./shared-utilities.md)
- [아키텍처 개요](./architecture-overview.md)
