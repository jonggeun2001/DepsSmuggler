# 테스트

## 개요

이 저장소는 Vitest 기반 단위/통합 테스트와 Playwright 기반 기본 E2E 회귀 세트를 함께 운용합니다. CI는 GitHub Actions에서 테스트, 빌드, CLI 스모크, 타입 체크, 커버리지를 분리해 실행합니다.

## 로컬 검증 명령

```bash
# 표준 worktree 검증 진입점
bash scripts/ensure_verify_worktree.sh "$PWD"
bash scripts/verify-worktree.sh

# 단위 테스트
npm run test

# 통합 테스트 포함
INTEGRATION_TEST=true npm run test

# 커버리지
npm run test:coverage

# 린트/타입 체크
npm run lint
npx tsc --noEmit

# 보안/의존성 점검
npm audit
```

`scripts/verify-worktree.sh`는 현재 저장소의 `scripts.test` 계약을 그대로 호출하는 얇은 래퍼이며, worktree에서 공통 검증 진입점으로 사용합니다. 현재 자동 생성 범위는 `test`만 포함하고 `lint`/`typecheck`는 별도 명령으로 유지합니다.

보안/의존성 유지보수 작업에서는 `npm audit`와 함께 `npm test`, `npm run test:e2e`, `npx tsc --noEmit`를 묶어 확인합니다. direct dependency를 올린 뒤 transitive 취약점이 남으면, 가능한 한 patch/minor 범위에서 lockfile 재해결이나 `overrides`로 먼저 정리합니다.

## 테스트 종류

### 1. 단위 테스트

- 설정 파일: `vitest.config.ts`
- 기본 include: `src/**/*.test.ts`, `src/**/*.test.tsx`, `electron/**/*.test.ts`, `tests/unit/**/*.test.ts`, `tests/unit/**/*.test.tsx`
- 기본 exclude: `node_modules`, `dist`, `tests/e2e/**`
- 기본 실행 환경: `node`

렌더러 훅처럼 DOM이 필요한 일부 테스트는 파일 상단 `// @vitest-environment jsdom` 주석으로 개별 override 합니다. 다운로드 페이지 controller, `use-os-download-flow`, `use-settings-form-actions` 테스트가 이 방식을 사용합니다. Electron preload API와 외부 경계는 mock하고 실제 React 훅의 상태 전이와 정리 동작을 검증합니다. 실행에는 `package.json`에 선언된 `jsdom`과 `@testing-library/react`가 필요하며, 일부 의존성이 빠진 기존 `node_modules`를 재사용한 결과를 전체 테스트 통과로 간주하지 않습니다.

대상 예시:

- downloader / resolver 로직
- packager / cache / config / shared 유틸리티
- Electron `services/` 오케스트레이션과 package router/helper
- 네트워크 호출을 모킹한 내부 동작
- renderer form 계약 유틸리티 (`src/renderer/pages/settings/settings-form-utils.test.ts`)
- renderer store / hook 오케스트레이션 (`cart-store`, `download-store`, `settings-store`, `use-download-page-controller`)

Phase 1 characterization 범위에서 특히 회귀 게이트로 삼는 테스트는 다음과 같습니다.

- `src/core/resolver/pip-resolver.characterization.test.ts`
  - simple / extras / conflicts / markers / wheel-tags 5개 fixture를 JSON snapshot으로 고정
- `electron/services/download-orchestrator.test.ts`
  - 패키지 매니저별 happy path 매핑, 취소 경계, concurrency limiter, 진행률 이벤트 순서를 고정
- `src/renderer/stores/cart-store.test.ts`
- `src/renderer/stores/download-store.test.ts`
- `src/renderer/stores/settings-store.test.ts`
- `src/renderer/pages/download-page/hooks/use-download-page-controller.test.tsx`

### 기능·오류·경계값 회귀 범위

기존 동작을 기준으로 다음 공백을 보강합니다. 서비스 로직을 테스트에 맞추어 변경하지 않으며, 아래 테스트는 실제 레지스트리나 SMTP 서버에 접속하지 않습니다.

| 영역               | 테스트 위치                                                                                                                             | 주요 검증                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| CLI 설정·캐시      | `src/cli/commands/{config,cache}.test.ts`                                                                                               | 값 변환, 조회·초기화, 빈 캐시, 삭제 확인 거부, 디렉토리 소실, EACCES/EPERM, 실패 후 삭제 방지                    |
| Electron 저장·조회 | `electron/{config,cache,history,version}-handlers.test.ts`                                                                              | JSON 오류, 파일 권한·용량 오류, 히스토리 상한·순서, 빈 결과, 버전 캐시와 재시도                                  |
| Electron 다운로드  | `electron/services/{dependency-resolve-service,download-progress,os-search-service,os-package-router,os-download-orchestrator}.test.ts` | 미지원 입력, 의존성·검색 실패, 진행률 제한, 취소, 패키징 실패와 임시 파일 정리                                   |
| Docker             | `src/core/downloaders/docker-{auth,blob-downloader,catalog-cache,manifest-service,search-service}.test.ts`                              | 인증 거부·토큰 만료, 빈 목록, 플랫폼별 manifest 선택, 체크섬 불일치, 파일 권한, 캐시 복구                        |
| OS 패키지          | `src/core/downloaders/os-shared/{archive-packager,dependency-tree}.test.ts`, `src/core/resolver/os-resolver-utils.test.ts`              | 압축 형식·스크립트, 누락 파일, 순환·중복 의존성, 버전·아키텍처 필터, 요청 간 상태 격리                           |
| Python             | `src/core/shared/{pip-candidate,pip-tags,pip-provider,pypi-utils}.test.ts`                                                              | ABI·플랫폼, Python/패키지 버전 제약, 철회·시험 배포, 후보 없음, 의존성·캐시·실패 후 재시도                       |
| Conda·Maven        | `src/core/shared/{conda-utils,conda-validator,maven-utils}.test.ts`                                                                     | 압축 인덱스/일반 인덱스/API fallback, noarch, Python 빌드, 채널 거부, classifier, 잘못된·빈 응답                 |
| HTTP·파일·캐시     | `src/core/shared/{axios-http-client,file-utils}.test.ts`, `src/core/shared/cache/cache-store.test.ts`                                   | 상태·오류·진행률 전달, 바이트 전송, redirect, pause/cancel 정리, TTL 경계, 동시 실패·재시도, 손상 JSON·권한 오류 |
| 메일               | `src/core/mailer/email-sender-errors.test.ts`                                                                                           | 첨부 제한과 같은 크기/초과, 인증·수신자·파일 접근 오류, 부분 발송 중단, 연결 재시도                              |
| 렌더러 훅          | `src/renderer/pages/settings/use-settings-form-actions.test.ts`, `src/renderer/pages/download-page/hooks/use-os-download-flow.test.ts`  | 입력 검증·미저장 이동 방지, SMTP·캐시 실패, OS 선택, 늦은 응답, 히스토리·장바구니 보존, 구독 해제                |

커버리지는 `npm run test:coverage`로 확인합니다. 현재 커버리지 집계 대상은 `src/core/**/*.ts`이므로 CLI, Electron, 렌더러, E2E 테스트의 검증 범위와 구분해야 합니다. 외부 레지스트리 실제 연동 및 OS별 파일시스템 동작 전체를 mock 테스트가 보장하지는 않습니다.

### 2. 통합 테스트

- 파일명 관례: `*.integration.test.ts`
- 실제 외부 저장소/레지스트리를 호출하는 흐름을 검증합니다.
- 보통 `INTEGRATION_TEST=true`일 때만 실행되도록 테스트 코드에서 gating 합니다.

현재 코드베이스에는 다음과 같은 통합 테스트가 포함되어 있습니다.

- `src/core/downloaders/pip.integration.test.ts`
- `src/core/downloaders/conda.integration.test.ts`
- `src/core/downloaders/maven.integration.test.ts`
- `src/core/downloaders/npm.integration.test.ts`
- `src/core/downloaders/docker.integration.test.ts`
- `src/core/downloaders/yum.integration.test.ts`
- `src/core/downloaders/apt.integration.test.ts`
- `src/core/downloaders/apk.integration.test.ts`
- `src/core/downloaders/os.integration.test.ts`

### 3. E2E 회귀 세트

- 설정 파일: `playwright.config.ts`
- 설정상 테스트 디렉터리: `tests/e2e`
- 브라우저 프로젝트: `chromium`
- 로컬 web server: `npm run dev:vite`
- 공통 mock fixture: `tests/e2e/fixtures/mock-electron-app.ts`

현재 포함 시나리오:

- `tests/e2e/settings-regression.spec.ts`: 설정 저장, SMTP 연결 테스트 호출, 새로고침 후 값 유지
- `tests/e2e/download-smoke.spec.ts`: 장바구니에서 일반 다운로드 완료 화면까지의 smoke flow
- `tests/e2e/history-email-restore.spec.ts`: 이메일 전달 히스토리 재다운로드 시 수신자 복원과 전역 설정 보존
- `tests/e2e/os-package-download.spec.ts`: OS 패키지 전용 검색/다운로드 흐름
- `tests/e2e/cart-input-regression.spec.ts`: 빈 장바구니·입력, requirements 중복·주석·파일 업로드, 최신 버전 조회 실패, package.json 오류·scoped/dev 의존성, Maven JAR/POM 구분과 저장 복원
- `tests/e2e/download-cancel-retry.spec.ts`: 실제 시작·패키지 완료 상태를 기다린 뒤 취소와 새 세션 재시도를 검증

구성 동작:

- Electron preload/API와 외부 네트워크는 browser-side mock/stub으로 대체해 결정적 실행을 유지합니다.
- `CI`와 로컬 모두 worker `1`로 직렬 실행하며, `CI`에서는 retry `2`를 사용합니다.
- 로컬에서는 기존 `http://localhost:3000` 서버 재사용 가능
- 실패 시 screenshot, 첫 재시도에 trace 수집

설정 화면 관련 참고:

- `settings-form-utils.test.ts`는 SettingsPage 리팩터링 과정에서 form 값과 store 저장 shape 변환, SMTP 테스트 경로 분류(`ipc | browser-simulated | missing-ipc`)를 고정합니다.

로컬 준비:

- 최초 1회는 `npx playwright install chromium`으로 브라우저 바이너리를 설치해야 합니다.
- 이후 `npm run test:e2e`로 전체 회귀 세트를 실행할 수 있습니다.

## UI 수동 테스트 자산

UI 수동 검증과 E2E 전환 계획은 별도 문서로 관리합니다.

- [UI 테스트 체크리스트](./ui-testing-checklist.md): 릴리즈 전 smoke와 탐색적 QA에 바로 사용할 최소 확인 목록
- [UI 상세 테스트 케이스](./ui-testing-test-cases.md): 테스트 ID, 사전 조건, 절차, 기대 결과, 실패 기준
- [UI Playwright 전환 시나리오](./ui-testing-playwright-conversion.md): 현재 자동화 범위와 신규 E2E 후보, mock 전략
- [UI 테스트 결과 2026-04-14](./ui-testing-findings-2026-04-14.md): 생성된 UI 테스트 문서 기준 실제 실행 결과와 수정 필요 사항
- [UI 테스트 후속 수정 프롬프트 2026-04-14](./ui-testing-fix-prompt-2026-04-14.md): 다음 구현 세션용 실행 프롬프트와 ASCII-art 병렬도

## GitHub Actions

### `test.yml`

트리거:

- `push` to `main`, `develop`
- `pull_request` to `main`

주요 잡:

- `test`: Ubuntu/Windows/macOS + Node 20에서 `npm ci`, `npm test`, `npm run build`, CLI `--version`, `--help`
- `lint`: 이름은 lint지만 실제 검증은 `npx tsc --noEmit`
- `coverage`: `npm run test:coverage` 후 Codecov 업로드

### `release.yml`

릴리즈 워크플로우는 패키징 전에 다시 다음 검증을 수행합니다.

- `npm test`
- `npx tsc --noEmit`

그 후 Windows/macOS/Linux 패키징과 draft release 생성이 이어집니다.

## 테스트 작성 원칙

- 단위 테스트는 네트워크/파일 시스템 부작용을 가능한 한 모킹합니다.
- 통합 테스트는 실제 외부 저장소 호출이 필요한 경우에만 추가합니다.
- 새 기능을 추가할 때는 구현 파일 옆에 테스트를 두는 현재 관례를 따릅니다.
- CLI/Electron 경계는 thin handler wiring 테스트와 service/helper 단위 테스트를 분리해 검증합니다.
- Electron handler 테스트는 IPC 채널 등록과 service 위임만 확인하고, package type 분기/패키징/OS 전용 흐름은 `electron/services/*.test.ts`에서 검증합니다.
- renderer 다운로드 흐름처럼 상태 전이가 많은 코드는 page 컴포넌트 전체보다 store/hook 단위 characterization test를 우선 추가합니다.
- 권한 오류는 `chmod`나 실행 사용자의 권한에 의존하지 않고 파일/전송 경계에서 재현하며, 거절 이후 불필요한 저장·삭제·발송이 발생하지 않는지도 확인합니다.
- 타이머는 fake clock 또는 명시적 완료 신호로 제어합니다. E2E 취소 테스트는 취소 버튼 표시뿐 아니라 시나리오에 필요한 다운로드 시작·완료 상태를 먼저 확인합니다.
- 실패한 테스트를 통과시키기 위해 서비스 검증을 제거하거나 테스트의 최종 결과 검증을 약화하지 않습니다.

## 현재 문서화 포인트

- 테스트 수나 개별 케이스 개수는 자주 변하므로 이 문서에서는 고정값을 관리하지 않습니다.
- 정확한 범위는 `vitest.config.ts`, `playwright.config.ts`, `.github/workflows/*.yml`을 기준으로 확인합니다.

## 관련 문서

- [아키텍처 개요](./architecture-overview.md)
- [Electron / Renderer](./electron-renderer.md)
- [IPC 핸들러](./ipc-handlers.md)
