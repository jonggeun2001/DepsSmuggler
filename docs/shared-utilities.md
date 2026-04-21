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
├── dependency-tree-utils.ts      # 의존성 트리 유틸리티
├── file-utils.ts                 # 파일 다운로드/압축 유틸리티
├── script-utils.ts               # 설치 스크립트 생성
├── path-utils.ts                 # 크로스 플랫폼 경로 처리
│
│   # HTTP 클라이언트 추상화
├── http-client.ts                # HttpClient 인터페이스 정의
├── axios-http-client.ts          # Axios 기반 구현체
├── mock-http-client.ts           # 테스트용 Mock 구현체
│
│   # 무결성 검사 유틸리티
├── integrity/
│   └── checksum.ts               # 파일 체크섬 계산/검증 공통 모듈
│
│   # 공유 캐시 모듈
├── cache-utils.ts                # 캐시 공통 유틸리티
├── cache-manager.ts              # 범용 캐시 매니저
├── pip-cache.ts                  # PyPI 메타데이터 캐시 (메모리 + 디스크)
├── npm-cache.ts                  # npm packument 캐시 (메모리)
├── maven-cache.ts                # Maven POM 캐시 (메모리 + 디스크)
├── conda-cache.ts                # repodata 캐싱 시스템
│
│   # pip 고급 의존성 해결 모듈
├── pip-backtracking-resolver.ts  # pip 백트래킹 Resolver
├── pip-candidate.ts              # 후보 평가기
├── pip-provider.ts               # resolvelib Provider 구현
├── pip-tags.ts                   # PEP 425 태그 생성/매칭
├── pip-wheel.ts                  # Wheel 파일 파싱/선택
│
│   # conda 고급 모듈
├── conda-matchspec.ts            # MatchSpec 파싱/매칭
├── conda-validator.ts            # Conda 채널 검증
│
│   # maven 고급 모듈
├── maven-skipper.ts              # 의존성 스킵/캐시 관리
├── maven-pom-utils.ts            # POM 파싱 유틸리티
├── maven-bom-processor.ts        # BOM 처리기
├── maven-utils.ts                # Maven classifier 빌드 유틸리티
│
│   # 플랫폼/버전 관련 유틸리티
├── platform-mappings.ts          # Linux 배포판/macOS 버전 매핑
├── version-fetcher.ts            # Python/Node/Java/CUDA 버전 조회
├── version-preloader.ts          # 버전 정보 프리로드/캐싱
│
│   # 재시도 유틸리티
├── retry-utils.ts                # 지수 백오프 재시도
│
│   # 검색 유틸리티
└── search-utils.ts               # 검색 결과 정렬/관련성 점수 계산

src/core/shared/
└── pip-simple-api-client.ts      # PyPI Simple API 파싱

src/utils/
├── logger.ts                     # 로깅 유틸리티
└── mask.ts                       # 민감 정보 마스킹
```

---

## 상세 문서

문서가 기능별로 분할되었습니다. 각 기능에 대한 상세 정보는 아래 문서를 참조하세요:

| 문서 | 설명 | 주요 모듈 |
|------|------|----------|
| [공통 타입](./shared-types.md) | 공통 타입 정의 | types.ts, *-types.ts |
| [pip/PyPI 유틸리티](./shared-pip.md) | PyPI 패키지 다운로드/의존성 해결 | pypi-utils.ts, pip-*.ts |
| [Conda 유틸리티](./shared-conda.md) | Conda 패키지 다운로드/의존성 해결 | conda-*.ts |
| [Maven 유틸리티](./shared-maven.md) | Maven 패키지 다운로드/의존성 해결 | maven-*.ts |
| [npm 유틸리티](./shared-npm.md) | npm 패키지 다운로드/의존성 해결 | npm-*.ts |
| [캐시 유틸리티](./shared-cache.md) | 캐시 공통 유틸리티 | cache-*.ts |
| [파일/경로 유틸리티](./shared-file-path.md) | 파일 다운로드/압축/경로 처리 | file-utils.ts, path-utils.ts, script-utils.ts |
| [HTTP 클라이언트](./shared-http.md) | HTTP 요청 추상화 레이어 | http-client.ts, axios-http-client.ts |
| [의존성 해결 유틸리티](./shared-dependency.md) | 공통 의존성 해결/버전 비교 | dependency-resolver.ts, version-utils.ts |
| [기타 유틸리티](./shared-misc.md) | 검색/재시도/마스킹/플랫폼 | search-utils.ts, retry-utils.ts, mask.ts |

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

// 무결성 검사 유틸리티
export {
  SUPPORTED_CHECKSUM_ALGORITHMS,
  calculateFileChecksum,
  isChecksumAlgorithm,
  normalizeChecksum,
  verifyFileChecksum,
} from './integrity/checksum';
export type { ChecksumAlgorithm } from './integrity/checksum';
```

---

## 무결성 검사 유틸리티 (`integrity/checksum.ts`)

파일 기반 체크섬 계산과 검증을 공통 모듈로 통합했습니다.

### 제공 함수

| 함수 | 설명 |
|------|------|
| `calculateFileChecksum(filePath, algorithm?)` | 파일의 체크섬을 계산합니다. 기본 알고리즘은 `sha256`입니다. |
| `verifyFileChecksum(filePath, expectedChecksum, algorithm?)` | 파일 체크섬이 기대값과 일치하는지 검증합니다. |
| `normalizeChecksum(checksum)` | 대소문자/`sha256:` 같은 알고리즘 프리픽스를 정규화합니다. |
| `isChecksumAlgorithm(value)` | 지원하는 알고리즘(`md5`, `sha1`, `sha256`, `sha512`) 여부를 확인합니다. |

### 주요 사용처

- `src/core/downloaders/pip.ts`
- `src/core/downloaders/conda.ts`
- `src/core/downloaders/maven.ts`
- `src/core/downloaders/docker-utils.ts`
- `src/core/cache-manager.ts`
- `src/core/downloaders/os-shared/gpg-verifier.ts`

---

## 관련 문서
- [아키텍처 개요](./architecture-overview.md)
- [Downloaders 문서](./downloaders.md)
- [Resolvers 문서](./resolvers.md)
- [Docker 아키텍처](./docker-architecture.md)
- [다운로드 유틸리티](./download-utilities.md)
- [pip 의존성 해결 알고리즘](./pip-dependency-resolution.md)
- [conda 의존성 해결 알고리즘](./conda-dependency-resolution.md)
- [Maven 의존성 해결 알고리즘](./maven-dependency-resolution.md)
- [npm 의존성 해결 알고리즘](./npm-dependency-resolution.md)
- [IPC 핸들러](./ipc-handlers.md)
- [Downloader Factory](./downloader-factory.md)
