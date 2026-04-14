# Electron & Renderer

## 개요

데스크톱 앱은 Electron main process와 React renderer가 `window.electronAPI` IPC 브리지로 통신하는 구조입니다. 핵심 다운로드/설정/검색 흐름은 IPC 기준이지만, 일부 검색과 버전 조회에는 `/api/...` 직접 호출이나 HTTP 폴백이 남아 있는 혼합 모델입니다.

현재 확인된 예시는 다음과 같습니다.

- `src/renderer/pages/CartPage.tsx`는 일부 최신 버전 조회를 `/api/pypi`, `/api/maven`, `/api/npm`으로 직접 호출합니다.
- `src/renderer/pages/WizardPage.tsx`는 npm 검색, Docker 검색/태그 조회에서 IPC 우선 후 HTTP 폴백을 유지합니다.

## 현재 화면 구조

현재 라우트 source of truth는 `src/renderer/index.tsx`의 `createHashRouter`입니다. `src/renderer/App.tsx`는 유사한 라우트 정의를 담고 있지만 현재 엔트리포인트에서 import되지 않는 레거시 파일입니다.

| 경로 | 컴포넌트 | 역할 |
|------|----------|------|
| `/` | `HomePage` | 패키지 매니저 선택 홈 |
| `/wizard` | `WizardPage` | 검색/버전/배포판 선택 위자드 |
| `/cart` | `CartPage` | 장바구니와 텍스트 입력 |
| `/download` | `DownloadPage` | 의존성 해결, 다운로드, 결과 표시 |
| `/history` | `HistoryPage` | 다운로드 이력 |
| `/settings` | `SettingsPage` | 설정, SMTP, 패키지 캐시, 업데이트 |

공통 레이아웃은 `src/renderer/layouts/MainLayout.tsx`가 담당하고, 자동 업데이트 UI는 `src/renderer/components/UpdateNotification.tsx`가 전역으로 렌더링됩니다.

## 패키지 매니저 노출 범위

### 홈/위자드에서 노출되는 타입

- 라이브러리: `pip`, `conda`, `maven`, `npm`
- OS 패키지: `yum`, `apt`, `apk`
- 컨테이너: `docker`

### Docker 레지스트리 선택 UI

`WizardPage.tsx`에는 다음 레지스트리 옵션이 있습니다.

- `docker.io`
- `ghcr.io`
- `ecr`
- `quay.io`
- `custom`

## Electron main process

`electron/main.ts`의 현재 책임:

- BrowserWindow 생성
- Vite dev server 준비 대기
- 기본 다이얼로그 / 앱 정보 IPC 등록
- 버전 프리로드 시작
- 자동 업데이트 초기화
- 기능별 handler 등록

추가 특징:

- 기본적으로 SSL 검증을 완화하고 `DEPSSMUGGLER_STRICT_SSL=true`일 때만 엄격 모드로 전환합니다.
- `registerConfigHandlers`, `registerCacheHandlers`, `registerHistoryHandlers`, `registerSearchHandlers`, `registerVersionHandlers`, `registerDownloadHandlers`를 순서대로 등록합니다.
- 개발 모드에서는 updater 더미 핸들러를 사용합니다.

## Preload API

`electron/preload.ts`는 렌더러에 다음 API 그룹을 노출합니다.

### 공통

- `log`
- `getAppVersion`
- `getAppPath`
- `selectFolder`
- `selectDirectory`
- `saveFile`
- `openFolder`
- `testSmtpConnection`

### 일반 패키지

- `download.start/pause/resume/cancel/checkPath/clearPath`
- `download.onProgress/onStatus/onDepsResolved/onAllComplete`
- `search.packages/suggest/versions`
- `dependency.resolve/onProgress`

### 앱 상태

- `config.get/set/reset/getPath`
- `cache.getSize/getStats/clear`
- `history.load/save/add/delete/clear`
- `updater.check/download/install/getStatus/setAutoDownload/onStatusChange`

### 타입별 보조 기능

- `docker.cache.refresh/status/clear`
- `maven.isNativeArtifact/getAvailableClassifiers`
- `os.getDistributions/getAllDistributions/getDistribution/search/resolveDependencies`
- `os.download.start/onProgress`
- `os.cache.getStats/clear`
- `versions.python/cuda/preload/refreshExpired/cacheStatus`

## 상태 관리

주요 Zustand 스토어:

| 파일 | 역할 |
|------|------|
| `stores/cart-store.ts` | 장바구니 상태 |
| `stores/download-store.ts` | 다운로드 화면 상태 |
| `stores/history-store.ts` | 히스토리 상태 |
| `stores/settings-store.ts` | 설정 상태 |

특징:

- Electron 환경에서는 settings store가 IPC를 통해 `~/.depssmuggler/settings.json`과 동기화되며, 레거시 `defaultOutputFormat/defaultArchiveType` 조합은 로드 시 `zip | tar.gz`로 정규화됩니다.
- settings UI는 `zip`/`tar.gz`를 노출하지만, 현재 main process에서 실제 아카이브 생성이 연결된 형식은 `zip`뿐입니다.
- 설정 화면의 캐시 위젯은 현재 `cache:*` IPC 기준 패키지 메타데이터 캐시만 집계/삭제합니다.
- `src/renderer/pages/settings/` 아래 `DeliverySettingsSection`, `CacheSettingsSection`, `UpdateSettingsSection`, `use-settings-form-actions.ts`가 `SettingsPage`의 세부 책임을 분리합니다.
- SMTP 테스트 버튼은 `testSmtpConnection` IPC가 있으면 실제 연결 테스트를 실행하고, 브라우저 개발 환경에서는 시뮬레이션, IPC가 빠진 Electron 빌드에서는 경고와 비활성화 상태를 노출합니다.
- 현재 UI 히스토리의 source of truth는 Zustand persist 키 `depssmuggler-history`입니다.
- `window.electronAPI.history.*`와 `~/.depssmuggler/history.json` 기반 파일 히스토리도 존재하지만, 현재 렌더러에서는 부분적으로만 연결되어 있습니다.

## 사용자 흐름

### 일반 패키지 흐름

1. `HomePage` 또는 `WizardPage`에서 패키지 타입 선택
2. `search:*`와 `dependency:resolve`로 후보/의존성 계산
3. `CartPage`에서 항목 정리
4. `DownloadPage`에서 실제 다운로드 실행
5. 완료 후 `HistoryPage`로 재방문 가능

### OS 패키지 흐름

1. `WizardPage`에서 `yum`, `apt`, `apk` 중 하나 선택
2. 배포판과 아키텍처를 `os:getAllDistributions`, `os:search`로 조회
3. 필요 시 `os:resolveDependencies`로 전용 트리 계산
4. `src/renderer/components/os/*`의 전용 출력 옵션 컴포넌트는 현재 라우트된 화면에서 사용되지 않습니다.
5. 실제 다운로드는 현재 `DownloadPage`의 일반 `download:start` 경로가 기준이며, `os:download:start`는 별도 IPC로 남아 있습니다.

## 출력과 패키징

### 일반 패키지

- `DownloadPage`는 설정 스토어의 `defaultOutputFormat`, `includeInstallScripts`, `enableFileSplit`, SMTP 설정을 사용합니다.
- 다운로드 시작 시 전달 방식 `local | email`을 선택할 수 있고, `email` 선택 시 설정 화면의 SMTP 발신자/수신자와 파일 분할 기준을 함께 전달합니다.
- 설정 UI와 main process 모두 `zip`과 `tar.gz`를 실제 아카이브 출력 형식으로 사용합니다.
- 이메일 전달을 선택하면 main process가 패키징 직후 SMTP 발송까지 수행하며, 첨부 크기 초과 시 `FileSplitter`를 사용해 실제 산출물을 분할합니다.

### OS 패키지

`src/renderer/components/os/OSOutputOptions.tsx`에는 다음 옵션 정의가 남아 있습니다.

- 출력 형식: `archive`, `repository`, `both`
- 아카이브 형식: `zip`, `tar.gz`
- 스크립트 타입: `dependency-order`, `local-repo`

다만 이 컴포넌트들은 현재 라우트된 GUI에 연결되어 있지 않아, 저장소 출력이나 `both` 출력은 현재 화면 기준으로는 사용할 수 없습니다.

## 자동 업데이트

- `UpdateNotification.tsx`가 `updater:status` 이벤트를 구독합니다.
- 새 버전 발견, 다운로드 진행률, 설치 준비 완료를 모달로 노출합니다.
- 개발 모드에서는 updater가 no-op 응답을 반환합니다.

## 버전 선택의 현재 방식

- Python/CUDA 목록은 IPC 기반 프리로드를 사용합니다.
- Java/Node 버전 선택지는 현재 렌더러 코드의 정적 옵션을 사용합니다.

## 관련 문서

- [IPC 핸들러](./ipc-handlers.md)
- [다운로드 히스토리](./download-history.md)
- [아키텍처 개요](./architecture-overview.md)
