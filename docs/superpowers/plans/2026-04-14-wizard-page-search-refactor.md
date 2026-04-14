# WizardPage Search Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `WizardPage`에서 검색/버전조회/OS 배포판 분기 로직을 훅과 서비스로 분리해 페이지 본체를 화면 조합 중심으로 축소한다.

**Architecture:** `src/renderer/pages/wizard-page/` 아래에 순수 헬퍼(`query-params`, `os-context`), 테스트 가능한 서비스(`search-service`, `version-service`), 오케스트레이션 훅(`useWizardSearchFlow`)을 추가한다. `WizardPage.tsx`는 router/store 값을 읽고 훅 반환값을 UI에 바인딩하는 역할만 유지한다.

**Tech Stack:** React 19, TypeScript, Zustand, React Router, Vitest

---

### Task 1: Query Param / OS Context 순수 모듈 추출

**Files:**
- Create: `src/renderer/pages/wizard-page/types.ts`
- Create: `src/renderer/pages/wizard-page/query-params.ts`
- Create: `src/renderer/pages/wizard-page/query-params.test.ts`
- Create: `src/renderer/pages/wizard-page/os-context.ts`
- Create: `src/renderer/pages/wizard-page/os-context.test.ts`
- Modify: `src/renderer/pages/WizardPage.tsx`

- [ ] **Step 1: Query param/OS context 실패 테스트 작성**

테스트 대상:
- 유효한 `type` query param은 category/package type/step을 계산한다.
- 무효한 `type`은 무시한다.
- `yum/apt/apk`별 distribution payload와 effective architecture를 계산한다.

- [ ] **Step 2: 테스트를 실행해 실패를 확인**

Run:
```bash
npx vitest run src/renderer/pages/wizard-page/query-params.test.ts src/renderer/pages/wizard-page/os-context.test.ts
```

Expected: 새 모듈 미존재 또는 구현 누락으로 FAIL

- [ ] **Step 3: 최소 구현 추가**

구현 내용:
- `types.ts`에 `SearchResult`, search/version context 타입 정의
- `query-params.ts`에 `resolveWizardTypeParam` 계열 순수 함수 추가
- `os-context.ts`에 OS distribution payload, cart snapshot, effective architecture 계산 함수 추가

- [ ] **Step 4: 테스트 재실행**

Run:
```bash
npx vitest run src/renderer/pages/wizard-page/query-params.test.ts src/renderer/pages/wizard-page/os-context.test.ts
```

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/renderer/pages/wizard-page/types.ts src/renderer/pages/wizard-page/query-params.ts src/renderer/pages/wizard-page/query-params.test.ts src/renderer/pages/wizard-page/os-context.ts src/renderer/pages/wizard-page/os-context.test.ts src/renderer/pages/WizardPage.tsx
git commit -m "refactor: extract WizardPage query param helpers"
```

### Task 2: 검색 서비스 추출

**Files:**
- Create: `src/renderer/pages/wizard-page/search-service.ts`
- Create: `src/renderer/pages/wizard-page/search-service.test.ts`
- Modify: `src/renderer/pages/WizardPage.tsx`

- [ ] **Step 1: 검색 서비스 실패 테스트 작성**

테스트 대상:
- package type별 전략 선택
- Electron IPC 우선 사용
- IPC 미존재 시 HTTP fallback
- OS 검색 결과를 `SearchResult`로 매핑
- pip/conda/docker 옵션 전달

- [ ] **Step 2: 테스트를 실행해 실패를 확인**

Run:
```bash
npx vitest run src/renderer/pages/wizard-page/search-service.test.ts
```

Expected: 모듈 미존재 또는 계약 불일치로 FAIL

- [ ] **Step 3: 최소 구현 추가**

구현 내용:
- `createSearchService` 또는 동등한 계약으로 의존성 주입 가능하게 구성
- suggestion/full search 둘 다 같은 전략 계층을 사용
- OS 검색 분기와 Electron/HTTP fallback을 내부에서 캡슐화

- [ ] **Step 4: 테스트 재실행**

Run:
```bash
npx vitest run src/renderer/pages/wizard-page/search-service.test.ts
```

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/renderer/pages/wizard-page/search-service.ts src/renderer/pages/wizard-page/search-service.test.ts src/renderer/pages/WizardPage.tsx
git commit -m "refactor: extract WizardPage search service"
```

### Task 3: 버전 조회 서비스 추출

**Files:**
- Create: `src/renderer/pages/wizard-page/version-service.ts`
- Create: `src/renderer/pages/wizard-page/version-service.test.ts`
- Modify: `src/renderer/pages/WizardPage.tsx`

- [ ] **Step 1: 버전 조회 서비스 실패 테스트 작성**

테스트 대상:
- Electron `search.versions` 우선
- PyPI/Maven/Docker fallback
- OS 검색 결과의 버전 배열 재사용
- Maven classifier 부가 조회 결과 조립

- [ ] **Step 2: 테스트를 실행해 실패를 확인**

Run:
```bash
npx vitest run src/renderer/pages/wizard-page/version-service.test.ts
```

Expected: 모듈 미존재 또는 구현 누락으로 FAIL

- [ ] **Step 3: 최소 구현 추가**

구현 내용:
- `loadPackageVersionDetails` 계약으로 package type별 버전 로딩 전략 분리
- `usedIndexUrl`, classifier 관련 반환값 포함
- 버전 배열이 없는 경우 단일 버전 fallback 처리

- [ ] **Step 4: 테스트 재실행**

Run:
```bash
npx vitest run src/renderer/pages/wizard-page/version-service.test.ts
```

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/renderer/pages/wizard-page/version-service.ts src/renderer/pages/wizard-page/version-service.test.ts src/renderer/pages/WizardPage.tsx
git commit -m "refactor: extract WizardPage version service"
```

### Task 4: 오케스트레이션 훅으로 상태 이관

**Files:**
- Create: `src/renderer/pages/wizard-page/useWizardSearchFlow.ts`
- Create: `src/renderer/pages/wizard-page/useWizardSearchFlow.test.tsx`
- Modify: `src/renderer/pages/WizardPage.tsx`

- [ ] **Step 1: 훅 실패 테스트 작성**

테스트 대상:
- 입력 변경 시 디바운스 검색 호출
- 패키지 선택 시 버전 단계로 이동
- reset 동작
- 서비스 반환값이 UI 상태로 반영됨

- [ ] **Step 2: 테스트를 실행해 실패를 확인**

Run:
```bash
npx vitest run src/renderer/pages/wizard-page/useWizardSearchFlow.test.tsx
```

Expected: 훅 미존재 또는 동작 불일치로 FAIL

- [ ] **Step 3: 최소 구현 추가**

구현 내용:
- 검색 관련 state/action을 훅으로 이동
- service 호출, 디바운스 타이머, 선택/초기화 로직을 훅에 집중
- `WizardPage.tsx`는 훅 API를 소비하도록 변경

- [ ] **Step 4: 테스트 재실행**

Run:
```bash
npx vitest run src/renderer/pages/wizard-page/useWizardSearchFlow.test.tsx
```

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/renderer/pages/wizard-page/useWizardSearchFlow.ts src/renderer/pages/wizard-page/useWizardSearchFlow.test.tsx src/renderer/pages/WizardPage.tsx
git commit -m "refactor: move WizardPage search flow into hook"
```

### Task 5: 페이지 정리 및 문서/검증

**Files:**
- Modify: `src/renderer/pages/WizardPage.tsx`
- Modify: `docs/electron-renderer.md`
- Modify: `docs/documentation-status.md`

- [ ] **Step 1: `WizardPage.tsx` 정리**

구현 내용:
- 페이지에 남은 search/version/query-param/OS helper inline 구현 제거
- 화면 조합, 섹션 렌더링, store/router wiring만 유지

- [ ] **Step 2: 문서 업데이트**

반영 내용:
- renderer search flow 책임 분리
- 새 모듈 위치와 역할

- [ ] **Step 3: 전체 관련 검증 실행**

Run:
```bash
npx vitest run src/renderer/pages/wizard-page/query-params.test.ts src/renderer/pages/wizard-page/os-context.test.ts src/renderer/pages/wizard-page/search-service.test.ts src/renderer/pages/wizard-page/version-service.test.ts src/renderer/pages/wizard-page/useWizardSearchFlow.test.tsx
npx tsc --noEmit --pretty false
```

Expected: PASS

- [ ] **Step 4: 최종 커밋**

```bash
git add src/renderer/pages/WizardPage.tsx src/renderer/pages/wizard-page docs/electron-renderer.md docs/documentation-status.md
git commit -m "refactor: split WizardPage search flow"
```
