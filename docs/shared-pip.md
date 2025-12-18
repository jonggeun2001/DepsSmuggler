# pip/PyPI 유틸리티

## 개요
- 목적: PyPI 패키지 다운로드 및 의존성 해결을 위한 유틸리티
- 위치: `src/core/shared/pypi-utils.ts`, `pip-*.ts`, `src/core/resolver/pip-simple-api.ts`

---

## 모듈 구조

```
src/core/shared/
├── pip-types.ts                  # PyPI 타입 정의 (shared-types.md 참조)
├── pypi-utils.ts                 # PyPI 다운로드 URL 조회
├── pip-tags.ts                   # PEP 425 태그 생성/매칭
├── pip-wheel.ts                  # Wheel 파일 파싱/선택
├── pip-cache.ts                  # PyPI 메타데이터 캐시
├── pip-backtracking-resolver.ts  # 백트래킹 Resolver
├── pip-candidate.ts              # 후보 평가기
└── pip-provider.ts               # resolvelib Provider 구현

src/core/resolver/
└── pip-simple-api.ts             # PyPI Simple API 파싱
```

---

## PyPI 유틸리티 (`pypi-utils.ts`)

### 주요 함수

| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `getPyPIDownloadUrl` | packageName, version, pythonVersion?, os?, architecture? | Promise<DownloadUrlResult \| null> | 최적 wheel/sdist URL 조회 |
| `parseWheelTags` | filename: string | WheelTags \| null | wheel 파일명에서 태그 파싱 |
| `generateSupportedTags` | pythonVersion?, os?, arch? | SupportedTag[] | 지원 태그 목록 생성 |
| `selectBestRelease` | releases, supportedTags | PyPIRelease \| null | 최적 릴리스 선택 |
| `isCompatiblePlatform` | platformTag, os?, arch? | boolean | 플랫폼 호환성 체크 |

### getPyPIDownloadUrl

PyPI 패키지의 최적 다운로드 URL 조회

```typescript
async function getPyPIDownloadUrl(
  packageName: string,
  version: string,
  pythonVersion?: string,  // 예: '3.11'
  targetOS?: string,       // 예: 'linux', 'macos', 'windows'
  architecture?: string    // 예: 'x86_64', 'arm64'
): Promise<DownloadUrlResult | null>
```

- Python 버전, OS, 아키텍처에 맞는 wheel 파일 우선 선택
- wheel이 없으면 sdist(소스 배포판) 선택
- PEP 425, PEP 427 표준 준수

### 사용 예시

```typescript
import { getPyPIDownloadUrl } from './pypi-utils';

// Python 3.11, Linux x86_64 용 wheel 찾기
const result = await getPyPIDownloadUrl(
  'numpy',
  '1.26.0',
  '3.11',
  'linux',
  'x86_64'
);

console.log(result);
// {
//   url: 'https://files.pythonhosted.org/.../numpy-1.26.0-cp311-cp311-manylinux_2_17_x86_64.whl',
//   filename: 'numpy-1.26.0-cp311-cp311-manylinux_2_17_x86_64.whl',
//   size: 18012345
// }
```

---

## pip 태그 (`pip-tags.ts`)

PEP 425 호환 태그 생성 및 매칭

### 주요 함수

| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `getSupportedTags` | pythonVersion, os, arch | PlatformTag[] | 지원 태그 목록 생성 |
| `generateCompatibleTags` | config: TargetPythonConfig | PlatformTag[] | 호환 태그 생성 |
| `isTagCompatible` | tag: PlatformTag, supportedTags: PlatformTag[] | boolean | 태그 호환성 검사 |
| `getTagPriority` | tag: PlatformTag, supportedTags: PlatformTag[] | number | 태그 우선순위 반환 |
| `parseTag` | tagString: string | PlatformTag | 태그 문자열 파싱 |

### PlatformTag

```typescript
interface PlatformTag {
  python: string;    // 예: 'cp311', 'py3'
  abi: string;       // 예: 'cp311', 'abi3', 'none'
  platform: string;  // 예: 'manylinux_2_17_x86_64', 'win_amd64'
}
```

### 태그 우선순위 (CPython 3.11, Linux x86_64 예시)

```
1. cp311-cp311-linux_x86_64          (현재 버전 + ABI + 플랫폼)
2. cp311-cp311-manylinux_2_17_x86_64 (manylinux)
3. cp311-abi3-manylinux_2_17_x86_64  (stable ABI)
4. cp311-none-manylinux_2_17_x86_64  (ABI 무관)
5. cp310-cp310-manylinux_2_17_x86_64 (이전 버전)
...
N. py3-none-any                       (순수 Python)
```

### 사용 예시

```typescript
import { getSupportedTags, isTagCompatible, parseTag } from './pip-tags';

// 지원 태그 생성
const tags = getSupportedTags('3.11', 'linux', 'x86_64');

// 태그 호환성 검사
const wheelTag = parseTag('cp311-cp311-manylinux_2_17_x86_64');
const compatible = isTagCompatible(wheelTag, tags); // true
```

---

## pip Wheel 유틸리티 (`pip-wheel.ts`)

Wheel 파일명 파싱 및 선택

### 주요 함수

| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `parseWheelFilename` | filename: string | WheelInfo \| null | wheel 파일명 파싱 |
| `isWheelFile` | filename: string | boolean | wheel 파일 여부 확인 |
| `isSourceDist` | filename: string | boolean | sdist 여부 확인 |
| `isWheelSupported` | wheelInfo: WheelInfo, supportedTags: PlatformTag[] | boolean | wheel 호환성 검사 |
| `selectBestWheel` | wheels: WheelInfo[], supportedTags: PlatformTag[] | WheelInfo \| null | 최적 wheel 선택 |
| `filterCompatibleWheels` | wheels: WheelInfo[], supportedTags: PlatformTag[] | WheelInfo[] | 호환 wheel 필터링 |
| `getWheelSupportIndex` | wheel: WheelInfo, supportedTags: PlatformTag[] | number | wheel 우선순위 인덱스 |

### WheelInfo

```typescript
interface WheelInfo {
  name: string;           // 패키지명 (정규화됨)
  version: string;        // 버전
  buildTag?: string;      // 빌드 태그
  pythonTags: string[];   // Python 태그들
  abiTags: string[];      // ABI 태그들
  platformTags: string[]; // 플랫폼 태그들
  filename: string;       // 원본 파일명
}
```

### Wheel 파일명 형식

```
{distribution}-{version}(-{build tag})?-{python tag}-{abi tag}-{platform tag}.whl

예시:
- numpy-1.26.0-cp311-cp311-manylinux_2_17_x86_64.manylinux2014_x86_64.whl
- requests-2.31.0-py3-none-any.whl
```

### 사용 예시

```typescript
import { parseWheelFilename, selectBestWheel, getSupportedTags } from './pip-wheel';

const wheelInfo = parseWheelFilename('numpy-1.26.0-cp311-cp311-manylinux_2_17_x86_64.whl');
// {
//   name: 'numpy',
//   version: '1.26.0',
//   pythonTags: ['cp311'],
//   abiTags: ['cp311'],
//   platformTags: ['manylinux_2_17_x86_64'],
//   filename: 'numpy-1.26.0-cp311-cp311-manylinux_2_17_x86_64.whl'
// }

// 여러 wheel 중 최적 선택
const wheels = [...];
const supportedTags = getSupportedTags('3.11', 'linux', 'x86_64');
const best = selectBestWheel(wheels, supportedTags);
```

---

## pip 백트래킹 Resolver (`pip-backtracking-resolver.ts`)

resolvelib 스타일의 백트래킹 의존성 해결 알고리즘 구현

### BacktrackingResolver

```typescript
class BacktrackingResolver {
  constructor(provider: PipProvider);

  // 메인 해결 메서드
  async resolve(requirements: Requirement[]): Promise<ResolutionResult>;

  // 내부 메서드
  private addRequirement(state: ResolutionState, requirement: Requirement): void;
  private backtrack(state: ResolutionState): boolean;
  private selectNextIdentifier(state: ResolutionState): string | null;
  private async findCandidates(identifier: string, state: ResolutionState): Promise<Candidate[]>;
}
```

### ResolutionResult

```typescript
interface ResolutionResult {
  success: boolean;
  resolutions: Map<string, Candidate>;  // 해결된 패키지들
  conflicts?: ConflictInfo[];           // 충돌 정보
  backtrackCount: number;               // 백트래킹 횟수
}
```

### ResolverConfig

```typescript
interface ResolverConfig {
  maxBacktracks?: number;  // 최대 백트래킹 횟수 (기본: 100)
  maxRounds?: number;      // 최대 라운드 수 (기본: 2000000)
}
```

### 사용 예시

```typescript
import { BacktrackingResolver, resolveDependencies } from './pip-backtracking-resolver';

// 간편 함수 사용
const result = await resolveDependencies(
  ['flask>=2.0', 'requests', 'numpy>=1.20'],
  {
    pythonVersion: '3.11',
    targetOS: 'linux',
    architecture: 'x86_64',
  }
);

if (result.success) {
  console.log('해결된 패키지:', [...result.resolutions.entries()]);
} else {
  console.log('충돌:', result.conflicts);
}
```

---

## pip 후보 평가기 (`pip-candidate.ts`)

### CandidateEvaluator

wheel/sdist 후보를 평가하고 최적 파일을 선택하는 클래스

```typescript
class CandidateEvaluator {
  constructor(config: CandidateEvaluatorConfig);

  // 후보 적용 가능 여부 검사
  isApplicable(candidate: InstallationCandidate): boolean;

  // 정렬 키 계산
  getSortingKey(candidate: InstallationCandidate): CandidateSortingKey;

  // 적용 가능한 후보 필터링
  getApplicableCandidates(candidates: InstallationCandidate[]): InstallationCandidate[];

  // 최적 후보 계산
  computeBestCandidate(candidates: InstallationCandidate[]): BestCandidateResult;
}
```

### CandidateSortingKey

정렬 우선순위 (pip 공식 구현과 동일)

```typescript
interface CandidateSortingKey {
  hasAllowedHash: boolean;  // 1. 해시 일치
  isYanked: boolean;        // 2. 철회 여부 (false가 좋음)
  binaryPreference: number; // 3. wheel > sdist
  version: string;          // 4. 버전 (높을수록 좋음)
  tagPriority?: number;     // 5. 태그 우선순위 (낮을수록 좋음)
  buildTag?: number;        // 6. 빌드 번호
}
```

### InstallationCandidate

```typescript
interface InstallationCandidate {
  name: string;
  version: string;
  url: string;
  filename: string;
  isWheel: boolean;
  requiresPython?: string;
  yanked?: boolean;
  digests?: { sha256?: string };
}
```

---

## pip Provider (`pip-provider.ts`)

resolvelib 스타일 Provider 인터페이스 구현

### PipProvider

```typescript
class PipProvider {
  constructor(config: ProviderConfig);

  // 패키지 식별자 반환
  identify(requirement: Requirement): string;

  // 요구사항 선택 축소 (백트래킹 최적화)
  narrowRequirementSelection(
    identifiers: Iterable<string>,
    resolutions: Map<string, Candidate>,
    candidates: Map<string, Iterable<Candidate>>,
    information: Map<string, Iterable<RequirementInformation>>,
    backtrackCauses: Iterable<RequirementInformation>
  ): Iterable<string>;

  // 우선순위 계산
  getPreference(
    identifier: string,
    resolutions: Map<string, Candidate>,
    candidates: Map<string, Iterable<Candidate>>,
    information: Map<string, Iterable<RequirementInformation>>,
    backtrackCauses: Iterable<RequirementInformation>
  ): Preference;

  // 후보 검색
  async findMatches(
    identifier: string,
    requirements: Map<string, Iterable<Requirement>>,
    incompatibilities: Map<string, Iterable<Candidate>>
  ): Promise<Iterable<Candidate>>;

  // 후보가 요구사항을 만족하는지 검사
  isSatisfiedBy(requirement: Requirement, candidate: Candidate): boolean;

  // 의존성 조회
  async getDependencies(candidate: Candidate): Promise<Requirement[]>;
}
```

### ProviderConfig

```typescript
interface ProviderConfig {
  pythonVersion: string;        // 예: '3.11'
  targetOS: string;             // 예: 'linux'
  architecture: string;         // 예: 'x86_64'
  allowPrereleases?: boolean;   // 사전 릴리스 허용
}
```

---

## PyPI 캐시 (`pip-cache.ts`)

PyPI 패키지 메타데이터 캐싱 (메모리 + 디스크)

PipResolver와 PipDownloader가 공유하여 중복 API 호출을 방지합니다.

### 주요 함수

| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `fetchPackageMetadata` | name, version, options? | Promise<PipCacheResult \| null> | 패키지 메타데이터 조회 (캐시 지원) |
| `clearMemoryCache` | - | void | 메모리 캐시 초기화 |
| `clearDiskCache` | cacheDir? | Promise<void> | 디스크 캐시 삭제 |
| `clearAllCache` | cacheDir? | Promise<void> | 모든 캐시 삭제 |
| `getCacheStats` | cacheDir? | PipCacheStats | 캐시 통계 조회 |
| `pruneExpiredCache` | cacheDir?, maxAge? | Promise<number> | 만료 캐시 정리 |

### PipCacheOptions

```typescript
interface PipCacheOptions {
  /** 메모리 TTL (초), 기본: 300 (5분) */
  ttl?: number;
  /** 강제 새로고침 */
  forceRefresh?: boolean;
  /** 디스크 캐시 사용 여부, 기본: true */
  useDiskCache?: boolean;
  /** 캐시 디렉토리 */
  cacheDir?: string;
}
```

### PipCacheResult

```typescript
interface PipCacheResult {
  info: PyPIPackageInfo;
  releases: Record<string, PyPIRelease[]>;
  fromCache: 'memory' | 'disk' | 'network';
}
```

### 캐시 위치

```
~/.depssmuggler/cache/pip/
├── requests/
│   ├── 2.28.0.json
│   ├── 2.31.0.json
│   └── latest.json
└── flask/
    └── ...
```

### 사용 예시

```typescript
import { fetchPackageMetadata, getCacheStats, clearAllCache } from './pip-cache';

// 패키지 메타데이터 조회
const result = await fetchPackageMetadata('requests', '2.28.0');
if (result) {
  console.log('소스:', result.fromCache); // 'memory', 'disk', 또는 'network'
  console.log('정보:', result.info);
}

// 캐시 통계 조회
const stats = getCacheStats();
console.log(`메모리: ${stats.memoryEntries}개, 디스크: ${stats.diskEntries}개`);

// 캐시 삭제
await clearAllCache();
```

---

## PyPI Simple API (`pip-simple-api.ts`)

PEP 503 Simple Repository API 파싱 유틸리티

> **참고**: Simple API는 JSON API보다 훨씬 가볍습니다.
> - JSON API: ~50KB+ (전체 메타데이터)
> - Simple API: ~5KB (버전/파일 목록만)

### 위치
`src/core/resolver/pip-simple-api.ts`

### 주요 함수

| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `fetchReleasesFromSimpleApi` | packageName, options? | Promise<SimpleRelease[]> | Simple API에서 릴리스 목록 가져오기 |
| `fetchVersionsFromSimpleApi` | packageName, options? | Promise<string[]> | 버전 목록만 가져오기 |
| `parseSimpleApiHtml` | html, packageName | SimpleRelease[] | HTML 파싱 |
| `extractVersionFromFilename` | filename, packageName | string \| null | 파일명에서 버전 추출 |
| `extractVersionsFromReleases` | releases | string[] | 릴리스에서 중복 없는 버전 목록 추출 |
| `getPackageType` | filename | 'wheel' \| 'sdist' \| 'egg' \| 'unknown' | 패키지 타입 판별 |
| `fetchPackageFiles` | indexUrl, packageName | Promise<SimpleApiPackageFile[]> | 패키지 파일 목록 조회 (캐시 활용) |
| `fetchWheelMetadata` | url | Promise<string> | Wheel METADATA 조회 |
| `parseRequiresDist` | metadata | string[] | Requires-Dist 파싱 |

### SimpleRelease

```typescript
interface SimpleRelease {
  filename: string;           // 파일명
  url: string;                // 다운로드 URL
  hash?: string;              // 해시값
  hashAlgorithm?: string;     // 해시 알고리즘
  requiresPython?: string;    // Python 버전 요구사항
  version: string;            // 버전 (파일명에서 추출)
  packageType: 'wheel' | 'sdist' | 'egg' | 'unknown';
}
```

### SimpleApiOptions

```typescript
interface SimpleApiOptions {
  baseUrl?: string;    // 기본: https://pypi.org/simple
  timeout?: number;    // 타임아웃 (ms)
}
```

### 캐싱

디스크 캐시를 사용하여 반복 요청 시 네트워크 트래픽을 줄입니다.

```typescript
// 캐시 설정
- 메모리 캐시 TTL: 5분
- 디스크 캐시 TTL: 1시간
- 최대 캐시 항목: 100개 패키지
- 캐시 경로: ~/.depssmuggler/cache/pip-simple/

// 캐시 키 형식
`${indexUrl}:${normalizedPackageName}`
```

### 사용 예시

```typescript
import { fetchVersionsFromSimpleApi, extractVersionFromFilename, fetchPackageFiles } from './pip-simple-api';

// 버전 목록 가져오기
const versions = await fetchVersionsFromSimpleApi('requests');
// ['2.31.0', '2.30.0', '2.29.0', ...]

// 파일명에서 버전 추출
extractVersionFromFilename('requests-2.28.0.tar.gz', 'requests');
// '2.28.0'

extractVersionFromFilename('requests-2.28.0-py3-none-any.whl', 'requests');
// '2.28.0'

// 커스텀 인덱스 (예: PyTorch)
const torchFiles = await fetchPackageFiles('https://download.pytorch.org/whl/cu118', 'torch');
```

---

## 관련 문서

- [Shared Utilities 개요](./shared-utilities.md)
- [공통 타입 정의](./shared-types.md)
- [pip 의존성 해결 알고리즘](./pip-dependency-resolution.md)
- [캐시 유틸리티](./shared-cache.md)
