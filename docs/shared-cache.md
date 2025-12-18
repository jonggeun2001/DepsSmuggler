# 캐시 유틸리티

## 개요
- 목적: 모든 캐시 모듈에서 공통으로 사용하는 캐시 관련 유틸리티
- 위치: `src/core/shared/cache-utils.ts`, `cache-manager.ts`

---

## 모듈 구조

```
src/core/shared/
├── cache-utils.ts     # 캐시 공통 유틸리티
├── cache-manager.ts   # 범용 캐시 매니저
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
const DEFAULT_DISK_TTL_MS = 86400000;   // 24시간 (디스크 캐시 기본 TTL)
const LONG_DISK_TTL_MS = 604800000;     // 7일 (장기 디스크 캐시 TTL)
```

### 타입 정의

#### BaseCacheEntry

캐시 엔트리 기본 구조

```typescript
interface BaseCacheEntry<T> {
  data: T;             // 캐시된 데이터
  cachedAt: number;    // 캐시 저장 시간 (Unix timestamp ms)
  ttl: number;         // TTL (ms)
}
```

#### CacheEntryWithMeta

메타데이터를 포함한 캐시 엔트리

```typescript
interface CacheEntryWithMeta<T, M = Record<string, unknown>> extends BaseCacheEntry<T> {
  metadata?: M;        // 추가 메타데이터
}
```

#### CacheOptions

캐시 조회 옵션

```typescript
interface CacheOptions {
  ttl?: number;              // TTL (ms)
  forceRefresh?: boolean;    // 강제 새로고침
  useDiskCache?: boolean;    // 디스크 캐시 사용 여부
}
```

#### CacheStats

캐시 통계

```typescript
interface CacheStats {
  entries: number;           // 캐시 항목 수
  hits: number;              // 캐시 히트 수
  misses: number;            // 캐시 미스 수
  hitRate: number;           // 히트율 (0~1)
}
```

#### ExtendedCacheStats

확장 캐시 통계

```typescript
interface ExtendedCacheStats extends CacheStats {
  memoryEntries: number;     // 메모리 캐시 항목 수
  diskEntries: number;       // 디스크 캐시 항목 수
  diskSize: number;          // 디스크 캐시 크기 (바이트)
  pendingRequests: number;   // 진행 중인 요청 수
}
```

### 주요 함수

| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `isCacheValid` | cachedAt, ttl | boolean | 캐시 유효성 검사 |
| `isCacheEntryValid` | entry: BaseCacheEntry | boolean | 캐시 엔트리 유효성 검사 |
| `createCacheEntry` | data, ttl, metadata? | CacheEntryWithMeta | 캐시 엔트리 생성 |
| `normalizeKey` | key | string | 캐시 키 정규화 |
| `pruneExpiredEntries` | cache: Map, getTtl? | number | 만료된 엔트리 정리 |
| `calculateCacheStats` | cache: Map, hits?, misses? | CacheStats | 캐시 통계 계산 |
| `isBaseCacheEntry` | entry | boolean | BaseCacheEntry 타입 가드 |
| `createPendingRequestManager` | - | PendingRequestManager | 중복 요청 방지 관리자 생성 |

### PendingRequestManager

중복 네트워크 요청을 방지하는 관리자

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

## 범용 캐시 매니저 (`cache-manager.ts`)

범용 캐시 관리 클래스입니다.

### CacheManager

```typescript
class CacheManager<T> {
  constructor(options: CacheManagerOptions);

  // 캐시 조회
  get(key: string): T | null;

  // 캐시 저장
  set(key: string, value: T, ttl?: number): void;

  // 캐시 삭제
  delete(key: string): boolean;

  // 전체 캐시 초기화
  clear(): void;

  // 만료 캐시 정리
  prune(): number;

  // 캐시 통계
  getStats(): CacheStats;
}
```

### CacheManagerOptions

```typescript
interface CacheManagerOptions {
  /** 기본 TTL (ms) */
  defaultTtl?: number;
  /** 최대 항목 수 */
  maxEntries?: number;
  /** 자동 정리 간격 (ms) */
  pruneInterval?: number;
}
```

---

## 패키지별 캐시 요약

| 패키지 타입 | 메모리 캐시 | 디스크 캐시 | TTL | 문서 |
|------------|------------|------------|-----|------|
| pip | O | O | 메모리 5분, 디스크 24시간 | [shared-pip.md](./shared-pip.md) |
| npm | O | X | 5분 | [shared-npm.md](./shared-npm.md) |
| Maven | O | O | 메모리 5분, 디스크 24시간 | [shared-maven.md](./shared-maven.md) |
| Conda | X | O | HTTP Cache-Control 기반 | [shared-conda.md](./shared-conda.md) |

---

## 캐시 디렉토리 구조

```
~/.depssmuggler/cache/
├── pip/
│   └── {package}/
│       └── {version}.json
├── pip-simple/
│   └── {package}.json
├── maven/
│   └── {groupId}/
│       └── {artifactId}/
│           └── {version}/
│               ├── pom.xml
│               └── meta.json
└── conda/
    └── {channel}/
        └── {subdir}/
            ├── repodata.json
            └── repodata.meta.json
```

---

## 관련 문서

- [Shared Utilities 개요](./shared-utilities.md)
- [pip 유틸리티](./shared-pip.md)
- [Conda 유틸리티](./shared-conda.md)
- [Maven 유틸리티](./shared-maven.md)
- [npm 유틸리티](./shared-npm.md)
