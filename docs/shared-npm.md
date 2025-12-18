# npm 유틸리티

## 개요
- 목적: npm 패키지 다운로드 및 의존성 해결을 위한 유틸리티
- 위치: `src/core/shared/npm-*.ts`

---

## 모듈 구조

```
src/core/shared/
├── npm-types.ts    # npm 타입 정의 (shared-types.md 참조)
└── npm-cache.ts    # packument 캐싱 시스템
```

---

## npm 캐시 (`npm-cache.ts`)

npm Registry packument 캐싱 (메모리)

NpmResolver와 NpmDownloader가 공유하여 중복 API 호출을 방지합니다.

### 주요 함수

| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `fetchPackument` | name, options? | Promise<NpmPackument> | packument 조회 (캐시 지원) |
| `fetchPackumentWithCacheInfo` | name, options? | Promise<NpmCacheResult> | packument + 캐시 정보 조회 |
| `getPackumentFromCache` | name, registryUrl? | NpmPackument \| null | 캐시에서 직접 조회 |
| `isPackumentCached` | name, registryUrl? | boolean | 캐시 존재 여부 확인 |
| `invalidatePackage` | name, registryUrl? | void | 특정 패키지 캐시 무효화 |
| `clearNpmCache` | - | void | 전체 캐시 초기화 |
| `getNpmCacheStats` | - | NpmCacheStats | 캐시 통계 조회 |
| `pruneExpiredNpmCache` | - | number | 만료 캐시 정리 |

### NpmCacheOptions

```typescript
interface NpmCacheOptions {
  /** 레지스트리 URL, 기본: https://registry.npmjs.org */
  registryUrl?: string;
  /** TTL (ms), 기본: 300000 (5분) */
  ttl?: number;
  /** 강제 새로고침 */
  forceRefresh?: boolean;
}
```

### NpmCacheResult

```typescript
interface NpmCacheResult {
  packument: NpmPackument;
  fromCache: boolean;
}
```

### NpmCacheStats

```typescript
interface NpmCacheStats {
  entries: number;      // 캐시 항목 수
  pendingRequests: number; // 진행 중인 요청 수
}
```

### 사용 예시

```typescript
import { fetchPackument, getNpmCacheStats, clearNpmCache } from './npm-cache';

// packument 조회
const packument = await fetchPackument('express');
console.log('최신 버전:', packument['dist-tags'].latest);

// 캐시 통계
const stats = getNpmCacheStats();
console.log(`캐시 항목: ${stats.entries}개`);

// 캐시 초기화
clearNpmCache();
```

---

## 관련 문서

- [Shared Utilities 개요](./shared-utilities.md)
- [공통 타입 정의](./shared-types.md)
- [npm 의존성 해결 알고리즘](./npm-dependency-resolution.md)
- [캐시 유틸리티](./shared-cache.md)
