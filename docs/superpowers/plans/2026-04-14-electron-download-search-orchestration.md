# Electron Download/Search Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `electron/download-handlers.ts`와 `electron/search-handlers.ts`에서 패키지 타입 분기, resolver 선택, 진행 이벤트 전송, 출력 패키징, OS 전용 오케스트레이션을 분리해 IPC wiring만 남긴다.

**Architecture:** Electron 메인 핸들러는 채널 등록과 인자/반환 매핑만 담당하고, 실제 다운로드/검색/OS 오케스트레이션은 `electron/services/`와 helper 모듈로 이동한다. 공통 progress emitter와 package type 선택기는 서비스에서 주입 가능한 의존성으로 만들어 preload/renderer contract는 그대로 유지한다.

**Tech Stack:** Electron IPC, TypeScript, Vitest, fs-extra, p-limit

---

### Task 1: 서비스 경계 고정 테스트 추가

**Files:**
- Modify: `electron/download-handlers.test.ts`
- Modify: `electron/search-handlers.test.ts`
- Create: `electron/services/download-orchestrator.test.ts`
- Create: `electron/services/search-orchestrator.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it('download:start 핸들러가 오케스트레이터로 payload와 emitters를 위임한다', async () => {
  // registerDownloadHandlers 후 ipc handler 추출
  // orchestrator mock 호출과 반환 검증
});

it('os:search 핸들러가 검색 서비스 결과를 그대로 반환한다', async () => {
  // registerSearchHandlers 후 service mock 호출 검증
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run electron/download-handlers.test.ts electron/search-handlers.test.ts electron/services/download-orchestrator.test.ts electron/services/search-orchestrator.test.ts`
Expected: FAIL because orchestrator modules and delegation points do not exist yet

- [ ] **Step 3: Add minimal test scaffolding**

```ts
vi.mock('./services/download-orchestrator', () => ({
  createDownloadOrchestrator: vi.fn(() => ({ startDownload: vi.fn() })),
}));
```

- [ ] **Step 4: Re-run focused tests**

Run: `npx vitest run electron/download-handlers.test.ts electron/search-handlers.test.ts`
Expected: FAIL on missing production delegation behavior

- [ ] **Step 5: Commit checkpoint**

```bash
git add electron/download-handlers.test.ts electron/search-handlers.test.ts electron/services/*.test.ts
git commit -m "test: pin handler orchestration seams"
```

### Task 2: download orchestration 서비스 분해

**Files:**
- Modify: `electron/download-handlers.ts`
- Create: `electron/services/download-orchestrator.ts`
- Create: `electron/services/download-progress.ts`
- Create: `electron/services/download-package-router.ts`
- Create: `electron/services/os-download-orchestrator.ts`
- Create: `electron/services/os-package-router.ts`

- [ ] **Step 1: Write the failing service tests**

```ts
it('package type별 downloader selection과 output packaging을 service가 처리한다', async () => {
  // pip/maven/docker/os 분기, packageInfos 생성, archive/email path 검증
});

it('OS download orchestrator가 unresolved/conflict/cancelled 흐름을 조립한다', async () => {
  // resolve -> download -> package result aggregation 검증
});
```

- [ ] **Step 2: Run the new service tests**

Run: `npx vitest run electron/services/download-orchestrator.test.ts`
Expected: FAIL because services do not exist

- [ ] **Step 3: Implement minimal services**

```ts
export function createDownloadOrchestrator(deps: DownloadOrchestratorDeps) {
  return {
    startDownload(input) { /* package type routing + packaging */ },
    cancel() { /* abort controller */ },
  };
}
```

- [ ] **Step 4: Run focused tests until green**

Run: `npx vitest run electron/services/download-orchestrator.test.ts electron/download-handlers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit checkpoint**

```bash
git add electron/download-handlers.ts electron/services/download-*.ts electron/services/os-*.ts
git commit -m "refactor: extract download orchestration services"
```

### Task 3: search orchestration 서비스 분해

**Files:**
- Modify: `electron/search-handlers.ts`
- Create: `electron/services/search-orchestrator.ts`
- Create: `electron/services/search-package-router.ts`
- Create: `electron/services/os-search-service.ts`
- Create: `electron/services/dependency-resolve-service.ts`

- [ ] **Step 1: Write the failing tests for search services**

```ts
it('package type별 search/versions/suggest 로직을 router가 처리한다', async () => {
  // pip/conda/maven/npm/docker
});

it('dependency resolve service가 progress callback을 sender로 브리지한다', async () => {
  // resolveAllDependencies onProgress -> sender.send 검증
});
```

- [ ] **Step 2: Run the focused search tests**

Run: `npx vitest run electron/services/search-orchestrator.test.ts electron/search-handlers.test.ts`
Expected: FAIL because router/service modules are missing

- [ ] **Step 3: Implement minimal search services**

```ts
export function createSearchOrchestrator(deps: SearchOrchestratorDeps) {
  return {
    searchPackages(type, query, options) { /* route */ },
    getVersions(type, name, options) { /* route */ },
    suggest(type, query, options) { /* cache + timeout */ },
  };
}
```

- [ ] **Step 4: Re-run focused tests**

Run: `npx vitest run electron/services/search-orchestrator.test.ts electron/search-handlers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit checkpoint**

```bash
git add electron/search-handlers.ts electron/services/search-*.ts electron/services/dependency-resolve-service.ts
git commit -m "refactor: extract search orchestration services"
```

### Task 4: 문서와 회귀 검증 정리

**Files:**
- Modify: `docs/ipc-handlers.md`
- Modify: `docs/architecture-overview.md`
- Modify: `docs/testing.md`

- [ ] **Step 1: Update docs for new module boundaries**

```md
- download/search handlers are thin IPC adapters
- orchestration services own package routing and progress emission
```

- [ ] **Step 2: Run project verification**

Run: `bash scripts/ensure_verify_worktree.sh /Users/jonggeun/IdeaProjects/DepsSmuggler-worktrees/electron-download-search-orchestration`
Expected: generates `scripts/verify-worktree.sh` if needed

- [ ] **Step 3: Run tests**

Run: `bash scripts/verify-worktree.sh`
Expected: PASS

- [ ] **Step 4: Run targeted handler/service tests**

Run: `npx vitest run electron/download-handlers.test.ts electron/search-handlers.test.ts electron/services/download-orchestrator.test.ts electron/services/search-orchestrator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit checkpoint**

```bash
git add docs/ipc-handlers.md docs/architecture-overview.md docs/testing.md scripts/verify-worktree.sh
git commit -m "docs: describe electron orchestration split"
```
