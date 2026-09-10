# IPC 핸들러

## 개요

Electron IPC는 `electron/main.ts`에서 공통 다이얼로그/앱 정보 채널을 등록하고, 기능별 모듈이 자체 채널을 추가하는 구조입니다. 렌더러는 모두 `electron/preload.ts`를 통해 `window.electronAPI`로 접근합니다.

## 모듈 구성

```text
electron/
├── main.ts
├── preload.ts
├── cache-handlers.ts
├── config-handlers.ts
├── download-handlers.ts
├── history-handlers.ts
├── search-handlers.ts
├── services/
├── updater.ts
└── version-handlers.ts
```

`download-handlers.ts`와 `search-handlers.ts`는 현재 thin IPC adapter 역할만 맡고, 실제 분기/오케스트레이션은 `electron/services/*.ts`로 위임합니다. `os-package-handlers.ts` 같은 별도 파일은 없고, OS 패키지 IPC도 동일하게 각 service 계층으로 연결됩니다.

## `main.ts` 공통 채널

| 채널 | 설명 |
|------|------|
| `toggle-devtools` | 개발자 도구 토글 |
| `get-app-version` | 앱 버전 조회 |
| `get-app-path` | 앱 데이터 경로 조회 |
| `select-folder` | 출력 폴더 선택 |
| `select-directory` | 설정용 디렉터리 선택 |
| `save-file` | 파일 저장 다이얼로그 |
| `open-folder` | Finder/Explorer 열기 |
| `test-smtp-connection` | SMTP 설정으로 연결만 테스트하고 연결을 닫음. 실제 이메일 발송은 하지 않음 |

`toggle-devtools`는 main에 등록되어 있지만 현재 preload 메서드로 노출되지 않습니다. 반대로 preload의 `log`는 `renderer:log`를 `send`하지만, 현재 소스에 해당 채널의 main 수신 핸들러는 없습니다.

## 설정 / 캐시 / 히스토리

### `config-handlers.ts`

설정 파일 위치는 `~/.depssmuggler/settings.json`입니다.

| 채널 | 설명 |
|------|------|
| `config:get` | 설정 로드 |
| `config:set` | 설정 저장 |
| `config:reset` | 설정 초기화 |
| `config:getPath` | 설정 파일 경로 조회 |

### `cache-handlers.ts`

| 채널 | 설명 |
|------|------|
| `cache:get-size` | 패키지 메타데이터 캐시 크기만 조회 |
| `cache:stats` | 패키지 메타데이터 캐시 통계 (`pip`/`npm`/`maven`/`conda`) |
| `cache:clear` | 패키지 메타데이터 캐시 삭제 |
| `docker:cache:refresh` | Docker 카탈로그 캐시 갱신 |
| `docker:cache:status` | Docker 카탈로그 캐시 상태 |
| `docker:cache:clear` | Docker 카탈로그 캐시 삭제 |

참고: `cache:*`는 현재 버전 목록 캐시(`versions:*`, 예: CUDA 버전 파일/메모리 캐시)나 renderer localStorage 캐시를 포함하지 않습니다.

### `history-handlers.ts`

히스토리 파일 위치는 `~/.depssmuggler/history.json`입니다.

| 채널 | 설명 |
|------|------|
| `history:load` | 히스토리 전체 로드 |
| `history:save` | 히스토리 전체 저장 |
| `history:add` | 새 히스토리 추가 |
| `history:delete` | 특정 히스토리 삭제 |
| `history:clear` | 히스토리 전체 삭제 |

## 검색 / 의존성 해결

### `search-handlers.ts`

일반 패키지 검색과 OS 패키지 검색이 모두 이 모듈에 있으며, 핸들러 본체는 채널 등록과 인자 전달만 담당합니다.

검색 사전 로딩 실패는 `SearchOrchestrator` 경고로 기록하고 일반 검색은 계속 사용할 수 있습니다. 사전 로딩이 성공했다고 보고하거나 빈 검색 결과를 미리 확정하지 않습니다. `search-orchestrator.test.ts`가 실패 후 정상 검색을 검증합니다.

주요 위임 대상:

- `electron/services/search-orchestrator.ts`
- `electron/services/search-package-router.ts`
- `electron/services/dependency-resolve-service.ts`
- `electron/services/os-search-service.ts`

| 채널 | 설명 |
|------|------|
| `search:packages` | `pip`, `conda`, `maven`, `npm`, `docker` 검색 |
| `search:versions` | 타입별 버전 목록 조회 |
| `search:suggest` | 자동완성 제안 |
| `dependency:resolve` | 일반 패키지 의존성 해결 |
| `maven:isNativeArtifact` | Maven 네이티브 아티팩트 여부 |
| `maven:getAvailableClassifiers` | Maven classifier 목록 |
| `os:getDistributions` | 패키지 관리자별 배포판 목록 |
| `os:getAllDistributions` | 동적/로컬 배포판 전체 목록 |
| `os:getDistribution` | 배포판 상세 조회 |
| `os:search` | OS 패키지 검색 |

이벤트:

| 이벤트 | 설명 |
|--------|------|
| `dependency:progress` | 일반 패키지 의존성 해결 진행률 |

## 다운로드

### `download-handlers.ts`

일반 패키지와 OS 패키지 다운로드를 모두 담당하지만, 핸들러 자체는 IPC wiring만 수행합니다.

주요 위임 대상:

- `electron/services/download-orchestrator.ts`
- `electron/services/download/download-session.ts`
- `electron/services/download/concurrency-limiter.ts`
- `electron/services/download/delivery-pipeline.ts`
- `electron/services/download/session-registry.ts`
- `electron/services/download-package-router.ts`
- `electron/services/download-progress.ts`
- `electron/services/os-download-orchestrator.ts`
- `electron/services/os-package-router.ts`

#### 일반 패키지 채널

| 채널 | 설명 |
|------|------|
| `download:start` | 일반 패키지 다운로드 시작 |
| `download:pause` | 일시정지 |
| `download:resume` | 재개 |
| `download:cancel` | 취소 |
| `download:check-path` | 출력 폴더 상태 확인 |
| `download:clear-path` | 출력 폴더 비우기 |

일반 패키지 이벤트:

| 이벤트 | 설명 |
|--------|------|
| `download:status` | 전체 단계 상태 |
| `download:progress` | 개별 패키지 진행률 |
| `download:deps-resolved` | preload의 의존성 해결 결과 구독 API는 남아 있지만 현재 main service에는 이 이벤트 발행 경로가 없음. UI는 `dependency:resolve` 응답을 사용 |
| `download:all-complete` | 전체 다운로드 완료. `outputPath`는 대표 산출물 경로를, `artifactPaths`는 실제 산출물 목록을 담음. 이메일 전달 시 `deliveryMethod`, `deliveryResult`가 함께 전달됨 |

참고: `dependency:resolve`의 `options.includeDependencies`가 `false`이면 메인 프로세스는 원본 패키지 목록만 반환합니다.
참고: `download:start`는 `deliveryMethod`, `email`, `smtp`, `fileSplit` 옵션을 받아 패키징 뒤 로컬 저장 또는 이메일 전달까지 수행합니다.

일반 `download:start`의 런타임 응답은 시작 접수를 뜻하는 `{ success: true, started: true }`이고 실제 최종 결과는 `download:all-complete`로 전달됩니다. 일반 의존성 계산은 renderer가 먼저 `dependency:resolve`로 수행하며, `download:start`의 세션 실행기는 전달받은 패키지 목록을 다운로드합니다. OS 전용 `os:download:start`는 이와 달리 의존성 계산부터 최종 결과 반환까지 기다리는 요청입니다.

일반 다운로드 요청과 진행률·상태·완료 이벤트에는 선택적인 `sessionId`가 포함됩니다. 렌더러는 이를 사용해 취소 또는 재시작 이후 도착한 이전 세션 이벤트를 구분합니다. 이벤트 구독 API는 각각 listener 제거 함수를 반환합니다.

`download:start`는 비어 있거나 잘못된 패키지 목록, 필수 문자열, 출력 경로, 동시 다운로드 수를 세션 생성 전에 거부하고 경고를 남깁니다. 초기 limiter 생성 실패도 `DownloadSession`의 실패 완료 이벤트와 오류 로그로 전달됩니다. 정상 요청의 반환값·완료 결과·취소 정책은 유지합니다.

`DownloadProgress`는 일반/OS 다운로드 알림에서 닫힌 창을 건너뛰고, 전송 시점에 발생한 창 종료/IPC 오류를 채널명과 함께 기록합니다. UI 알림 실패를 실제 다운로드 실패로 바꾸지 않으며 정상 전송의 payload와 throttle은 유지합니다. `download-orchestrator.test.ts`, `download-session.test.ts`, `download-progress.test.ts`가 잘못된 요청·초기 실패·창 종료를 검증합니다.

#### OS 패키지 채널

| 채널 | 설명 |
|------|------|
| `os:resolveDependencies` | OS 패키지 의존성 해결 |
| `os:download:start` | OS 패키지 전용 end-to-end 다운로드 시작. 필요 시 의존성 해결, 원본 패키지 다운로드, `archive/repository/both` 패키징까지 수행하고 `warnings`, `unresolved`, `conflicts`, `generatedOutputs`, `cancelled`를 함께 반환 |
| `os:download:cancel` | OS 패키지 전용 다운로드 취소 요청. 현재 전송 중인 fetch에도 abort 신호를 전달하고, 취소 시 최종 출력물이 없으면 성공 산출물로 보고하지 않음 |
| `os:cache:stats` | OS 캐시 통계 조회 placeholder (`{ size: 0, count: 0, path: '' }`) |
| `os:cache:clear` | OS 캐시 초기화 placeholder (`{ success: true }`만 반환) |

OS 이벤트:

| 이벤트 | 설명 |
|--------|------|
| `os:resolveDependencies:progress` | OS 의존성 해결 진행률 |
| `os:download:progress` | OS 다운로드/패키징 진행률 (`resolving`, `downloading`, `packaging` 단계 포함). 충돌/미해결 의존성도 resolving 단계 메시지로 먼저 표면화 |

참고: `os:cache:*` 채널은 현재 실제 캐시 백엔드에 연결되지 않은 no-op 성격의 placeholder 구현입니다.

## 버전 / 업데이트

### `version-handlers.ts`

| 채널 | 설명 |
|------|------|
| `versions:python` | Python 버전 목록 |
| `versions:cuda` | CUDA 버전 목록 |
| `versions:preload` | 버전 프리로드 실행 |
| `versions:refresh-expired` | 만료 캐시만 갱신 |
| `versions:cache-status` | 버전 캐시 상태 조회 |

Java/Node 런타임 버전 목록 IPC와 해당 런타임 선택 단계는 현재 없습니다. Python/CUDA는 설정 화면에서 위 채널을 사용하고, 패키지 자체의 버전 목록은 `search:versions`로 조회합니다.

### `updater.ts`

| 채널 | 설명 |
|------|------|
| `updater:check` | 업데이트 확인 |
| `updater:download` | 업데이트 다운로드 |
| `updater:install` | 설치 후 재시작 |
| `updater:status` | 현재 상태 조회 |
| `updater:set-auto-download` | 자동 다운로드 설정 |
| `updater:open-release-notes-link` | HTTP(S) 패치 노트 링크를 시스템 브라우저로 열기 |

이벤트:

| 이벤트 | 설명 |
|--------|------|
| `updater:status` | 상태 변경 브로드캐스트 |

`updater:status.updateInfo.releaseNotes`는 `electron-updater`와 동일하게 HTML/일반 텍스트 문자열, `{ version, note }[]`, `null` 또는 미설정을 허용합니다. 렌더러는 외부 HTML을 정제한 뒤 표시합니다. `updater.openReleaseNotesLink(url)`는 메인 프로세스에서 HTTP(S) URL인지 검증하고 `shell.openExternal`을 호출하며 `{ success, error? }`로 결과를 반환합니다.

패키징된 앱은 전체 updater를 초기화하며, 개발 모드에는 업데이트 작업의 no-op 핸들러를 등록합니다. 패치 노트 링크 열기 핸들러는 양쪽에서 같은 검증을 사용합니다. `updater:set-auto-download` 채널은 구현되어 있지만 설정 화면의 `autoDownloadUpdate` 저장에서 호출하지 않습니다. 시작 시 업데이트 확인도 저장된 `autoUpdate` 값을 참조하지 않습니다.

## Preload 표면

`window.electronAPI`는 다음 그룹으로 정리되어 있습니다.

- `download`, `search`, `dependency`
- `config`, `cache`, `history`
- `os`, `docker.cache`, `maven`
- `updater`, `versions`
- `getAppVersion`, `getAppPath`, `selectFolder`, `selectDirectory`, `saveFile`, `openFolder`, `testSmtpConnection`, `log`

실제 노출 메서드와 이벤트 wiring은 `electron/preload.ts`, 렌더러 선언은 `src/types/electron.d.ts`, 런타임 반환값은 각 handler/service가 기준입니다. 일부 preload 반환값은 `unknown` 또는 `void`로 축약되어 있으므로 서비스가 반환하는 결과와 구분해서 확인합니다. `os.getDistributions()`는 인수가 없으면 `os:getAllDistributions`를 호출하고, 인수가 있으면 패키지 관리자별 `os:getDistributions`를 호출합니다.

## 관련 문서

- [Electron / Renderer](./electron-renderer.md)
- [아키텍처 개요](./architecture-overview.md)
