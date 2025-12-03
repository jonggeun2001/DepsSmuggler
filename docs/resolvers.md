# Resolvers

## 개요
- 목적: 패키지 의존성 트리 해결 및 충돌 감지
- 위치: `src/core/resolver/`

---

## PipResolver

### 개요
- 목적: Python/PyPI 패키지 의존성 해결
- 위치: `src/core/resolver/pipResolver.ts`

### 클래스 구조

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `resolveDependencies` | name: string, version?: string, options?: ResolverOptions | Promise<DependencyResolutionResult> | 메인 진입점: 패키지 의존성 트리 해결 |
| `resolvePackage` | name: string, version: string, depth: number, parentPath: string[] | Promise<DependencyNode \| null> | 단일 패키지의 의존성 재귀 해결 |
| `parseFromText` | text: string | ParsedDependency[] | requirements.txt 파싱 |
| `flattenDependencies` | node: DependencyNode | PackageInfo[] | 트리를 플랫 리스트로 변환 |

### 내부 메서드

| 메서드 | 설명 |
|--------|------|
| `parseDependencyString` | 의존성 문자열 파싱 (예: "requests>=2.0,<3.0") |
| `getLatestVersion` | 버전 제약조건에 맞는 최신 버전 조회 |
| `isVersionCompatible` | 버전이 제약조건을 만족하는지 확인 |
| `compareVersions` | SemVer 버전 비교 |

### 속성

| 속성 | 타입 | 설명 |
|------|------|------|
| `type` | PackageType | 'pip' |
| `baseUrl` | string | PyPI API URL |
| `visited` | Map<string, DependencyNode> | 방문한 패키지 캐시 |
| `conflicts` | DependencyConflict[] | 감지된 충돌 목록 |

### 사용 예시
```typescript
import { getPipResolver } from './core/resolver/pipResolver';

const resolver = getPipResolver();
const result = await resolver.resolveDependencies('flask', '2.0.0');
console.log(result.tree);       // 의존성 트리
console.log(result.conflicts);  // 충돌 목록
console.log(result.packages);   // 플랫 패키지 목록
```

### requirements.txt 파싱
```typescript
const deps = resolver.parseFromText(`
flask>=2.0.0
requests==2.31.0
numpy>=1.20,<2.0
`);
// [{ name: 'flask', versionConstraint: '>=2.0.0' }, ...]
```

---

## MavenResolver

### 개요
- 목적: Maven/Java 아티팩트 의존성 해결
- 위치: `src/core/resolver/mavenResolver.ts`

### 클래스 구조

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `resolveDependencies` | name: string, version?: string, options?: ResolverOptions | Promise<DependencyResolutionResult> | GAV 좌표 기반 의존성 해결 |
| `resolvePackage` | artifact: string, depth: number, parentPath: string[] | Promise<DependencyNode \| null> | POM 기반 의존성 재귀 해결 |
| `parseFromText` | text: string | ParsedDependency[] | pom.xml 파싱 |
| `flattenDependencies` | node: DependencyNode | PackageInfo[] | 트리를 플랫 리스트로 변환 |

### 내부 메서드

| 메서드 | 설명 |
|--------|------|
| `fetchPom` | Maven Central에서 POM 파일 가져오기 |
| `processDependencyManagement` | BOM (Bill of Materials) 처리 |
| `resolveProperty` | ${property} 치환 |
| `normalizeDependencies` | 의존성 배열 정규화 |
| `getLatestVersion` | 최신 버전 조회 |

### 속성

| 속성 | 타입 | 설명 |
|------|------|------|
| `type` | PackageType | 'maven' |
| `repoUrl` | string | Maven Central URL |
| `parser` | XMLParser | XML 파서 인스턴스 |
| `visited` | Map<string, DependencyNode> | 방문 캐시 |
| `conflicts` | DependencyConflict[] | 충돌 목록 |
| `dependencyManagement` | Map<string, string> | BOM 버전 관리 |

### pom.xml 파싱
```typescript
const deps = resolver.parseFromText(`
<project>
  <dependencies>
    <dependency>
      <groupId>org.springframework</groupId>
      <artifactId>spring-core</artifactId>
      <version>5.3.0</version>
    </dependency>
  </dependencies>
</project>
`);
```

---

## CondaResolver

### 개요
- 목적: Conda/Anaconda 패키지 의존성 해결
- 위치: `src/core/resolver/condaResolver.ts`

### 클래스 구조

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `resolveDependencies` | name: string, version?: string, options?: ResolverOptions | Promise<DependencyResolutionResult> | Conda 패키지 의존성 해결 |
| `resolvePackage` | name: string, version: string, depth: number, parentPath: string[] | Promise<DependencyNode \| null> | 단일 패키지 해결 |
| `parseFromText` | text: string | ParsedDependency[] | environment.yml 파싱 |
| `flattenDependencies` | node: DependencyNode | PackageInfo[] | 플랫 리스트 변환 |

### 내부 메서드

| 메서드 | 설명 |
|--------|------|
| `parseDependencyString` | Conda 의존성 문자열 파싱 |
| `getLatestVersion` | 채널별 최신 버전 조회 |
| `isVersionCompatible` | 버전 호환성 확인 |
| `isSystemPackage` | 시스템 패키지 여부 확인 (libc 등 제외) |
| `compareVersions` | 버전 비교 |

### 속성

| 속성 | 타입 | 설명 |
|------|------|------|
| `type` | PackageType | 'conda' |
| `apiUrl` | string | Anaconda API URL |
| `defaultChannel` | string | 기본 채널 (conda-forge) |
| `visited` | Map | 방문 캐시 |
| `conflicts` | DependencyConflict[] | 충돌 목록 |

### environment.yml 파싱
```typescript
const deps = resolver.parseFromText(`
name: myenv
channels:
  - conda-forge
dependencies:
  - numpy>=1.20
  - pandas=1.3.0
  - pip:
    - requests
`);
```

---

## YumResolver

### 개요
- 목적: YUM/RPM 패키지 의존성 해결
- 위치: `src/core/resolver/yumResolver.ts`

### 클래스 구조

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `resolveDependencies` | name: string, version?: string, options?: ResolverOptions | Promise<DependencyResolutionResult> | RPM 패키지 의존성 해결 |
| `resolvePackage` | name: string, version: string, depth: number, parentPath: string[] | Promise<DependencyNode \| null> | 단일 패키지 해결 |
| `parseFromText` | text: string | ParsedDependency[] | 패키지 목록 파싱 |
| `flattenDependencies` | node: DependencyNode | PackageInfo[] | 플랫 리스트 변환 |
| `clearCache` | - | void | 메타데이터 캐시 초기화 |

### 내부 메서드

| 메서드 | 설명 |
|--------|------|
| `loadMetadata` | YUM 저장소 메타데이터 로드 (repomd.xml, primary.xml) |
| `findPackage` | 이름으로 패키지 검색 |
| `findProvider` | Capability 제공자 검색 (예: libssl.so) |
| `isSystemDependency` | 시스템 의존성 여부 확인 |
| `formatVersion` | EVR (Epoch:Version-Release) 포맷 |
| `normalizeEntries` | requires/provides 엔트리 정규화 |

### 속성

| 속성 | 타입 | 설명 |
|------|------|------|
| `type` | PackageType | 'yum' |
| `parser` | XMLParser | XML 파서 |
| `visited` | Map | 방문 캐시 |
| `conflicts` | DependencyConflict[] | 충돌 목록 |
| `packagesByName` | Map<string, PrimaryPackage[]> | 패키지 인덱스 |
| `providerCache` | Map<string, PrimaryPackage \| null> | Capability 캐시 |
| `metadataLoaded` | boolean | 메타데이터 로드 상태 |
| `currentRepoUrl` | string | 현재 저장소 URL |

---

## 공통 인터페이스

모든 Resolver는 `IResolver` 인터페이스를 구현:

```typescript
interface IResolver {
  type: PackageType;
  resolveDependencies(name: string, version?: string, options?: ResolverOptions): Promise<DependencyResolutionResult>;
  parseFromText(text: string): { name: string; version?: string }[];
}
```

### DependencyResolutionResult

```typescript
interface DependencyResolutionResult {
  tree: DependencyNode;
  packages: PackageInfo[];
  conflicts: DependencyConflict[];
}
```

### DependencyNode

```typescript
interface DependencyNode {
  name: string;
  version: string;
  type: PackageType;
  dependencies: DependencyNode[];
  optional?: boolean;
  scope?: DependencyScope;
}
```

### DependencyConflict

```typescript
interface DependencyConflict {
  packageName: string;
  type: ConflictType;
  versions: string[];
  requestedBy: string[];
}
```

---

## 의존성 해결 알고리즘

1. **DFS 탐색**: 깊이 우선 탐색으로 의존성 트리 구축
2. **방문 캐싱**: 동일 패키지 중복 처리 방지
3. **충돌 감지**: 동일 패키지의 다른 버전 요청 시 기록
4. **버전 해결**: 제약조건에 맞는 최적 버전 선택

```
패키지 A
├── B >= 1.0
│   └── D >= 2.0
├── C >= 1.5
│   └── D >= 1.8  ← 충돌: D의 다른 버전 요청
└── E (optional)
```

---

## 관련 문서
- [아키텍처 개요](./architecture-overview.md)
- [Downloaders 문서](./downloaders.md)
- [타입 정의](./types.md)
