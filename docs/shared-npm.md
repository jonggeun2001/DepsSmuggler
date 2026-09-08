# npm 유틸리티

## 개요
- 목적: npm 패키지 다운로드 및 의존성 해결을 위한 유틸리티
- 위치: `src/core/shared/npm-*.ts`

---

## 모듈 구조

```
src/core/shared/
├── npm-types.ts             # npm 타입 정의 (shared-types.md 참조)
├── npm-cache.ts             # packument 캐싱 시스템
└── npm-version-resolver.ts  # dist-tag/semver 버전 해결
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
| `isPackumentCached` | name, registryUrl?, ttl? | boolean | 캐시 존재 여부 확인 |
| `invalidatePackage` | name, registryUrl? | void | 특정 패키지 캐시 무효화 |
| `clearNpmCache` | - | void | 전체 캐시 초기화 |
| `getNpmCacheStats` | - | NpmCacheStats | 캐시 통계 조회 |
| `pruneExpiredNpmCache` | ttl? | number | 만료 캐시 정리 |

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

`ttl` 옵션과 `isPackumentCached`/`pruneExpiredNpmCache`의 TTL 인자는 기존 호출 호환용이며 현재 캐시 TTL을 바꾸지 않습니다. 실제 TTL은 저장소 생성 시 지정한 5분입니다. 키는 `${registryUrl}:${name}`이며, 패키지 이름은 캐시 모듈에서 소문자로 정규화하지 않습니다.

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
  oldestEntry: number | null; // 가장 오래된 저장 시각 (ms)
  newestEntry: number | null; // 가장 최근 저장 시각 (ms)
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

## npm 버전 해결 (`npm-version-resolver.ts`)

`NpmVersionResolver(registryUrl?)`는 공유 packument 캐시와 인스턴스별 이름/스펙 → 버전 캐시를 사용합니다.

| 메서드 | 반환값 | 동작 |
|--------|--------|------|
| `fetchPackument(name)` | `Promise<NpmPackument>` | registry 메타데이터 조회 |
| `resolveVersion(spec, packument)` | `string \| null` | dist-tag → 정확 버전 → semver 범위 순으로 해결 |
| `resolveVersionForRequest(spec, packument)` | `Promise<string \| null>` | 요청 세션이 연결되면 버전 선택 결과 재사용 |
| `getVersions(packageName)` | `Promise<string[]>` | prerelease 제외, 최신순 |
| `getPackageInfo(name, version)` | `Promise<NpmPackageVersion \| null>` | 스펙을 해결하여 버전 정보 조회; 실패하면 null |
| `parseFromPackageJson(content)` | `Promise<{ name: string; version: string }[]>` | prod/dev/peer/optional 필드를 합쳐 각 스펙 해결 |
| `clearCache()` | `void` | 인스턴스의 버전 선택 캐시 초기화 |

semver 범위는 정식 버전을 먼저 찾고, 없으면 prerelease를 포함해 다시 시도합니다. `parseFromPackageJson()`은 같은 이름의 필드를 뒤쪽 종류로 덮어쓰며 개별 조회 실패는 건너뜁니다. 이 헬퍼의 필드 병합은 `NpmResolver`의 실제 설치 그래프/peer 처리와 구분됩니다.

---

## 관련 문서

- [Shared Utilities 개요](./shared-utilities.md)
- [공통 타입 정의](./shared-types.md)
- [npm 의존성 해결 알고리즘](./npm-dependency-resolution.md)
- [캐시 유틸리티](./shared-cache.md)
