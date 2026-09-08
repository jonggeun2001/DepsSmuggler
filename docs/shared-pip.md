# pip/PyPI 유틸리티

## 개요
- 목적: PyPI 패키지 다운로드 및 의존성 해결을 위한 유틸리티
- 위치: `src/core/shared/pypi-utils.ts`, `pip-*.ts`, `src/core/shared/pip-simple-api-client.ts`

---

## 모듈 구조

```
src/core/shared/
├── pip-types.ts                  # PyPI 타입 정의 (shared-types.md 참조)
├── pypi-utils.ts                 # PyPI 다운로드 URL 조회
├── pip-simple-api-client.ts      # 커스텀 인덱스 파일 목록·Core Metadata
├── pip-simple-api.ts             # PyPI Simple API 릴리스/버전 조회
├── pip-version.ts                # PEP 440 버전 파싱/비교
├── pep508-marker.ts              # 환경 마커 평가
├── pip-tags.ts                   # PEP 425 태그 생성/매칭
├── pip-wheel.ts                  # Wheel 파일 파싱/선택
├── pip-cache.ts                  # PyPI 메타데이터 캐시
├── pip-backtracking-resolver.ts  # 백트래킹 Resolver
├── pip-candidate.ts              # 후보 평가기
└── pip-provider.ts               # resolvelib 스타일 Provider
```

---

## PyPI 유틸리티 (`pypi-utils.ts`)

### 주요 함수

| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `getPyPIDownloadUrl` | packageName, version, architecture?, targetOS?, pythonVersion?, indexUrl? | Promise<DownloadUrlResult \| null> | 최적 wheel/sdist URL 조회 |
| `parseWheelTags` (내부) | filename: string | WheelTags \| null | wheel 파일명에서 태그 파싱 |
| `generateSupportedTags` (내부) | pythonVersion, targetOS, architecture | SupportedTag[] | 지원 태그 목록 생성 |
| `selectBestRelease` (내부) | releases, architecture?, targetOS?, pythonVersion? | DownloadUrlResult | 최적 릴리스 선택 |
| `isCompatiblePlatform` (내부) | filename, targetOS?, architecture? | boolean | 파일명의 플랫폼 호환성 체크 |
| `extractVersionFromFilename` | filename | string \| null | 파일명에서 버전 추출 |

### getPyPIDownloadUrl

PyPI 패키지의 최적 다운로드 URL 조회

```typescript
async function getPyPIDownloadUrl(
  packageName: string,
  version: string,
  architecture?: string, // 기본: 'x86_64'
  targetOS?: string,      // 기본: 'any'
  pythonVersion?: string, // 기본: '3.11'
  indexUrl?: string       // 지정하면 Simple API 사용
): Promise<DownloadUrlResult | null>
```

- Python 버전, OS, 아키텍처에 맞는 wheel 파일 우선 선택
- wheel이 없으면 sdist(소스 배포판) 선택
- PEP 425/427의 태그·파일명 개념을 사용하는 로컬 선택 로직입니다. 적합한 wheel과 sdist가 모두 없으면 첫 릴리스로 대체하므로, 이 헬퍼만으로 대상 환경에서의 설치 가능성을 보장하지 않습니다.
- `indexUrl`이 없으면 버전별 PyPI JSON의 `urls`를 조회합니다. 커스텀 인덱스 결과는 크기를 `0`으로 채우며 조회 실패 또는 릴리스 부재 시 `null`을 반환합니다.

### 사용 예시

```typescript
import { getPyPIDownloadUrl } from './pypi-utils';

// Python 3.11, Linux x86_64 용 wheel 찾기
const result = await getPyPIDownloadUrl(
  'numpy',
  '1.26.0',
  'x86_64',
  'linux',
  '3.11'
);

// 다음 객체는 응답 형태 예시이며 파일명·크기는 조회 결과에 따라 달라집니다.
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
| `getSupportedTags` | config: TargetPythonConfig | PlatformTag[] | 지원 태그 목록 생성 |
| `generateCompatibleTags` | config: TargetPythonConfig | PlatformTag[] | 호환 태그 생성 |
| `getFullSupportedTags` | pythonVersion, platform, arch, implementation? | PlatformTag[] | OS/아키텍처를 받아 전체 태그 생성 |
| `isTagCompatible` | tag: PlatformTag, supportedTags: PlatformTag[] | boolean | 태그 호환성 검사 |
| `getTagPriority` | tag: PlatformTag, supportedTags: PlatformTag[] | number | 태그 우선순위 반환 |
| `parseTag` | tagString: string | PlatformTag \| null | 태그 문자열 파싱 |

### PlatformTag

```typescript
interface PlatformTag {
  pythonTag: string; // cp311, py3, py2.py3
  abiTag: string; // cp311, abi3, none
  platformTag: string; // manylinux_2_17_x86_64, win_amd64, any
}
```

### 태그 우선순위 (CPython 3.11, Linux x86_64 예시)

`getFullSupportedTags('3.11', 'linux', 'x86_64')`의 플랫폼 목록은 코드에 정의한 `manylinux_2_35_x86_64`부터 이전 manylinux 및 `linux_x86_64`, `any` 순입니다. 현재 CPython ABI 조합, `abi3`, `none`, 이전 Python의 `abi3`, 범용 `py*-none-*` 조합 순으로 추가합니다.

```text
cp311-cp311-manylinux_2_35_x86_64
cp311-cp311-manylinux_2_34_x86_64
... 현재 CPython/ABI의 나머지 플랫폼 ...
cp311-abi3-manylinux_2_35_x86_64
... none ABI와 이전 CPython의 abi3 조합 ...
cp310-abi3-manylinux_2_35_x86_64
... 범용 Python 태그 ...
py3-none-any
```

이전 CPython의 `cp310-cp310` 조합을 CPython 3.11 지원 태그로 추가하지 않습니다. 플랫폼 목록은 고정 매핑으로, 실제 대상 OS의 glibc/macOS 버전을 자동 검사하는 API는 아닙니다. `pypi-utils.ts`의 내부 `SupportedTag`와 이 모듈의 `PlatformTag`는 필드와 생성 순서가 서로 다릅니다.

### 사용 예시

```typescript
import { getFullSupportedTags, isTagCompatible, parseTag } from './pip-tags';

// 지원 태그 생성
const tags = getFullSupportedTags('3.11', 'linux', 'x86_64');

// 태그 호환성 검사
const wheelTag = parseTag('cp311-cp311-manylinux_2_17_x86_64');
const compatible = wheelTag !== null && isTagCompatible(wheelTag, tags); // true
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
  /** 원본 파일명 */
  filename: string;
  /** 패키지 이름 (정규화됨) */
  name: string;
  /** 버전 */
  version: string;
  /** 빌드 태그 (선택적) */
  buildTag?: BuildTag;
  /** 파일 태그 목록 */
  fileTags: Set<string>;
  /** 파싱된 태그 목록 */
  parsedTags: PlatformTag[];
}
```

`BuildTag`는 `[number, string] | []`입니다. `getWheelSupportIndex()`는 호환 태그가 없으면 `-1`을 반환합니다.

### Wheel 파일명 형식

```
{distribution}-{version}(-{build tag})?-{python tag}-{abi tag}-{platform tag}.whl

예시:
- numpy-1.26.0-cp311-cp311-manylinux_2_17_x86_64.manylinux2014_x86_64.whl
- requests-2.31.0-py3-none-any.whl
```

### 사용 예시

```typescript
import { parseWheelFilename, selectBestWheel } from './pip-wheel';
import { getFullSupportedTags } from './pip-tags';

const wheelInfo = parseWheelFilename('numpy-1.26.0-cp311-cp311-manylinux_2_17_x86_64.whl');
// {
//   name: 'numpy',
//   version: '1.26.0',
//   buildTag: [],
//   fileTags: Set { 'cp311-cp311-manylinux_2_17_x86_64' },
//   parsedTags: [{ pythonTag: 'cp311', abiTag: 'cp311', platformTag: 'manylinux_2_17_x86_64' }],
//   filename: 'numpy-1.26.0-cp311-cp311-manylinux_2_17_x86_64.whl'
// }

// 여러 wheel 중 최적 선택
const wheels = wheelInfo ? [wheelInfo] : [];
const supportedTags = getFullSupportedTags('3.11', 'linux', 'x86_64');
const best = selectBestWheel(wheels, supportedTags);
```

---

## pip 백트래킹 Resolver (`pip-backtracking-resolver.ts`)

resolvelib 스타일의 독립 백트래킹 의존성 해결 모듈입니다. 현재 앱의 `PipResolver`는 `src/core/resolver/pip-resolver.ts`의 별도 해결 경로를 사용하며, 이 클래스가 앱의 모든 pip 요청에 적용되는 것은 아닙니다.

### BacktrackingResolver

```typescript
class BacktrackingResolver {
  constructor(config: ResolverConfig, fetchPackageInfo: PackageInfoFetcher);

  // 메인 해결 메서드
  async resolve(requirements: Requirement[]): Promise<ResolutionResult>;

  // 내부 메서드
  private addRequirement(state: ResolutionState, requirement: Requirement, parent: Candidate | null): Promise<void>;
  private backtrack(state: ResolutionState, stateStack: ResolutionState[]): boolean;
  private selectNextIdentifier(state: ResolutionState, unsatisfied: ResolutionCriterion[]): Promise<string | null>;
  private findCandidates(criterion: ResolutionCriterion): Promise<Candidate[]>;
}
```

### ResolutionResult

```typescript
interface ResolutionResult {
  /** 성공 여부 */
  success: boolean;
  /** 해결된 패키지 맵 */
  mapping: Map<string, Candidate>;
  /** 충돌 정보 (실패 시) */
  conflicts?: ConflictInfo[];
  /** 백트래킹 횟수 */
  backtrackCount: number;
}
```

### ResolverConfig

```typescript
interface ResolverConfig extends ProviderConfig {
  /** 최대 백트래킹 횟수 */
  maxBacktracks?: number;
  /** 최대 탐색 라운드 */
  maxRounds?: number;
}
```

생성자의 기본값은 `maxBacktracks: 100000`, `maxRounds: 200000`입니다.

### 사용 예시

```typescript
import { resolveDependencies } from './pip-backtracking-resolver';
import { fetchPackageMetadata } from './pip-cache';

// 간편 함수 사용: 문자열이 아닌 Requirement 객체와 조회 함수를 전달
const result = await resolveDependencies(
  [{ name: 'flask', versionSpec: '>=2.0' }, { name: 'requests' }, { name: 'numpy', versionSpec: '>=1.20' }],
  {
    pythonVersion: '3.11',
    platform: 'linux',
    arch: 'x86_64',
  },
  async (name) => {
    const cached = await fetchPackageMetadata(name);
    if (!cached) throw new Error(`메타데이터 없음: ${name}`);
    return { info: cached.data.info, releases: cached.data.releases ?? {} };
  }
);

if (result.success) {
  console.log('해결된 패키지:', [...result.mapping.entries()]);
} else {
  console.log('충돌:', result.conflicts);
}
```

---

## pip 후보 평가기 (`pip-candidate.ts`)

### CandidateEvaluator

후보 정렬 키는 `getApplicableCandidates()` 호출 안에서 후보 객체별로 한 번만 계산합니다. 반복 비교 때 wheel 태그·해시 검사와 키 객체 생성을 줄이며, 정렬 비교기와 결과 순서는 그대로입니다. 캐시는 호출 후 해제되어 다음 호출의 후보 변경도 반영합니다. `src/core/shared/pip-candidate.test.ts`에서 기존 비교 결과와 키 계산 횟수를 검증합니다.

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

정렬 우선순위 (pip 후보 평가 개념을 참고한 로컬 구현)

```typescript
interface CandidateSortingKey {
  /** 허용된 해시와 일치하는지 (true가 우선) */
  hasAllowedHash: boolean;
  /** Yanked되지 않았는지 (true가 우선) */
  isNotYanked: boolean;
  /** Binary(wheel) 인지 (true가 우선, 설정에 따라 다름) */
  isBinary: boolean;
  /** 버전 (높을수록 우선) */
  version: string;
  /** 태그 우선순위 (낮을수록 우선, undefined면 가장 낮은 우선순위) */
  tagPriority?: number;
  /** 빌드 태그 */
  buildTag: BuildTag;
}
```

### InstallationCandidate

```typescript
interface InstallationCandidate {
  /** 패키지 이름 (정규화됨) */
  name: string;
  /** 버전 */
  version: string;
  /** 다운로드 URL */
  url: string;
  /** 파일명 */
  filename: string;
  /** 파일 크기 */
  size?: number;
  /** 해시 (sha256) */
  hash?: string;
  /** 패키지 타입 */
  packageType: 'wheel' | 'sdist';
  /** Wheel 정보 (wheel인 경우) */
  wheelInfo?: WheelInfo;
  /** Yanked 여부 */
  isYanked?: boolean;
  /** Yanked 이유 */
  yankedReason?: string;
  /** Requires-Python */
  requiresPython?: string;
}
```

---

## pip Provider (`pip-provider.ts`)

resolvelib 스타일 Provider 인터페이스 구현

### PipProvider

```typescript
class PipProvider {
  constructor(config: ProviderConfig, fetchPackageInfo: PackageInfoFetcher);

  // 패키지 식별자 반환
  identify(requirementOrCandidate: Requirement | Candidate): string;

  // 요구사항 선택 축소 (백트래킹 최적화)
  narrowRequirementSelection(
    identifiers: string[],
    resolutions: Map<string, Candidate>,
    candidates: Map<string, Candidate[]>,
    information: Map<string, RequirementInformation[]>,
    backtrackCauses: RequirementInformation[]
  ): string[];

  // 우선순위 계산
  getPreference(
    identifier: string,
    resolutions: Map<string, Candidate>,
    candidates: Map<string, Candidate[]>,
    information: Map<string, RequirementInformation[]>,
    backtrackCauses: RequirementInformation[]
  ): Preference;

  // 후보 검색
  async findMatches(
    identifier: string,
    requirements: Map<string, Requirement[]>,
    incompatibilities: Map<string, Candidate[]>
  ): Promise<Candidate[]>;

  // 후보가 요구사항을 만족하는지 검사
  isSatisfiedBy(requirement: Requirement, candidate: Candidate): boolean;

  // 의존성 조회
  async getDependencies(candidate: Candidate): Promise<Requirement[]>;
}
```

### ProviderConfig

```typescript
interface ProviderConfig {
  /** 타겟 Python 버전 */
  pythonVersion: string;
  /** 타겟 플랫폼 */
  platform: PlatformType;
  /** 타겟 아키텍처 */
  arch: ArchType;
  /** Python 구현체 */
  implementation?: string;
  /** 의존성 무시 여부 */
  ignoreDependencies?: boolean;
  /** 업그레이드 전략 */
  upgradeStrategy?: 'eager' | 'only-if-needed' | 'to-satisfy-only';
  /** 사용자 요청 패키지 목록 */
  userRequested?: Map<string, number>;
  /** 제약조건 */
  constraints?: Map<string, Constraint>;
  /** Pre-release 허용 */
  allowPrerelease?: boolean;
}
```

---

## PyPI 캐시 (`pip-cache.ts`)

PyPI 패키지 메타데이터 캐싱 (메모리 + 디스크)

PipResolver와 PipDownloader가 공유하여 중복 API 호출을 방지합니다.

### 주요 함수

| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `fetchPackageMetadata` | name, version?, options? | Promise<PipCacheResult \| null> | 패키지 메타데이터 조회 (캐시 지원) |
| `clearMemoryCache` | - | void | 메모리 캐시 초기화 |
| `clearDiskCache` | cacheDir? | void | 디스크 캐시 삭제 |
| `clearAllCache` | cacheDir? | void | 모든 캐시 삭제 |
| `getCacheStats` | cacheDir? | PipCacheStats | 캐시 통계 조회 |
| `pruneExpiredCache` | cacheDir? | number | 만료 캐시 정리 |

### PipCacheOptions

```typescript
interface PipCacheOptions {
  /** PyPI 기본 URL */
  baseUrl?: string;
  /** 캐시 디렉토리 */
  cacheDir?: string;
  /** 메모리 캐시 사용 (기본: true) */
  useMemoryCache?: boolean;
  /** 디스크 캐시 사용 (기본: true) */
  useDiskCache?: boolean;
  /** 메모리 캐시 TTL (초, 기본: 300) */
  memoryTtl?: number;
  /** 디스크 캐시 TTL (초, 기본: 3600) */
  diskTtl?: number;
  /** 강제 새로고침 */
  forceRefresh?: boolean;
  /** 요청 타임아웃 (ms) */
  timeout?: number;
}
```

### PipCacheResult

```typescript
interface PipCacheResult {
  data: PyPIResponse;
  fromCache: boolean;
  cacheType?: 'memory' | 'disk';
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
  console.log('소스:', result.cacheType ?? 'network');
  console.log('정보:', result.data.info);
}

// 캐시 통계 조회
const stats = getCacheStats();
console.log(`메모리: ${stats.memoryEntries}개, 디스크: ${stats.diskEntries}개`);

// 캐시 삭제
clearAllCache();
```

---

`memoryTtl`은 선언되어 있지만 현재 `fetchPackageMetadata()`에서 적용하지 않으며 메모리 TTL은 5분입니다. `useMemoryCache: false`는 초기 메모리 조회를 건너뛰지만 이후 `CacheStore.getOrFetch()`는 여전히 메모리 캐시를 사용할 수 있습니다. 디스크 TTL은 초 단위로 기본 3600초이고, 캐시 키는 이름·버전만 사용하여 `baseUrl`별로 분리하지 않습니다.

## PyPI Simple API (`pip-simple-api.ts`, `pip-simple-api-client.ts`)

PEP 503 Simple Repository API 파싱 유틸리티

> **참고**: Simple API는 파일 목록과 관련 속성을 조회합니다. 실제 응답 크기는 패키지의 파일 수와 API 형식에 따라 달라지므로 JSON API보다 항상 작다고 보장하지 않습니다.

### 위치

- `src/core/shared/pip-simple-api.ts`: 릴리스·버전 목록과 `SimpleRelease`
- `src/core/shared/pip-simple-api-client.ts`: 커스텀 인덱스의 `SimpleApiPackageFile`·원격 Core Metadata

### 주요 함수

| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `fetchReleasesFromSimpleApi` (`pip-simple-api.ts`) | packageName, options? | Promise<SimpleRelease[] \| null> | Simple API에서 릴리스 목록 가져오기 |
| `fetchVersionsFromSimpleApi` (`pip-simple-api.ts`) | packageName, options? | Promise<string[] \| null> | 버전 목록만 가져오기 |
| `parseSimpleApiHtml` (`pip-simple-api.ts`) | html, packageName | SimpleRelease[] | HTML 파싱 |
| `parseSimpleApiHtml` (`pip-simple-api-client.ts`) | html, baseUrl | SimpleApiPackageFile[] | URL 정규화·파일 속성 파싱 |
| `extractVersionFromFilename` (`pip-simple-api.ts`) | filename, packageName | string \| null | 파일명에서 버전 추출 |
| `extractVersionFromFilename` (`pip-simple-api-client.ts`) | filename | string | 클라이언트용 버전 추출 |
| `extractVersionsFromReleases` | releases | string[] | 릴리스에서 중복 없는 버전 목록 추출 |
| `getPackageType` | filename | 'wheel' \| 'sdist' \| 'egg' \| 'unknown' | 패키지 타입 판별 |
| `fetchPackageFiles` | indexUrl, packageName | Promise<SimpleApiPackageFile[]> | 패키지 파일 목록 조회 (캐시 활용) |
| `fetchWheelMetadata` | file: SimpleApiPackageFile | Promise<WheelMetadataResult> | 해시 검증 후 Requires-Dist 조회 |
| `parseRequiresDist` (client 내부) | metadata | string[] | Requires-Dist 파싱; 외부 export 아님 |

### SimpleRelease

```typescript
interface SimpleRelease {
  /** 파일명 */
  filename: string;
  /** 다운로드 URL */
  url: string;
  /** 해시 (sha256 등) */
  hash?: string;
  /** 해시 알고리즘 */
  hashAlgorithm?: string;
  /** Python 버전 요구사항 */
  requiresPython?: string;
  /** 버전 (파일명에서 추출) */
  version: string;
  /** 패키지 타입 (wheel, sdist 등) */
  packageType: 'wheel' | 'sdist' | 'egg' | 'unknown';
}
```

### SimpleApiOptions

```typescript
interface SimpleApiOptions {
  /** PyPI Simple API 기본 URL */
  baseUrl?: string;
  /** 요청 타임아웃 (ms) */
  timeout?: number;
  /** Accept 헤더 (JSON 응답 요청 가능) */
  acceptJson?: boolean;
}
```

`SimpleApiOptions`의 기본값은 `baseUrl: https://pypi.org/simple`, `timeout: 15000`, `acceptJson: false`입니다. `acceptJson`은 버전 목록 조회에 적용됩니다. 원격 Core Metadata 결과는 `not-advertised`, `available` (`requiresDist` 포함), `unavailable` (`error` 포함)로 구분하며, 광고된 해시가 없거나 검증에 실패하면 사용 불가로 반환합니다.

### 캐싱

`pip-simple-api-client.ts`의 `fetchPackageFiles()`는 메모리·디스크 캐시를 사용합니다. `pip-simple-api.ts`의 릴리스·버전 목록 함수는 이 캐시를 사용하지 않습니다.

```text
캐시 설정
- 메모리 캐시 TTL: 5분
- 디스크 캐시 TTL: 1시간
- 최대 메모리 캐시 항목: 100개 패키지
- 캐시 경로: {configManager.getCacheDir()}/pip-simple/ (기본 ~/.depssmuggler/cache/pip-simple/)
- 디스크 파일명: 인덱스 URL과 정규화 이름을 결합한 키의 특수문자를 _로 치환한 .json

// 캐시 키 형식
`${indexUrl}:${normalizedPackageName}`
```

### 사용 예시

```typescript
import { fetchVersionsFromSimpleApi, extractVersionFromFilename } from './pip-simple-api';
import { fetchPackageFiles } from './pip-simple-api-client';

// 버전 목록 가져오기
const versions = await fetchVersionsFromSimpleApi('requests');
// 반환된 목록의 정렬은 보장하지 않으며 조회 실패 시 null입니다.

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
