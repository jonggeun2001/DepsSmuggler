# CLI Configurable Dependency Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let CLI downloads retain packages resolved through a configurable dependency depth instead of failing the direct pip root at that boundary.

**Architecture:** Commander exposes a string-valued `--max-depth` option that the download command validates and converts once before passing it to `resolveAllDependencies`. Pip resolution will treat the configured boundary as a truncation point: it preserves the already resolved node and emits a warning, while real metadata/version failures retain their existing error path.

**Tech Stack:** TypeScript, Commander, Vitest, Electron CLI, ESLint, Prettier.

---

## File structure

- `src/cli/index.ts` — declares the public `download --max-depth` option and its default.
- `src/cli/commands/download.ts` — validates/parses the option and forwards the normalized number to the shared resolver.
- `src/cli/commands/download.test.ts` — covers default/explicit forwarding and invalid command input before side effects.
- `src/core/resolver/pip-resolver.ts` — changes depth-boundary handling from a required-dependency error to a warning and branch truncation.
- `src/core/resolver/pip-resolver.characterization.test.ts` — proves a bounded dependency tree is returned without an error.
- `docs/cli.md`, `docs/resolvers.md`, `docs/shared-dependency.md` — document the CLI contract and bounded-resolution semantics.

### Task 1: Add the CLI depth option with validation

**Files:**
- Modify: `src/cli/index.ts:24-44`
- Modify: `src/cli/commands/download.ts:19-28, 135-190, 228-292`
- Test: `src/cli/commands/download.test.ts:75-115, 840-880`

- [ ] **Step 1: Write failing command tests**

Extend `commandOptions` with `maxDepth: '5'`. Update the existing default `deps` forwarding assertion to include `maxDepth: 5`. Add one test that passes `maxDepth: '8'` and expects:

```ts
expect(resolveAllDependencies).toHaveBeenCalledWith(
  expect.any(Array),
  expect.objectContaining({ maxDepth: 8 }),
);
```

Add a parameterized invalid-input test for `''`, `' '`, `'-1'`, `'1.5'`, and `'abc'`. Stub `process.exit` as existing validation tests do; assert resolver, queue, and output-directory calls were not made.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/commands/download.test.ts`

Expected: FAIL because `maxDepth` is not parsed/forwarded and invalid values do not stop the command.

- [ ] **Step 3: Write minimal implementation**

In `src/cli/index.ts`, add:

```ts
.option('--max-depth <num>', '최대 의존성 탐색 깊이', '5')
```

In `src/cli/commands/download.ts`, add `maxDepth: string` to `DownloadCommandOptions` and a focused parser:

```ts
function parseMaxDepth(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error('--max-depth는 0 이상의 정수여야 합니다.');
  }
  const maxDepth = Number(value);
  if (!Number.isSafeInteger(maxDepth)) {
    throw new Error('--max-depth는 0 이상의 정수여야 합니다.');
  }
  return maxDepth;
}
```

Normalize a missing programmatic value to `'5'`, parse it before package/file side effects, add `maxDepth` to the `preparePackagesForDownload` options, and pass `{ maxDepth }` to `resolveAllDependencies` when dependencies are resolved.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/cli/commands/download.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/index.ts src/cli/commands/download.ts src/cli/commands/download.test.ts
git commit -m "feat: CLI 의존성 탐색 깊이 설정 추가"
```

### Task 2: Preserve the pip result at the depth boundary

**Files:**
- Modify: `src/core/resolver/pip-resolver.ts:312-432`
- Test: `src/core/resolver/pip-resolver.characterization.test.ts:269-307`

- [ ] **Step 1: Write failing resolver test**

Replace the current test that expects `maxDepth: 1` to reject. Using its existing `root -> child -> grandchild` fixture, assert a successful result with:

```ts
expect(result.flatList.map((pkg) => pkg.name)).toEqual(['root', 'child']);
expect(result.root.dependencies).toHaveLength(1);
expect(result.root.dependencies[0].dependencies).toEqual([]);
expect(logger.warn).toHaveBeenCalledWith(
  expect.stringContaining('최대 의존성 탐색 깊이'),
  expect.objectContaining({ depth: 1, maxDepth: 1 }),
);
```

Spy on the resolver logger using the repository's existing Vitest mocking pattern before invoking the resolver.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/resolver/pip-resolver.characterization.test.ts -t "최대 깊이"`

Expected: FAIL with `최대 의존성 탐색 깊이를 초과했습니다`.

- [ ] **Step 3: Write minimal implementation**

In `PipResolver.resolveDependencies`, leave the `depth > maxDepth` guard as a defensive no-op for queued nodes. Replace the `depth >= maxDepth && parsedDeps.length > 0` throw with:

```ts
logger.warn('최대 의존성 탐색 깊이에 도달하여 하위 의존성 확장을 중단합니다', {
  name: packageInfo.name,
  version: actualVersion,
  depth,
  maxDepth,
  omittedDependencyCount: parsedDeps.length,
});
continue;
```

This keeps the boundary package in `resolvedNodes` and prevents only descendant enqueues. Do not change errors for missing package metadata or unsatisfied dependency versions.

- [ ] **Step 4: Run focused regression tests**

Run: `npx vitest run src/core/resolver/pip-resolver.characterization.test.ts src/core/resolver/pip-resolver-download.test.ts src/core/shared/dependency-resolver.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/resolver/pip-resolver.ts src/core/resolver/pip-resolver.characterization.test.ts
git commit -m "fix: 깊이 제한에서 pip 의존성 부분 해결 유지"
```

### Task 3: Document bounded-download behavior

**Files:**
- Modify: `docs/cli.md:56-78, 97-122`
- Modify: `docs/resolvers.md:99-104`
- Modify: `docs/shared-dependency.md:96-120`

- [ ] **Step 1: Document the CLI option**

Add `--max-depth <num>` to the `download` options table with default `5`. State that dependencies through the boundary are downloaded and deeper descendants are skipped with a warning. Add a concrete `--max-depth 8` pip example.

- [ ] **Step 2: Document resolver semantics**

Replace documentation claiming that a maximum-depth expansion fails the direct root. Clarify that maximum depth is a bounded traversal result, while unresolved version/metadata dependencies remain direct-root failures.

- [ ] **Step 3: Run documentation-adjacent checks**

Run: `npm run format:check`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/cli.md docs/resolvers.md docs/shared-dependency.md
git commit -m "docs: CLI 의존성 깊이 제한 동작 설명"
```

### Task 4: Verify the integrated change

**Files:**
- Create if absent: `scripts/verify-worktree.sh`

- [ ] **Step 1: Ensure the standard worktree verification entrypoint exists**

Run:

```bash
bash /Users/jonggeun/IdeaProjects/myskillrepo/skills/worktree-flow/scripts/ensure_verify_worktree.sh .
```

If it creates `scripts/verify-worktree.sh`, include it in the next commit because it is part of the repository change.

- [ ] **Step 2: Run the standard test verification**

Run: `bash scripts/verify-worktree.sh`

Expected: repository test contract passes.

- [ ] **Step 3: Run static checks and inspect CLI help**

Run:

```bash
npm run lint
npm run format:check
npm run cli -- download --help
```

Expected: lint and format checks pass; help displays `--max-depth <num>` with default 5.

- [ ] **Step 4: Commit any generated verification helper**

```bash
git add scripts/verify-worktree.sh
git commit -m "test: worktree 검증 진입점 추가"
```

Only make this commit if the helper was newly created.
