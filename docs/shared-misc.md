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
| `calculateRelevanceScore` | name: string, query: string | number | 패키지명과 쿼리의 관련성 점수 계산 (0~100) |
| `sortByRelevance` | results: T[], query: string, type?: PackageType | T[] | 검색 결과를 관련성 순으로 정렬 |

### PackageType

```typescript
type PackageType = 'pip' | 'conda' | 'maven' | 'npm' | 'docker' | 'yum' | 'default';
```

### 관련성 점수 계산 기준

1. **정확 일치** (100점): 쿼리와 패키지명이 정확히 일치
2. **접두사 일치** (90점): 패키지명이 쿼리로 시작
3. **포함 일치** (70점): 패키지명에 쿼리가 포함됨
4. **편집 거리 기반** (0~60점): Levenshtein 거리에 따른 유사도

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
const score = calculateRelevanceScore('requests', 'req');  // 높은 점수 (접두사 일치)
const score2 = calculateRelevanceScore('flask', 'req');    // 낮은 점수

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
  maxRetries?: number;      // 최대 재시도 횟수 (기본: 3)
  initialDelay?: number;    // 초기 지연 시간 ms (기본: 1000)
  maxDelay?: number;        // 최대 지연 시간 ms (기본: 30000)
  backoffMultiplier?: number; // 지연 증가 배수 (기본: 2)
  retryOn?: (error: Error) => boolean; // 재시도 조건 함수
}
```

### 주요 함수

| 함수 | 설명 |
|------|------|
| `retryWithExponentialBackoff<T>(fn, options)` | 지수 백오프로 함수 재시도 |
| `isRetryableHttpError(error)` | HTTP 오류 재시도 가능 여부 확인 |

### 사용 예시

```typescript
import { retryWithExponentialBackoff, isRetryableHttpError } from './retry-utils';

const result = await retryWithExponentialBackoff(
  async () => {
    const response = await axios.get('https://api.example.com/data');
    return response.data;
  },
  {
    maxRetries: 3,
    initialDelay: 1000,
    retryOn: isRetryableHttpError,
  }
);
```

---

## 플랫폼 매핑 (`platform-mappings.ts`)

Linux 배포판 및 macOS 버전에 대한 매핑 정보를 제공합니다.

### Linux 배포판 정보

```typescript
interface LinuxDistroInfo {
  id: string;           // 'rocky-9', 'ubuntu-22.04'
  name: string;         // 표시 이름
  family: string;       // 'rhel', 'debian', 'alpine'
  glibcVersion: string; // glibc 버전
  eolDate?: string;     // EOL 날짜
}

// 배포판별 glibc 버전 매핑
const LINUX_DISTRO_GLIBC_MAP: Record<string, LinuxDistroInfo>;

// glibc 버전 역방향 매핑
const GLIBC_VERSION_MAP: Record<string, string[]>;
```

### macOS 버전 정보

```typescript
interface MacOSVersionInfo {
  version: string;      // '15.0', '14.0'
  name: string;         // 'Sequoia', 'Sonoma'
  x86_64: boolean;      // x86_64 지원
  arm64: boolean;       // arm64 지원
}

const MACOS_VERSIONS: MacOSVersionInfo[];
```

### 주요 함수

| 함수 | 설명 |
|------|------|
| `getDistrosByFamily(family)` | 패밀리별 배포판 목록 조회 |
| `getDistrosByGlibcVersion(version)` | glibc 버전 호환 배포판 조회 |
| `isDistroEOL(distroId)` | EOL 여부 확인 |
| `isDistroEOLSoon(distroId, daysThreshold)` | 곧 EOL 예정 여부 확인 |
| `getMacOSVersionInfo(version)` | macOS 버전 정보 조회 |
| `getMacOSVersionsSorted()` | 정렬된 macOS 버전 목록 |
| `isMacOSVersionCompatibleWithArch(version, arch)` | 아키텍처 호환성 확인 |

---

## 버전 조회 (`version-fetcher.ts`)

Python, Node.js, Java, CUDA 등의 버전 정보를 원격에서 조회하고 캐싱합니다.

### 주요 함수

| 함수 | 반환값 | 설명 |
|------|--------|------|
| `fetchPythonVersions()` | Promise<string[]> | Python 버전 목록 (python.org API) |
| `fetchNodeVersions()` | Promise<string[]> | Node.js 버전 목록 (nodejs.org API) |
| `fetchJavaVersions()` | Promise<string[]> | Java 버전 목록 (Adoptium API) |
| `fetchCudaVersions()` | Promise<string[]> | CUDA 버전 목록 (NVIDIA conda 채널) |

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

// 캐시 저장 위치: ~/.depssmuggler/cache/
```

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

### 주요 함수

| 함수 | 설명 |
|------|------|
| `preloadAllVersions()` | 모든 버전 정보 프리로드 |
| `loadPythonVersions()` | Python 버전 로드 (캐시 우선) |
| `loadCudaVersions()` | CUDA 버전 로드 (캐시 우선) |
| `refreshExpiredCaches()` | 만료된 캐시 갱신 |
| `isCacheValid(key)` | 캐시 유효성 확인 |
| `getCacheAge(key)` | 캐시 경과 시간 조회 |

### PreloadResult

```typescript
interface PreloadResult {
  python: VersionLoadingStatus;
  cuda: VersionLoadingStatus;
}

interface VersionLoadingStatus {
  versions: string[];
  fromCache: boolean;
  error?: VersionLoadingError;
}
```

---

## 민감 정보 마스킹 (`src/utils/mask.ts`)

로그 출력 시 비밀번호, API 키 등 민감한 정보를 자동으로 마스킹하는 유틸리티

### 상수

```typescript
const MASK = '****';  // 마스킹 문자열
```

### 민감 정보 패턴

```typescript
// 민감한 필드명 패턴
const SENSITIVE_FIELD_PATTERNS = [
  'password', 'passwd', 'pwd', 'secret', 'token',
  'apikey', 'api_key', 'api-key', 'auth', 'credential',
  'private', 'key', 'bearer', 'authorization', 'access_token',
  'refresh_token', 'client_secret', 'smtp', 'mail'
];

// 민감한 URL 파라미터 정규식
const URL_SENSITIVE_PARAM_REGEX = /([\?&])(password|token|key|secret|auth|api_key)=/gi;

// Bearer 토큰 정규식
const BEARER_TOKEN_REGEX = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
```

### 주요 함수

| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `mask` | value: unknown | unknown | 값의 민감 정보 마스킹 (alias) |
| `maskObject` | obj: unknown, depth? | unknown | 객체 내 민감 정보 마스킹 |
| `maskString` | input: string | string | 문자열 내 민감 정보 마스킹 |
| `maskSensitiveData` | ...args: unknown[] | unknown[] | 여러 인자의 민감 정보 마스킹 |
| `isSensitiveKey` | key: string | boolean | 민감한 키인지 확인 |
| `addSensitivePattern` | pattern: string | void | 커스텀 민감 패턴 추가 |
| `getSensitivePatterns` | - | string[] | 등록된 민감 패턴 목록 |

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
//   password: '****',
//   apiKey: '****',
// }

// 문자열 마스킹
const logMessage = 'Request to https://api.example.com?token=abc123&user=john';
const maskedLog = maskString(logMessage);
// 'Request to https://api.example.com?token=****&user=john'

// Bearer 토큰 마스킹
const authHeader = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIs...';
const maskedHeader = maskString(authHeader);
// 'Authorization: Bearer ****'

// 커스텀 패턴 추가
addSensitivePattern('myCustomSecret');
const customData = { myCustomSecret: 'sensitive value' };
const maskedCustom = maskObject(customData);
// { myCustomSecret: '****' }
```

### 로거와의 통합

`src/utils/logger.ts`에서 자동으로 마스킹을 적용:

```typescript
import { maskSensitiveData } from './mask';

class Logger {
  info(message: string, ...args: unknown[]): void {
    console.log(`[INFO] ${message}`, ...maskSensitiveData(...args));
  }

  error(message: string, ...args: unknown[]): void {
    console.error(`[ERROR] ${message}`, ...maskSensitiveData(...args));
  }
}
```

---

## 관련 문서

- [Shared Utilities 개요](./shared-utilities.md)
