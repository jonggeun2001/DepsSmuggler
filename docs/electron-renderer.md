# Electron & Renderer

## 개요

데스크톱 앱은 Electron main process와 React renderer가 `window.electronAPI` IPC 브리지로 통신하는 구조입니다. 검색/버전조회/히스토리 I/O 같은 renderer data access는 `src/renderer/lib/renderer-data-client.ts` facade를 통해 한곳으로 모았습니다. 일반 검색/버전 조회는 해당 IPC 메서드가 없으면 HTTP fallback을 사용하고, OS 검색은 IPC가 없으면 빈 목록을 반환합니다. 브라우저의 제한된 fallback을 Electron 전체 기능과 동일하게 취급하지 않습니다.

현재 구조의 핵심은 다음과 같습니다.

- `src/renderer/pages/CartPage.tsx`는 최신 버전 조회를 직접 `fetch`하지 않고 renderer data client를 사용합니다.
- `src/renderer/pages/WizardPage.tsx`는 화면 조합과 store/router wiring에 집중하고, 검색/버전조회 로직은 `src/renderer/pages/wizard-page/*` 모듈과 renderer data client 조합으로 분리되었습니다.
- `src/renderer/stores/history-store.ts`는 history data client를 통해 영속화한 뒤 메모리 상태를 갱신합니다. Electron에서는 `~/.depssmuggler/history.json`이 기준이고, `HistoryPage.tsx`는 이력 I/O에 store만 소비합니다.

## 현재 화면 구조

현재 라우트 source of truth는 `src/renderer/router.tsx`의 `appRoutes`/`createAppRouter()`입니다. 엔트리포인트 `src/renderer/index.tsx`는 이 라우터만 import하며, 중복 정의를 담고 있던 `src/renderer/App.tsx`는 제거되었습니다.

`createHashRouter`를 사용하므로 브라우저 URL은 `/#/wizard`, `/#/download`처럼 hash 경로를 사용합니다. 아래 표는 hash 안의 라우트이며, 알 수 없는 경로는 홈 컴포넌트를 표시합니다.

| 경로 | 컴포넌트 | 역할 |
|------|----------|------|
| `/` | `HomePage` | 패키지 매니저 선택 홈 |
| `/wizard` | `WizardPage` | 검색/버전/배포판 선택 위자드 |
| `/cart` | `CartPage` | 장바구니와 텍스트 입력 |
| `/download` | `DownloadPage` | 의존성 해결, 다운로드, 결과 표시 |
| `/history` | `HistoryPage` | 다운로드 이력 |
| `/settings` | `SettingsPage` | 설정, SMTP, 패키지 캐시, 업데이트 |

공통 레이아웃은 `src/renderer/layouts/MainLayout.tsx`가 담당하고, 자동 업데이트 UI는 `src/renderer/components/UpdateNotification.tsx`가 전역으로 렌더링됩니다.

`DownloadPage.tsx` 자체는 현재 orchestration 레이어이며, 실제 일반 다운로드 상태/완료 처리와 OS 전용 흐름은 `src/renderer/pages/download-page/hooks/*`, `components/*`, `utils.ts`, `view-state.ts`로 분리되어 있습니다.

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

검색 동작은 `src/core/downloaders/docker-search-service.ts`에서 구분합니다. Docker Hub와 Quay는 검색 API를 사용하고, GHCR/ECR은 검색 결과를 조회하지 않고 정확한 이미지명 입력을 후보로 반환합니다. 커스텀 레지스트리는 카탈로그 API를 조회합니다. 레지스트리별 제약은 [Docker 아키텍처](./docker-architecture.md)를 참고합니다.

## WizardPage 검색 모듈 경계

`/wizard` 경로의 검색 관련 책임은 다음처럼 분리됩니다.

- `src/renderer/pages/WizardPage.tsx`
  - 스텝 UI 조합, settings/cart store 연결, 검색 훅 바인딩
- `src/renderer/pages/wizard-page/query-params.ts`
  - `type` query param 해석 및 소비
- `src/renderer/pages/wizard-page/os-context.ts`
  - `yum/apt/apk` 배포판/아키텍처 계산과 `osContext` snapshot 처리
- `src/renderer/lib/renderer-data-client.ts`
  - 검색/버전조회/히스토리 I/O facade. 해당 IPC가 없을 때 일반 검색/버전은 HTTP, 히스토리는 localStorage를 사용
- `src/renderer/pages/wizard-page/search-service.ts`
  - package type별 검색 전략과 OS 검색 파라미터 구성
- `src/renderer/pages/wizard-page/version-service.ts`
  - 버전 선택 전략, Docker tag 선택, Maven classifier 부가 조회
- `src/renderer/pages/wizard-page/useWizardSearchFlow.ts`
  - 검색 입력/제안/선택/버전조회 오케스트레이션

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
- `os.getDistributions/getAllDistributions/getDistribution/search/resolveDependencies/onResolveDependenciesProgress`
- `os.download.start/cancel/onProgress`
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
- 설정 로드 시 잘못된 숫자·불리언·목록·중첩 객체는 기존 기본값으로 복구하며, 파일의 데이터가 스토어 액션 함수를 덮어쓰지 못하게 합니다. 정상 Windows/macOS pip 타겟의 선택적 필드와 알 수 없는 기존 데이터 필드는 유지합니다. 브라우저 백업 저장소의 접근/용량 오류는 메모리 갱신과 Electron 파일 저장을 막지 않으며, `config:set`의 실패 응답도 로그로 남깁니다. `[settings-store:*]` 로그와 `settings-store.test.ts`로 로드/저장 실패를 추적·검증합니다.
- 초기 설정 로드·정규화와 기본값 대체는 메모리에만 반영합니다. Electron 파일이나 브라우저 백업을 자동으로 덮어쓰지 않고, 사용자의 설정 변경/초기화부터 저장합니다. 정상/손상/읽기 실패 및 브라우저 초기화의 저장 호출 여부를 `settings-store.test.ts`에서 검증합니다.
- 설정 화면의 캐시 위젯은 현재 `cache:*` IPC 기준 패키지 메타데이터 캐시만 집계/삭제합니다.
- `src/renderer/pages/settings/` 아래 `DeliverySettingsSection`, `CacheSettingsSection`, `UpdateSettingsSection`, `use-settings-form-actions.ts`가 `SettingsPage`의 세부 책임을 분리합니다.
- SMTP 테스트 버튼은 `testSmtpConnection` IPC가 있으면 실제 연결 테스트를 실행하고, 브라우저 개발 환경에서는 시뮬레이션, IPC가 빠진 Electron 빌드에서는 경고와 비활성화 상태를 노출합니다.
- 히스토리 store는 renderer data client를 통해 `window.electronAPI.history.*`와 동기화됩니다. `load/add/delete/clear`가 모두 있으면 파일이 기준이며, 이 API 세트가 없거나 일부 빠진 환경에서는 `depssmuggler-history` localStorage로 대체합니다. 추가/삭제/전체 삭제는 영속화 성공 뒤 store를 갱신하고, 실패하면 이전 메모리 목록을 유지합니다.
- 다운로드 화면 오케스트레이션은 `use-download-page-controller.test.tsx`에서 jsdom + mocked `window.electronAPI` 조합으로 시작/일시정지/재개/취소/완료/오류 시나리오를 회귀 고정합니다.
- 다운로드 표의 의존성 그룹은 목록 변경 시 부모 ID로 한 번 인덱싱하고 재사용합니다. 행마다 전체 목록을 검색하던 비용을 `O(원본 수 × 전체 항목 수)`에서 `O(전체 항목 수)`로 줄입니다. 원본 그룹에 연결되지 않은 항목도 독립 행으로 표시하여 전체 다운로드 목록에서 사라지지 않게 합니다. `download-page/utils.test.ts`가 그룹 결과와 조회 횟수를 검증합니다.

## 사용자 흐름

### 일반 패키지 흐름

1. `HomePage` 또는 `WizardPage`에서 패키지 타입 선택
2. `search:*`로 패키지와 버전을 조회
3. `CartPage`에서 항목 정리
4. 장바구니 트리 미리보기 또는 `DownloadPage`의 의존성 확인에서 `dependency:resolve`를 호출하고, `DownloadPage`에서 실제 다운로드 실행
5. 완료 후 `HistoryPage`로 재방문 가능

`CartPage`에서 `pom.xml` 파일을 가져오거나 텍스트로 붙여넣을 때는 `<type>pom</type>` 같은 Maven artifact type을 장바구니 metadata로 유지합니다. Maven 장바구니의 중복 판정도 이 artifact type을 포함하므로 같은 GAV라도 기본 JAR과 POM은 각각 보관하고, 같은 type만 중복으로 처리합니다. 이 metadata는 일반 다운로드 IPC를 거쳐 `MavenDownloader`에 전달되므로 POM 전용 의존성은 `.pom` 아티팩트와 체크섬으로 다운로드되고, 최상위 복사본도 `.pom` 확장자를 사용합니다.

Maven 입력의 `dependencyManagement`에 있는 BOM 선언도 가져옵니다. 장바구니 의존성 트리 미리보기와 실제 의존성 포함 다운로드 모두 선택한 type을 resolver에 전달하며, 원격 packaging보다 명시한 type을 우선합니다.

Maven 해결 결과의 `root`는 실행 의존성 그래프이고, `flatList`에는 그 그래프에 없는 부모 POM과 import BOM도 포함될 수 있습니다. 장바구니 미리보기의 `함께 다운로드할 POM` 목록을 펼치면 그래프 밖 모델의 좌표·버전·파일 상세를 확인할 수 있습니다. 그래프에 이미 있는 POM은 이 목록에 중복 표시하지 않으며, 같은 GAV의 JAR와 POM, 서로 다른 classifier를 구분합니다.

다운로드 화면은 수동 의존성 확인(`handleResolveDependencies`)과 다운로드 시작 후 해결 이벤트(`onDepsResolved`)에서 `download-page/resolved-items.ts`의 공통 변환을 사용합니다. 각 루트의 `flatList`를 기준으로 원본 다운로드 항목의 실제 ID에 그룹을 연결하므로, `root.dependencies`에 없는 부모/BOM POM도 의존성 그룹에 표시됩니다. 원본 항목 판정과 그룹 연결은 Maven artifact type과 classifier를 구분하며, 그룹에 연결하지 못한 행도 표에서 유지합니다.

의존성 포함 다운로드에서는 선택된 Maven 패키지의 부모 POM과 import BOM도 자동으로 수집하여 POM 파일로 전달합니다. 부모/BOM의 `dependencyManagement`에 있는 사용하지 않는 라이브러리는 추가하지 않습니다. 일반 JAR와 부속 POM은 `packages/m2repo/`에 저장되고, 최상위 `packages/`에는 각 항목의 주 아티팩트만 복사합니다. 부모/BOM은 `.pom` 자체가 주 아티팩트이므로 최상위에도 복사됩니다. 필요한 Parent/BOM 조회 실패나 순환 참조는 의존성 해결 오류로 처리합니다. 실제 파일 다운로드에서 일반 JAR의 부속 POM을 저장하지 못한 경우도 해당 패키지를 실패로 표시합니다.

Electron 다운로드 라우터는 같은 출력 디렉터리·GAV의 Maven 작업을 다운로드부터 평탄화 복사 완료까지 순서대로 실행합니다. JAR 작업도 부속 POM을 저장하므로 별도 POM 작업과의 동시 쓰기를 방지하기 위함입니다. 다른 GAV는 병렬 실행하며, 앞 작업이 실패해도 대기열을 해제하고 대기 중 취소·일시정지 상태를 다시 확인합니다.

### OS 패키지 흐름

1. `WizardPage`에서 `yum`, `apt`, `apk` 중 하나 선택
2. 배포판과 아키텍처는 settings store와 `wizard-page/os-context.ts` helper를 통해 선택/적용됩니다.
3. 검색은 `wizard-page/search-service.ts`가 `os:search` IPC를 통해 수행합니다.
4. OS 의존성은 전용 다운로드 시작 요청의 `resolveDependencies` 옵션에 따라 main에서 계산합니다. 별도 `os:resolveDependencies`와 진행 이벤트 API도 노출되어 있지만 현재 routed UI는 이 메서드를 직접 호출하지 않습니다.
5. 장바구니가 OS 패키지로만 구성되고 모든 항목에 동일한 패키지 관리자·배포판·아키텍처의 `metadata.osContext`가 있으면 `/download`에서 전용 OS 다운로드 화면으로 전환됩니다. `src/renderer/components/os/*`의 출력 옵션/진행률/결과 컴포넌트를 사용합니다. OS 항목의 context가 누락되면 재선택 안내를 표시하며, 일반 패키지가 섞이거나 서로 다른 context이면 전용 흐름 조건을 만족하지 않습니다.
6. 실제 다운로드는 `os:download:start` IPC로 실행되고, 일반 패키지 경로 `download:start`와 분리되어 유지됩니다.

## 출력과 패키징

### 일반 패키지

- `DownloadPage`는 설정 스토어의 `defaultOutputFormat`, `includeInstallScripts`, `enableFileSplit`, SMTP 설정을 사용합니다.
- 다운로드 시작 시 전달 방식 `local | email`을 선택할 수 있고, `email` 선택 시 설정 화면의 SMTP 발신자/수신자와 파일 분할 기준을 함께 전달합니다.
- 설정 UI와 main process 모두 `zip`과 `tar.gz`를 실제 아카이브 출력 형식으로 사용합니다.
- 이메일 전달을 선택하면 main process가 패키징 직후 SMTP 발송까지 수행합니다. 첨부 크기가 한도를 넘고 분할이 활성화되어 있으면 `FileSplitter`로 분할하고 조각·메타데이터·병합 스크립트를 전달합니다. 분할을 끈 상태에서 한도를 넘으면 생성된 아카이브를 보존한 실패 결과를 반환합니다. 로컬 저장에는 이 자동 분할 경로가 적용되지 않습니다.

### OS 패키지

`src/renderer/components/os/OSOutputOptions.tsx`에서 다음 옵션을 제공합니다.

- 출력 형식: `archive`, `repository`, `both`
- 아카이브 형식: `zip`, `tar.gz`
- 스크립트 타입: `dependency-order`, `local-repo`

이 옵션들은 현재 `/download`의 OS 전용 흐름에 연결되어 있으며, 저장소 출력이나 `both` 출력도 전용 UI에서 선택할 수 있습니다.

OS 전용 흐름의 전달 방식은 로컬 저장이며, 일반 다운로드의 이메일·파일 분할 옵션을 사용하지 않습니다.

## 자동 업데이트

- `UpdateNotification.tsx`가 `updater:status` 이벤트를 구독합니다.
- 새 버전 발견, 다운로드 진행률, 설치 준비 완료를 모달로 노출합니다.
- 패키징된 앱은 시작 후 약 3초 뒤 업데이트를 확인합니다. 자동 다운로드 기본값은 `false`이며, 사용자가 다운로드와 설치/재시작을 선택할 수 있고 내려받은 업데이트는 앱 종료 시 설치하도록 설정되어 있습니다.
- 설정 화면의 `autoUpdate`/`autoDownloadUpdate` 값은 저장·복원되지만 현재 updater 동작과 연결되어 있지 않습니다. 시작 검사에서는 `autoUpdate`를 읽지 않으며, 설정 저장은 `updater.setAutoDownload`를 호출하지 않습니다. `지금 확인` 버튼은 실제 `updater.check`를 호출합니다.
- 개발 모드에서는 updater가 no-op 응답을 반환합니다.

## 버전 선택의 현재 방식

- Python/CUDA 목록은 IPC 기반 프리로드를 사용합니다.
- Java/Node 런타임 버전 선택 단계는 없습니다. 위자드는 카테고리 → 패키지 타입 → 검색 → 패키지 버전 순서로 진행하며, 사용되지 않던 과거 언어 버전 옵션 목록과 단계 생략 함수를 제거했습니다. Python 설정과 패키지 버전 조회 흐름은 유지됩니다.

## 관련 문서

- [IPC 핸들러](./ipc-handlers.md)
- [다운로드 히스토리](./download-history.md)
- [아키텍처 개요](./architecture-overview.md)
