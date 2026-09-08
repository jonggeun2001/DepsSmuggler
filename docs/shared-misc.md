# 기타 유틸리티

## 개요
- 목적: 검색, 재시도, 마스킹, 플랫폼/버전 관련 유틸리티
- 위치: `src/core/shared/`, `src/utils/`

---

## 모듈 구조

```
src/core/shared/
├── search-utils.ts        # 검색 결과 정렬/관련성 점수 계산
├── retry-utils.ts         # 지수 백오프 재시도
├── platform-mappings.ts   # Linux 배포판/macOS 버전 매핑
├── version-fetcher.ts     # Python/Node/Java/CUDA 버전 조회
└── version-preloader.ts   # 버전 정보 프리로드/캐싱

src/utils/
├── logger.ts              # 로깅 유틸리티
└── mask.ts                # 민감 정보 마스킹
```

---

## 검색 유틸리티 (`search-utils.ts`)

패키지 검색 결과를 쿼리와의 관련성에 따라 정렬하는 유틸리티

### 주요 함수

| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `levenshteinDistance` | a: string, b: string | number | 두 문자열 간의 편집 거리 계산 |
| `normalizeForSearch` | str: string | string | 검색용 문자열 정규화 (소문자, 특수문자 제거) |
| `calculateRelevanceScore` | name: string, query: string | number | 패키지명과 쿼리의 관련성 점수 계산 (낮을수록 우선, 상한 없음) |
| `sortByRelevance` | results: T[], query: string, type?: PackageType | T[] | 검색 결과를 관련성 순으로 정렬 |

### PackageType

```typescript
type PackageType = 'pip' | 'conda' | 'maven' | 'npm' | 'docker' | 'yum' | 'default';
```

### 관련성 점수 계산 기준

1. **정확 일치**: 정규화한 이름이 같으면 0
2. **접두사 일치**: `1 + (패키지명 길이 - 쿼리 길이) * 0.1`
3. **포함 일치**: `10 + 첫 등장 인덱스`
4. **편집 거리 기반**: `50 + Levenshtein 거리 * 10`

점수는 낮을수록 먼저 정렬됩니다. `sortByRelevance()`는 전체 이름의 정확 일치를 먼저 처리하고 나머지를 핵심명 점수로 비교합니다. 빈 검색어에는 원본 배열을 반환하며 그 외에는 복사본을 정렬합니다.

### 패키지 타입별 핵심명 추출

| 타입 | 입력 예시 | 핵심명 추출 |
|------|-----------|-------------|
| maven | `org.springframework:spring-core` | `spring-core` |
| docker | `library/nginx` | `nginx` |
| npm | `@types/node` | `node` |
| 기타 | `requests` | `requests` |

### 사용 예시

```typescript
import { sortByRelevance, calculateRelevanceScore } from './search-utils';

// 관련성 점수 계산
const score = calculateRelevanceScore('requests', 'req');  // 1.5 (접두사 일치)
const score2 = calculateRelevanceScore('flask', 'req');    // 더 큰 점수 (관련성 낮음)

// 검색 결과 정렬
const results = [
  { name: 'requests-mock', version: '1.0.0' },
  { name: 'requests', version: '2.28.0' },
  { name: 'urllib3-requests', version: '1.0.0' },
];

const sorted = sortByRelevance(results, 'requests', 'pip');
// [
//   { name: 'requests', version: '2.28.0' },           // 정확 일치
//   { name: 'requests-mock', version: '1.0.0' },       // 접두사 일치
//   { name: 'urllib3-requests', version: '1.0.0' },    // 포함 일치
// ]
```

---

## 재시도 유틸리티 (`retry-utils.ts`)

네트워크 요청 등에서 사용할 수 있는 지수 백오프 재시도 유틸리티입니다.

### RetryOptions

```typescript
interface RetryOptions {
  maxRetries: number;      // 최초 시도 이후 최대 재시도 횟수
  delayMs: number;         // 최초 재시도 지연 시간 ms (이후 2배씩 증가)
  shouldRetry?: (error: unknown) => boolean; // 재시도 조건 함수
}
```

### 주요 함수

| 함수 | 설명 |
|------|------|
| `retryWithExponentialBackoff<T>(fn, options)` | 지수 백오프로 함수 재시도 |
| `isRetryableHttpError(error)` | HTTP 오류 재시도 가능 여부 확인 |

`maxRetries`와 `delayMs`는 필수입니다. 지연은 `delayMs * 2^attempt`이며 jitter나 상한은 없습니다. `isRetryableHttpError()`는 `code`가 `ETIMEDOUT`/`ECONNABORTED`이거나 `response.status`가 504/503/408일 때만 true를 반환합니다. 모든 5xx 또는 429를 자동 재시도하지 않습니다.

### 사용 예시

```typescript
import axios from 'axios';
import { retryWithExponentialBackoff, isRetryableHttpError } from './retry-utils';

const result = await retryWithExponentialBackoff(
  async () => {
    const response = await axios.get('https://api.example.com/data');
    return response.data;
  },
  {
    maxRetries: 3,
    delayMs: 1000,
    shouldRetry: isRetryableHttpError,
  }
);
```

---

## 플랫폼 매핑 (`platform-mappings.ts`)

Linux 배포판 및 macOS 버전에 대한 매핑 정보를 제공합니다.

### Linux 배포판 정보

```typescript
interface LinuxDistroInfo {
  id: string;              // 'centos7', 'rhel8', 'ubuntu22', etc.
  name: string;            // 'CentOS 7', 'RHEL 8', 'Ubuntu 22.04 LTS'
  family: 'rhel' | 'debian' | 'ubuntu' | 'other';
  glibcVersion: string;    // '2.17', '2.28', '2.34', '2.35', '2.39', etc.
  releaseDate?: string;    // '2014-06-10'
  eolDate?: string;        // '2024-06-30'
  status: 'current' | 'lts' | 'eol' | 'extended-support';
  notes?: string;          // 추가 설명
}

const LINUX_DISTRO_GLIBC_MAP: Record<string, LinuxDistroInfo>;
// 배포판 ID → glibc 버전
const GLIBC_VERSION_MAP: Record<string, string>;
```

### macOS 버전 정보

```typescript
interface MacOSVersionInfo {
  version: string;         // "10.9", "11.0", "12.0", "13.0", "14.0", "15.0"
  name: string;            // "Mavericks", "Big Sur", "Monterey", "Ventura", "Sonoma", "Sequoia"
  minArch: 'intel' | 'apple_silicon' | 'both';  // 최소 아키텍처 요구사항
  releaseYear: number;     // 2013, 2020, 2021, 2022, 2023, 2024
  releaseDate?: string;    // "2013-10-22", "2020-11-12", etc.
  eolDate?: string;        // End of Life 날짜 (알려진 경우)
  isLTS?: boolean;         // macOS는 LTS 개념이 없지만 향후 확장 가능
}

const MACOS_VERSIONS: Record<string, MacOSVersionInfo>;
```

### 주요 함수

| 함수 | 설명 |
|------|------|
| `getDistrosByFamily()` | family → 배포판 배열인 전체 그룹 객체 반환 |
| `getDistrosByGlibcVersion(version)` | glibc 버전 문자열이 정확히 같은 배포판 반환 |
| `isDistroEOL(distroId)` | EOL 여부 확인 |
| `isDistroEOLSoon(distroId, months?)` | 기본 6개월 이내 EOL 예정 여부 확인 |
| `getMacOSVersionInfo(version)` | macOS 버전 정보 조회 |
| `getMacOSVersionsSorted()` | releaseYear 오름차순 목록 |
| `isMacOSVersionCompatibleWithArch(version, arch)` | 아키텍처 호환성 확인 |

---

이 매핑은 저장소에 포함된 정적 목록입니다. ID는 `rocky9`, `ubuntu22`처럼 OS 패키지 배포판 ID(`rocky-9`, `ubuntu-22.04`)와 다릅니다. `isDistroEOL()`은 정적 `status`가 아닌 `eolDate`와 실행 시각을 비교하며, 현재 upstream 지원 상태를 원격 검증하지 않습니다. `getMacOSVersionInfo()`는 없는 버전에 `undefined`를 반환합니다.

## 버전 조회 (`version-fetcher.ts`)

Python, Node.js, Java, CUDA 등의 버전 정보를 원격에서 조회하고 캐싱합니다.

### 주요 함수

| 함수 | 반환값 | 설명 |
|------|--------|------|
| `fetchPythonVersions()` | Promise<string[]> | Python 버전 목록 (python.org API) |
| `fetchNodeVersions()` | Promise<NodeRelease[]> | Node.js 버전 목록 (nodejs.org API) |
| `fetchJavaVersions()` | Promise<JavaRelease[]> | Java 버전 목록 (Adoptium API) |
| `fetchCudaVersions()` | Promise<string[]> | CUDA 버전 목록 (NVIDIA conda 채널) |

`JavaRelease`는 `{ version: string; lts: boolean }`, `NodeRelease`는 `{ version: string; lts: string | false }`입니다. Node 결과의 version은 `"20"` 같은 major 문자열이며 현재 릴리스와 LTS major를 반환합니다. Java는 LTS와 최근 non-LTS 3개를 반환합니다. 두 함수는 코드에 deprecated로 표시되어 있으며 현재 버전 프리로드 대상은 Python/CUDA입니다.

### Python 버전 조회

python.org API 응답 형식을 파싱합니다:

```typescript
// API 응답 형식
interface PythonRelease {
  name: string;         // "Python 3.12.0"
  version: number;      // 메이저 버전 (3)
  pre_release: boolean;
  release_date: string;
  is_published: boolean;
}

// 버전 추출: "Python 3.12.0" → "3.12"
// 중복 제거: 3.12.0, 3.12.1 → "3.12" 하나만
// 필터: 3.9 이상, 정식 릴리스만
```

### CUDA 버전 조회

NVIDIA conda 채널(`conda.anaconda.org/nvidia`)에서 버전을 추출합니다:

```typescript
// 버전 추출 대상 패키지
const cudaPackageNames = ['cuda-toolkit', 'cuda-cudart', 'cuda-runtime'];

// repodata.json에서 해당 패키지 버전 수집
const url = 'https://conda.anaconda.org/nvidia/linux-64/repodata.json';
```

### 캐싱

```typescript
// 캐시 TTL
const CACHE_TTL = 86400000;        // 24시간 (Python)
const NODE_CACHE_TTL = 86400000;   // 24시간
const JAVA_CACHE_TTL = 86400000;   // 24시간
const CUDA_CACHE_TTL = 604800000;  // 7일 (CUDA 릴리스 빈도 낮음)

// Python: 메모리 + 브라우저 localStorage (python_versions_cache)
// Java/Node/CUDA: 메모리 + ~/.depssmuggler/cache/{java,node,cuda}-versions.json
```

원격 조회 실패 시 만료된 캐시를 먼저 사용하고, 없으면 코드에 포함된 버전 목록으로 대체합니다. 다음 버전 목록은 응답 형태 예시이며 현재 최신 버전 목록을 의미하지 않습니다.

### 사용 예시

```typescript
import { fetchPythonVersions, fetchCudaVersions } from './version-fetcher';

const pythonVersions = await fetchPythonVersions();
// ['3.13', '3.12', '3.11', '3.10', '3.9']

const cudaVersions = await fetchCudaVersions();
// ['12.6', '12.5', '12.4', '11.8', ...]
```

---

## 버전 프리로드 (`version-preloader.ts`)

앱 시작 시 버전 정보를 미리 로드하여 UI 응답성을 개선합니다.

브라우저의 `window`·`localStorage` 확인을 타입 가드로 연결해 `any` 단언 없이 접근합니다. DOM 타입이 없는 Electron main에서도 타입 검사가 가능하며, 캐시 키·TTL·Node.js 환경의 캐시 비활성 동작은 유지됩니다. `version-preloader.test.ts`에서 캐시 유효기간과 fallback 동작을 검증합니다.

### 주요 함수

| 함수 | 설명 |
|------|------|
| `preloadAllVersions()` | 모든 버전 정보 프리로드 |
| `loadPythonVersions()` (내부) | Python 버전 로드 (캐시 우선) |
| `loadCudaVersions()` (내부) | CUDA 버전 로드 (캐시 우선) |
| `refreshExpiredCaches()` | 만료된 캐시 갱신 |
| `isCacheValid(source)` | source는 `python` 또는 `cuda`; 저장 시각의 TTL 확인 |
| `getCacheAge(source)` | 경과 시간(ms); 저장 시각이 없거나 Node 환경이면 undefined |

### PreloadResult

```typescript
interface PreloadResult {
  success: boolean;
  status: VersionLoadingStatus;
  errors: VersionLoadingError[];
  duration: number; // ms
}

interface VersionLoadingStatus {
  python: 'idle' | 'loading' | 'success' | 'error';
  cuda: 'idle' | 'loading' | 'success' | 'error';
}

interface VersionLoadingError {
  source: 'python' | 'cuda';
  error: string;
  timestamp: number;
}
```

---

`preloadAllVersions()`는 버전 배열이나 fromCache 필드를 반환하지 않습니다. 브라우저 캐시는 `depssmuggler:python-versions`, `depssmuggler:cuda-versions`와 각 `-timestamp` 키이며 TTL은 24시간/7일입니다. 내부 로더가 fallback 목록으로 완료해도 상태는 success이므로 네트워크 조회 성공 여부와 같지 않습니다.

## 민감 정보 마스킹 (`src/utils/mask.ts`)

로그 출력 시 비밀번호, API 키 등 민감한 정보를 자동으로 마스킹하는 유틸리티

로거 호출 자체의 실패를 콘솔로 기록할 때도 마스킹한 원래 오류 인자를 함께 남겨 원인·스택 추적이 가능하도록 합니다.

로깅용 `BigInt`는 문자열로 변환하고, 읽을 수 없는 getter/proxy는 `[UNREADABLE]`로 대체해 오류 기록 중 다시 예외가 발생하지 않도록 합니다. 기존 깊이 제한·민감 필드 마스킹은 유지합니다. Core 로거는 기록 예외와 로거 `error` 이벤트를 격리하고 콘솔에 진단을 남깁니다. Electron 로거는 로그 디렉터리를 만들 수 없으면 파일 로그만 끄고 콘솔을 사용합니다. 로그 실패로 호출자의 작업을 중단하지 않으며, 파일 로그를 쓸 수 없을 때 콘솔까지 실패하면 기록 보존은 보장하지 않습니다. `src/utils/logger.test.ts`, `mask.test.ts`, `electron/utils/logger.test.ts`가 직렬화·마스킹·저장 실패를 검증합니다.

### 상수

```typescript
const MASK = '***MASKED***';  // 마스킹 문자열
```

### 민감 정보 패턴

```typescript
// 실제 기본 패턴 목록은 getSensitivePatterns()로 조회합니다.
const examples = ['password', 'pass', 'token', 'apikey', 'authorization',
  'credit_card', 'privatekey', 'session', 'cookie'];

// 객체 키는 기본 패턴 전체와 대소문자를 무시한 정확 일치로 비교
// 문자열은 URL 쿼리와 key=value, JWT 형태의 Bearer 토큰을 처리
const BEARER_TOKEN_REGEX = /Bearer\s+[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]*/gi;
```

`auth`, 일반 `key`, `smtp`, `mail`을 모두 민감 필드로 취급하지 않습니다. `auth` 같은 중첩 객체는 내부의 `pass`/`password` 등을 재귀적으로 처리합니다. `addSensitivePattern()`은 객체 키 검사 정규식만 갱신하며 문자열 URL/key=value 정규식까지 갱신하지 않습니다.

### 주요 함수

| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `mask` | value: unknown | unknown | 값의 민감 정보 마스킹 (alias) |
| `maskObject` | obj: unknown, depth? | unknown | 객체 내 민감 정보 마스킹 |
| `maskString` | input: string | string | 문자열 내 민감 정보 마스킹 |
| `maskSensitiveData` | ...args: unknown[] | unknown[] | 여러 인자의 민감 정보 마스킹 |
| `isSensitiveKey` | key: string | boolean | 민감한 키인지 확인 |
| `addSensitivePattern` | pattern: string | void | 커스텀 민감 패턴 추가 |
| `getSensitivePatterns` | - | readonly string[] | 등록된 민감 패턴 목록 |

### 사용 예시

```typescript
import { mask, maskObject, maskString, addSensitivePattern } from './mask';

// 객체 마스킹
const config = {
  host: 'smtp.example.com',
  username: 'user@example.com',
  password: 'secretPassword123',
  apiKey: 'sk-abc123xyz',
};

const masked = maskObject(config);
// {
//   host: 'smtp.example.com',
//   username: 'user@example.com',
//   password: '***MASKED***',
//   apiKey: '***MASKED***',
// }

// 문자열 마스킹
const logMessage = 'Request to https://api.example.com?token=abc123&user=john';
const maskedLog = maskString(logMessage);
// 'Request to https://api.example.com?token=***MASKED***&user=john'

// Bearer 토큰 마스킹
const authHeader = 'Authorization: Bearer header.payload.signature';
const maskedHeader = maskString(authHeader);
// 'Authorization: Bearer ***MASKED***'

// 커스텀 패턴 추가
addSensitivePattern('myCustomSecret');
const customData = { myCustomSecret: 'sensitive value' };
const maskedCustom = maskObject(customData);
// { myCustomSecret: '***MASKED***' }
```

### 로거와의 통합

`src/utils/logger.ts`는 Winston으로 기록하기 전에 메시지에 `maskString()`, 메타데이터에 `mask()`를 적용합니다. 공개 호출 예시는 다음과 같습니다:

```typescript
import logger from '../../utils/logger';

logger.info('다운로드 시작', { packageName: 'requests' });
logger.error('인증 오류', { password: 'example-secret' });
// 메타데이터의 password 값은 ***MASKED***로 기록
logger.logError(new Error('요청 실패'), '패키지 조회');
```

---

## 관련 문서

- [Shared Utilities 개요](./shared-utilities.md)
