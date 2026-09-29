# Conda 유틸리티

## 개요
- 목적: Conda 패키지 다운로드 및 의존성 해결을 위한 유틸리티
- 위치: `src/core/shared/conda-*.ts`

---

## 모듈 구조

```
src/core/shared/
├── conda-types.ts         # Conda 타입 정의 (shared-types.md 참조)
├── conda-channel.ts       # 논리 채널 → 저장소 URL / API 소유자
├── conda-utils.ts         # Conda 패키지 URL 조회
├── conda-cache.ts         # repodata 참조·디스크 캐시 프로토콜
├── metadata/              # Conda/YUM Worker·HTTP 전달·수명 관리
├── conda-matchspec.ts     # MatchSpec 파싱/매칭
└── conda-validator.ts     # Conda 채널 검증
```

---

## 채널 URL (`conda-channel.ts`)

`getCondaRepositoryBase(channel, baseUrl?)`와 `getCondaApiOwner(channel)`는 `shared/index.ts`에서도 내보냅니다. resolver, downloader, URL 조회, 채널 검증 및 Electron의 파일명 기반 다운로드 경로가 이 규칙을 함께 사용합니다.

| 논리 채널 | 기본 저장소 URL | Anaconda API 소유자 |
| --- | --- | --- |
| `defaults` | `https://repo.anaconda.com/pkgs/main` | `main` |
| `main` | `https://conda.anaconda.org/main` | `main` |
| `conda-forge` | `https://conda.anaconda.org/conda-forge` | `conda-forge` |
| 기타 채널 | `https://conda.anaconda.org/<채널>` | 입력 채널 |

저장소 URL 뒤에 `<subdir>/<파일명>`을 붙입니다. API 파일명에 포함된 subdir는 중복해서 붙이지 않습니다. `defaults` 변환은 기본 origin인 `https://conda.anaconda.org`에만 적용하며 끝의 `/`는 제거합니다. 사용자 지정 `baseUrl`은 기존 `<baseUrl>/<channel>` 규칙을 유지합니다. 예를 들어 `https://mirror.example/conda`와 `defaults`를 주면 저장소는 `https://mirror.example/conda/defaults`입니다.

패키지 메타데이터와 디스크 캐시 디렉터리는 논리 채널명을 유지합니다. 캐시 메타데이터의 URL은 실제 요청한 저장소 주소이며, 진행 중인 요청의 중복 제거 키에는 기존처럼 입력 `baseUrl`도 포함합니다. 이 앱의 `defaults`는 `pkgs/main`을 뜻하며 Conda 자체의 `.condarc`나 여러 기본 채널 설정을 읽어 확장하지 않습니다.

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

- **repodata.json.zst 지원**: zstd 압축 파일 → `current_repodata.json` → `repodata.json` 순으로 시도합니다.
- **캐싱**: URL 헬퍼도 아래 `conda-cache.ts`의 디스크 캐시와 수명이 제한된 Worker 인덱스를 공유합니다. 메인에는 채널/subdir 참조만 보관하고 필요한 이름의 아티팩트만 조회합니다.
- **Python 버전 우선순위**: `py312`, `cp312` 같은 build 태그가 맞는 후보를 우선하고, 그다음 `.conda` 형식과 높은 build number를 선호합니다. 호환 빌드가 없으면 경고 후 다른 빌드를 선택할 수 있으므로 엄격한 필터는 아닙니다.
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

`getCondaSubdir()`의 기본값은 Linux/x86_64입니다. ARM 판별은 `arm64`와 `aarch64`에 적용하고, 다른 아키텍처는 해당 OS의 64비트 subdir로 처리합니다. 알 수 없는 OS에는 `linux-64`를 반환합니다.

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

// 응답 형태 예시: 실제 파일명·크기는 조회 결과에 따릅니다.
console.log(result);
// {
//   url: 'https://conda.anaconda.org/conda-forge/linux-64/numpy-1.26.0-py312h8753938_0.conda',
//   filename: 'numpy-1.26.0-py312h8753938_0.conda',
//   size: 6789012
// }
```

---

## Conda 캐시 (`conda-cache.ts`)

repodata 읽기·압축 해제·파싱·저장·이름 인덱싱은 Worker에서 실행합니다. 메인은 작은 참조를 받으며 `queryRepodata()`로 필요한 이름의 레코드만 조회합니다. 같은 옵션의 동시 로드 Promise를 공유하고 완료 후 제거합니다. Worker 인덱스는 최대 2개/원본 256 MiB 기준이며 30초 유휴 종료 정책을 적용합니다. 기존 350MB 이상 원본의 무제한 전역 캐시는 복원하지 않습니다. 상세 수명·메모리 한계와 측정은 [메타데이터 Worker](metadata-worker-performance.md)를 참고하세요.

유효기간은 `max(서버 max-age, 86400초)`로 최소 24시간입니다. TTL 안에서는 디스크 또는 유효한 Worker 인덱스를 사용하고, 만료되면 기존 URL의 ETag/Last-Modified를 조건부 헤더로 보내 304 응답을 재사용합니다. `forceRefresh`는 TTL 조회와 조건부 요청을 생략합니다. `pruneExpiredCache()`의 기본 정리 기준은 저장된 `maxAge`의 10배입니다. 원본 HTTP는 메인의 axios로 수행하며 시작·완료·실패 로그를 메인의 기존 로거로 전달합니다. 전체 길이가 있으면 20%p 간격의 진행 로그도 남깁니다.

### 이름 인덱스의 hit/miss와 호환 경로 (#187)

이름 인덱스가 완성된 Worker에서 없는 이름은 즉시 빈 `packages`를 반환합니다. 이름을 소문자로 정규화하며, hit도 그 이름의 `.tar.bz2`/`.conda` 원시 후보만 반환합니다. 조회마다 원본 전체를 복사·열거하지 않습니다. 이 경로는 #185의 Worker 전환(PR #196)에서 반영되었고 #187은 그 계약을 별도 회귀 테스트로 고정합니다.

`queryRepodata()`에 인덱스 없는 `RepoData`를 직접 넘기는 호환 경로는 입력을 그대로 반환합니다. processor/downloader가 이 입력을 전체 열거하는 fallback은 유지합니다. 운영 경로는 작은 `RepodataReference`를 사용하므로 이 fallback과 구분해야 합니다. Worker 인덱스가 퇴출되거나 만료·갱신되면 원본을 다시 읽고 함께 재생성하며, 오래된 miss 결과를 따로 영구 캐시하지 않습니다.

대상 플랫폼에서 이름이 없는 경우 noarch 탐색을 계속합니다. 인덱스는 환경 필터 없이 원시 후보를 공유하며 resolver의 Python/CUDA/플랫폼·버전·build 조건과 정렬을 유지합니다. downloader의 메타데이터 fallback은 정확한 버전의 최고 build number를 선택합니다. downloader에 resolver의 환경 선택 규칙을 추가하지 않습니다.

`conda-worker-index.test.ts`는 실제 Worker 메시지 처리 함수를 사용하되 스레드·캐시 I/O 경계를 모킹합니다. 100,000개 기본 포맷 + 다른 포맷 1개를 처음 인덱싱할 때 포맷별 전체 열거 각 1회, 이후 hit 20회/miss 20회는 원본 열거 **0회**인지 검사합니다. 별도 `conda-index-consumers.test.ts`는 실제 Worker·임시 디스크 캐시로 platform miss → noarch와 resolver/downloader의 서로 다른 선택 정책을 검증하며, 인덱스 없는 입력의 전체 열거도 따로 계수합니다. 재현 명령과 캐시 교체·종료 검증은 [테스트 문서](testing.md#conda-이름-인덱스-miss-회귀-187)를 참고하세요. 이 검증은 작업 횟수 계약이며 새 시간 벤치마크나 전체 앱 CPU 측정은 아닙니다.

### 주요 함수

| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `fetchRepodata` | channel, subdir, options? | Promise<CacheResult \| null> | repodata 가져오기 (디스크 캐시 지원) |
| `queryRepodata` | reference, name | Promise<RepoData> | 해당 이름의 레코드만 조회, 기존 작은 RepoData 입력도 지원 |
| `closeRepodataWorker` | - | Promise<void> | 대기 작업 완료 후 Worker 종료 |
| `getCacheStats` | cacheDir? | CacheStats | 캐시 통계 조회 |
| `getCacheStatsAsync` | cacheDir?, forceRefresh? | Promise<CacheStats> | 데스크톱용 비동기 메타데이터 집계·결과 재사용 |
| `clearCache` | cacheDir?, channel?, subdir? | void | 캐시 삭제 |
| `pruneExpiredCache` | cacheDir?, maxAgeMultiplier? | number | 만료 캐시 정리 |

### CacheResult

```typescript
interface CacheResult {
  data: RepodataReference;      // channel/subdir/options/info를 가진 재조회용 참조
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
  maxAge: number;           // 서버 max-age와 86400 중 큰 값 (초)
  cachedAt: number;         // 캐시 저장 시간 (Unix timestamp ms)
  fileSize: number;         // 압축 응답 또는 JSON 응답의 바이트 수
  packageCount: number;     // 패키지 수
  compressed: boolean;      // zstd 압축 여부
}
```

### FetchRepodataOptions

```typescript
interface FetchRepodataOptions {
  baseUrl?: string;        // 채널명 앞에 붙일 URL (기본: https://conda.anaconda.org)
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
| `matchesSpec` | package: { name; version; build? }, spec: MatchSpec | boolean | 패키지가 스펙에 일치하는지 검사 |
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

const spec = parseMatchSpec('numpy >=1.20,<2.0 py312*');
// { name: 'numpy', version: '>=1.20,<2.0', build: 'py312*' }

const pkg = { name: 'numpy', version: '1.26.0', build: 'py312h8753938_0' };
const matches = matchesSpec(pkg, spec); // true
```

---

`parseMatchSpec()`는 공백으로 나눈 `name version build`와 `name=version=build`, 선택적인 `channel[/subdir]::` 접두사를 처리합니다. 붙여 쓴 `numpy>=1.20` 형태를 일반 비교식으로 파싱하지 않습니다. `matchesSpec()`는 이름·버전·빌드만 검사하고 채널/subdir/namespace는 검사하지 않습니다.

## Conda 채널 검증 (`conda-validator.ts`)

Conda 채널의 원격 repodata에 HEAD 요청을 보내 접근 가능 여부를 확인하는 비동기 유틸리티입니다. 두 함수 모두 `Promise<boolean>`을 반환합니다. `defaults`도 위 채널 URL 규칙에 따라 `repo.anaconda.com/pkgs/main`의 repodata를 확인합니다.

### 주요 함수

| 함수 | 설명 |
|------|------|
| `validateCondaChannel(channel)` | `noarch/repodata.json`에서 HTTP 200 확인, 타임아웃 5초 |
| `validateCondaChannelStrict(channel, subdirs?)` | 기본 `noarch`, `linux-64`, `win-64`, `osx-64`를 병렬 확인, 요청별 3초; 하나라도 성공하면 true |

### 사용 예시

```typescript
import { validateCondaChannel, validateCondaChannelStrict } from './conda-validator';

const accessible = await validateCondaChannel('conda-forge');

// 여러 subdir 중 하나라도 접근 가능한지 확인
const result = await validateCondaChannelStrict('conda-forge', ['linux-64', 'noarch']);
// 네트워크/서버 상태에 따라 true 또는 false
```

---

## 관련 문서

- [Shared Utilities 개요](./shared-utilities.md)
- [공통 타입 정의](./shared-types.md)
- [Conda 의존성 해결 알고리즘](./conda-dependency-resolution.md)
- [캐시 유틸리티](./shared-cache.md)
