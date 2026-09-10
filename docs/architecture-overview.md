# DepsSmuggler 아키텍처 개요

## 개요

DepsSmuggler는 Electron 메인 프로세스, React 렌더러, TypeScript core 모듈, Commander 기반 CLI가 하나의 저장소에 공존하는 구조입니다. 현재 코드베이스의 source of truth는 `electron/`, `src/renderer/`, `src/cli/`, `src/core/`입니다.

## 최상위 구조

```text
depssmuggler/
├── electron/
│   ├── main.ts
│   ├── preload.ts
│   ├── cache-handlers.ts
│   ├── config-handlers.ts
│   ├── download-handlers.ts
│   ├── history-handlers.ts
│   ├── search-handlers.ts
│   ├── services/
│   ├── updater.ts
│   ├── version-handlers.ts
│   └── utils/logger.ts
├── src/
│   ├── renderer/
│   │   ├── router.tsx
│   │   ├── lib/
│   │   ├── layouts/MainLayout.tsx
│   │   ├── pages/
│   │   ├── components/
│   │   ├── components/os/
│   │   └── stores/
│   ├── cli/
│   │   ├── index.ts
│   │   └── commands/
│   │       ├── download.ts
│   │       └── download-runner.ts
│   ├── core/
│   │   ├── downloaders/
│   │   ├── downloaders/lang-shared/
│   │   ├── downloaders/os-shared/
│   │   ├── ports/
│   │   ├── resolver/
│   │   ├── packager/
│   │   ├── mailer/
│   │   ├── shared/
│   │   ├── config.ts
│   │   └── cache-manager.ts      # compatibility shim → shared/cache/artifact-cache.ts
│   ├── types/
│   └── utils/
├── docs/
└── .github/workflows/
```

## 계층별 역할

### 1. Renderer (`src/renderer`)

- React Router 기준 경로는 `/`, `/wizard`, `/cart`, `/download`, `/history`, `/settings`입니다.
- 라우트 source of truth는 `src/renderer/router.tsx`이며, `src/renderer/index.tsx`는 `createAppRouter()`만 소비합니다.
- `MainLayout.tsx`가 좌측 네비게이션과 공통 레이아웃을 담당합니다.
- `HomePage.tsx`와 `WizardPage.tsx`는 패키지 타입 선택과 검색 진입을 담당합니다.
- `CartPage.tsx`는 장바구니와 텍스트 입력 기반 패키지 추가를 담당하며, BOM을 포함한 Maven POM 입력의 artifact type metadata를 미리보기·의존성 해결·다운로드 경계까지 유지하고 같은 GAV라도 type이 다른 artifact를 구분합니다.
- 장바구니의 Maven artifact type 정보는 Electron 다운로드 라우터까지 전달됩니다. 같은 출력 디렉터리·GAV의 다운로드와 복사는 main service에서 직렬화해 JAR의 부속 POM과 별도 POM 작업 간 파일 쓰기 충돌을 방지합니다.
- `DownloadPage.tsx`는 orchestration 레이어이며, 실제 일반 다운로드 상태/완료 처리와 OS 전용 흐름은 `pages/download-page/` 아래 hook/component/util로 분리되어 있습니다.
- `HistoryPage.tsx`와 `SettingsPage.tsx`는 각각 다운로드 이력과 앱 설정을 관리합니다.
- `renderer/lib/renderer-data-client.ts`가 renderer와 Electron 사이의 검색/버전조회/히스토리 I/O facade 역할을 맡습니다.
- `SettingsPage.tsx`는 환경별 설정 폼과 버전/배포판 목록을 구성하고, `src/renderer/pages/settings/` 아래 섹션 컴포넌트와 `use-settings-form-actions.ts`가 전달/캐시/업데이트 액션과 dirty/save 계약을 나눠 담당합니다.
- `components/os/`는 OS 패키지 전용 검색, 출력 옵션, 결과 렌더링을 분리합니다.
- `UpdateNotification.tsx`는 Electron auto updater 상태를 UI로 노출합니다.

### 2. Preload (`electron/preload.ts`)

- `window.electronAPI` 하나로 렌더러에 안전한 IPC 인터페이스를 제공합니다.
- 주요 그룹:
  - `download`, `search`, `dependency`
  - `config`, `cache`, `history`
  - `os`, `docker.cache`, `maven`
  - `updater`, `versions`
  - 공통 다이얼로그/앱 정보 API

### 3. Main Process (`electron`)

- `main.ts`가 BrowserWindow 생성, 개발 서버 대기, 기본 다이얼로그 IPC, 버전 프리로드, updater 초기화를 담당합니다.
- `config-handlers.ts`, `cache-handlers.ts`, `history-handlers.ts`, `search-handlers.ts`, `download-handlers.ts`, `version-handlers.ts`, `updater.ts`가 기능별 IPC를 등록합니다.
- `electron/services/`는 메인 프로세스용 orchestration 계층입니다. download/search handler는 채널 등록만 하고, package type 분기, resolver 선택, progress emit, 패키징, OS 전용 흐름은 service/helper 모듈로 위임합니다.
- SSL 검증은 기본적으로 완화되며 `DEPSSMUGGLER_STRICT_SSL=true`일 때만 엄격 모드로 전환됩니다.

### 4. Core (`src/core`)

- `downloaders/`: 패키지 타입별 검색/다운로드 구현
- `downloaders/lang-shared/`: 언어 패키지 downloader가 공유하는 스트림 저장, 진행률 계산, 파일명 정규화, 검증 실패 정리 계층
- `downloaders/os-shared/`: YUM/APT/APK 공용 저장소, 캐시, 스크립트, 아카이브, 로컬 저장소 패키징
- `ports/`: downloader와 resolver 사이에 두는 패키지 메타데이터/파일 fetch 경계. orchestration 계층이 구현체를 조합합니다.
- `resolver/`: 타입별 의존성 계산
- `packager/`: 일반 패키지용 아카이브/스크립트/분할 처리
- `mailer/`: SMTP 발송
- `shared/`: HTTP, 캐시, 버전 비교, 플랫폼 매핑, 버전 프리로드, 마스킹 등 공통 유틸리티
- 공용 타입은 core 내부가 아닌 `src/types/`에 있습니다. `src/types/index.ts` barrel과 `download/`, `manifest/`, `package-manager/`, `platform/`, `resolver/` 하위 canonical module로 분리되어 있습니다.
  `download/options.ts`, `download/progress.ts`, `download/error.ts`, `platform/os-target.ts`가 Phase 2 기준 canonical entry입니다.

### 5. CLI (`src/cli`)

- `index.ts`가 `download`, `search`, `config`, `cache`, `os` 명령을 등록합니다.
- 일반 패키지 CLI는 `pip`, `conda`, `maven`, `npm`, `docker`의 검색과 다운로드를 지원합니다. GUI의 SMTP 전달·자동 분할·히스토리 저장은 CLI 명령에 연결되어 있지 않습니다.
- OS CLI는 `list-distros`, `search`, `download`, `cache`를 자체 backend(`downloaders/os-shared/cli-backend.ts`)로 실행합니다.

## 주요 도메인 모듈

| 영역 | 현재 구현 위치 | 비고 |
|------|----------------|------|
| 일반 다운로드 | `src/core/downloaders/*.ts` | `pip`, `conda`, `maven`, `npm`, `docker`, `yum`, `apt`, `apk` |
| 언어 downloader 공용 레이어 | `src/core/downloaders/lang-shared/*` | 현재 `pip`, `conda`, `npm`, `maven`이 공통 artifact 저장 로직을 재사용 |
| OS 공용 기능 | `src/core/downloaders/os-shared/*` | 저장소 프리셋, GPG, 로컬 repo 패키징 |
| Core 경계 포트 | `src/core/ports/*` | package metadata 조회, package fetch 스트림 |
| 의존성 해결 | `src/core/resolver/*.ts` | `pip`, `conda`, `maven`, `npm`, `yum`, `apt`, `apk` |
| 공통 의존성 유틸 | `src/core/shared/dependency-resolver.ts` | 타입별 resolver orchestration |
| 일반 패키징 | `src/core/packager/*` | archive, script, file splitter |
| 설정 | `src/core/config.ts` | `~/.depssmuggler/settings.json` |
| 캐시 | `src/core/shared/cache/artifact-cache.ts`, `src/core/shared/cache/cache-store.ts`, `src/core/shared/*-cache.ts` | canonical cache modules + compatibility shims |
| 메일 | `src/core/mailer/email-sender.ts` | SMTP 테스트/발송 |

## 런타임 데이터 흐름

### 일반 패키지 다운로드

1. Renderer가 검색/버전 조회는 `renderer-data-client`를 통해 `window.electronAPI.search.*`로, 의존성 계산은 `window.electronAPI.dependency.resolve`로 요청
2. `search-handlers.ts`가 `electron/services/search-orchestrator.ts`와 관련 service에 위임
3. `DownloadPage.tsx`의 `use-download-page-controller.tsx`가 `download:start`를 호출
4. `download-handlers.ts`가 `electron/services/download-orchestrator.ts`를 호출하고, 서비스가 `electron/services/download/session-registry.ts`, `download-session.ts`, `delivery-pipeline.ts`, `concurrency-limiter.ts`로 세션 상태/실행 루프/전달 파이프라인/동시성 제어를 분리한 뒤 package router/progress emitter/packager를 조합해 실행
5. 진행률 이벤트를 `download:*` 채널로 렌더러에 다시 전송
6. 완료 시 실제 산출물 경로와 전달 결과를 히스토리에 저장. 파일 저장이 성공한 뒤 히스토리 store를 갱신하고, 성공한 현재 세션의 장바구니만 정리

참고: `zip`과 `tar.gz` 패키징은 동일 orchestration service를 통해 처리되고, 전달 방식은 `local | email`이며 preload/renderer contract는 그대로 유지됩니다.

이메일 첨부가 한도를 넘고 분할 옵션이 켜져 있으면 전달 파이프라인이 실제 아카이브를 분할합니다. 분할이 꺼져 있으면 아카이브와 오류를 보존하며, 로컬 저장에는 이 자동 분할 단계가 없습니다.

### OS 패키지 다운로드

1. `WizardPage.tsx`가 `os:search`로 `yum/apt/apk` 패키지를 찾고, 전체 `OSPackageInfo`를 장바구니 메타데이터로 유지합니다.
2. 장바구니가 OS 패키지로만 구성되고 모든 항목의 `metadata.osContext`에 패키지 관리자·배포판·아키텍처가 동일하게 저장되어 있으면 `DownloadPage.tsx`가 `pages/download-page/hooks/use-os-download-flow.ts`를 통해 동일 라우트(`/download`) 안에서 전용 화면으로 전환합니다. context가 누락된 OS 장바구니는 재선택 안내를 표시합니다. 일반 패키지가 섞이거나 서로 다른 context인 경우에는 전용 흐름이 성립하지 않습니다.
3. OS 전용 흐름은 `os:getDistribution`으로 선택된 배포판 전체 설정을 읽고 `archive | repository | both` 출력 옵션을 노출합니다. `repository`/`both`에서는 로컬 저장소 설정 스크립트가 기본 포함됩니다.
4. 실제 다운로드 시작은 `os:download:start` 하나로 통합되어, `electron/services/os-download-orchestrator.ts`가 필요 시 의존성 해결과 패키징까지 수행합니다. 미해결 의존성은 이 단계에서 즉시 중단되고, resolving 단계 취소도 오류보다 우선해 중단 결과를 반환합니다.
5. 진행률은 `os:download:progress`로, 취소는 `os:download:cancel`로 처리됩니다. 취소 요청은 현재 OS 패키지 전송의 `fetch`에도 abort 신호를 전달합니다.
6. 결과 출력물 경로와 `generatedOutputs`, `warnings`, `conflicts`, `cancelled` 상태는 `os:download:start` 반환값으로 렌더러에 전달됩니다. 취소로 최종 산출물이 생성되지 않은 경우에는 임시 다운로드를 성공으로 승격하지 않고, routed OS 결과 화면에서 중단 상태와 실제 생성물만 안내합니다.

OS 전용 흐름은 로컬 저장으로 동작하며, 일반 다운로드의 SMTP 전달·자동 분할 파이프라인을 사용하지 않습니다. Electron의 `os:cache:*`는 아직 placeholder이고, 실제 OS CLI 캐시는 `<cachePath>/os-packages`의 JSON 파일을 관리합니다. CLI의 `cacheEnabled`와 `maxCacheSize`를 검색·다운로드 backend에 전달하며, 크기 한도는 저장 데이터의 추정 크기에 적용합니다. 기본값과 별도 캐시의 범위는 [캐시 문서](shared-cache.md#os-메타데이터-캐시-설정)를 참고하세요.

## 상태 저장

캐시 여부는 파일의 `enableCache`를 기준으로 CLI의 `cacheEnabled`와 비동기 core API의 `cachingEnabled`에 연결합니다. 이전 별칭은 읽기 호환성을 유지하고 명시적 저장 시 제거합니다. 비동기 `saveConfig`/`updateConfig`는 호출자가 넘긴 `cachingEnabled`를 저장 키에 반영합니다.

- 파일 기반 설정: `~/.depssmuggler/settings.json`
- 파일 기반 히스토리: `~/.depssmuggler/history.json`
- 파일 기반 패키지 메타데이터 캐시/로그: `~/.depssmuggler/cache`, `~/.depssmuggler/logs`
- Python 버전 캐시와 settings store 백업은 renderer `localStorage`를 함께 사용합니다.
- Renderer 상태는 Zustand로 관리하며, 장바구니와 설정 백업에 persist/localStorage를 사용합니다. 다운로드 실행 상태는 메모리에 유지합니다.
- 설정 상태는 Electron 환경에서 IPC를 통해 `~/.depssmuggler/settings.json`과 동기화됩니다.
- 설정 화면의 저장 계약은 `settings-form-utils.ts`가 form 값과 store shape 간 변환을 맡아 유지합니다.
- 장바구니는 persist 기반이고, 히스토리는 완전한 `history` IPC가 있는 Electron 환경에서 `history.json`을 기준으로 사용합니다. history IPC가 없거나 일부 빠진 브라우저/테스트 환경에서는 data client가 localStorage를 사용합니다.

### 설정 읽기 실패의 격리

`ConfigManager.loadConfig()`는 디렉터리 생성·읽기·최초 기본값 저장 실패 시 메모리 기본값을 반환합니다. 읽기에 실패한 기존 파일을 기본값으로 덮어쓰지 않으며, 명시적인 저장/초기화 실패는 계속 호출자에게 전달합니다. 잘못된 동시 다운로드 수·분할 크기·캐시 여부·SMTP 필드는 기본값/미설정 값으로 복구하고 정상 필드는 유지합니다. 잘못된 필드가 있는 파일은 암호화 마이그레이션도 명시적 저장까지 미뤄 원본을 보존합니다. 정상 설정의 자동 마이그레이션은 유지하며, 저장이 실패해도 이미 읽은 설정은 반환합니다. 로그의 `[config:load]`, `[config:get]`, `[config:migrate]`로 실패 지점을 구분합니다. `src/core/config.test.ts`는 임시 홈에서 권한/용량 오류와 레거시 암호화 조합을 포함한 원본 보존을 검증합니다.

## 업데이트 및 버전 프리로드

Electron의 앱 준비/창 생성과 활성화 시 창 재생성 Promise는 실패를 `Main` 로그에 기록합니다. 처리되지 않은 Promise 예외로 방치하지 않으며, 화면 파일 손상처럼 창을 로드할 수 없는 상황을 성공으로 취급하거나 새 자동 복구 기능을 추가하지는 않습니다. `electron/main-lifecycle.test.ts`로 검증합니다.

- 자동 업데이트는 `electron/updater.ts`와 `src/renderer/components/UpdateNotification.tsx`가 담당합니다. 패치 노트는 DOMPurify로 정제해 제목·목록 등 HTML 서식을 표시하며, HTTP(S) 링크 열기는 updater IPC를 통해 시스템 브라우저에 위임합니다. 문자열·버전별 배열·빈 노트 처리와 검증 방법은 [Electron / Renderer](electron-renderer.md#자동-업데이트)를 참고하세요.
- 패키징된 앱은 시작 후 업데이트를 확인하고 사용자 선택으로 다운로드·설치합니다. 개발 모드는 더미 IPC를 사용합니다. 설정 UI의 `autoUpdate`/`autoDownloadUpdate`는 저장·복원되지만 현재 시작 검사나 `updater:set-auto-download`와 연결되어 있지 않습니다.
- 버전 프리로드는 `electron/version-handlers.ts`와 `src/core/shared/version-preloader.ts`가 담당합니다.
- 현재 IPC 기반 런타임 버전 로딩은 Python/CUDA에 집중되어 있고 Java/Node 런타임 선택 단계는 없습니다. 라이브러리와 컨테이너 패키지 자체의 버전 목록은 검색/버전 조회 API로 가져옵니다.

## 개발/검증 기준

```bash
npm run dev
npm run build
npm run test
INTEGRATION_TEST=true npm run test
npm run lint
npx tsc --noEmit
npx tsc --noEmit -p tsconfig.electron.json
npm run test:e2e
```

참고: `tests/e2e`에는 설정 반영, 장바구니→다운로드 smoke, 이메일 히스토리 복원, OS 패키지 흐름을 검증하는 기본 Playwright 회귀 세트가 있습니다. 이 세트는 `tests/e2e/fixtures/mock-electron-app.ts`와 OS spec의 inline stub으로 Electron bridge와 외부 호출을 고정 응답으로 대체해 결정적으로 실행됩니다.

## 관련 문서

- [문서 상태와 source of truth](./documentation-status.md)
- [Electron / Renderer](./electron-renderer.md)
- [IPC 핸들러](./ipc-handlers.md)
- [CLI](./cli.md)
- [테스트](./testing.md)
