# Pip Source Artifact Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대상 Python·OS·아키텍처용 wheel이 없을 때 PyPI sdist를 반입하고, sdist도 없으면 직접 루트를 안전하게 skip 또는 strict 실패로 처리한다.

**Architecture:** `PipResolver`가 PyPI JSON API와 Simple API의 후보 선택 결과를 하나의 대상-아티팩트 진단으로 정규화한다. version spec(`latest`, 범위, 정확 버전)을 유지한 채 호환 release를 선택하고, 선택된 sdist의 URL·파일명·checksum은 기존 resolver→downloader 경로로 전달한다. 의존성을 확장하지 않는 `--no-deps`는 Simple API Core Metadata가 없어도 checksum이 있는 **sdist만** 반입하지만, wheel과 일반 의존성 해결은 기존 fail-closed 정책을 유지한다.

**Tech Stack:** TypeScript, Commander, Vitest, PyPI JSON API, PEP 440, PEP 658/714 Simple API metadata.

---

## File structure

- Modify: `src/core/resolver/pip-resolver.ts` — version spec을 실제 호환 release로 선택하고, wheel/sdist 부재를 구체적으로 진단하며 `--no-deps` 메타데이터 정책을 적용한다.
- Modify: `src/cli/commands/download.ts` — requirements의 pip version operator를 보존해 resolver에 전달한다.
- Modify: `src/core/resolver/pip-resolver-download.test.ts` — JSON/Simple API의 후보 선택·diagnostic·sdist 전달 회귀를 고정한다.
- Modify: `src/cli/commands/download.test.ts` — requirements version spec 보존과 root skip/strict/전부 실패 정책을 고정한다.
- Modify: `docs/cli.md` — 사용자 대상 sdist 반입과 skip/strict 종료 정책을 명시한다.
- Modify: `docs/resolvers.md` — resolver의 JSON/Simple 후보 선택과 metadata 신뢰 경계를 명시한다.

### Task 1: pip version spec과 artifact 부재 진단을 테스트로 고정

**Files:**
- Modify: `src/core/resolver/pip-resolver-download.test.ts`
- Modify: `src/cli/commands/download.test.ts`

- [ ] **Step 1: PyPI JSON API 정확 버전의 실패 테스트를 작성한다.**

```ts
await expect(
  resolver.resolveDependencies('native-only', '1.0.0', {
    maxDepth: 0,
    targetPlatform: { system: 'Linux', machine: 'x86_64' },
    pythonVersion: '3.13',
  }),
).rejects.toThrow(
  '호환되는 pip wheel 또는 source distribution을 찾을 수 없습니다: native-only@1.0.0',
);
```

Fixture에는 `cp312-cp312-manylinux_*_x86_64.whl`만 넣고 `sdist`를 넣지 않는다. 메시지에 `Python 3.13`, `linux`, `x86_64`과 sdist 부재가 포함되는지도 검증한다.

- [ ] **Step 2: 모든 version spec의 실패·성공 선택 테스트를 작성한다.**

PyPI JSON과 Simple API 각각에서 정확 버전, `latest`, `>=1,<2`가 CPython 3.13 호환 파일을 전혀 찾지 못하는 fixture를 만든다. 오류는 존재하지 않는 release version이 아니라 사용자가 요청한 spec을 포함해야 한다. 특히 Simple API 정확 버전 diagnostic도 별도로 고정한다.

각 API에서 `>=1,<2`가 여러 release 중 실제 호환 artifact가 있는 release를 선택하는 positive fixture도 만든다. 이 테스트는 direct-root 범위 spec이 보존되고 `getLatestVersion` 경로가 실제 패키지를 반환함을 고정한다.

- [ ] **Step 3: CLI requirements 파서와 종료 정책 테스트를 작성한다.**

`native-only>=1,<2`가 resolver에 `>=1,<2`로 전달되는지 확인한다. 기본 모드는 실패한 root만 경고로 제외하고, 모든 root가 실패하면 `다운로드할 해결된 패키지가 없습니다`로 종료하며 `createArchive`를 호출하지 않음을 확인한다. `strict: true`는 즉시 실패하고 다운로드 queue·`downloadPackage`·archive 생성 부작용이 없음을 확인한다.

- [ ] **Step 4: 새 테스트가 현재 구현에서 실패하는지 확인한다.**

Run:

```bash
npm test -- --run src/core/resolver/pip-resolver-download.test.ts src/cli/commands/download.test.ts
```

Expected: 최소 한 건 이상이 기존 일반 `패키지를 찾을 수 없음` 메시지 또는 operator가 빠진 version으로 실패한다.

- [ ] **Step 5: 테스트만 커밋한다.**

```bash
git add src/core/resolver/pip-resolver-download.test.ts src/cli/commands/download.test.ts
git commit -m "test: pip source artifact 정책을 고정"
```

### Task 2: version spec 보존과 PyPI JSON 후보 선택을 구현

**Files:**
- Modify: `src/cli/commands/download.ts:412-445`
- Modify: `src/core/resolver/pip-resolver.ts:538-710, 844-935`
- Test: `src/core/resolver/pip-resolver-download.test.ts`
- Test: `src/cli/commands/download.test.ts`

- [ ] **Step 1: requirements parser가 연산자를 보존하도록 최소 변경한다.**

정규식을 package name과 optional specifier로 분리해 `>=`, `<=`, `~=`, `==`, `===`, `!=`, `>`, `<` 및 comma로 연결된 specifier를 `PackageInfo.version`에 원문대로 남긴다. 연산자가 없는 버전은 기존처럼 `latest`로 처리한다.

```ts
const match = trimmed.match(
  /^([a-zA-Z0-9._-]+)((?:===|==|!=|~=|>=|<=|>|<).+)?$/,
);
// version: match?.[2]?.trim() || 'latest'
```

- [ ] **Step 2: resolver에 재사용 가능한 대상 artifact 오류 생성을 추가한다.**

`PipResolver` 내부 helper는 name, 요청 spec, `pipTargetPlatform`을 받아 다음 정보를 포함한 오류를 만든다.

```ts
`대상 환경과 호환되는 pip wheel 또는 source distribution을 찾을 수 없습니다: ${name}@${requestedSpec} ` +
  `(대상: Python ${pythonVersion}, ${os} ${arch}; 호환 wheel 없음; 호환 source distribution 없음)`
```

sdist가 존재하지만 `Requires-Python`이 맞지 않은 경우도 “호환 source distribution 없음”으로 표현한다.

- [ ] **Step 3: `fetchPackageInfo`가 `latest`와 version spec을 구분하도록 구현한다.**

`latest` 또는 operator로 시작하는 version은 `getLatestVersion(name, versionSpec, indexUrl)`으로 해석해 actual version을 얻는다. `getLatestVersion`은 패키지/릴리스가 존재하지만 대상 artifact가 하나도 없을 때 helper 오류를 throw하고, package 자체가 없을 때만 기존 `null`을 반환한다. 정확 버전 후보 선택에서 `null`이 나온 경우도 같은 helper를 사용한다.

- [ ] **Step 4: focused 테스트를 통과시킨다.**

Run:

```bash
npm test -- --run src/core/resolver/pip-resolver-download.test.ts src/cli/commands/download.test.ts
```

Expected: PASS.

- [ ] **Step 5: 구현을 커밋한다.**

```bash
git add src/core/resolver/pip-resolver.ts src/cli/commands/download.ts \
  src/core/resolver/pip-resolver-download.test.ts src/cli/commands/download.test.ts
git commit -m "fix: pip source artifact 부재를 명확히 진단"
```

### Task 3: JSON/Simple sdist 전달과 Simple API `--no-deps` 신뢰 경계를 구현

**Files:**
- Modify: `src/core/resolver/pip-resolver.ts:334, 598-647`
- Modify: `src/core/resolver/pip-resolver-download.test.ts`

- [ ] **Step 1: JSON/Simple API sdist artifact 보존 테스트를 작성한다.**

PyPI JSON과 Simple API 각각에 `.tar.gz`, `.zip`, `.tar.bz2`, `.tar.xz` fixture를 만든다. 각 경로는 선택한 sdist의 filename·URL·checksum을 반환해야 한다. Simple API fixture의 Core Metadata는 `not-advertised`와 artifact hash를 사용하고, `maxDepth: 0`, `skipDependencyExpansion: true`에서만 해당 sdist 반입을 허용한다. 일반 모드(`skipDependencyExpansion: false`)는 기존 `검증된 의존성 메타데이터` 오류를 유지한다.

- [ ] **Step 2: downloader 전달 테스트를 확장한다.**

JSON·Simple API의 선택된 각 sdist가 `PipDownloader.downloadPackage`에 전달될 때 resolver가 저장한 URL을 재조회 없이 사용하고 sha256 checksum verifier를 설정하는지 `expectSelectedArtifactIsDownloaded` helper로 검증한다. 따라서 두 API × 네 sdist 형식 각각에서 filename, URL, checksum, 실제 downloader 사용을 검증한다.

- [ ] **Step 3: 현재 구현에서 `--no-deps` case가 실패하는지 확인한다.**

Run:

```bash
npm test -- --run src/core/resolver/pip-resolver-download.test.ts
```

Expected: `not-advertised` metadata를 가진 `skipDependencyExpansion` sdist case가 `검증된 의존성 메타데이터를 찾을 수 없습니다`로 FAIL.

- [ ] **Step 4: metadata 예외를 root-only sdist에만 한정한다.**

`resolveDependencies`는 root artifact만 검사할 때 `fetchPackageInfo`에 “unverified sdist 허용” 의도를 전달한다. `fetchPackageInfo`는 최종 selected artifact가 sdist일 때만 Core Metadata 부재를 허용하며, 같은 `--no-deps` 경로라도 wheel은 검증된 metadata가 없으면 기존처럼 실패한다. 일반 모드는 artifact 종류와 관계없이 `true`를 유지한다. artifact checksum 보존·downloader checksum 검증은 변경하지 않는다.

- [ ] **Step 5: focused 테스트를 통과시키고 커밋한다.**

```bash
npm test -- --run src/core/resolver/pip-resolver-download.test.ts
git add src/core/resolver/pip-resolver.ts src/core/resolver/pip-resolver-download.test.ts
git commit -m "fix: no-deps pip sdist를 반입"
```

### Task 4: 사용자·resolver 문서를 정책에 맞게 갱신

**Files:**
- Modify: `docs/cli.md:76-95`
- Modify: `docs/resolvers.md:101-104`

- [ ] **Step 1: CLI 정책의 상충 문장을 교체한다.**

`docs/cli.md`에서 “필수 전이 의존성 실패는 전체 명령 실패”와 “sdist 부재 시 오류 종료”라는 절대 표현을 제거한다. 기본 모드는 실패 root skip, `--strict` 전체 실패, 모든 root 실패는 오류, sdist는 반입만 하고 빌드는 하지 않는다고 설명한다.

- [ ] **Step 2: resolver 후보 선택과 trust boundary를 문서화한다.**

`docs/resolvers.md`에 wheel → Requires-Python 호환 sdist → no candidate 순서를 추가하고, JSON/Simple API 모두에서 동일한 진단을 사용함을 기록한다. Simple API는 `--no-deps`의 **sdist**만 artifact hash로 반입할 수 있고 wheel 및 의존성 확장에는 검증된 Core Metadata가 필요함을 명시한다.

- [ ] **Step 3: 문서 diff를 확인하고 커밋한다.**

```bash
git diff --check
git add docs/cli.md docs/resolvers.md
git commit -m "docs: pip source artifact 정책을 안내"
```

### Task 5: 전체 검증과 PR 준비

**Files:**
- Modify if absent: `scripts/verify-worktree.sh`

- [ ] **Step 1: 표준 worktree 검증 스크립트를 준비한다.**

Run:

```bash
bash /Users/jonggeun/IdeaProjects/myskillrepo/skills/worktree-flow/scripts/ensure_verify_worktree.sh \
  /Users/jonggeun/IdeaProjects/DepsSmuggler-worktrees/pip-source-artifact-policy
```

`scripts/verify-worktree.sh`가 생성되면 검증 계약 파일로 포함한다.

- [ ] **Step 2: 전체 단위 테스트를 실행한다.**

Run:

```bash
bash scripts/verify-worktree.sh
```

Expected: exit 0.

- [ ] **Step 3: lint와 build를 실행한다.**

Run:

```bash
npm run lint
npm run build
```

Expected: lint exit 0 (기존 warning 허용), build exit 0.

- [ ] **Step 4: 최종 diff와 상태를 확인한다.**

Run:

```bash
git diff --check origin/main...HEAD
git status --short
```

- [ ] **Step 5: 검증 스크립트가 새 파일이면 커밋한다.**

```bash
git add scripts/verify-worktree.sh
git commit -m "test: worktree 검증 스크립트 추가"
```
