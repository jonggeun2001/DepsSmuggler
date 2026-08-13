# 요청 단위 의존성 탐색 재사용 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 하나의 `resolveAllDependencies()` 요청에서 공통 라이브러리 의존성의 후보 선택과 원격 metadata 조회를 한 번만 수행하고, 기존 트리와 실패 의미를 보존한다.

**Architecture:** `ResolutionSession`은 resolver 종류·작업 종류·안정 직렬화 문맥으로 canonical Promise를 관리하고 consumer마다 복제한 snapshot을 반환한다. 공통 resolver는 매 호출마다 세션과 요청 전용 pip/conda/Maven/npm resolver를 만들며, resolver는 원격 후보/manifest 조회만 세션화한다. extras·scope/exclusion·peer/hoisting의 부모 간선 평가는 기존처럼 직접 루트별로 수행한다.

**Tech Stack:** TypeScript, Node.js `structuredClone`, Vitest, 기존 PyPI/Conda/Maven/npm cache 모듈

---

## 파일 구조

| 파일 | 책임 |
| --- | --- |
| `src/core/shared/internal/resolution-session.ts` | 내부 요청 수명 memoizer, namespace key, clone-on-read, hit/miss 통계 |
| `src/core/shared/internal/resolution-session.test.ts` | 내부 세션의 동시성·실패·키·불변성 계약 |
| `src/core/resolver/{pip,conda,maven,npm}-resolver.ts` | 요청 전용 factory 및 resolver별 session 적용 |
| `src/core/shared/npm-version-resolver.ts` | npm packument/후보 선택 session 적용 |
| `src/core/shared/dependency-resolver.ts` | 세션·요청 전용 resolver 묶음 생성과 통계 로그 |
| 기존 resolver 테스트 | 공통 전이 의존성 재사용, 키 격리, 재시도 회귀 |
| `docs/shared-dependency.md`, `docs/resolvers.md`, 유형별 문서 | 재사용 범위·비범위·검증 방법 |

### Task 1: `ResolutionSession`의 공통 계약을 TDD로 만든다

**Files:**

- Create: `src/core/shared/internal/resolution-session.ts`
- Create: `src/core/shared/internal/resolution-session.test.ts`

- [ ] **Step 1: 실패하는 세션 단위 테스트를 작성한다.**

`internal/resolution-session.test.ts`에 다음을 각각 독립 테스트로 추가한다.

```ts
it('동일 resolver·operation·문맥의 in-flight producer를 한 번만 실행한다', async () => {
  let release!: (value: { value: string }) => void;
  const pending = new Promise<{ value: string }>((resolve) => { release = resolve; });
  const producer = vi.fn(() => pending);
  const session = new ResolutionSession();

  const first = session.getOrCreate('pip', 'package-info', { name: 'shared' }, producer);
  const second = session.getOrCreate('pip', 'package-info', { name: 'shared' }, producer);
  release({ value: 'ok' });

  await expect(Promise.all([first, second])).resolves.toEqual([{ value: 'ok' }, { value: 'ok' }]);
  expect(producer).toHaveBeenCalledTimes(1);
});

it('각 consumer에 clone-on-read snapshot을 반환한다', async () => {
  // 첫 반환값의 중첩 속성을 수정해도 두 번째 반환값은 원래 값을 유지해야 한다.
});

it.each([
  ['pip', 'latest-version'],
  ['pip', 'package-info'],
  ['npm', 'package-info'],
])('resolver와 operation namespace가 다르면 값을 섞지 않는다', async (resolver, operation) => {
  // 같은 name 문맥이어도 producer가 각각 실행되는지 검증한다.
});

it('객체 키 순서가 다른 동등 문맥을 같은 key로 정규화한다', async () => {
  // target object의 key 순서만 다른 두 context를 사용한다.
});

it('reject·null·빈 후보는 저장하지 않고 다음 조회에서 재시도한다', async () => {
  // null/빈 문자열은 isCacheable: Boolean과 함께 호출해 두 번째 producer 실행을 검증한다.
});
```

`getStats()`가 miss/hit/in-flight join을 올바르게 집계하는 테스트도 추가한다.

- [ ] **Step 2: 테스트가 기능 부재로 실패하는지 확인한다.**

Run: `npx vitest run src/core/shared/internal/resolution-session.test.ts`

Expected: FAIL — 내부 `resolution-session` 모듈을 찾지 못한다.

- [ ] **Step 3: 최소 세션 구현을 작성한다.**

`internal/resolution-session.ts`에 내부 API를 만든다. `src/core/shared/index.ts` 또는 `src/core/index.ts`에는 export하지 않는다.

```ts
export type ResolutionOperation = 'latest-version' | 'package-info' | 'packument' | 'pom';

export class ResolutionSession {
  getOrCreate<T>(
    resolver: 'pip' | 'conda' | 'maven' | 'npm',
    operation: ResolutionOperation,
    context: Record<string, unknown>,
    producer: () => Promise<T>,
    options?: { isCacheable?: (value: T) => boolean },
  ): Promise<T>;
  getStats(): { hits: number; misses: number; joins: number };
}
```

`stableSerialize()`는 object key를 재귀 정렬하고 `undefined`를 일관되게 표현한다. map에는 canonical producer Promise만 저장한다. 새 항목은 `Promise.resolve().then(producer)`로 등록한다. reject 또는 `isCacheable(value) === false`일 때는 **map에 같은 Promise가 남아 있을 때만** 제거한다. 반환은 항상 `canonical.then((value) => structuredClone(value))`여야 한다. 기본 cacheable 규칙은 `value !== null && value !== undefined`; 후보 선택 caller는 `Boolean(value)` predicate를 전달해 빈 문자열도 제거한다. 복제 불가능한 값을 공유하지 말고 오류를 전파한다.

세션은 `resolveAllDependencies()`와 resolver module 내부 factory만 import한다. `ResolverOptions`에 session 필드를 추가하거나 public resolver constructor에 session 인자를 추가하지 않는다. 외부 호출 경로는 요청 session을 전달·보존할 수 없다.

- [ ] **Step 4: 세션 단위 테스트가 통과하는지 확인한다.**

Run: `npx vitest run src/core/shared/internal/resolution-session.test.ts`

Expected: PASS — producer 1회, snapshot 격리, namespace 분리, reject/null/empty 재시도가 확인된다.

- [ ] **Step 5: 첫 단위를 커밋한다.**

```bash
git add src/core/shared/internal/resolution-session.ts src/core/shared/internal/resolution-session.test.ts
git commit -m "feat: 요청 단위 의존성 세션 추가"
```

### Task 2: 요청 전용 resolver factory와 요청 격리를 추가한다

**Files:**

- Modify: `src/core/resolver/pip-resolver.ts`
- Modify: `src/core/resolver/conda-resolver.ts`
- Modify: `src/core/resolver/maven-resolver.ts`
- Modify: `src/core/resolver/npm-resolver.ts`
- Modify: `src/core/shared/dependency-resolver.ts`
- Modify: `src/core/shared/dependency-resolver.test.ts`

- [ ] **Step 1: factory 사용과 동시 요청 격리의 실패 테스트를 작성한다.**

기존 `dependency-resolver.test.ts` module mock에 `createRequestPipResolver`, `createRequestCondaResolver`, `createRequestMavenResolver`, `createRequestNpmResolver`를 추가한다. pip root 두 개의 같은 요청은 `createRequestPipResolver` 1회와 해당 resolver의 `resolveDependencies` 2회를 기대한다. linux/arm64와 windows/x86_64의 `resolveAllDependencies()`를 동시에 실행해 서로 다른 factory 반환값과 resolver options가 섞이지 않는지 검증한다. Pip/Maven resolver 단위 테스트에는 singleton의 `setCacheOptions()` 이후 factory 결과가 같은 값을 복사하고 factory resolver 변경이 singleton에 역전파되지 않는 검증을 추가한다.

- [ ] **Step 2: 테스트가 기존 singleton 흐름 때문에 실패하는지 확인한다.**

Run: `npx vitest run src/core/shared/dependency-resolver.test.ts src/core/resolver/pip-resolver.test.ts src/core/resolver/maven-resolver.test.ts`

Expected: FAIL — 요청 factory export가 없거나 `getPipResolver()` singleton이 호출된다.

- [ ] **Step 3: 요청 전용 factory를 최소 구현한다.**

각 library resolver module에는 `/** @internal */`로 표시하고 public barrel에서는 re-export하지 않는 `createRequest*Resolver(session)` helper를 추가한다. Factory는 매번 새 instance를 만든다. session은 public constructor/`ResolverOptions`가 아니라 module-private `WeakMap<Resolver, ResolutionSession>`에 factory가 연결하고 resolver의 private accessor만 읽는다.

```ts
/** @internal dependency-resolver 전용 factory */
export function createRequestPipResolver(session: ResolutionSession): PipResolver {
  const resolver = new PipResolver();
  requestSessions.set(resolver, session);
  resolver.setCacheOptions(getPipResolver().getCacheOptions());
  return resolver;
}
```

Pip/Maven에는 `getCacheOptions()`를 추가해 `{ ...this.cacheOptions }` 복사본을 반환한다. Conda/Npm도 매번 새 resolver를 반환한다. Factory와 `ResolutionSession`은 `src/core/index.ts`와 public shared barrel에 export하지 않으며, `dependency-resolver.ts`만 이 internal module path를 사용한다. 기존 singleton accessor와 public constructor는 session 없는 동작을 유지한다.

`dependency-resolver.ts`에서는 함수 시작 시 session과 library resolver 묶음을 한 번 생성한다. `getResolverByType`은 OS/Docker 특수 경로를 건드리지 않고 pip/conda/Maven/npm만 묶음에서 반환한다. 종료 시 hit이 1 이상일 때만 hit/miss/join 통계를 `logger.info`로 남긴다. `includeDependencies: false` 조기 반환은 세션/factory를 만들지 않는다.

- [ ] **Step 4: factory·동시 요청 테스트를 통과시킨다.**

Run: `npx vitest run src/core/shared/dependency-resolver.test.ts src/core/resolver/pip-resolver.test.ts src/core/resolver/maven-resolver.test.ts`

Expected: PASS — 타입당 요청 factory 1회, 요청 간 상태 분리, cache option snapshot을 확인한다.

- [ ] **Step 5: 두 번째 단위를 커밋한다.**

```bash
git add src/core/shared/dependency-resolver.ts src/core/shared/dependency-resolver.test.ts src/core/resolver/pip-resolver.ts src/core/resolver/pip-resolver.test.ts src/core/resolver/conda-resolver.ts src/core/resolver/maven-resolver.ts src/core/resolver/maven-resolver.test.ts src/core/resolver/npm-resolver.ts
git commit -m "feat: 의존성 요청별 resolver 상태 격리"
```

### Task 3: pip 후보와 artifact metadata 조회를 세션화한다

**Files:**

- Modify: `src/core/resolver/pip-resolver.ts`
- Modify: `src/core/resolver/pip-resolver-download.test.ts`

- [ ] **Step 1: 공통 전이 pip 의존성 재사용의 실패 테스트를 작성한다.**

두 직접 root `alpha`와 `beta`가 `shared>=1`을 요구하도록 PyPI JSON mock을 구성한다. 하나의 내부 `ResolutionSession`을 factory로 연결한 별도 resolver 두 개를 순차 실행하고 `shared`의 release lookup과 exact artifact metadata lookup이 각각 1회인지 검증한다. Simple API와 JSON 경로를 모두 포함한다. 다른 `indexUrl`, Python 버전 또는 `skipDependencyExpansion`의 source-artifact 검증 모드에서는 shared 조회가 재사용되지 않는 테스트도 작성한다. `Shared_Pkg`, `shared-pkg`, `shared.pkg`가 PEP 503 canonical name 하나로 재사용되는 테스트와 첫 호출의 null/empty 후보 또는 reject 뒤 두 번째 root가 producer를 다시 호출하는 테스트를 추가한다.

- [ ] **Step 2: 테스트가 중복 조회를 보여 주며 실패하는지 확인한다.**

Run: `npx vitest run src/core/resolver/pip-resolver-download.test.ts -t "요청 세션"`

Expected: FAIL — shared의 latest-version/package-info producer가 두 번 실행된다.

- [ ] **Step 3: pip의 원격 조회만 세션으로 감싼다.**

`PipResolver`에 private `sessionGet()` helper를 추가한다. `getLatestVersion()` 전체를 `'pip'/'latest-version'` operation으로, `fetchPackageInfo()`의 원격 artifact/metadata producer 전체를 `'pip'/'package-info'` operation으로 감싼다. key context는 아래처럼 고정한다.

```ts
{
  name: pep503Normalize(name), versionSpec: versionSpec ?? null, indexUrl: indexUrl ?? null,
  target: this.pipTargetPlatform, pythonVersion: this.pythonVersion,
  baseUrl: this.cacheOptions.baseUrl ?? null,
  allowUnverifiedSourceArtifact,
}
```

`getLatestVersion`은 `Boolean(version)` predicate를 전달해 null/빈 버전을 저장하지 않는다. `fetchPackageInfo`는 non-null `FetchedPackageInfo`만 저장한다. `fetchPackageInfo`가 latest를 해결하기 위해 `getLatestVersion`을 호출하는 구조는 유지하되 operation name이 다르므로 순환 key를 만들지 않는다. PEP 508 marker, extras, BFS queue, dependency node 생성은 session producer 밖에 남긴다.

- [ ] **Step 4: pip 회귀 테스트를 통과시킨다.**

Run: `npx vitest run src/core/resolver/pip-resolver-download.test.ts src/core/resolver/pip-resolver.test.ts`

Expected: PASS — 공통 조회는 1회, 키가 다르면 재사용하지 않고 기존 source artifact 정책도 유지된다.

- [ ] **Step 5: 세 번째 단위를 커밋한다.**

```bash
git add src/core/resolver/pip-resolver.ts src/core/resolver/pip-resolver-download.test.ts src/core/resolver/pip-resolver.test.ts
git commit -m "feat: pip 의존성 조회를 요청 세션에서 재사용"
```

### Task 4: conda 후보 선택과 artifact 정보 조회를 세션화한다

**Files:**

- Modify: `src/core/resolver/conda-resolver.ts`
- Modify: `src/core/resolver/conda-resolver.test.ts` 또는 현재 conda resolver 테스트 파일
- Modify: `src/core/resolver/conda-repodata-processor.test.ts` (기존 파일이면)

- [ ] **Step 1: conda 공통 전이 의존성의 실패 테스트를 작성한다.**

두 root가 같은 `shared` Conda dependency를 갖는 fixture를 만들고, 내부 factory로 연결한 두 요청 전용 resolver 실행에서 `getLatestVersionFromRepoData`와 candidate selection이 한 번만 수행되는지 spy한다. channel, targetSubdir, Python, CUDA, build가 달라지면 재사용하지 않는 테스트와 `Shared`/`shared`가 하나의 canonical key를 쓰는 테스트, null 후보 뒤 두 번째 resolver가 repodata candidate producer를 다시 실행하는 테스트를 추가한다.

- [ ] **Step 2: 테스트가 중복 candidate selection으로 실패하는지 확인한다.**

Run: `npx vitest run src/core/resolver/conda-resolver.test.ts src/core/resolver/conda-repodata-processor.test.ts`

Expected: FAIL — 같은 channel/subdir 후보 탐색이 root마다 반복된다.

- [ ] **Step 3: resolver helper를 통해 conda 세션 적용 지점을 단일화한다.**

`CondaResolver`에 `getLatestVersionFromRepoDataWithSession()`와 `fetchPackageInfoBFSWithSession()` helper를 만든다. 전자는 processor의 `getLatestVersionFromRepoData()` 호출을 `'conda'/'latest-version'`으로, 후자는 현재 `fetchPackageInfoBFS()` body를 `'conda'/'package-info'`으로 감싼다. 두 key는 `{ name: name.toLowerCase(), versionSpec/version, buildSpec, channel, targetSubdir, targetArchitecture, pythonVersion, cudaVersion }`을 포함한다. null/latest 후보와 대상 artifact 오류는 cache하지 않는다. processor의 disk/memory repodata cache와 Conda BFS parent-child map은 변경하지 않는다.

- [ ] **Step 4: conda 회귀 테스트를 통과시킨다.**

Run: `npx vitest run src/core/resolver/conda-resolver.test.ts src/core/resolver/conda-repodata-processor.test.ts`

Expected: PASS — 동일 문맥은 1회, 환경·channel·build가 다르면 독립 조회, 실패 후 재시도한다.

- [ ] **Step 5: 네 번째 단위를 커밋한다.**

```bash
git add src/core/resolver/conda-resolver.ts src/core/resolver/conda-resolver.test.ts src/core/resolver/conda-repodata-processor.test.ts
git commit -m "feat: conda 후보 탐색을 요청 세션에서 재사용"
```

### Task 5: Maven POM과 metadata 조회를 세션화하고 prefetch를 통합한다

**Files:**

- Modify: `src/core/resolver/maven-resolver.ts`
- Modify: `src/core/resolver/maven-resolver.test.ts`
- Modify: `src/core/shared/maven-cache.test.ts`

- [ ] **Step 1: Maven POM sharing·prefetch의 실패 테스트를 작성한다.**

내부 factory로 연결한 Maven resolver 두 개가 같은 GAV POM을 읽을 때 raw POM producer가 한 번만 호출되는 테스트를 만든다. `setCacheOptions({ repoUrl: 'https://repo-a.example/maven2' })`와 다른 `repoUrl`인 resolver는 raw POM을 공유하지 않는 테스트를 추가한다. 한 resolver의 `fetchPomWithCache` 결과를 mutate한 뒤 다른 resolver 결과는 원본인 clone-on-read 테스트를 추가한다. prefetch 직후 동일 coordinate 단건 fetch가 같은 in-flight producer를 사용하는 테스트와, prefetch 실패가 실제 resolve의 오류 정책을 바꾸지 않는 테스트를 추가한다. 같은 GAV라도 classifier가 다른 root는 raw POM 한 번을 공유하면서 각 root artifact selection은 독립적인 assertion을 넣는다.

- [ ] **Step 2: 테스트가 POM producer 중복 호출로 실패하는지 확인한다.**

Run: `npx vitest run src/core/resolver/maven-resolver.test.ts src/core/shared/maven-cache.test.ts`

Expected: FAIL — session-aware POM producer가 없고 prefetch가 별도 cache helper를 우회한다.

- [ ] **Step 3: Maven 세션 producer를 단일화한다.**

`fetchPomWithCache()`를 `'maven'/'pom'` session operation으로 감싼다. context에는 실제 `fetchPomFromCache()`가 쓰는 `effectiveRepoUrl = this.cacheOptions.repoUrl ?? this.repoUrl`와 `{ groupId, artifactId, version }`만 포함하고 classifier/type은 포함하지 않는다. `getLatestVersion()`은 `'maven'/'latest-version'`으로 분리해 빈 문자열을 cache하지 않는다. repository URL 격리와 동일 GAV/classifier 재사용을 각각 테스트로 고정한다.

`prefetchPomsParallelInternal()`은 `prefetchPomsParallel()` 직접 호출 대신 같은 `fetchPomWithCache()`를 `parallelThreads` 제한으로 fire-and-forget 호출한다. 각 task 오류는 debug log로 소비해 best-effort prefetch 의미를 유지하고, 이후 실제 fetch의 오류는 기존 호출자가 처리한다. POM/BOM을 소비하는 scope/exclusion, dependency-management, classifier/type 선택 로직은 session 밖에 둔다.

- [ ] **Step 4: Maven 회귀 테스트를 통과시킨다.**

Run: `npx vitest run src/core/resolver/maven-resolver.test.ts src/core/shared/maven-cache.test.ts`

Expected: PASS — raw POM 단일 producer, prefetch 공유, classifier 독립, 기존 prefetch 실패 정책을 확인한다.

- [ ] **Step 5: 다섯 번째 단위를 커밋한다.**

```bash
git add src/core/resolver/maven-resolver.ts src/core/resolver/maven-resolver.test.ts src/core/shared/maven-cache.test.ts
git commit -m "feat: Maven POM 조회를 요청 세션에서 재사용"
```

### Task 6: npm packument와 version candidate 선택을 세션화한다

**Files:**

- Modify: `src/core/shared/npm-version-resolver.ts`
- Modify: `src/core/resolver/npm-resolver.ts`
- Modify: `src/core/resolver/npm-resolver.test.ts`
- Create: `src/core/shared/npm-version-resolver.test.ts` (기존 unit test가 없을 때)

- [ ] **Step 1: npm 공통 dependency의 실패 테스트를 작성한다.**

내부 factory로 연결한 별도 `NpmResolver` 두 개가 같은 transitive `shared@^1`을 처리할 때 `fetchPackument`와 비동기 version candidate producer가 각각 한 번 실행되는지 검증한다. registry URL 또는 name/spec이 다르면 재사용하지 않는 테스트, `Shared`/`shared`가 npm canonical lowercase name 하나로 재사용되는 테스트, 없는 version(`null`) 뒤 두 번째 resolver가 재시도하는 테스트를 추가한다. OS/architecture는 session key에 새로 추가하지 않고 기존 `NpmResolver`의 package `os`/`cpu` 필터가 root별로 유지되는지도 검증한다.

- [ ] **Step 2: 테스트가 packument와 version resolution을 반복하며 실패하는지 확인한다.**

Run: `npx vitest run src/core/resolver/npm-resolver.test.ts src/core/shared/npm-version-resolver.test.ts`

Expected: FAIL — `fetchPackument`과 선택 함수가 두 resolver에서 각각 호출된다.

- [ ] **Step 3: NpmVersionResolver에 session-aware async accessor를 추가한다.**

기존 synchronous `resolveVersion()` public API는 유지한다. `fetchPackument()`은 `'npm'/'packument'` session operation으로 감싸고 context에 `{ registryUrl, name: name.toLowerCase() }`을 넣는다. 새 `resolveVersionForRequest(spec, packument)`은 `'npm'/'latest-version'` operation으로 `{ registryUrl, name: packument.name.toLowerCase(), spec }`을 key로 사용하며 `Boolean(version)` predicate를 전달한다. `NpmResolver.resolveDependencies()`와 `processDepItem()`만 새 async accessor를 await한다. `NpmVersionResolver`는 resolver module의 private session accessor만 사용하고 public constructor/공개 API에는 session을 추가하지 않는다. `NpmTreeManager`, peer/optional 처리, hoisting 및 현재 target OS/architecture mapping은 변경하지 않는다.

- [ ] **Step 4: npm 회귀 테스트를 통과시킨다.**

Run: `npx vitest run src/core/resolver/npm-resolver.test.ts src/core/shared/npm-version-resolver.test.ts`

Expected: PASS — packument·valid version은 재사용되고 null은 다시 조회하며 트리 배치는 유지된다.

- [ ] **Step 5: 여섯 번째 단위를 커밋한다.**

```bash
git add src/core/shared/npm-version-resolver.ts src/core/shared/npm-version-resolver.test.ts src/core/resolver/npm-resolver.ts src/core/resolver/npm-resolver.test.ts
git commit -m "feat: npm metadata 조회를 요청 세션에서 재사용"
```

### Task 7: 공통 resolver의 사용자 결과와 실패 정책 회귀를 완성한다

**Files:**

- Modify: `src/core/shared/dependency-resolver.test.ts`
- Modify: `src/cli/commands/download.test.ts` (필요할 때만)

- [ ] **Step 1: end-to-end shared dependency와 실패 정책의 실패 테스트를 작성한다.**

factory mock이 실제 session을 관찰할 수 있도록 최소 fake resolver를 사용한다. requirements 입력 두 root가 같은 dependency를 가져도 `successfulPackages`에는 한 아티팩트만 남고 각 root `dependencyTrees`는 둘 다 남는지 확인한다. 첫 root의 shared dependency가 일시적으로 실패하고 두 번째 root에서 재시도 성공할 때 default best-effort는 성공 root 결과만 다운로드하고, `--strict`는 기존대로 하나라도 실패하면 중단하는 테스트를 만든다. logger spy로 hit이 있을 때만 세션 통계 info log가 나오고 hit이 없으면 나오지 않는지도 검증한다.

- [ ] **Step 2: 테스트가 재시도·통계 계약 부재로 실패하는지 확인한다.**

Run: `npx vitest run src/core/shared/dependency-resolver.test.ts src/cli/commands/download.test.ts`

Expected: FAIL — 재시도 횟수 또는 세션 통계 로그 assertion이 충족되지 않는다.

- [ ] **Step 3: 최소 통합 보완을 적용한다.**

Task 2의 session/factory 사용 범위에서 누락된 resolver option 전파나 종료 로그만 보완한다. 기존 `successfulPackageSet`·`resolvedSet` 병합 순서, progress current/total, strict 처리, CLI `--file` parser는 변경하지 않는다. 새 CLI 옵션이나 출력 줄을 추가하지 않는다.

- [ ] **Step 4: 공통 resolver와 CLI 회귀 테스트를 통과시킨다.**

Run: `npx vitest run src/core/shared/dependency-resolver.test.ts src/cli/commands/download.test.ts`

Expected: PASS — 다운로드 목록과 failure semantics은 유지되고 조회만 재사용된다.

- [ ] **Step 5: 일곱 번째 단위를 커밋한다.**

```bash
git add src/core/shared/dependency-resolver.ts src/core/shared/dependency-resolver.test.ts src/cli/commands/download.test.ts
git commit -m "test: 의존성 세션 재사용 정책을 검증"
```

### Task 8: 모든 영향 문서를 갱신하고 검증한다

**Files:**

- Modify: `docs/shared-dependency.md`
- Modify: `docs/resolvers.md`
- Modify: `docs/pip-dependency-resolution.md`
- Modify: `docs/conda-dependency-resolution.md`
- Modify: `docs/maven-dependency-resolution.md`
- Modify: `docs/npm-dependency-resolution.md`

- [ ] **Step 1: 문서 변경의 기대 문구를 작성한다.**

각 문서에 한 다운로드 요청 안에서만 조회 snapshot을 재사용하고 요청 종료 후 폐기된다는 사실을 추가한다. `shared-dependency.md`에는 적용 타입(pip/conda/Maven/npm), session key 격리, 실패/null 비캐시 및 기존 최종 다운로드 중복 제거와의 차이를 적는다. `resolvers.md`와 유형별 문서에는 해당 resolver의 cached operation과 부모 문맥(extras, build, scope/exclusion, peer/hoisting)을 별도 평가하는 경계를 적는다. OS/Docker가 이번 session 비범위임도 명시한다.

- [ ] **Step 2: 문서가 이전 동작만 설명하는지 확인한다.**

Run: `rg -n "중복|세션|재사용|공통 의존성" docs/shared-dependency.md docs/resolvers.md docs/{pip,conda,maven,npm}-dependency-resolution.md`

Expected: 새 request-session 동작 설명이 아직 없어 필요한 문서 변경 위치를 확인한다.

- [ ] **Step 3: 문서를 갱신한다.**

설계 문서의 키 표를 복제하지 말고, 사용자와 운영자에게 필요한 짧은 정책으로 요약한다. CLI 사용자 경험이나 설정값은 바뀌지 않으므로 `docs/cli.md`에는 중복 항목을 추가하지 않는다.

- [ ] **Step 4: 전체 검증을 실행한다.**

Run: `bash scripts/verify-worktree.sh`

Expected: 전체 Vitest suite PASS.

Run: `npm run lint`

Expected: exit 0; 기존 경고가 있으면 새 error가 없는지 확인한다.

Run: `npm run typecheck`

Expected: exit 0.

Run: `git diff --check origin/main...HEAD`

Expected: whitespace error 없음.

- [ ] **Step 5: 문서와 검증 변경을 커밋한다.**

```bash
git add docs/shared-dependency.md docs/resolvers.md docs/pip-dependency-resolution.md docs/conda-dependency-resolution.md docs/maven-dependency-resolution.md docs/npm-dependency-resolution.md
git commit -m "docs: 요청 단위 의존성 재사용을 안내"
```
