# Maven 의존성 해결 알고리즘 분석

> **알고리즘 분석 + 구현 대조 · 2026-09-08**: 1–8절과 11절은 Maven Resolver의 DF/BF·Skipper·설정·소스 구조를 설명하는 참고 분석입니다. 7절의 성능 수치는 이 저장소의 측정 결과가 아닙니다. 아래 JVM 옵션은 Maven용이며 DepsSmuggler CLI 옵션이 아닙니다. 실제 API는 [Resolvers](resolvers.md), [Downloaders](downloaders.md), [공유 Maven 유틸리티](shared-maven.md)를 참고하세요.

## 현재 구현 요약

- `MavenResolver`는 BF 탐색을 `MavenQueueProcessor`와 조합하고, `MavenBomProcessor`, `DependencyResolutionSkipper` 및 Maven 공용 캐시를 사용합니다. Maven JVM 라이브러리를 직접 실행하지 않습니다.
- 루트의 `latest`는 저장소 메타데이터의 `latest` 또는 `release` 실제 버전으로 바꾼 뒤 POM을 조회합니다. 두 값이 모두 없으면 실패합니다. CLI의 `--no-deps`에서도 버전 확인은 수행하며 자식 라이브러리 의존성은 펼치지 않습니다.
- 루트의 명시적 `metadata.type`은 `artifactType`으로 전달되며 원격 POM packaging이 이를 덮어쓰지 않습니다. 아티팩트 키는 type을 포함합니다. classifier는 사용자가 선택하며 OS/아키텍처만으로 자동 생성하지 않습니다.
- `dependencyManagement`와 BOM은 버전 관리에 사용하고, 그 목록 전체를 실제 다운로드 의존성으로 펼치지 않습니다. `MavenQueueProcessor`가 `src/core/shared/maven-pom-utils.ts`의 `extractDependencies()`를 호출합니다.
- 선택된 패키지의 모델 해석에 필요한 Parent POM과 import BOM은 전체 GAV로 중복 제거하여 `metadata.type: 'pom'`인 다운로드 항목으로 포함합니다. Parent/BOM 탐색과 그래프 평탄화는 반복 처리하며, 필수 모델의 누락이나 순환 참조는 해당 루트의 해결 실패로 보고합니다.
- `MavenDownloader.downloadPackage()`는 `metadata.packaging` → `metadata.type` → POM의 `<packaging>` → `jar` 순서로 파일 타입을 정합니다. 메인 아티팩트와 POM, 사용 가능한 `.sha1` 파일을 내려받습니다. source/javadoc은 classifier 또는 type으로 선택하며 자동으로 모두 포함하지 않습니다.
- 9절의 구현 권장사항과 10.4절의 축약 코드는 설계 설명입니다. 예시의 모든 타입·체크섬 알고리즘이 호출 옵션으로 노출되는 것은 아닙니다. 12–13절은 현재 구현의 크기 조회·POM 처리·요청 재사용을 설명합니다.

## 1. 개요

Maven의 `mvn install` 실행 시 의존성 해결은 **maven-resolver** (구 Aether) 컴포넌트가 담당합니다. Maven 3.9.0부터는 두 가지 알고리즘을 지원합니다:

| 알고리즘 | 클래스 | 특징 |
|---------|--------|------|
| **DF (Depth-First)** | `DfDependencyCollector` | 기존 기본값, 깊이 우선 탐색 |
| **BF (Breadth-First)** | `BfDependencyCollector` | eBay 기여, 너비 우선 탐색 + Skipper |

### 참고 자료
- [Apache Maven Resolver GitHub](https://github.com/apache/maven-resolver)
- [Maven 의존성 메커니즘 공식 문서](https://maven.apache.org/guides/introduction/introduction-to-dependency-mechanism.html)
- [eBay의 BF 알고리즘 기여 블로그](https://innovation.ebayinc.com/stories/open-source-contribution-new-maven-dependency-resolution-algorithm)

---

## 2. 핵심 의존성 해결 단계

### 2.1 전체 프로세스

```
1. Root POM 파싱
      ↓
2. Artifact Descriptor (POM) 읽기
      ↓
3. 의존성 그래프 구축 (Dirty Graph)
      ↓
4. 충돌 조정 (Conflict Mediation)
      ↓
5. 그래프 변환 (Graph Transformation)
      ↓
6. 최종 의존성 목록 (Resolved Graph)
      ↓
7. 파일 다운로드
```

### 2.2 주요 확장 포인트

Maven Resolver의 핵심 인터페이스들:

| 인터페이스 | 역할 |
|-----------|------|
| `DependencySelector` | 의존성 선택 여부 결정 (exclusions 처리) |
| `DependencyManager` | 의존성 버전 관리 (dependencyManagement) |
| `DependencyTraverser` | 하위 의존성 탐색 여부 결정 |
| `VersionFilter` | 버전 필터링 (SNAPSHOT 제외 등) |
| `DependencyGraphTransformer` | 최종 그래프 변환 |

```java
// 각 확장 포인트는 자식 컨텍스트를 파생
DependencySelector childSelector = depSelector.deriveChildSelector(context);
DependencyManager childManager = depManager.deriveChildManager(context);
DependencyTraverser childTraverser = depTraverser.deriveChildTraverser(context);
VersionFilter childFilter = verFilter.deriveChildFilter(context);
```

---

## 3. DF (Depth-First) 알고리즘 - 기존 방식

### 3.1 동작 원리

깊이 우선 탐색으로 모든 의존성 경로를 재귀적으로 탐색합니다.

```
의존성 트리 예시:
X
├── Y
│   └── Z 2.0
├── G
│   └── J
│       └── Z 1.0
├── H
│   └── Z 2.0
├── Z 2.0
└── D
    └── Z 2.0

탐색 순서 (DF):
1. X -> Y -> Z 2.0
2. X -> G -> J -> Z 1.0
3. X -> H -> Z 2.0
4. X -> Z 2.0
5. X -> D -> Z 2.0
```

### 3.2 핵심 로직

```java
// DfDependencyCollector.java 핵심 흐름
private void process(Args args, List<Dependency> dependencies, ...) {
    for (Dependency dependency : dependencies) {
        processDependency(args, dependency, ...);
    }
}

private void processDependency(Args args, Dependency dependency, ...) {
    // 1. 의존성 선택 여부 확인
    if (depSelector != null && !depSelector.selectDependency(dependency)) {
        return;
    }

    // 2. 버전 범위 해결
    VersionRangeResult rangeResult = cachedResolveRangeResult(rangeRequest, ...);
    List<Version> versions = filterVersions(dependency, rangeResult, ...);

    // 3. 각 버전에 대해 처리
    for (Version version : versions) {
        // POM 읽기
        ArtifactDescriptorResult descriptorResult = getArtifactDescriptorResult(...);

        // 순환 의존성 감지
        int cycleEntry = DefaultDependencyCycle.find(args.nodes.nodes, artifact);
        if (cycleEntry >= 0) {
            results.addCycle(...);
            continue;
        }

        // 재배치(relocation) 처리
        if (!descriptorResult.getRelocations().isEmpty()) {
            processDependency(..., descriptorResult.getRelocations(), ...);
            return;
        }

        // 자식 노드 생성 및 재귀 호출
        if (recurse) {
            doRecurse(args, descriptorResult, child);
        }
    }
}
```

### 3.3 캐시 메커니즘과 문제점

```java
// 캐시 키 생성 - exclusions도 포함됨!
Object key = args.pool.toKey(
    artifact,
    childRepos,
    childSelector,  // exclusions 포함
    childManager,
    childTraverser,
    childFilter
);

List<DependencyNode> children = args.pool.getChildren(key);
if (children == null) {
    // 캐시 미스 - 새로 계산 필요
    args.pool.putChildren(key, child.getChildren());
    doRecurse(...);
} else {
    // 캐시 히트 - 재사용
    child.setChildren(children);
}
```

**핵심 문제**: exclusions가 캐시 키에 포함되어 있어서:
- 같은 의존성(G:A:V)이라도 부모 경로의 exclusions가 다르면 캐시 미스 발생
- 대규모 프로젝트에서 동일 의존성을 수백만 번 재계산
- eBay 사례: 1,500개 최종 의존성을 위해 7,500만 노드 생성

---

## 4. BF (Breadth-First) + Skipper 알고리즘 - 새로운 방식

### 4.1 핵심 아이디어

1. **BF 탐색**: 너비 우선 탐색으로 순회 순서를 Maven의 충돌 조정 순서와 일치
2. **Skipper**: 충돌이 예측되는 노드의 해결을 건너뛰어 성능 향상
3. **병렬 처리**: POM 다운로드를 병렬로 수행

### 4.2 BF 탐색 로직

```java
// BfDependencyCollector.java
protected void doCollectDependencies(...) {
    // 큐 기반 너비 우선 탐색
    Queue<DependencyProcessingContext> queue = new ArrayDeque<>(128);

    // 루트 의존성들을 큐에 추가
    for (Dependency dependency : dependencies) {
        DependencyProcessingContext context = new DependencyProcessingContext(...);
        if (!filter(context)) {
            resolveArtifactDescriptorAsync(args, context, results);
            queue.add(context);
        }
    }

    // 큐가 빌 때까지 레벨별로 처리
    while (!queue.isEmpty()) {
        processDependency(args, results, queue.remove(), ...);
    }
}
```

### 4.3 Skipper 알고리즘

Skipper는 노드 해결 전에 충돌을 예측하여 불필요한 계산을 방지합니다.

```java
// DependencyResolutionSkipper.java
public boolean skipResolution(DependencyNode node, List<DependencyNode> parents) {
    int depth = parents.size() + 1;
    coordinateManager.createCoordinate(node, depth);

    // 1. 버전 충돌 체크 (같은 G:A에 다른 버전이 이미 해결됨)
    if (cacheManager.isVersionConflict(node)) {
        result.skippedAsVersionConflict = true;
        return true;  // SKIP - 버전 충돌 패배자
    }

    // 2. 중복 체크 (같은 G:A:V가 이미 해결됨)
    else if (cacheManager.isDuplicate(node)) {
        // 2a. 현재 노드가 더 왼쪽(먼저 선언)인 경우
        if (coordinateManager.isLeftmost(node, parents)) {
            result.forceResolution = true;
            return false;  // RESOLVE - scope 선택을 위해 강제 해결
        }
        // 2b. 오른쪽인 경우
        else {
            result.skippedAsDuplicate = true;
            return true;  // SKIP - 중복 패배자
        }
    }

    // 3. 새로운 의존성
    else {
        result.resolve = true;
        return false;  // RESOLVE - 새로 해결 필요
    }
}
```

### 4.4 좌표 시스템

노드의 위치를 (depth, sequence) 좌표로 추적하여 "왼쪽" 여부를 판단합니다.

```java
// 좌표 생성: (깊이, 해당 깊이에서의 순서)
Coordinate createCoordinate(DependencyNode node, int depth) {
    int seq = sequenceGen
        .computeIfAbsent(depth, k -> new AtomicInteger())
        .incrementAndGet();
    return new Coordinate(depth, seq);
}

// 왼쪽 여부 판단
boolean isLeftmost(DependencyNode node, List<DependencyNode> parents) {
    Coordinate leftmost = leftmostCoordinates.get(node.getArtifact());
    if (leftmost != null && leftmost.depth <= parents.size()) {
        DependencyNode sameLevelNode = parents.get(leftmost.depth - 1);
        return getCoordinate(sameLevelNode).sequence < leftmost.sequence;
    }
    return false;
}
```

### 4.5 강제 해결 (Force Resolution) 이유

BF 알고리즘에서 일부 중복 노드를 강제 해결하는 이유:

```
DF 전략에서의 R 노드 해결 순서:
A
├── R (#3) ← winner 후보 1
├── B
│   ├── R (#6) ← winner 후보 2
│   └── D
│       └── R (#8) ← 최종 winner
└── ...

DF에서 충돌 조정에 사용되는 경로:
- A -> R
- A -> B -> R
- A -> B -> D -> R

BF + Skipper에서 강제 해결 없이:
- A -> R 만 남음 (나머지 skip)

BF + Skipper에서 강제 해결 적용:
- A -> R
- A -> B -> R (왼쪽이므로 강제 해결)
- A -> B -> D -> R (왼쪽이므로 강제 해결)
→ 모든 충돌 경로 보존, 100% 호환성 달성
```

### 4.6 병렬 POM 다운로드

```java
// ParallelDescriptorResolver - Maven 3.9.0+
class ParallelDescriptorResolver implements Closeable {
    private final SmartExecutor smartExecutor;
    private final Map<String, Future<DescriptorResolutionResult>> results;

    void resolveDescriptors(Artifact artifact, Callable<DescriptorResolutionResult> callable) {
        results.computeIfAbsent(
            ArtifactIdUtils.toId(artifact),
            key -> smartExecutor.submit(callable)
        );
    }
}

// 기본 스레드 수
public static final int DEFAULT_THREADS = 5;
```

---

## 5. 충돌 조정 (Conflict Mediation) 규칙

### 5.1 Nearest Definition (가장 가까운 정의 우선)

```
A
├── B
│   └── C
│       └── D 2.0    ← depth 3
└── E
    └── D 1.0        ← depth 2 (WINNER!)

결과: D 1.0 선택 (루트에서 더 가까움)
```

### 5.2 First Declaration (동일 깊이시 먼저 선언된 것)

```
A
├── B
│   └── D 1.0    ← depth 2, 먼저 선언 (WINNER!)
└── C
    └── D 2.0    ← depth 2, 나중 선언

결과: D 1.0 선택 (POM에서 먼저 선언됨)
```

### 5.3 dependencyManagement 우선

```xml
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>com.example</groupId>
            <artifactId>D</artifactId>
            <version>3.0</version>  <!-- 이 버전이 강제됨 -->
        </dependency>
    </dependencies>
</dependencyManagement>
```

**우선순위**: dependencyManagement > Nearest Definition > First Declaration

### 5.4 충돌 유형

| 유형 | 설명 | 메시지 |
|------|------|--------|
| 중복 충돌 | 같은 G:A:V가 여러 경로에 존재 | `omitted for duplicate` |
| 버전 충돌 | 같은 G:A의 다른 버전 존재 | `omitted for conflict` |

---

## 6. Scope 전이 규칙

의존성 scope에 따른 전이적 의존성 scope 변환:

| 직접 의존성 Scope | 전이적 의존성의 원래 Scope → 결과 Scope |
|------------------|----------------------------------------|
| | compile | provided | runtime | test |
| **compile** | compile | - | runtime | - |
| **provided** | provided | - | provided | - |
| **runtime** | runtime | - | runtime | - |
| **test** | test | - | test | - |

**예시**:
- A가 B를 `compile`으로 의존, B가 C를 `runtime`으로 의존
- → A에서 C는 `runtime` scope로 전이

---

## 7. 성능 비교

eBay의 실제 측정 결과:

| 지표 | DF 알고리즘 | BF + Skipper |
|------|------------|--------------|
| 의존성 해결 시간 | 5-10분 (최악 30분+) | **30-70% 감소** |
| 메모리 사용 | 75M 노드 생성 | 대폭 감소 |
| 최종 의존성 수 | ~1,500개 | ~1,500개 (동일) |
| 호환성 | 100% | 100% |

---

## 8. Maven 설정 옵션

### 8.1 알고리즘 선택

```bash
# BF 알고리즘 활성화 (Maven 3.9.0+, 권장)
mvn install -Daether.dependencyCollector.impl=bf

# DF 알고리즘 (기본값)
mvn install -Daether.dependencyCollector.impl=df
```

### 8.2 Skipper 설정

```bash
# versionless: G:A:C:E 기준으로 중복 판단 (기본값)
-Daether.dependencyCollector.bf.skipper=versionless

# versioned: G:A:C:E:V 기준으로 중복 판단
-Daether.dependencyCollector.bf.skipper=versioned

# 비활성화
-Daether.dependencyCollector.bf.skipper=false
```

### 8.3 병렬 처리 설정

```bash
# POM 다운로드 병렬 스레드 수 (기본값: 5)
-Daether.dependencyCollector.bf.threads=10
```

---

## 9. DepsSmuggler 구현 시 고려사항

### 9.1 API 활용

Maven Central REST API로 POM 메타데이터 조회:

```
GET https://repo1.maven.org/maven2/{groupId}/{artifactId}/{version}/{artifactId}-{version}.pom
```

### 9.2 구현 권장사항

1. **BF 탐색 우선**: 너비 우선 탐색으로 불필요한 노드 계산 방지
2. **충돌 조정 구현**: Nearest Definition → First Declaration 순서
3. **캐싱 전략**: G:A:V 기준 캐싱 (exclusions 무관)
4. **병렬 다운로드**: POM 파일 병렬 fetch
5. **순환 의존성 감지**: 방문 경로 추적

### 9.3 다운로드 대상 파일

| 파일 유형 | 패턴 | 용도 |
|----------|------|------|
| JAR | `{artifactId}-{version}.jar` | 메인 아티팩트 |
| POM | `{artifactId}-{version}.pom` | 의존성 정보 |
| Sources | `{artifactId}-{version}-sources.jar` | 소스 코드 (선택) |
| Javadoc | `{artifactId}-{version}-javadoc.jar` | 문서 (선택) |
| Checksum | `.sha1`, `.md5`, `.sha256`, `.sha512` | 무결성 검증 |

### 9.4 체크섬 검증

Maven Resolver가 지원하는 체크섬 알고리즘:
- MD5
- SHA-1 (기본)
- SHA-256
- SHA-512

---

## 10. 패키징 타입(Packaging Type) 처리

### 10.1 Maven 패키징 타입 개요

Maven은 다양한 패키징 타입을 지원하며, 각 타입에 따라 다운로드할 아티팩트가 다릅니다.

| 패키징 타입 | 확장자 | 설명 | JAR 존재 |
|------------|--------|------|----------|
| `jar` | `.jar` | 기본값, Java 라이브러리 | ✅ |
| `pom` | `.pom`만 | BOM, Parent POM (코드 없음) | ❌ |
| `war` | `.war` | 웹 애플리케이션 | ❌ (WAR 대신) |
| `ear` | `.ear` | 엔터프라이즈 애플리케이션 | ❌ (EAR 대신) |
| `ejb` | `.jar` | Enterprise JavaBean | ✅ |
| `maven-plugin` | `.jar` | Maven 플러그인 | ✅ |
| `bundle` | `.jar` | OSGi 번들 | ✅ |
| `rar` | `.rar` | 리소스 어댑터 | ❌ (RAR 대신) |
| `aar` | `.aar` | Android 라이브러리 | ❌ (AAR 대신) |
| `hpi`/`jpi` | `.hpi`/`.jpi` | Jenkins 플러그인 | ❌ |
| `test-jar` | `-tests.jar` | 테스트 클래스 JAR | ✅ (classifier) |
| `javadoc` | `-javadoc.jar` | Javadoc JAR | ✅ (classifier) |
| `sources` | `-sources.jar` | 소스 JAR | ✅ (classifier) |

### 10.2 타입 결정 우선순위

패키징 타입은 다음 순서로 결정됩니다:

```
1. 의존성 선언의 <type> 태그 (명시적 지정)
2. POM의 <packaging> 태그
3. 기본값: jar
```

루트의 명시적 선택은 `metadata.type`에서 `MavenResolverOptions.artifactType`으로 전달됩니다. 루트와 전이 의존성 모두 원격 packaging이 명시한 type을 덮어쓰지 않습니다. packaging을 자동 감지하면 metadata의 파일명도 갱신하며, 다운로드 목록의 artifact key는 Maven type을 포함해 같은 GAV의 JAR와 POM을 구분합니다. `src/core/shared/maven-pom-resolution.test.ts`는 실제 resolver와 공통 병합 경로를 함께 검증합니다.

```xml
<!-- 예시: 의존성에서 type 명시 -->
<dependency>
    <groupId>org.eclipse.microprofile</groupId>
    <artifactId>microprofile-telemetry-api</artifactId>
    <version>2.1</version>
    <type>pom</type>  <!-- BOM import -->
    <scope>import</scope>
</dependency>

<!-- 예시: POM에서 packaging 선언 -->
<project>
    <packaging>war</packaging>  <!-- WAR 패키징 -->
</project>
```

### 10.3 타입별 다운로드 전략

#### 10.3.1 JAR 계열 (`jar`, `ejb`, `maven-plugin`, `bundle`)

```
다운로드 대상:
├── {artifactId}-{version}.jar       # 메인 아티팩트
├── {artifactId}-{version}.pom       # POM 파일
├── {artifactId}-{version}.jar.sha1  # JAR 체크섬
└── {artifactId}-{version}.pom.sha1  # POM 체크섬

선택적:
├── {artifactId}-{version}-sources.jar
└── {artifactId}-{version}-javadoc.jar
```

#### 10.3.2 POM Only (`pom`)

BOM(Bill of Materials) 또는 Parent POM으로, 실행 가능한 코드가 없습니다.

```
다운로드 대상:
├── {artifactId}-{version}.pom       # POM 파일만
└── {artifactId}-{version}.pom.sha1  # 체크섬
```

**주의**: JAR 다운로드를 시도하면 404 에러 발생

#### 10.3.3 WAR (`war`)

웹 애플리케이션 아카이브:

```
다운로드 대상:
├── {artifactId}-{version}.war       # WAR 파일
├── {artifactId}-{version}.pom       # POM 파일
├── {artifactId}-{version}.war.sha1  # WAR 체크섬
└── {artifactId}-{version}.pom.sha1  # POM 체크섬
```

#### 10.3.4 EAR (`ear`)

엔터프라이즈 애플리케이션 아카이브:

```
다운로드 대상:
├── {artifactId}-{version}.ear       # EAR 파일
├── {artifactId}-{version}.pom       # POM 파일
├── {artifactId}-{version}.ear.sha1  # EAR 체크섬
└── {artifactId}-{version}.pom.sha1  # POM 체크섬
```

#### 10.3.5 RAR (`rar`)

리소스 어댑터 아카이브:

```
다운로드 대상:
├── {artifactId}-{version}.rar       # RAR 파일
├── {artifactId}-{version}.pom       # POM 파일
└── 체크섬 파일들
```

#### 10.3.6 AAR (`aar`)

Android 라이브러리:

```
다운로드 대상:
├── {artifactId}-{version}.aar       # AAR 파일
├── {artifactId}-{version}.pom       # POM 파일
└── 체크섬 파일들

저장소: Google Maven (https://maven.google.com)
```

#### 10.3.7 Classifier 타입 (`test-jar`, `sources`, `javadoc`)

Classifier는 동일 좌표의 추가 아티팩트를 구분합니다:

```xml
<dependency>
    <groupId>com.example</groupId>
    <artifactId>my-lib</artifactId>
    <version>1.0</version>
    <type>test-jar</type>  <!-- 또는 classifier 사용 -->
    <classifier>tests</classifier>
</dependency>
```

```
다운로드 URL 패턴:
├── {artifactId}-{version}.jar                # 기본
├── {artifactId}-{version}-tests.jar          # test-jar (classifier=tests)
├── {artifactId}-{version}-sources.jar        # sources
└── {artifactId}-{version}-javadoc.jar        # javadoc
```

### 10.4 구현 가이드라인

#### 10.4.1 ArtifactType 정의

```typescript
// 지원하는 모든 패키징 타입
type ArtifactType =
  | 'jar'           // 기본 JAR
  | 'pom'           // POM only (BOM, parent)
  | 'war'           // 웹 애플리케이션
  | 'ear'           // 엔터프라이즈 애플리케이션
  | 'ejb'           // EJB (JAR로 다운로드)
  | 'maven-plugin'  // Maven 플러그인 (JAR로 다운로드)
  | 'bundle'        // OSGi 번들 (JAR로 다운로드)
  | 'rar'           // 리소스 어댑터
  | 'aar'           // Android 라이브러리
  | 'hpi'           // Jenkins 플러그인
  | 'test-jar'      // 테스트 JAR (classifier)
  | 'sources'       // 소스 JAR (classifier)
  | 'javadoc';      // Javadoc JAR (classifier)

// 타입별 실제 확장자 매핑
const TYPE_EXTENSION_MAP: Record<ArtifactType, string> = {
  'jar': '.jar',
  'pom': '.pom',
  'war': '.war',
  'ear': '.ear',
  'ejb': '.jar',           // EJB는 JAR 확장자
  'maven-plugin': '.jar',  // 플러그인도 JAR 확장자
  'bundle': '.jar',        // OSGi 번들도 JAR 확장자
  'rar': '.rar',
  'aar': '.aar',
  'hpi': '.hpi',
  'test-jar': '.jar',      // classifier로 구분
  'sources': '.jar',       // classifier로 구분
  'javadoc': '.jar',       // classifier로 구분
};

// Classifier 매핑
const TYPE_CLASSIFIER_MAP: Record<string, string> = {
  'test-jar': 'tests',
  'sources': 'sources',
  'javadoc': 'javadoc',
};
```

#### 10.4.2 파일명 생성 로직

```typescript
function buildFileName(
  artifactId: string,
  version: string,
  type: ArtifactType,
  classifier?: string
): string {
  const ext = TYPE_EXTENSION_MAP[type] || '.jar';
  const typeClassifier = TYPE_CLASSIFIER_MAP[type];
  const finalClassifier = classifier || typeClassifier;

  if (finalClassifier) {
    return `${artifactId}-${version}-${finalClassifier}${ext}`;
  }
  return `${artifactId}-${version}${ext}`;
}

// 예시
buildFileName('spring-core', '5.3.0', 'jar');           // spring-core-5.3.0.jar
buildFileName('spring-core', '5.3.0', 'sources');       // spring-core-5.3.0-sources.jar
buildFileName('my-app', '1.0', 'war');                  // my-app-1.0.war
buildFileName('my-ejb', '1.0', 'ejb');                  // my-ejb-1.0.jar
buildFileName('my-lib', '1.0', 'jar', 'linux-x64');     // my-lib-1.0-linux-x64.jar
```

#### 10.4.3 다운로드 로직

```typescript
async function downloadPackage(info: PackageInfo, destPath: string): Promise<string> {
  const { groupId, artifactId, version, type, classifier } = info.metadata;
  const packaging = type || 'jar';

  // POM-only 패키지 체크
  const isPomOnly = packaging === 'pom';

  // 메인 아티팩트 다운로드 (pom이 아닌 경우)
  if (!isPomOnly) {
    await downloadArtifact(groupId, artifactId, version, destPath, packaging, classifier);
    await downloadChecksumFile(groupId, artifactId, version, destPath, packaging, classifier);
  }

  // POM 파일은 항상 다운로드
  await downloadArtifact(groupId, artifactId, version, destPath, 'pom');
  await downloadChecksumFile(groupId, artifactId, version, destPath, 'pom');

  return buildFilePath(destPath, groupId, artifactId, version, packaging);
}
```

### 10.5 특수 케이스 처리

#### 10.5.1 BOM Import

BOM(Bill of Materials)은 `<type>pom</type>`과 `<scope>import</scope>`로 선언됩니다.

```xml
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-dependencies</artifactId>
            <version>3.2.0</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>
```

**처리 방법**:
- POM 파일만 다운로드
- dependencyManagement 섹션의 버전 정보를 현재 프로젝트에 병합
- 의존성 트리에는 포함하지 않음 (import scope)

#### 10.5.2 Native Classifier

플랫폼별 네이티브 라이브러리:

```xml
<dependency>
    <groupId>io.netty</groupId>
    <artifactId>netty-transport-native-epoll</artifactId>
    <version>4.1.100.Final</version>
    <classifier>linux-x86_64</classifier>
</dependency>
```

**처리 방법**:
- classifier가 포함된 파일명으로 다운로드
- 사용자가 대상 아키텍처를 선택할 수 있도록 UI 제공

**UI에서의 Classifier 선택**:

DepsSmuggler는 네이티브 라이브러리 감지 시 UI에서 사용자가 classifier를 직접 선택할 수 있도록 합니다.

1. **자동 감지**: Maven Central API를 통해 네이티브 아티팩트 여부 확인
2. **Classifier 조회**: API의 `ec` 필드에서 사용 가능한 classifier 목록 추출
3. **사용자 선택**: 드롭다운에서 대상 환경에 맞는 classifier 선택

```typescript
// IPC 핸들러 호출
const isNative = await window.electronAPI.maven.isNativeArtifact(groupId, artifactId, version);
const classifiers = await window.electronAPI.maven.getAvailableClassifiers(groupId, artifactId, version);
// ['natives-linux', 'natives-macos', 'natives-windows', ...]
```

**각 라이브러리별 Classifier 형식**:
- **LWJGL**: `natives-linux`, `natives-macos-arm64`, `natives-windows`
- **Netty**: `linux-x86_64`, `osx-aarch_64`
- **JavaCPP**: `linux-x86_64`, `macosx-arm64`, `windows-x86_64`
- **JNA**: `linux-x86-64`, `darwin-aarch64`, `win32-x86-64`

**참고**: 자동 classifier 생성이 아닌 사용자 선택 방식을 채택한 이유는 각 라이브러리마다 classifier 명명 규칙이 다르기 때문입니다.

#### 10.5.3 존재하지 않는 아티팩트 처리

일부 POM은 메인 아티팩트 없이 POM만 배포됩니다 (aggregator, parent):

```typescript
async function downloadArtifact(...): Promise<string | null> {
  try {
    // 다운로드 시도
    const response = await axios.get(url);
    // ...
  } catch (error) {
    if (error.response?.status === 404) {
      // POM-only 패키지일 가능성
      logger.info('아티팩트 없음 (POM-only 패키지)', { type, groupId, artifactId });
      return null;
    }
    throw error;
  }
}
```

---

## 11. 소스 코드 참조

### 핵심 클래스 위치 (maven-resolver)

```
maven-resolver-impl/src/main/java/org/eclipse/aether/internal/impl/collect/
├── bf/
│   ├── BfDependencyCollector.java      # BF 알고리즘 구현
│   ├── DependencyResolutionSkipper.java # Skipper 구현
│   └── DependencyProcessingContext.java # 처리 컨텍스트
├── df/
│   └── DfDependencyCollector.java      # DF 알고리즘 구현
├── DataPool.java                        # 캐시 풀
├── DefaultDependencyCollector.java      # 기본 진입점
└── DependencyCollectorDelegate.java     # 공통 로직
```

### GitHub 저장소

- https://github.com/apache/maven-resolver

---

## 12. DepsSmuggler 구현 세부사항

### 12.1 패키지 크기 조회 (병렬 HEAD 요청)

MavenResolver는 의존성 해결 후 모든 패키지의 크기를 병렬로 조회합니다.

```typescript
// MavenResolver의 fetchPackageSizes 메서드
private async fetchPackageSizes(packages: PackageInfo[]): Promise<PackageInfo[]> {
  const limit = pLimit(15); // 동시 15개 요청

  const results = await Promise.all(
    packages.map((pkg) =>
      limit(async () => {
        const [groupId, artifactId] = pkg.name.split(':');
        const type = (pkg.metadata?.type as string) || 'jar';

        // POM-only 패키지는 pom 파일 크기 조회
        const extension = type === 'pom' ? 'pom' : 'jar';
        const url = `${repoUrl}/${groupPath}/${artifactId}/${version}/${fileName}.${extension}`;

        const response = await axios.head(url, { timeout: 5000 });
        const size = parseInt(response.headers['content-length'] || '0', 10);

        return { ...pkg, metadata: { ...pkg.metadata, size } };
      })
    )
  );

  return results;
}
```

**특징**:
- `p-limit`으로 동시 요청 15개 제한
- HEAD 요청으로 `Content-Length` 헤더에서 크기 추출
- POM-only 패키지는 `.pom` 파일 크기 조회
- 조회 실패 시 크기를 0으로 설정 (다운로드에는 영향 없음)
- `totalSize` 계산하여 결과에 포함
- 현재 크기 조회는 기본 Maven Central URL과 `pom`/`jar` 확장자만 사용합니다. classifier·WAR 등 다른 확장자·사용자 지정 저장소를 반영한 정밀 크기 보장은 없으며 실제 파일 다운로드 선택과 구분해야 합니다.

### 12.2 Parent POM / BOM의 dependencyManagement 처리

**중요**: Parent POM이나 BOM(Bill of Materials)의 `<dependencyManagement>` 섹션은 **버전 관리 전용**입니다. 실제 다운로드 대상 의존성으로 처리하면 안 됩니다.

```typescript
// src/core/shared/maven-pom-utils.ts의 공용 함수
export function extractDependencies(
  pom: PomProject,
  coordinate: MavenCoordinate,
  isRoot = false,
): PomDependency[] {
  // 실제 <dependencies> 섹션만 반환
  const deps = pom.dependencies?.dependency;
  if (deps) {
    return Array.isArray(deps) ? deps : [deps];
  }

  // <dependencies>가 없으면 빈 배열 반환
  // dependencyManagement의 630개 이상 항목을 모두 다운로드하면
  // 스택 오버플로우 및 불필요한 다운로드 발생
  if (isRoot && pom.packaging === 'pom') {
    logger.info(`Parent/BOM POM 감지: ${coordinateToString(coordinate)} - 실제 의존성 없음`);
  }

  return [];
}
```

**이유**:
- Spring Boot BOM 같은 패키지는 `dependencyManagement`에 600개 이상의 항목을 포함
- 이를 모두 의존성으로 처리하면 불필요한 다운로드 및 메모리 문제 발생
- `dependencyManagement`는 버전 해결용으로만 사용

### 12.3 오프라인 출력에 필요한 Parent POM과 import BOM

Parent POM이나 import BOM을 읽어 버전을 해결했더라도, 조회 캐시에만 저장하면 전달할 출력물에는 포함되지 않습니다. 예를 들어 `org.apache.flink:flink-streaming-java:1.20.5`의 `flink-core → flink-core-api → flink-metrics-core` 경로를 해결할 때 `flink-metrics-core`의 부모인 `org.apache.flink:flink-metrics:1.20.5`가 필요합니다. 이전에는 이 부모를 읽고도 다운로드 목록에 추가하지 않아, JAR와 각 JAR 자신의 POM을 복사한 폐쇄망 환경에서 부모 POM이 누락될 수 있었습니다.

현재 resolver는 다음과 같이 모델 POM을 다운로드 목록에 포함합니다.

1. 루트와 선택된 전이 의존성에서 부모 체인 및 import BOM을 수집합니다. BOM의 부모와 중첩 import도 따라갑니다.
2. 모델 POM은 `groupId:artifactId:version` 전체 좌표로 중복 제거합니다. 같은 GA의 서로 다른 버전은 각각 보존합니다.
3. 수집한 모델을 `metadata.type: 'pom'`으로 `flatList`에 추가합니다. 같은 GAV의 JAR 항목도 필요하면 별개로 유지합니다.
4. 실제 라이브러리는 `<dependencies>`와 기존 scope·optional·최대 깊이 설정에 따라 선택합니다. 사용하지 않는 `dependencyManagement` 라이브러리를 실행 의존성 그래프에 추가하지 않습니다.

화면에서도 이 구분을 유지합니다. 다운로드 표는 루트별 `flatList`를 기준으로 그룹을 연결하여 실행 그래프에 없는 모델 POM을 표시하고, 장바구니 미리보기는 이를 `함께 다운로드할 POM` 목록으로 보여줍니다. 원본 항목과 다운로드 파일의 연결은 GAV 외에도 artifact type과 classifier를 구분합니다. 따라서 전체 다운로드 개수에 포함된 POM이 트리 기반 화면에서 누락되지 않으며, 표시 때문에 실행 의존성 그래프를 바꾸지 않습니다.

전이 패키지별 관리 버전은 루트 관리 맵을 복사한 문맥에서 해결합니다. 루트가 지정한 관리 버전을 유지하면서, 형제 패키지 A의 미사용 관리 버전이 패키지 B의 부모/BOM이 정한 버전에 섞이지 않도록 합니다. 모델 POM 파일 수집은 이 관리 문맥과 별도로 요청 전체에 유지합니다.

Parent/BOM 탐색과 그래프 평탄화는 명시적인 작업 목록을 사용하는 반복 방식입니다. 깊은 체인으로 호출 스택이 넘치지 않으며 Parent/BOM의 순환 참조를 오류로 보고합니다. 필요한 모델을 가져오지 못하거나 좌표를 해결하지 못한 경우도 해당 루트의 해결 실패로 처리합니다. 이미 가져온 일부 모델만으로 성공 결과를 반환하지 않습니다. 모델 조회 이후의 실제 POM 파일 다운로드도 필수이며, 일반 JAR의 부속 POM 저장이 실패해도 그 패키지 다운로드는 실패합니다. SHA1 파일은 선택 사항입니다.

Electron 출력의 `packages/m2repo/`에는 Maven 저장소 구조를 유지합니다. 각 일반 JAR의 부속 POM은 그 저장소 경로에 저장되고, 별도 모델 항목으로 수집한 부모/BOM은 `.pom`이 주 아티팩트이므로 최상위 `packages/`에도 `.pom` 복사본이 생성됩니다. 최상위 폴더만 보고 모든 JAR의 부속 POM이 없다고 판단하지 않아야 합니다. 자세한 경로는 [Downloaders](downloaders.md)의 Maven 출력 설명을 참고하세요.

회귀 검증은 Parent/BOM의 깊은 체인·순환·중복·조회 실패와 실제 라이브러리 의존성 보존을 확인하고, HTTP 응답 fixture를 거쳐 실제 다운로더가 기록한 POM/JAR 파일을 검사합니다. 외부 Maven Central 검증은 이 fixture 검증과 구분합니다. 실행 진입점과 테스트 파일은 [테스트 문서](testing.md)의 Maven 모델 POM 검증 절에 정리합니다.

### 12.4 POM-only 패키지의 packaging 타입 조회

Search API는 BOM 같은 POM-only 패키지의 `packaging` 정보를 제대로 반환하지 않습니다. 따라서 POM 파일을 직접 조회하여 패키징 타입을 확인합니다.

```typescript
// MavenDownloader의 downloadPackage 메서드
if (!packaging) {
  try {
    const pomUrl = this.buildDownloadUrl(groupId, artifactId, version, 'pom');
    const pomResponse = await this.client.get<string>(pomUrl);
    const pomXml = pomResponse.data;

    // POM에서 <packaging> 태그 파싱
    const packagingMatch = pomXml.match(/<packaging>([^<]+)<\/packaging>/);
    packaging = packagingMatch ? packagingMatch[1].trim() : 'jar';
  } catch {
    packaging = 'jar'; // 조회 실패 시 기본값
  }
}
```

**적용 시점**: `downloadPackage` 호출 시 `metadata.packaging`과 `metadata.type`이 모두 없는 경우. 아래 예시의 `packaging` 변수는 두 필드의 우선순위를 먼저 적용한 값입니다.

## 13. 요청 단위 POM·버전 조회 재사용

여러 Maven 직접 루트를 하나의 `resolveAllDependencies()` 요청으로 처리하면
공통 전이 좌표의 원시 POM/BOM 조회·파싱과 최신 버전 metadata 조회를 재사용합니다.
POM key는 실제 적용 저장소 URL(설정된 cache option의 저장소 URL이 있으면 그 값)과
`groupId:artifactId:version`으로 구성됩니다. 버전 조회는 같은 실제 저장소 URL과
`groupId:artifactId`를 사용합니다.

병렬 POM prefetch와 이후의 일반 POM 조회도 같은 요청 세션의 producer를
사용하므로 동시에 발생해도 중복 원격 요청을 만들지 않습니다. prefetch 오류는
기존처럼 best-effort로 처리하고, 실패·빈 결과는 저장하지 않아 후속 실제 조회나
다음 직접 루트가 재시도할 수 있습니다. 각 consumer에는 복제한 POM snapshot이
전달됩니다.

classifier/type 기반 artifact 선택, scope·exclusion, parent/BOM의
dependencyManagement 적용과 각 루트의 dependency tree는 재사용하지 않습니다.
따라서 metadata를 절약하면서도 기존 Maven 간선 및 최종 다운로드 선택 규칙을
유지하며, 요청이 끝나면 세션도 폐기됩니다.
