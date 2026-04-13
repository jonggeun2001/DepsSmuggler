# SMTP Delivery Download Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 설정 화면의 SMTP/파일 분할 값을 실제 다운로드 완료 전달 플로우에 연결해 `local | email` 전달을 지원한다.

**Architecture:** 렌더러는 전달 방식과 SMTP 설정 스냅샷을 수집해 `download:start` 옵션으로 전달한다. 메인 프로세스의 다운로드 핸들러는 패키징 뒤 로컬 저장 또는 이메일 전달을 수행하고, 필요 시 `FileSplitter`로 실제 산출물을 분할한 뒤 `EmailSender`로 발송한다. 완료 이벤트와 히스토리는 대표 경로와 실제 산출물 목록, 전달 결과를 함께 저장한다.

**Tech Stack:** Electron IPC, React + Zustand, TypeScript, nodemailer, fs-extra, Vitest

---

### Task 1: IPC/타입 계약 고정

**Files:**
- Modify: `electron/preload.ts`
- Modify: `src/types/electron.d.ts`
- Modify: `src/core/shared/types.ts`
- Modify: `src/types/index.ts`
- Test: `electron/download-handlers.test.ts`

- [ ] **Step 1: Write the failing test**

확장된 `download:all-complete` payload와 `download:start` 옵션을 사용하는 테스트를 추가한다. `deliveryMethod`, `artifactPaths`, `deliveryResult`가 없어서 실패하도록 만든다.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- electron/download-handlers.test.ts`
Expected: FAIL because delivery-related fields are not present in the current contract.

- [ ] **Step 3: Write minimal implementation**

`preload`와 Electron 타입 정의에 SMTP 테스트 API, 전달 관련 `download:start` 옵션, 확장된 완료 이벤트 타입을 추가한다. 공유 타입/히스토리 타입에 `deliveryMethod`, `artifactPaths`, `deliveryResult`, `smtpTo`를 반영한다.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- electron/download-handlers.test.ts`
Expected: PASS for the new contract-level assertions.

- [ ] **Step 5: Commit**

```bash
git add electron/preload.ts src/types/electron.d.ts src/core/shared/types.ts src/types/index.ts electron/download-handlers.test.ts
git commit -m "feat: 전달 IPC 계약을 확장"
```

### Task 2: 설정 화면과 다운로드 화면 연결

**Files:**
- Modify: `src/renderer/stores/settings-store.ts`
- Modify: `src/renderer/pages/SettingsPage.tsx`
- Modify: `src/renderer/pages/DownloadPage.tsx`
- Modify: `src/renderer/stores/history-store.ts`
- Test: `src/renderer/pages/DownloadPage.tsx` 관련 existing tests if present, otherwise contract validation via handler tests

- [ ] **Step 1: Write the failing test**

설정에서 `smtpTo`를 읽고 다운로드 시작 옵션에 `deliveryMethod`, `email`, `fileSplit`가 전달된다는 시나리오를 테스트에 추가한다. 설정 UI의 SMTP 테스트 버튼이 실제 IPC를 호출한다고 가정하는 케이스도 포함한다.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- electron/download-handlers.test.ts`
Expected: FAIL because renderer does not yet provide delivery/email/fileSplit settings.

- [ ] **Step 3: Write minimal implementation**

`settings-store`에 `smtpTo`를 추가하고 `SettingsPage`에 수신자 입력 필드를 연결한다. `DownloadPage`에 `deliveryMethod` 상태/UI를 추가하고 시작 전 SMTP 필수값 검증과 다운로드 옵션 스냅샷을 구현한다. 히스토리 저장 함수가 확장된 설정/산출물 정보를 받을 수 있도록 맞춘다.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- electron/download-handlers.test.ts`
Expected: PASS for delivery option propagation assertions.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/stores/settings-store.ts src/renderer/pages/SettingsPage.tsx src/renderer/pages/DownloadPage.tsx src/renderer/stores/history-store.ts
git commit -m "feat: 설정과 다운로드 화면에 이메일 전달 옵션 추가"
```

### Task 3: SMTP 테스트 IPC 구현

**Files:**
- Modify: `electron/main.ts`
- Modify: `src/core/mailer/email-sender.ts`
- Test: `src/core/mailer/email-sender.test.ts`

- [ ] **Step 1: Write the failing test**

`EmailSender.testConnection()`이 성공/실패 시 구조화된 결과를 반환하거나, IPC 소비에 필요한 오류 메시지를 제공한다는 테스트를 추가한다.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/core/mailer/email-sender.test.ts`
Expected: FAIL because SMTP 테스트 결과가 현재 IPC contract 수준으로 노출되지 않는다.

- [ ] **Step 3: Write minimal implementation**

`electron/main.ts`에 `test-smtp-connection` IPC를 등록하고, 전달된 설정으로 `EmailSender`를 생성해 `testConnection()`을 실행한다. `EmailSender`는 오류 메시지를 포함한 결과를 메인 프로세스가 사용할 수 있게 정리한다.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/core/mailer/email-sender.test.ts`
Expected: PASS for SMTP test success/failure assertions.

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts src/core/mailer/email-sender.ts src/core/mailer/email-sender.test.ts
git commit -m "feat: SMTP 연결 테스트 IPC 구현"
```

### Task 4: 다운로드 완료 후 이메일 전달 오케스트레이션

**Files:**
- Modify: `electron/download-handlers.ts`
- Modify: `src/core/mailer/email-sender.ts`
- Test: `electron/download-handlers.test.ts`

- [ ] **Step 1: Write the failing test**

다음 시나리오를 `electron/download-handlers.test.ts`에 추가한다.

```ts
it('email 전달 선택 시 패키징 뒤 메일을 발송한다', async () => {
  // deliveryMethod=email, split disabled, sendEmail called, outputPath/artifactPaths/deliveryResult returned
});
```

추가로 `deliveryMethod=local`이면 메일러가 호출되지 않는다는 회귀 테스트를 둔다.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- electron/download-handlers.test.ts`
Expected: FAIL because the handler currently only packages and completes locally.

- [ ] **Step 3: Write minimal implementation**

`download:start` 완료 단계에서 `deliveryMethod`를 읽어, `local`이면 기존 동작을 유지하고 `email`이면 메일러를 초기화해 실제 첨부 전달을 수행한다. 전달 성공 시 `artifactPaths`, `deliveryMethod`, `deliveryResult`를 포함해 완료 이벤트를 전송하고, 실패 시 생성된 로컬 산출물 정보를 포함한 실패 이벤트를 보낸다.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- electron/download-handlers.test.ts`
Expected: PASS for local/email branching tests.

- [ ] **Step 5: Commit**

```bash
git add electron/download-handlers.ts src/core/mailer/email-sender.ts electron/download-handlers.test.ts
git commit -m "feat: 다운로드 완료 후 이메일 전달을 연결"
```

### Task 5: 파일 분할 기반 첨부 전달

**Files:**
- Modify: `src/core/packager/file-splitter.ts`
- Modify: `src/core/mailer/email-sender.ts`
- Modify: `electron/download-handlers.ts`
- Test: `src/core/packager/file-splitter.test.ts`
- Test: `src/core/mailer/email-sender.test.ts`
- Test: `electron/download-handlers.test.ts`

- [ ] **Step 1: Write the failing test**

아카이브 파일이 첨부 제한을 넘고 `enableFileSplit=true`일 때 `splitFile()` 결과의 파트, 메타데이터, 병합 스크립트가 메일 첨부 목록과 완료 이벤트의 `artifactPaths`에 포함된다는 테스트를 추가한다. `enableFileSplit=false`일 때는 전달 실패 테스트를 추가한다.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/core/packager/file-splitter.test.ts src/core/mailer/email-sender.test.ts electron/download-handlers.test.ts`
Expected: FAIL because no splitter orchestration exists yet.

- [ ] **Step 3: Write minimal implementation**

아카이브 파일 크기와 설정의 `maxFileSize`를 비교해, 필요 시 `FileSplitter.splitFile()`을 호출한다. splitter 결과에서 실제 첨부 파일 목록을 구성하는 헬퍼를 만들고, mailer 반환값에 `attachmentsSent`, `splitApplied`를 반영한다. 분할 비활성화 상태의 초과 크기는 명시적 에러로 종료한다.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/core/packager/file-splitter.test.ts src/core/mailer/email-sender.test.ts electron/download-handlers.test.ts`
Expected: PASS for split/no-split delivery cases.

- [ ] **Step 5: Commit**

```bash
git add src/core/packager/file-splitter.ts src/core/packager/file-splitter.test.ts src/core/mailer/email-sender.ts src/core/mailer/email-sender.test.ts electron/download-handlers.ts electron/download-handlers.test.ts
git commit -m "feat: 분할 첨부 메일 전달을 지원"
```

### Task 6: 히스토리/문서 정리와 전체 검증

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/renderer/stores/history-store.ts`
- Modify: `docs/ipc-handlers.md`
- Modify: `docs/electron-renderer.md`
- Modify: `docs/download-history.md`
- Modify: `docs/packagers.md`
- Verify: `scripts/verify-worktree.sh`

- [ ] **Step 1: Write the failing test**

히스토리 저장이 `artifactPaths`, `deliveryMethod`, `deliveryResult`를 유지한다고 가정하는 테스트 또는 기존 소비 코드 검증을 추가한다.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- electron/download-handlers.test.ts`
Expected: FAIL because history/output metadata is still incomplete.

- [ ] **Step 3: Write minimal implementation**

히스토리 타입/스토어를 확장하고, 문서에서 새 IPC 계약과 이메일 전달/파일 분할 동작을 반영한다.

- [ ] **Step 4: Run test to verify it passes**

Run: `bash scripts/verify-worktree.sh`
Expected: PASS if local dependencies are available; otherwise document the failure reason and rely on CI.

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/renderer/stores/history-store.ts docs/ipc-handlers.md docs/electron-renderer.md docs/download-history.md docs/packagers.md
git commit -m "docs: 이메일 전달 완료 메타데이터를 반영"
```
