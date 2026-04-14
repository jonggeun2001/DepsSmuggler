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
- 기본 include: `src/**/*.test.ts`, `tests/unit/**/*.test.ts`
- 기본 exclude: `node_modules`, `dist`, `tests/e2e/**`
- 실행 환경: `node`

대상 예시:

- downloader / resolver 로직
- packager / cache / config / shared 유틸리티
- 네트워크 호출을 모킹한 내부 동작
- renderer form 계약 유틸리티 (`src/renderer/pages/settings/settings-form-utils.test.ts`)

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
- CLI/Electron 경계는 순수 함수와 핸들러 단위로 나눠 검증하는 편이 유지보수에 유리합니다.

## 현재 문서화 포인트

- 테스트 수나 개별 케이스 개수는 자주 변하므로 이 문서에서는 고정값을 관리하지 않습니다.
- 정확한 범위는 `vitest.config.ts`, `playwright.config.ts`, `.github/workflows/*.yml`을 기준으로 확인합니다.

## 관련 문서

- [아키텍처 개요](./architecture-overview.md)
- [Electron / Renderer](./electron-renderer.md)
- [IPC 핸들러](./ipc-handlers.md)
