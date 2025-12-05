# npm 의존성 해결 알고리즘 분석

## 1. 개요

npm의 `npm install` 실행 시 의존성 해결은 **Arborist** (`@npmcli/arborist`) 모듈이 담당합니다. npm v7부터 도입된 Arborist는 의존성 트리 관리의 핵심 엔진으로, 이전 버전들의 문제점을 해결하기 위해 완전히 재설계되었습니다.

### 참고 자료
- [npm/arborist GitHub](https://github.com/npm/arborist)
- [npm v7 Series - Arborist Deep Dive](https://blog.npmjs.org/post/618653678433435649/npm-v7-series-arborist-deep-dive.html)
- [npm CLI GitHub](https://github.com/npm/cli)
- [PeerSpin 연구 논문 (arXiv)](https://arxiv.org/html/2505.12676v2)

---

## 2. npm 의존성 모델의 핵심 개념

### 2.1 Node와 Edge

npm은 의존성 관계를 **그래프**로 모델링합니다:

| 개념 | 설명 |
|------|------|
| **Node** | 특정 패키지 버전을 나타내는 노드 (예: `react@18.2.0`) |
| **Link** | 심볼릭 링크된 패키지 (workspace 등) |
| **Edge** | 두 노드 간의 의존성 관계 |

```javascript
// Edge 구조
{
  from: Node,      // 의존하는 패키지
  to: Node,        // 의존되는 패키지
  type: string,    // 'prod', 'dev', 'peer', 'peerOptional', 'optional'
  spec: string,    // 버전 요구사항 (예: "^1.0.0")
  valid: boolean   // 현재 만족 여부
}
```

### 2.2 Node Tree vs Node Graph

| 구조 | 설명 |
|------|------|
| **Node Graph** | 패키지 간 의존성 관계 (방향 그래프, 사이클 가능) |
| **Node Tree** | 실제 `node_modules` 디렉토리 구조 |

npm의 핵심 역할: **Node Graph를 올바른 Node Tree로 변환**

### 2.3 의존성 유형

```javascript
// package.json
{
  "dependencies": { },         // 런타임 의존성
  "devDependencies": { },      // 개발 의존성
  "peerDependencies": { },     // 피어 의존성 (호스트가 설치)
  "peerDependenciesMeta": { }, // 피어 의존성 메타 (optional 등)
  "optionalDependencies": { }, // 선택적 의존성 (실패해도 OK)
  "bundleDependencies": [ ]    // 번들 의존성 (함께 패키징)
}
```

---

## 3. Arborist 아키텍처

### 3.1 주요 메서드

```javascript
const Arborist = require('@npmcli/arborist')
const arb = new Arborist({ path: '/path/to/project' })

// 실제 node_modules 트리 로드
await arb.loadActual()

// package-lock.json에서 가상 트리 로드
await arb.loadVirtual()

// 이상적인(ideal) 트리 계산
await arb.buildIdealTree({ add, rm, update })

// 이상적인 트리를 실제로 설치
await arb.reify()

// 보안 취약점 검사 및 수정
await arb.audit({ fix: true })
```

### 3.2 트리 빌딩 프로세스

```
1. loadVirtual() - package-lock.json 로드
      ↓
2. buildIdealTree() - 이상적인 트리 계산
      ↓
3. reify() - 실제 설치 수행
```

---

## 4. 핵심 알고리즘: buildIdealTree

### 4.1 전체 흐름

```javascript
async buildIdealTree(options) {
  // 1. 초기 트리 로드
  await this.#initTree()

  // 2. 오래된 lockfile 업그레이드
  await this.#inflateAncientLockfile()

  // 3. 사용자 요청 적용 (add, rm, update)
  await this.#applyUserRequests(options)

  // 4. 의존성 빌드 (핵심!)
  await this.#buildDeps()

  // 5. 의존성 플래그 수정
  await this.#fixDepFlags()

  // 6. 실패한 optional 의존성 정리
  await this.#pruneFailedOptional()

  // 7. 엔진/플랫폼 검사
  await this.#checkEngineAndPlatform()
}
```

### 4.2 DepsQueue - 너비 우선 탐색

npm은 **너비 우선 탐색(BFS)**을 사용합니다:

```javascript
// 깊이가 얕은 노드를 먼저 처리 (알파벳 순 정렬)
class DepsQueue {
  #deps = []
  #sorted = true

  push(item) {
    if (!this.#deps.includes(item)) {
      this.#sorted = false
      this.#deps.push(item)
    }
  }

  pop() {
    if (!this.#sorted) {
      // 깊이 순, 그 다음 경로 알파벳 순 정렬
      this.#deps.sort((a, b) =>
        (a.depth - b.depth) || localeCompare(a.path, b.path)
      )
      this.#sorted = true
    }
    return this.#deps.shift()
  }
}
```

### 4.3 buildDepStep - 의존성 처리 루프

```javascript
async #buildDepStep() {
  // 큐가 빌 때까지 반복
  if (!this.#depsQueue.length) {
    return this.#resolveLinks()
  }

  const node = this.#depsQueue.pop()

  // 이미 방문했거나, 트리에서 제거됐으면 스킵
  if (this.#depsSeen.has(node) || node.root !== this.idealTree) {
    return this.#buildDepStep()
  }

  this.#depsSeen.add(node)

  // 문제가 있는 엣지들 처리
  for (const edge of this.#problemEdges(node)) {
    // 1. Virtual Root 생성 (peer deps 해결용)
    const virtualRoot = this.#virtualRoot(source, true)

    // 2. Edge에서 Node 생성
    const dep = await this.#nodeFromEdge(edge, parent, null, required)

    // 3. PlaceDep으로 배치
    const pd = new PlaceDep({ edge, dep, ... })
  }

  return this.#buildDepStep()
}
```

---

## 5. 노드 배치 알고리즘 (Hoisting)

### 5.1 Maximally Naive Deduplication

npm v3부터 사용된 알고리즘으로, 의존성을 가능한 **가장 얕은 위치**에 배치합니다:

```
목표: 중복을 최소화하면서 올바른 의존성 해결

root -> (a@1, b@1||2)
a -> (b@1)

결과 트리:
root
├── a@1
│   └── b@1    ← a가 필요로 하는 b@1은 중첩
└── b@2        ← root가 직접 의존하는 b@2는 상위에
```

### 5.2 배치 가능 여부 검사 (canPlace)

각 위치에서 배치 가능 여부를 검사합니다:

```javascript
// can-place-dep.js의 결과값
const PlacementResult = {
  OK: 'OK',           // 배치 가능
  KEEP: 'KEEP',       // 기존 버전 유지
  REPLACE: 'REPLACE', // 기존 버전 교체
  CONFLICT: 'CONFLICT' // 충돌 - 이 위치에 배치 불가
}
```

### 5.3 배치 알고리즘 상세

```
의존성 dep를 edge를 만족시키기 위해 배치하려면:

1. edge가 이미 유효하고 update 대상이 아니면 → 배치하지 않음

2. 시작 위치 결정:
   - peer dep이면 → node.parent에서 시작
   - 일반 dep이면 → node에서 시작

3. 루트까지 올라가며 각 위치 검사:
   while (target != null) {
     result = canPlace(dep, target)
     if (result == CONFLICT) break
     lastValidTarget = target
     target = target.parent
   }

4. 마지막 유효 위치에 배치:
   - KEEP → 아무것도 하지 않음
   - OK → dep.parent = target
   - REPLACE → 기존 노드 교체, 영향받는 노드 정리

5. peer deps 처리:
   for (peerDep of dep.peerDependencies) {
     PLACE(peerDep)
   }
```

### 5.4 canPlace 상세 로직

```javascript
function canPlace(dep, target) {
  const existing = target.children.get(dep.name)

  if (existing) {
    // 1. 같은 버전이면 → KEEP
    if (existing.version === dep.version) return KEEP

    // 2. target이 루트면 → REPLACE (peers 배치 가능시)
    if (target.isRoot) return canPlacePeers() ? REPLACE : CONFLICT

    // 3. target의 edge가 dep를 만족하지 않으면 → CONFLICT
    if (!target.edgesOut.get(dep.name)?.satisfiedBy(dep)) return CONFLICT

    // 4. 기존 버전보다 새 버전이 높으면 → REPLACE
    if (semver.gt(dep.version, existing.version)) {
      return canPlacePeers() ? REPLACE : CONFLICT
    }

    // 5. preferDedupe 옵션이면 → KEEP
    if (preferDedupe && existing.satisfies(edge)) return KEEP

    return CONFLICT
  } else {
    // 자식이 없는 경우

    // 1. target이 dep.name에 대한 의존성이 있고 dep가 만족하지 않으면 → CONFLICT
    if (target.edgesOut.has(dep.name) && !edge.satisfiedBy(dep)) {
      return CONFLICT
    }

    // 2. 하위 노드가 상위에서 해결되는 의존성을 가리게 되면 → CONFLICT
    for (descendant of target.descendants) {
      if (descendant.edgesOut.get(dep.name)?.to?.depth < target.depth) {
        if (!descendant.edgesOut.get(dep.name).satisfiedBy(dep)) {
          return CONFLICT
        }
      }
    }

    return OK
  }
}
```

---

## 6. Peer Dependencies 처리

### 6.1 npm v7+ 자동 설치

npm v7부터 peer dependencies가 자동으로 설치됩니다:

```javascript
// peer deps는 PeerSet으로 함께 처리
async #loadPeerSet(node, required) {
  const peerEdges = [...node.edgesOut.values()]
    .filter(e => e.peer && !(e.valid && e.to))
    .sort(({ name: a }, { name: b }) => localeCompare(a, b))

  for (const edge of peerEdges) {
    if (!edge.to) {
      // peer dep가 없으면 설치
      await this.#nodeFromEdge(edge, node.parent, null, required)
    } else if (!edge.valid) {
      // 있지만 버전이 맞지 않으면 교체 시도
      const dep = await this.#nodeFromEdge(edge, null, null, required)
      if (dep.canReplace(edge.to)) {
        await this.#nodeFromEdge(edge, node.parent, null, required)
      }
    }
  }
  return node
}
```

### 6.2 PeerSpin 문제

peer dependencies 간 충돌로 인한 무한 루프 문제:

```
PeerSpin 발생 조건:
1. 노드 교체가 발생
2. 교체로 인해 PeerSource나 PeerEntry의 의존성이 깨짐
3. 깨진 의존성 복구 시도로 또 다른 노드 교체 발생
4. 1-3이 무한 반복

예시:
A -> B@2.0.0 (regular)
B@2.0.0 -> C@1.0.0 (peer)
C@1.0.0 -> B@1.0.0 (peer)

→ B@1.0.0과 B@2.0.0이 서로를 계속 교체
```

### 6.3 PeerSpin 패턴

**패턴 A: Peer-to-Regular 충돌**
```
A --(regular)--> B₁
B₁ --(peer, indirect)--> B₂ (다른 버전)
→ B₁과 B₂가 서로 교체
```

**패턴 B: Peer-to-Peer 충돌**
```
A --(regular)--> B
B --(peer)--> C@2.0.0
B --(peer, via D)--> C@1.0.0
→ C@1.0.0과 C@2.0.0이 서로 교체
```

---

## 7. 설치 전략 (Install Strategy)

### 7.1 hoisted (기본값)

```bash
npm install --install-strategy=hoisted
```

가능한 가장 상위에 패키지를 배치하여 중복 최소화:

```
node_modules/
├── a/
├── b/
└── c/
    └── node_modules/
        └── b/  ← 충돌하는 버전만 중첩
```

### 7.2 nested (legacy)

```bash
npm install --install-strategy=nested
# 또는
npm install --legacy-bundling
```

npm v1-v2 스타일, 각 패키지가 자신의 의존성을 가짐:

```
node_modules/
├── a/
│   └── node_modules/
│       └── b/
└── c/
    └── node_modules/
        └── b/
```

### 7.3 shallow (global)

```bash
npm install -g
```

전역 설치 시 사용, 최상위에만 패키지 배치.

---

## 8. 버전 해결 규칙

### 8.1 Semver 범위

```javascript
// 허용되는 버전 범위 예시
"^1.2.3"   // >= 1.2.3 < 2.0.0
"~1.2.3"   // >= 1.2.3 < 1.3.0
"1.2.x"    // >= 1.2.0 < 1.3.0
">=1.2.3"  // >= 1.2.3
"1.2.3 - 2.0.0" // >= 1.2.3 <= 2.0.0
"*"        // 모든 버전
```

### 8.2 버전 선택 우선순위

1. **package-lock.json에 명시된 버전** (있는 경우)
2. **이미 설치된 버전** (만족하면)
3. **가장 높은 만족 버전** (기본 동작)
4. **preferDedupe 시 중복 최소화 버전**

### 8.3 충돌 해결

```
동일 패키지의 다른 버전이 필요한 경우:

1. 상위에서 해결 가능하면 → 하나만 설치 (hoisting)
2. 호환 불가능하면 → 각각 중첩 설치
3. peer dep 충돌이면 → ERESOLVE 에러 또는 강제 설치
```

---

## 9. package-lock.json

### 9.1 역할

- **재현 가능한 설치**: 정확한 버전 고정
- **빠른 설치**: 버전 해결 스킵 가능
- **보안**: integrity 해시로 무결성 검증

### 9.2 lockfile 버전

| 버전 | npm 버전 | 특징 |
|------|---------|------|
| v1 | npm v5-v6 | 기본 메타데이터 |
| v2 | npm v7+ | node_modules 구조 포함 |
| v3 | npm v7+ | v2와 호환, 이전 버전 무시 가능 |

### 9.3 lockfile 우선순위

```javascript
// npm ci vs npm install
npm ci       // package-lock.json 엄격 준수
npm install  // package.json 기준, lockfile 업데이트 가능
```

---

## 10. 옵션 및 설정

### 10.1 설치 관련 옵션

```bash
# 의존성 유형 제어
npm install --omit=dev          # devDependencies 제외
npm install --include=optional  # optionalDependencies 포함

# peer deps 처리
npm install --legacy-peer-deps  # peer deps 자동설치 비활성화
npm install --strict-peer-deps  # peer 충돌 시 에러
npm install --force             # 모든 충돌 무시

# 중복 제거
npm install --prefer-dedupe     # 최신 버전보다 중복 제거 우선

# 설치 전략
npm install --install-strategy=hoisted|nested|shallow
```

### 10.2 .npmrc 설정

```ini
# ~/.npmrc 또는 프로젝트/.npmrc
legacy-peer-deps=true
strict-peer-deps=false
prefer-dedupe=false
install-strategy=hoisted
```

---

## 11. 성능 특성

### 11.1 npm install vs npm ci

| 명령 | 용도 | 속도 | lockfile |
|------|------|------|----------|
| `npm install` | 개발 | 느림 | 업데이트 가능 |
| `npm ci` | CI/CD | 빠름 | 엄격 준수 |

### 11.2 캐싱

```bash
# 캐시 위치
~/.npm/_cacache/

# 캐시 검증
npm cache verify

# 캐시 정리
npm cache clean --force
```

---

## 12. DepsSmuggler 구현 시 고려사항

### 12.1 npm Registry API

```bash
# 패키지 메타데이터
GET https://registry.npmjs.org/{package}

# 특정 버전
GET https://registry.npmjs.org/{package}/{version}

# tarball
GET https://registry.npmjs.org/{package}/-/{package}-{version}.tgz
```

### 12.2 구현 권장사항

1. **BFS 탐색**: 깊이가 얕은 의존성 먼저 처리
2. **Hoisting 적용**: 가능한 상위에 패키지 배치
3. **Peer Deps 처리**: PeerSet 단위로 함께 처리
4. **버전 캐싱**: 같은 패키지의 메타데이터 재사용
5. **Lockfile 활용**: 있으면 버전 해결 스킵

### 12.3 다운로드 대상 파일

| 파일 유형 | URL 패턴 |
|----------|---------|
| Tarball | `registry.npmjs.org/{pkg}/-/{pkg}-{ver}.tgz` |
| Package.json | tarball 내 `package/package.json` |
| Integrity | packument의 `dist.integrity` 필드 |

### 12.4 오프라인 미러 구조

```
offline-mirror/
├── registry.npmjs.org/
│   ├── react/
│   │   ├── index.json          # packument
│   │   └── -/
│   │       └── react-18.2.0.tgz
│   └── lodash/
│       ├── index.json
│       └── -/
│           └── lodash-4.17.21.tgz
└── package-lock.json           # 선택적
```

---

## 13. 소스 코드 참조

### 핵심 파일 위치 (npm/cli)

```
workspaces/arborist/
├── lib/
│   ├── arborist/
│   │   ├── build-ideal-tree.js  # 이상적 트리 빌드 알고리즘
│   │   ├── reify.js             # 실제 설치 수행
│   │   └── load-*.js            # 트리 로딩
│   ├── node.js                  # Node 클래스
│   ├── link.js                  # Link 클래스 (심볼릭 링크)
│   ├── edge.js                  # Edge 클래스 (의존성 관계)
│   ├── place-dep.js             # 의존성 배치 로직
│   ├── can-place-dep.js         # 배치 가능 여부 검사
│   └── shrinkwrap.js            # lockfile 처리
└── docs/
    └── ideal-tree.md            # 알고리즘 문서
```

### GitHub 저장소

- https://github.com/npm/cli
- https://github.com/npm/arborist (npm/cli에 통합됨)
