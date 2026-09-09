# 캐시 유틸리티

## 개요
- 목적: 모든 캐시 모듈에서 공통으로 사용하는 캐시 관련 유틸리티
- 위치: `src/core/shared/cache-utils.ts`, `src/core/shared/cache/cache-store.ts`, `src/core/shared/cache/artifact-cache.ts`

---

## 모듈 구조

```
src/core/shared/
├── cache-utils.ts     # 캐시 공통 유틸리티
├── cache-manager.ts   # compatibility shim
├── cache/
│   ├── cache-store.ts     # 범용 CacheStore
│   └── artifact-cache.ts  # 다운로드 아티팩트 캐시
├── pip-cache.ts       # PyPI 캐시 (shared-pip.md 참조)
├── npm-cache.ts       # npm 캐시 (shared-npm.md 참조)
├── maven-cache.ts     # Maven 캐시 (shared-maven.md 참조)
└── conda-cache.ts     # Conda 캐시 (shared-conda.md 참조)
```

---

## 캐시 공통 유틸리티 (`cache-utils.ts`)

### 상수

```typescript
const DEFAULT_MEMORY_TTL_MS = 300000;   // 5분 (메모리 캐시 기본 TTL)
const DEFAULT_DISK_TTL_MS = 3600000;   // 1시간 (디스크 캐시 기본 TTL)
const LONG_DISK_TTL_MS = 86400000;     // 24시간 (장기 디스크 캐시 TTL)
```

### 타입 정의

#### BaseCacheEntry

캐시 엔트리 기본 구조

```typescript
interface BaseCacheEntry<T> {
  /** 캐시된 데이터 */
  data: T;
  /** 캐시 저장 시간 (Unix timestamp ms) */
  cachedAt: number;
  /** TTL (밀리초) */
  ttl: number;
}
```

#### CacheEntryWithMeta

메타데이터를 포함한 캐시 엔트리

```typescript
interface CacheEntryWithMeta<T, M = Record<string, unknown>> extends BaseCacheEntry<T> {
  /** 추가 메타데이터 */
  metadata?: M;
}
```

#### CacheOptions

캐시 조회 옵션

```typescript
interface CacheOptions {
  /** TTL (밀리초) */
  ttl?: number;
  /** 강제 새로고침 */
  forceRefresh?: boolean;
}
```

#### CacheStats

캐시 통계

```typescript
interface CacheStats {
  /** 항목 수 */
  entries: number;
  /** 가장 오래된 항목 시간 (ms) */
  oldestEntry: number | null;
  /** 가장 최근 항목 시간 (ms) */
  newestEntry: number | null;
}
```

#### ExtendedCacheStats

확장 캐시 통계

```typescript
interface ExtendedCacheStats extends CacheStats {
  /** 메모리 캐시 항목 수 */
  memoryEntries: number;
  /** 디스크 캐시 크기 (바이트) */
  diskSize?: number;
  /** 디스크 캐시 항목 수 */
  diskEntries?: number;
  /** 진행 중인 요청 수 */
  pendingRequests?: number;
}
```

### 주요 함수

| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `isCacheValid` | cachedAt, ttl | boolean | 캐시 유효성 검사 |
| `isCacheEntryValid` | entry: BaseCacheEntry | boolean | 캐시 엔트리 유효성 검사 |
| `createCacheEntry` | data, ttl, metadata? | CacheEntryWithMeta | 캐시 엔트리 생성 |
| `normalizeKey` | key | string | 캐시 키 정규화 |
| `pruneExpiredEntries` | cache: Map, ttlOverride?: number | number | 만료된 엔트리 정리 |
| `calculateCacheStats` | cache: Map | CacheStats | 캐시 통계 계산 |
| `isBaseCacheEntry` | entry | boolean | BaseCacheEntry 타입 가드 |
| `createPendingRequestManager` | - | PendingRequestManager | 중복 요청 방지 관리자 생성 |

### PendingRequestManager

중복 네트워크 요청을 방지하는 관리자. 아래 인터페이스는 `createPendingRequestManager<T>()` 반환 객체를 설명하는 형태이며, `PendingRequestManager`라는 타입 이름 자체는 export하지 않습니다.

```typescript
interface PendingRequestManager<T> {
  has(key: string): boolean;
  get(key: string): Promise<T | null> | undefined;
  set(key: string, promise: Promise<T | null>): void;
  delete(key: string): void;
  clear(): void;
  readonly size: number;
  execute(key: string, fetcher: () => Promise<T | null>, onComplete?: (data: T) => void): Promise<T | null>;
}
```

### 사용 예시

```typescript
import {
  isCacheValid,
  createCacheEntry,
  createPendingRequestManager,
  DEFAULT_MEMORY_TTL_MS,
} from './cache-utils';

// 캐시 유효성 검사
const cachedAt = Date.now() - 60000; // 1분 전
const isValid = isCacheValid(cachedAt, DEFAULT_MEMORY_TTL_MS); // true (5분 이내)

// 캐시 엔트리 생성
const entry = createCacheEntry(
  { name: 'requests', version: '2.28.0' },
  DEFAULT_MEMORY_TTL_MS,
  { source: 'pypi' }
);

// 중복 요청 방지 관리자
const pendingRequests = createPendingRequestManager<PackageMetadata>();

const metadata = await pendingRequests.execute(
  'requests:2.28.0',
  async () => {
    // 네트워크 요청
    const response = await fetch(`https://pypi.org/pypi/requests/2.28.0/json`);
    return response.json();
  },
  (data) => {
    // 성공 시 캐시에 저장
    cache.set('requests:2.28.0', createCacheEntry(data, DEFAULT_MEMORY_TTL_MS));
  }
);
```

---

## 범용 캐시 저장소 (`cache/cache-store.ts`)

메모리, 선택적 디스크 저장, 진행 중 요청 합치기를 제공하는 범용 캐시 저장소입니다. `get()`은 메모리만, `getFromDisk()`는 디스크만 조회하며 `getOrFetch()`가 메모리 → 디스크 → 조회 함수 순서를 연결합니다.

### CacheStore

```typescript
class CacheStore<T> {
  constructor(options: CacheStoreOptions<T>);
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  has(key: string): boolean;
  delete(key: string): boolean;
  clear(): void;
  readonly size: number;
  getFromDisk(key: string): T | undefined;
  getOrFetch(key: string, fetcher: () => Promise<T>, options?: { forceRefresh?: boolean }): Promise<CacheStoreGetResult<T>>;
  dedupeFetch(key: string, fetcher: () => Promise<T | null>): Promise<T | null>;
  prune(): number;
  getStats(): CacheStoreStats;
  keys(): IterableIterator<string>;
  values(): IterableIterator<T>;
  forEach(callback: (value: T, key: string) => void): void;
}
```

`set()`별 TTL 인자나 자동 정리 타이머는 없습니다. `maxSize` 초과 시 접근 시간이 아닌 저장 시각(`cachedAt`)이 가장 오래된 메모리 항목을 제거합니다. 디스크 파일명은 키의 영숫자·점·밑줄·하이픈 외 문자를 `_`로 바꾼 `{safeKey}.json`입니다.

### CacheStoreOptions

```typescript
interface CacheStoreOptions<T> {
  /** 캐시 이름 (로깅용) */
  name: string;
  /** TTL (밀리초) */
  ttlMs: number;
  /** 최대 항목 수 (선택적, 초과 시 저장 시각이 오래된 항목부터 제거) */
  maxSize?: number;
  /** 디스크 캐시 경로 (설정 시 디스크 캐시 활성화) */
  diskCachePath?: string;
  /** 디스크 캐시 TTL (밀리초, 기본값: ttlMs) */
  diskTtlMs?: number;
  /** 직렬화 함수 (디스크 캐시용) */
  serialize?: (value: T) => string;
  /** 역직렬화 함수 (디스크 캐시용) */
  deserialize?: (data: string) => T;
}
```

---

`name`과 `ttlMs`는 필수이며, `diskTtlMs`는 생략 시 `ttlMs`를 사용합니다. `createMemoryCache(name, ttlMs, maxSize?)`와 `createDiskCache(name, ttlMs, diskCachePath, options?)` 팩토리도 제공합니다.

`CacheStoreStats`는 `name`, `memoryEntries`, `hits`, `misses`, `evictions`, `oldestEntry`, `newestEntry`, `pendingRequests`를 반환합니다. 위 `cache-utils.ts`의 `CacheStats`와 다른 타입입니다. `CacheStoreGetResult<T>`는 `{ data, fromCache, cacheType: 'memory' | 'disk' | 'network' }`입니다.

## 아티팩트 캐시 (`cache/artifact-cache.ts`)

`ArtifactCacheManager`는 실제 다운로드 파일을 저장하는 별도 클래스입니다. 옵션은 `{ cacheDir?: string; maxSizeGB?: number; enabled?: boolean }`이고 기본값은 `~/.depssmuggler/cache`, 10GiB, 활성화입니다.

- `initialize()` 후 `getCachedFile(packageInfo)`로 파일을 조회하고 SHA-256을 검증합니다. 없거나 체크섬이 다르면 `null`입니다.
- `addToCache(packageInfo, filePath)`는 파일을 복사하고 저장/접근 시각을 기록합니다. 공간 확보 시 마지막 접근 시각이 오래된 항목부터 제거합니다.
- `clearCache()`, `getCacheSize()`, `getCacheCount()`, `getCacheEntries()`, `getStats()`는 비동기 관리/조회 메서드입니다. `setEnabled()`와 `isEnabled()`는 동기입니다.
- `getCacheManager(options?)`는 싱글톤을 만들며, `initializeCacheManager(options?)`는 초기화까지 수행합니다.

호환용 `CacheManager` 이름은 이 모듈에서는 `ArtifactCacheManager`를, `shared/cache-manager.ts`에서는 범용 `CacheStore`를 가리킵니다. Maven의 `CacheManager` alias와도 별개입니다.

---

## OS 메타데이터 캐시 설정

`src/core/downloaders/os-shared/cache-manager.ts`의 `OsPackageCache`는 OS 저장소 메타데이터를 관리합니다. CLI의 `os search`와 `os download`는 `settings.json`에서 읽은 캐시 사용 여부와 경로, 최대 크기를 이 캐시에 전달합니다.

- CLI 설정 `cacheEnabled`는 GUI와 같은 저장 키 `enableCache`로 연결됩니다. 비동기 `ConfigManager` API의 이름은 `cachingEnabled`로 유지합니다. 읽기 우선순위와 입력 검증은 [CLI 설정](cli.md#config)을 참고하세요.
- CLI의 `maxCacheSize` 기본값은 10GiB입니다. OS backend를 직접 호출하면서 `cacheMaxSize`를 생략한 경우에는 기존 생성자 기본값인 500MiB를 사용합니다.
- 크기 예산은 저장 데이터의 `JSON.stringify(data).length * 2` 추정값이며, 파일의 JSON 부가 필드와 다른 캐시 디렉터리의 크기는 포함하지 않습니다. 저장과 디스크 캐시 로드 시 LRU로 공간을 확보하며, 항목 하나가 한도보다 크면 저장을 생략합니다. 캐시 저장 가능 여부 때문에 정상적인 검색·다운로드를 실패 처리하지 않습니다.
- 캐시를 비활성화하면 새 데이터를 메모리·디스크 캐시에 저장하지 않습니다. 기존 파일을 지우려면 캐시 삭제 명령을 사용합니다.

이 설정은 OS CLI 경로에 전달됩니다. `ArtifactCacheManager.maxSizeGB`와 pip·Maven·Conda 등의 개별 메타데이터 캐시 옵션은 각각 별도입니다.

## 패키지별 캐시 요약

| 패키지 타입 | 메모리 캐시 | 디스크 캐시 | TTL | 문서 |
|------------|------------|------------|-----|------|
| pip | O | O | 메모리 5분, 디스크 1시간 | [shared-pip.md](./shared-pip.md) |
| npm | O | X | 5분 | [shared-npm.md](./shared-npm.md) |
| Maven | O | O | 메모리 5분, 디스크 24시간 | [shared-maven.md](./shared-maven.md) |
| Conda (`conda-cache.ts`) | 동시 요청만 | O | 서버 max-age와 24시간 중 큰 값 | [shared-conda.md](./shared-conda.md) |

`conda-cache.ts`는 완료 후 repodata payload를 메모리에 보존하지 않고 동시 요청만 합칩니다. 별도 URL 헬퍼 `conda-utils.ts`는 TTL 없는 메모리 Map을 사용하므로 두 경로를 구분해야 합니다.

Maven 메모리 캐시와 중복 요청 관리는 `CacheStore<PomCacheEntry>` 어댑터로 통합되고, 디스크 캐시만 Maven 전용 파일 구조를 유지합니다.

---

## 캐시 디렉토리 구조

```
~/.depssmuggler/cache/
├── cache-manifest.json              # 아티팩트 캐시 manifest
├── {type}-{safe-name}-{hash16}/      # 다운로드 파일 캐시
│   └── {downloaded-filename}
├── pip/
│   └── {package}/
│       └── {version}.json
├── pip-simple/
│   └── {sanitized-index-url-and-package-key}.json
├── maven/
│   └── {groupId-as-directory-path}/
│       └── {artifactId}/
│           └── {version}/
│               ├── {artifactId}-{version}.pom
│               └── cache-meta.json
└── conda/
    └── {channel}/
        └── {subdir}/
            ├── repodata.json
            └── repodata.meta.json
```

---

캐시 경로를 별도로 설정한 경우 위 기본 경로와 달라집니다. pip/Maven/Conda 메타데이터 함수의 `cacheDir` 옵션과 Simple API 클라이언트의 `configManager.getCacheDir()` 적용 범위는 각 상세 문서를 참고하세요.

## 관련 문서

- [Shared Utilities 개요](./shared-utilities.md)
- [pip 유틸리티](./shared-pip.md)
- [Conda 유틸리티](./shared-conda.md)
- [Maven 유틸리티](./shared-maven.md)
- [npm 유틸리티](./shared-npm.md)
