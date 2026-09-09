# Maven 유틸리티

## 개요
- 목적: Maven 패키지 다운로드 및 의존성 해결을 위한 유틸리티
- 위치: `src/core/shared/maven-*.ts`

---

## 모듈 구조

```
src/core/shared/
├── maven-types.ts         # Maven 타입 정의 (shared-types.md 참조)
├── maven-utils.ts         # Maven classifier 빌드 유틸리티
├── maven-cache.ts         # POM 캐싱 시스템
├── maven-pom-utils.ts     # POM 파싱 유틸리티
├── maven-bom-processor.ts # BOM 처리기
├── maven-dedupe-index.ts  # 충돌/중복 인덱스와 BF 좌표 관리
└── maven-skipper.ts       # compatibility shim → maven-dedupe-index.ts
```

---

## Maven 유틸리티 (`maven-utils.ts`)

Maven classifier 빌드, 네이티브 아티팩트 판별, 동적 classifier 조회 유틸리티입니다.

### 주요 함수

| 함수 | 설명 |
|------|------|
| `buildMavenClassifier(os, arch)` | OS/아키텍처에 맞는 classifier 생성 |
| `isNativeArtifact(groupId, artifactId)` | 네이티브 아티팩트 여부 확인 (패턴 기반) |
| `isNativeArtifactFromApi(groupId, artifactId, version?)` | 네이티브 아티팩트 여부 확인 (Maven Central API) |
| `fetchClassifiersFromMavenCentral(groupId, artifactId, version?)` | Maven Central에서 classifier 목록 조회 |
| `getAvailableClassifiers(groupId, artifactId)` | 사용 가능한 classifier 목록 반환 (하드코딩 폴백) |
| `getAvailableClassifiersAsync(groupId, artifactId, version?)` | 사용 가능한 classifier 목록 반환 (API 동적 조회) |

### 네이티브 라이브러리 판별

`isNativeArtifact()`는 `artifactId`에 `native`가 포함되거나 아래 패턴과 일치하는지 검사합니다. `groupId` 인자는 현재 판별에 사용하지 않습니다:

```typescript
const nativePatterns = [
  /^netty-transport-native-/,
  /^lwjgl($|-)/,     // lwjgl 또는 lwjgl-* 모두 매칭
  /^javacpp-/,
  /^jni4net-/,
  /^jogamp-/,
];

isNativeArtifact('org.lwjgl', 'lwjgl-opengl');  // true
isNativeArtifact('io.netty', 'netty-transport-native-epoll');  // true
```

### 네이티브 Classifier 매핑

각 네이티브 라이브러리별 classifier 형식:

```typescript
const NATIVE_CLASSIFIERS = {
  // LWJGL: natives-${platform} 형식
  'lwjgl': [
    'natives-linux', 'natives-linux-arm64', 'natives-linux-arm32',
    'natives-macos', 'natives-macos-arm64',
    'natives-windows', 'natives-windows-x86', 'natives-windows-arm64',
  ],
  // Netty: ${os}-${arch} 형식
  'netty-transport-native': [
    'linux-x86_64', 'linux-aarch_64', 'osx-x86_64', 'osx-aarch_64',
  ],
  // JavaCPP
  'javacpp': [
    'linux-x86_64', 'linux-arm64', 'linux-ppc64le',
    'macosx-x86_64', 'macosx-arm64', 'windows-x86_64', 'windows-x86',
  ],
  // JNA
  'jna': [
    'linux-x86-64', 'linux-aarch64', 'darwin-x86-64', 'darwin-aarch64', 'win32-x86-64', 'win32-x86',
  ],
  // SWT
  'swt': [
    'gtk-linux-x86_64', 'gtk-linux-aarch64', 'cocoa-macosx-x86_64', 'cocoa-macosx-aarch64', 'win32-win32-x86_64',
  ],
};
```

### 동적 Classifier 조회 (Maven Central API)

Maven Central Search API의 `ec` 필드에서 classifier를 동적으로 추출합니다:

```typescript
// API 응답의 ec 필드 형식:
// [".jar", "-sources.jar", "-javadoc.jar", "-natives-linux.jar", ...]

const classifiers = await fetchClassifiersFromMavenCentral('org.lwjgl', 'lwjgl', '3.3.6');
// ['natives-linux', 'natives-linux-arm64', 'natives-macos', ...]
```

`fetchClassifiersFromMavenCentral()`는 Search API의 첫 결과에서 `-{classifier}.jar`를 추출하고 sources/javadoc/tests/test-sources를 제외합니다. 조회 실패나 결과 부재 시 `[]`이며, `getAvailableClassifiersAsync()`는 이 결과를 그대로 반환합니다. 동기 `getAvailableClassifiers()`의 하드코딩 목록으로 자동 대체하지 않습니다.

### Classifier 생성 규칙 (레거시)

```typescript
// OS 매핑
// 'windows' -> 'windows'
// 'macos' -> 'osx'
// 'linux' -> 'linux'

// 아키텍처 매핑
// 'x86_64' -> 'x86_64'
// 'arm64' -> 'aarch_64'

buildMavenClassifier('linux', 'x86_64');   // 'linux-x86_64'
buildMavenClassifier('macos', 'arm64');    // 'osx-aarch_64'
```

`buildMavenClassifier(targetOS?, architecture?)`는 위 매핑에 없는 값 또는 누락된 값에 `undefined`를 반환합니다. 라이브러리별 classifier 형식이 다르므로 이 일반 조합만으로 파일 존재를 판단하지 않으며, UI는 조회한 classifier를 선택할 수 있게 제공합니다.

---

## Maven 캐시 (`maven-cache.ts`)

Maven POM 캐싱 (메모리 + 디스크)

MavenResolver와 MavenDownloader가 공유하여 중복 API 호출을 방지합니다. 메모리 캐시와 중복 요청 관리는 `CacheStore<PomCacheEntry>` 어댑터로 통합하고, 디스크 캐시 디렉토리 구조는 Maven 전용 포맷을 유지합니다.

### 주요 함수

| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `fetchPom` | coordinate, options? | Promise<PomProject> | POM 조회 (캐시 지원) |
| `fetchPomWithCacheInfo` | coordinate, options? | Promise<MavenCacheResult> | POM + 캐시 정보 조회 |
| `prefetchPomsParallel` | coordinates, options? | void | 여러 POM 백그라운드 프리페치 |
| `fetchPomsParallel` | coordinates, options? | Promise<Map<string, PomProject>> | 여러 POM 병렬 조회 |
| `getPomFromCache` | coordinate, repoUrl? | PomProject \| null | 메모리 캐시에서 직접 조회 |
| `isPomCached` | coordinate, repoUrl?, ttl? | boolean | 캐시 존재 여부 확인 |
| `invalidatePom` | coordinate, repoUrl? | void | 특정 POM 캐시 무효화 |
| `clearMemoryCache` | - | void | 메모리 캐시 초기화 |
| `clearDiskCache` | cacheDir? | Promise<void> | 디스크 캐시 삭제 |
| `getMavenCacheStats` | - | MavenCacheStats | 캐시 통계 조회 |
| `pruneExpiredMemoryCache` | ttl? | number | 만료 메모리 캐시 정리 |

병렬 함수의 `options`는 `MavenCacheOptions & { batchSize?: number }`이며 기본 배치 크기는 5입니다. `prefetchPomsParallel()`은 완료를 기다릴 수 없는 `void` 반환 함수이고, 완료가 필요하면 `await fetchPomsParallel()`을 사용합니다. 조회 실패한 POM은 병렬 조회 결과에서 빠집니다.

### MavenCacheOptions

```typescript
interface MavenCacheOptions {
  /** 레포지토리 URL, 기본: https://repo1.maven.org/maven2 */
  repoUrl?: string;
  /** 메모리 TTL (ms), 기본: 300000 (5분) */
  memoryTtl?: number;
  /** 디스크 TTL (ms), 기본: 86400000 (24시간) */
  diskTtl?: number;
  /** 강제 새로고침 */
  forceRefresh?: boolean;
  /** 디스크 캐시 사용 여부, 기본: true */
  useDiskCache?: boolean;
  /** 캐시 디렉토리 */
  cacheDir?: string;
}
```

### MavenCacheResult

```typescript
interface MavenCacheResult {
  pom: PomProject;
  fromCache: 'memory' | 'disk' | 'network';
}
```

### MavenCacheStats

```typescript
interface MavenCacheStats {
  memoryEntries: number;   // 메모리 캐시 항목 수
  diskEntries: number;     // 디스크 캐시 파일 수
  pendingRequests: number; // 진행 중인 요청 수
  oldestEntry: number | null;
  newestEntry: number | null;
  diskSize: number;
}
```

### 캐시 위치

```
~/.depssmuggler/cache/maven/
├── org/
│   └── springframework/
│       └── spring-core/
│           └── 5.3.0/
│               ├── spring-core-5.3.0.pom
│               └── cache-meta.json
└── com/
    └── ...
```

### 사용 예시

```typescript
import { fetchPom, prefetchPomsParallel, getMavenCacheStats } from './maven-cache';

// 단일 POM 조회
const pom = await fetchPom({
  groupId: 'org.springframework',
  artifactId: 'spring-core',
  version: '5.3.0'
});

// 여러 POM 백그라운드 프리페치 (완료를 기다리지 않음)
prefetchPomsParallel([
  { groupId: 'org.springframework', artifactId: 'spring-beans', version: '5.3.0' },
  { groupId: 'org.springframework', artifactId: 'spring-context', version: '5.3.0' },
]);

// 캐시 통계
const stats = getMavenCacheStats();
console.log(`메모리: ${stats.memoryEntries}개`);
```

---

메모리 캐시 키는 저장소 URL과 좌표를 포함하지만 디스크 경로는 G:A:V만 사용합니다. `invalidatePom()`은 메모리 항목만 삭제합니다. `getPomFromCache()`는 별도 `memoryTtl` 검사를 하지 않으며, 유효성 검사에는 `isPomCached()`를 사용합니다. `getMavenCacheStats()`는 기본 디스크 경로를 집계하고 POM과 메타데이터를 각각 파일 1개로 셉니다.

## Maven 스킵/캐시 관리 (`maven-dedupe-index.ts`)

Maven 의존성 해결 최적화를 위한 스킵 로직 및 캐시

### DependencyResolutionSkipper

```typescript
class DependencyResolutionSkipper {
  constructor(coordinateManager?: CoordinateManager, dedupeIndex?: MavenDedupeIndex);
  skipResolution(coordinate: MavenCoordinate, depth: number, parentPath: string[]): SkipResult;
  recordResolved(coordinate: MavenCoordinate): void;
  getResolvedVersion(groupId: string, artifactId: string): string | undefined;
  getCoordinateManager(): CoordinateManager;
  getDedupeIndex(): MavenDedupeIndex;
  getCacheManager(): MavenDedupeIndex; // 호환용 이름
  getStats(): {
    totalProcessed: number;
    skippedAsVersionConflict: number;
    skippedAsDuplicate: number;
    forceResolved: number;
    resolved: number;
  };
  clear(): void;
}
```

스킵 이유는 `skipResolution()` 반환값의 `reason`으로 확인합니다. scope, optional, exclusion 필터링은 리졸버의 별도 처리이며 이 Skipper의 이유 값이 아닙니다.

### SkipResult

```typescript
interface SkipResult {
  skip: boolean;
  reason?: 'version_conflict' | 'duplicate';
  forceResolution?: boolean; // 중복이지만 더 왼쪽 좌표라 처리할 경우
}
```

### CoordinateManager

좌표 관리 및 버전 충돌 처리

```typescript
class CoordinateManager {
  createCoordinate(coordinate: MavenCoordinate, depth: number): NodeCoordinate;
  getCoordinate(coordinate: MavenCoordinate): NodeCoordinate | undefined;
  getLeftmostCoordinate(groupId: string, artifactId: string): NodeCoordinate | undefined;
  isLeftmost(coordinate: MavenCoordinate, currentCoord: NodeCoordinate, parentPath: string[]): boolean;
  clear(): void;
}
```

`NodeCoordinate`는 `{ depth: number; sequence: number }`로 탐색 깊이와 같은 깊이의 선언 순서를 추적합니다. 버전 충돌과 선택된 버전은 다음 인덱스가 관리합니다.

### MavenDedupeIndex

해결된 버전과 아티팩트의 중복 상태 관리. POM 본문 캐시는 `maven-cache.ts`가 담당합니다.

```typescript
class MavenDedupeIndex {
  recordResolved(coordinate: MavenCoordinate): void;
  isVersionConflict(coordinate: MavenCoordinate): boolean;
  isDuplicate(coordinate: MavenCoordinate): boolean;
  getResolvedVersion(groupId: string, artifactId: string): string | undefined;
  clear(): void;
}
```

G:A의 첫 해결 버전을 기록하고, G:A:V(있으면 classifier 포함)의 처리 여부를 추적합니다. `CacheManager`는 이 클래스의 호환용 alias이며 범용 `CacheStore`나 다운로드 아티팩트 캐시와 구분해야 합니다.

---

## Maven POM 유틸리티 (`maven-pom-utils.ts`)

POM 파일 파싱 및 속성 해석 유틸리티:

| 함수 | 설명 |
|------|------|
| `resolveProperty(value, properties?)` | `${property}` 치환을 최대 10회 반복, 미해결 값은 유지 |
| `resolveVersionRange(version)` | 범위 문자열의 첫 경계 버전을 추출하는 단순화된 처리 |
| `resolveDependencyCoordinate(dep, properties?, dependencyManagement?)` | 버전 속성/관리 맵을 적용한 좌표 또는 null |
| `extractDependencies(pom, coordinate, isRoot?)` | 실제 `dependencies.dependency`만 배열로 반환 |
| `extractExclusions(dependency)` | `exclusions.exclusion`을 G:A `Set<string>`으로 반환 |

---

`resolveVersionRange()`는 저장소 버전 목록을 조회하거나 상·하한을 검증하지 않습니다. 예를 들어 `[1.0,2.0)`에서 `1.0`을 추출하며 Maven 전체 범위 해결을 구현한 것은 아닙니다. `dependencyManagement` 항목은 버전 관리용이고 `extractDependencies()`에서 실제 의존성으로 확장하지 않습니다.

## Maven BOM 처리기 (`maven-bom-processor.ts`)

`MavenBomProcessor(fetchPom, dependencyManagement?)`는 Parent POM의 속성·관리 버전을 상속하고 BOM import를 처리합니다. `processParentPom(pom, coordinate, inheritedProperties?)`는 병합된 속성을 반환하며, `processDependencyManagement(pom, properties?)`와 `importBom(dep, properties?)`는 관리 맵을 갱신하고 `Promise<void>`를 반환합니다. 맵은 `getDependencyManagement()`, `setDependencyManagement()`, `clearDependencyManagement()`로 관리합니다.

전이 패키지의 모델 해석에는 `processModel(pom, coordinate, rootManagement)`를 사용합니다. 루트 관리 맵을 복사한 문맥에서 해당 POM의 부모와 import BOM을 적용하고 `{ properties, dependencyManagement }`를 반환한 뒤 기존 관리 맵을 복원합니다. 관리 버전은 루트 값을 우선하며, 형제 패키지의 사용하지 않는 관리 항목이 다른 패키지의 의존성 버전을 바꾸지 않습니다. 이 메서드는 resolver의 순차 큐에서 호출합니다. 모델 POM 조회 캐시와 다운로드 좌표 수집은 요청 전체에서 공유하지만, 완료 import 상태는 관리 문맥이 바뀔 때 초기화합니다.

모델 해석 중 필요한 Parent POM과 import BOM의 좌표도 수집합니다. 부모 체인, BOM의 부모 및 중첩 import를 포함하고, `groupId:artifactId:version` 전체 좌표로 중복을 제거합니다. `getRequiredPoms(): MavenCoordinate[]`는 `type: 'pom'`이고 classifier가 없는 좌표의 복사본을 반환합니다. resolver는 이 수집 결과를 `metadata.type: 'pom'`인 다운로드 항목으로 추가하므로, POM이 조회 캐시에만 남고 전달 파일에서 누락되지 않습니다. 관리 맵의 일반 라이브러리 항목을 다운로드 의존성으로 확장하는 것은 아닙니다.

탐색은 재귀 호출 대신 반복 처리하며 현재 탐색 경로의 Parent/BOM 순환을 감지합니다. 여러 경로가 같은 모델 POM을 참조하는 정상적인 공유 구조는 순환으로 처리하지 않습니다. 필요한 모델의 조회 실패, 해결할 수 없는 좌표, 순환 참조는 `MavenPomResolutionError`로 호출자에게 전달합니다. BOM import는 선언 순서대로 처리하여 먼저 등록된 관리 버전을 유지합니다. 처리 완료된 import는 재사용하되 활성 조상으로 이어질 수 있으면 다시 탐색하고, 부모의 속성은 자식 문맥별로 재평가합니다. `clearDependencyManagement()`는 관리 맵, 수집된 모델 좌표, 처리기 내부 모델 조회 캐시, 완료 import 및 참조 그래프를 함께 초기화합니다. 원시 POM 공용 캐시의 재사용과 해당 resolver 호출의 다운로드 항목 수집은 별개입니다.

```typescript
import { MavenBomProcessor } from './maven-bom-processor';
import { fetchPom } from './maven-cache';

const processor = new MavenBomProcessor(fetchPom);

// BOM에서 버전 관리 정보 로드
await processor.importBom({
  groupId: 'org.springframework.boot',
  artifactId: 'spring-boot-dependencies',
  version: '3.2.0',
  type: 'pom',
  scope: 'import',
});
const managedVersions = processor.getDependencyManagement();

// 의존성 버전 조회
const version = managedVersions.get('org.springframework:spring-core');
```

---

## 관련 문서

- [Shared Utilities 개요](./shared-utilities.md)
- [공통 타입 정의](./shared-types.md)
- [Maven 의존성 해결 알고리즘](./maven-dependency-resolution.md)
- [캐시 유틸리티](./shared-cache.md)
