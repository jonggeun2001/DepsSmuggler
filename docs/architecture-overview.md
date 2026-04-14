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
│   ├── updater.ts
│   ├── version-handlers.ts
│   └── utils/logger.ts
├── src/
│   ├── renderer/
│   │   ├── App.tsx
│   │   ├── layouts/MainLayout.tsx
│   │   ├── pages/
│   │   ├── components/
│   │   ├── components/os/
│   │   └── stores/
│   ├── cli/
│   │   ├── index.ts
│   │   └── commands/
│   ├── core/
│   │   ├── downloaders/
│   │   ├── downloaders/os-shared/
│   │   ├── resolver/
│   │   ├── packager/
│   │   ├── mailer/
│   │   ├── shared/
│   │   ├── config.ts
│   │   ├── download-manager.ts
│   │   └── cache-manager.ts
│   ├── types/
│   └── utils/
├── docs/
└── .github/workflows/
```

## 계층별 역할

### 1. Renderer (`src/renderer`)

- React Router 기준 경로는 `/`, `/wizard`, `/cart`, `/download`, `/history`, `/settings`입니다.
- `MainLayout.tsx`가 좌측 네비게이션과 공통 레이아웃을 담당합니다.
- `HomePage.tsx`와 `WizardPage.tsx`는 패키지 타입 선택과 검색 진입을 담당합니다.
- `CartPage.tsx`는 장바구니와 텍스트 입력 기반 패키지 추가를 담당합니다.
- `DownloadPage.tsx`는 orchestration 레이어이며, 실제 일반 다운로드 상태/완료 처리와 OS 전용 흐름은 `pages/download-page/` 아래 hook/component/util로 분리되어 있습니다.
- `HistoryPage.tsx`와 `SettingsPage.tsx`는 각각 다운로드 이력과 앱 설정을 관리합니다.
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
- SSL 검증은 기본적으로 완화되며 `DEPSSMUGGLER_STRICT_SSL=true`일 때만 엄격 모드로 전환됩니다.

### 4. Core (`src/core`)

- `downloaders/`: 패키지 타입별 검색/다운로드 구현
- `downloaders/os-shared/`: YUM/APT/APK 공용 저장소, 캐시, 스크립트, 아카이브, 로컬 저장소 패키징
- `resolver/`: 타입별 의존성 계산
- `packager/`: 일반 패키지용 아카이브/스크립트/분할 처리
- `mailer/`: SMTP 발송
- `shared/`: HTTP, 캐시, 버전 비교, 플랫폼 매핑, 버전 프리로드, 마스킹 등 공통 유틸리티

### 5. CLI (`src/cli`)

- `index.ts`가 `download`, `search`, `config`, `cache`, `os` 명령을 등록합니다.
- 일반 패키지 CLI는 현재 `pip`, `conda`, `maven`, `docker` 검색과 `pip`, `conda`, `maven`, `npm`, `docker` 다운로드에 초점이 맞춰져 있습니다.
- OS CLI는 `list-distros`, `search`, `download`, `cache`를 자체 backend(`downloaders/os-shared/cli-backend.ts`)로 실행합니다.

## 주요 도메인 모듈

| 영역 | 현재 구현 위치 | 비고 |
|------|----------------|------|
| 일반 다운로드 | `src/core/downloaders/*.ts` | `pip`, `conda`, `maven`, `npm`, `docker`, `yum`, `apt`, `apk` |
| OS 공용 기능 | `src/core/downloaders/os-shared/*` | 저장소 프리셋, GPG, 로컬 repo 패키징 |
| 의존성 해결 | `src/core/resolver/*.ts` | `pip`, `conda`, `maven`, `npm`, `yum`, `apt`, `apk` |
| 공통 의존성 유틸 | `src/core/shared/dependency-resolver.ts` | 타입별 resolver orchestration |
| 일반 패키징 | `src/core/packager/*` | archive, script, file splitter |
| 설정 | `src/core/config.ts` | `~/.depssmuggler/settings.json` |
| 캐시 | `src/core/cache-manager.ts`, `src/core/shared/*-cache.ts` | 타입별 캐시 분리 |
| 메일 | `src/core/mailer/email-sender.ts` | SMTP 테스트/발송 |

## 런타임 데이터 흐름

### 일반 패키지 다운로드

1. Renderer가 `window.electronAPI.search.*` 또는 `dependency.resolve` 호출
2. `search-handlers.ts`가 downloader/resolver를 호출
3. `DownloadPage.tsx`의 `use-download-page-controller.tsx`가 `download:start`를 호출
4. `download-handlers.ts`가 core downloader와 packager를 실행
5. 진행률 이벤트를 `download:*` 채널로 렌더러에 다시 전송
6. 완료 시 출력 디렉터리와 결과를 히스토리에 저장

참고: 일반 패키지 경로는 현재 `zip`과 `tar.gz` 아카이브를 모두 지원하며, 전달 방식은 `local | email` 중에서 선택합니다.

### OS 패키지 다운로드

1. `WizardPage.tsx`가 `os:search`로 `yum/apt/apk` 패키지를 찾고, 전체 `OSPackageInfo`를 장바구니 메타데이터로 유지합니다.
2. OS 패키지 전용 장바구니만 담긴 상태에서 `DownloadPage.tsx`는 `pages/download-page/hooks/use-os-download-flow.ts`를 통해 동일 라우트(`/download`) 안에서 OS 전용 다운로드 화면으로 전환합니다.
3. OS 전용 흐름은 `os:getDistribution`으로 선택된 배포판 전체 설정을 읽고 `archive | repository | both` 출력 옵션을 노출합니다. `repository`/`both`에서는 로컬 저장소 설정 스크립트가 기본 포함됩니다.
4. 실제 다운로드 시작은 `os:download:start` 하나로 통합되어, 메인 프로세스가 필요 시 의존성 해결과 패키징까지 수행합니다. 미해결 의존성은 이 단계에서 즉시 중단되고, resolving 단계 취소도 오류보다 우선해 중단 결과를 반환합니다.
5. 진행률은 `os:download:progress`로, 취소는 `os:download:cancel`로 처리됩니다. 취소 요청은 현재 OS 패키지 전송의 `fetch`에도 abort 신호를 전달합니다.
6. 결과 출력물 경로와 `generatedOutputs`, `warnings`, `conflicts`, `cancelled` 상태는 `os:download:start` 반환값으로 렌더러에 전달됩니다. 취소로 최종 산출물이 생성되지 않은 경우에는 임시 다운로드를 성공으로 승격하지 않고, routed OS 결과 화면에서 중단 상태와 실제 생성물만 안내합니다.

## 상태 저장

- 파일 기반 설정: `~/.depssmuggler/settings.json`
- 파일 기반 히스토리: `~/.depssmuggler/history.json`
- 파일 기반 패키지 메타데이터 캐시/로그: `~/.depssmuggler/cache`, `~/.depssmuggler/logs`
- Python 버전 캐시와 settings store 백업은 renderer `localStorage`를 함께 사용합니다.
- Renderer 상태: Zustand + persist 기반입니다.
- 설정 상태는 Electron 환경에서 IPC를 통해 `~/.depssmuggler/settings.json`과 동기화됩니다.
- 장바구니/히스토리 상태는 현재 persist 저장소가 source of truth이며, `history.json` 기반 IPC는 부분 연결 상태입니다.

## 업데이트 및 버전 프리로드

- 자동 업데이트는 `electron/updater.ts`와 `src/renderer/components/UpdateNotification.tsx`가 담당합니다.
- 버전 프리로드는 `electron/version-handlers.ts`와 `src/core/shared/version-preloader.ts`가 담당합니다.
- 현재 IPC 기반 버전 로딩은 Python/CUDA에 집중되어 있고 Java/Node 선택지는 렌더러의 정적 옵션을 사용합니다.

## 개발/검증 기준

```bash
npm run dev
npm run build
npm run test
INTEGRATION_TEST=true npm run test
npm run lint
npx tsc --noEmit
```

참고: `tests/e2e`에는 설정 반영, 장바구니→다운로드 smoke, 이메일 히스토리 복원, OS 패키지 흐름을 검증하는 기본 Playwright 회귀 세트가 있습니다. 이 세트는 `tests/e2e/fixtures/mock-electron-app.ts`로 Electron bridge와 외부 호출을 고정 응답으로 대체해 결정적으로 실행됩니다.

## 관련 문서

- [문서 상태와 source of truth](./documentation-status.md)
- [Electron / Renderer](./electron-renderer.md)
- [IPC 핸들러](./ipc-handlers.md)
- [CLI](./cli.md)
- [테스트](./testing.md)
