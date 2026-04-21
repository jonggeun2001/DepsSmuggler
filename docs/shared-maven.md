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
└── maven-skipper.ts       # compatibility shim → ../core/downloaders/maven/maven-dedupe-index.ts
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

패턴 기반으로 알려진 네이티브 라이브러리를 판별합니다:

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
    'linux-x86_64', 'linux-arm64', 'macosx-x86_64', 'macosx-arm64', 'windows-x86_64',
  ],
  // JNA
  'jna': [
    'linux-x86-64', 'linux-aarch64', 'darwin-x86-64', 'darwin-aarch64', 'win32-x86-64',
  ],
  // SWT
  'swt': [
    'gtk-linux-x86_64', 'gtk-linux-aarch64', 'cocoa-macosx-x86_64', 'win32-win32-x86_64',
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

**참고**: 각 네이티브 라이브러리마다 classifier 형식이 다르므로 (LWJGL: `natives-linux`, Netty: `linux-x86_64`), UI에서 사용자가 직접 선택하는 방식을 권장합니다.

---

## Maven 캐시 (`maven-cache.ts`)

Maven POM 캐싱 (메모리 + 디스크)

MavenResolver와 MavenDownloader가 공유하여 중복 API 호출을 방지합니다.

### 주요 함수

| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `fetchPom` | coordinate, options? | Promise<PomProject> | POM 조회 (캐시 지원) |
| `fetchPomWithCacheInfo` | coordinate, options? | Promise<MavenCacheResult> | POM + 캐시 정보 조회 |
| `prefetchPomsParallel` | coordinates, options? | Promise<void> | 여러 POM 병렬 프리페치 |
| `fetchPomsParallel` | coordinates, options? | Promise<Map<string, PomProject>> | 여러 POM 병렬 조회 |
| `getPomFromCache` | coordinate | PomProject \| null | 메모리 캐시에서 직접 조회 |
| `isPomCached` | coordinate | boolean | 캐시 존재 여부 확인 |
| `invalidatePom` | coordinate | void | 특정 POM 캐시 무효화 |
| `clearMemoryCache` | - | void | 메모리 캐시 초기화 |
| `clearDiskCache` | cacheDir? | Promise<void> | 디스크 캐시 삭제 |
| `getMavenCacheStats` | - | MavenCacheStats | 캐시 통계 조회 |
| `pruneExpiredMemoryCache` | - | number | 만료 메모리 캐시 정리 |

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
  pendingRequests: number; // 진행 중인 요청 수
}
```

### 캐시 위치

```
~/.depssmuggler/cache/maven/
├── org/
│   └── springframework/
│       └── spring-core/
│           └── 5.3.0/
│               ├── pom.xml
│               └── meta.json
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

// 여러 POM 병렬 프리페치 (의존성 해결 최적화)
await prefetchPomsParallel([
  { groupId: 'org.springframework', artifactId: 'spring-beans', version: '5.3.0' },
  { groupId: 'org.springframework', artifactId: 'spring-context', version: '5.3.0' },
]);

// 캐시 통계
const stats = getMavenCacheStats();
console.log(`메모리: ${stats.memoryEntries}개`);
```

---

## Maven 스킵/캐시 관리 (`downloaders/maven/maven-dedupe-index.ts`)

Maven 의존성 해결 최적화를 위한 스킵 로직 및 캐시

### DependencyResolutionSkipper

```typescript
class DependencyResolutionSkipper {
  // 의존성 스킵 여부 결정
  shouldSkip(coordinate: MavenCoordinate, context: DependencyProcessingContext): SkipResult;

  // 스킵 이유 조회
  getSkipReason(coordinate: MavenCoordinate): string | null;
}
```

### SkipResult

```typescript
interface SkipResult {
  skip: boolean;
  reason?: 'already_resolved' | 'excluded' | 'optional' | 'test_scope' | 'system_scope';
  resolvedVersion?: string;  // 이미 해결된 버전
}
```

### CoordinateManager

좌표 관리 및 버전 충돌 처리

```typescript
class CoordinateManager {
  // 좌표 등록
  register(coordinate: MavenCoordinate, depth: number): void;

  // 충돌 확인
  hasConflict(coordinate: MavenCoordinate): boolean;

  // 선택된 버전 조회 (Nearest wins)
  getSelectedVersion(groupId: string, artifactId: string): string | null;
}
```

### MavenDedupeIndex

POM 캐시 관리

```typescript
class MavenDedupeIndex {
  // POM 캐시 조회
  getPom(coordinate: MavenCoordinate): PomCacheEntry | null;

  // POM 캐시 저장
  setPom(coordinate: MavenCoordinate, pom: PomProject): void;

  // 해결된 의존성 캐시
  getResolved(coordinate: MavenCoordinate): ResolvedDependencyNode[] | null;
  setResolved(coordinate: MavenCoordinate, deps: ResolvedDependencyNode[]): void;
}
```

---

## Maven POM 유틸리티 (`maven-pom-utils.ts`)

POM 파일 파싱 및 속성 해석 유틸리티:

| 함수 | 설명 |
|------|------|
| `resolveProperty(value, properties)` | `${property}` 형식 속성 해석 |
| `resolveVersionRange(range, versions)` | Maven 버전 범위 해석 |
| `resolveDependencyCoordinate(dep, props)` | 의존성 좌표 완전 해석 |
| `extractDependencies(pom)` | POM에서 의존성 목록 추출 |
| `extractExclusions(dependency)` | 의존성의 exclusions 추출 |

---

## Maven BOM 처리기 (`maven-bom-processor.ts`)

Bill of Materials (BOM) 처리:

```typescript
import { MavenBomProcessor } from './shared/maven-bom-processor';

const processor = new MavenBomProcessor(fetchPomFn);

// BOM에서 버전 관리 정보 로드
const managedVersions = await processor.processBom(
  'org.springframework.boot',
  'spring-boot-dependencies',
  '3.2.0'
);

// 의존성 버전 조회
const version = managedVersions.get('org.springframework:spring-core');
```

---

## 관련 문서

- [Shared Utilities 개요](./shared-utilities.md)
- [공통 타입 정의](./shared-types.md)
- [Maven 의존성 해결 알고리즘](./maven-dependency-resolution.md)
- [캐시 유틸리티](./shared-cache.md)
