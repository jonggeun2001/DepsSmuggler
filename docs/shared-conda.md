# Conda 유틸리티

## 개요
- 목적: Conda 패키지 다운로드 및 의존성 해결을 위한 유틸리티
- 위치: `src/core/shared/conda-*.ts`

---

## 모듈 구조

```
src/core/shared/
├── conda-types.ts         # Conda 타입 정의 (shared-types.md 참조)
├── conda-utils.ts         # Conda 패키지 URL 조회
├── conda-cache.ts         # repodata 캐싱 시스템
├── conda-matchspec.ts     # MatchSpec 파싱/매칭
└── conda-validator.ts     # Conda 채널 검증
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

## Conda 캐시 (`conda-cache.ts`)

repodata.json 캐싱 및 조회 시스템 (**디스크 캐시 전용** - 메모리 캐시 미사용)

> **참고**: Conda repodata.json 파일은 350MB+ 크기이므로 메모리 캐시를 사용하지 않고 디스크 캐시만 사용합니다.

### 다운로드 진행 상황 로깅

repodata 다운로드 시 진행 상황을 20% 단위로 로그 출력:

```typescript
onDownloadProgress: (progressEvent) => {
  const { loaded, total } = progressEvent;
  if (total) {
    const percent = Math.floor((loaded / total) * 100);
    // 20% 단위로 로그 출력 (너무 많은 로그 방지)
    if (percent >= lastLoggedPercent + 20) {
      lastLoggedPercent = percent;
      logger.info(`repodata 다운로드 중: ${channel}/${subdir} (${loadedMB}MB / ${totalMB}MB, ${percent}%, ${elapsed}초)`);
    }
  }
}
```

로그 출력 예시:
```
[INFO] repodata 다운로드 시작: conda-forge/linux-64
[INFO] repodata 다운로드 중: conda-forge/linux-64 (20.5MB / 102.3MB, 20%, 5.2초)
[INFO] repodata 다운로드 중: conda-forge/linux-64 (41.0MB / 102.3MB, 40%, 10.1초)
[INFO] repodata 다운로드 중: conda-forge/linux-64 (61.4MB / 102.3MB, 60%, 15.3초)
[INFO] repodata 다운로드 중: conda-forge/linux-64 (81.8MB / 102.3MB, 80%, 20.5초)
[INFO] repodata 다운로드 완료: conda-forge/linux-64 (25.8초)
```

### 주요 함수

| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `fetchRepodata` | channel, subdir, options? | Promise<CacheResult \| null> | repodata 가져오기 (디스크 캐시 지원) |
| `getCacheStats` | cacheDir? | CacheStats | 캐시 통계 조회 |
| `clearCache` | cacheDir?, channel?, subdir? | void | 캐시 삭제 |
| `pruneExpiredCache` | cacheDir?, maxAgeMultiplier? | number | 만료 캐시 정리 |

### CacheResult

```typescript
interface CacheResult {
  data: RepoData;               // repodata 내용
  fromCache: boolean;           // 캐시에서 로드 여부
  meta: RepodataCacheMeta;      // 캐시 메타데이터
}
```

### RepodataCacheMeta

```typescript
interface RepodataCacheMeta {
  url: string;              // 원본 URL
  etag?: string;            // HTTP ETag
  lastModified?: string;    // HTTP Last-Modified
  maxAge: number;           // Cache-Control max-age (초)
  cachedAt: number;         // 캐시 저장 시간 (Unix timestamp ms)
  fileSize: number;         // 파일 크기 (바이트)
  packageCount: number;     // 패키지 수
  compressed: boolean;      // zstd 압축 여부
}
```

### FetchRepodataOptions

```typescript
interface FetchRepodataOptions {
  baseUrl?: string;        // Conda 기본 URL (기본: https://conda.anaconda.org)
  cacheDir?: string;       // 캐시 디렉토리
  useCache?: boolean;      // 캐시 사용 여부 (기본: true)
  forceRefresh?: boolean;  // 강제 새로고침 (기본: false)
  timeout?: number;        // 요청 타임아웃 (ms, 기본: 120000)
}
```

### CacheStats

```typescript
interface CacheStats {
  totalSize: number;       // 총 캐시 크기 (바이트)
  channelCount: number;    // 캐시된 채널 수
  entries: Array<{
    channel: string;
    subdir: string;
    meta: RepodataCacheMeta;
    dataSize: number;
  }>;
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

## Conda 채널 검증 (`conda-validator.ts`)

Conda 채널 URL 유효성 검증 유틸리티입니다.

### 주요 함수

| 함수 | 설명 |
|------|------|
| `validateCondaChannel(channel)` | 채널 유효성 검증 (간략) |
| `validateCondaChannelStrict(channel)` | 채널 유효성 검증 (엄격) |

### 사용 예시

```typescript
import { validateCondaChannel, validateCondaChannelStrict } from './conda-validator';

validateCondaChannel('conda-forge');     // { valid: true, normalized: 'conda-forge' }
validateCondaChannel('invalid/channel'); // { valid: false, error: '...' }

// 엄격 모드: 실제 repodata 존재 확인
const result = await validateCondaChannelStrict('conda-forge');
```

---

## 관련 문서

- [Shared Utilities 개요](./shared-utilities.md)
- [공통 타입 정의](./shared-types.md)
- [Conda 의존성 해결 알고리즘](./conda-dependency-resolution.md)
- [캐시 유틸리티](./shared-cache.md)
