# Maven 의존성 해결 알고리즘 분석

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

## 10. 소스 코드 참조

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
