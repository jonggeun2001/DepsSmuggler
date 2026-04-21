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
| `test-smtp-connection` | SMTP 설정으로 연결 테스트 |

일반 패키지 이벤트:

| 이벤트 | 설명 |
|--------|------|
| `download:status` | 전체 단계 상태 |
| `download:progress` | 개별 패키지 진행률 |
| `download:deps-resolved` | 다운로드 전 의존성 해결 결과 |
| `download:all-complete` | 전체 다운로드 완료. `outputPath`는 대표 산출물 경로를, `artifactPaths`는 실제 산출물 목록을 담음. 이메일 전달 시 `deliveryMethod`, `deliveryResult`가 함께 전달됨 |

참고: `dependency:resolve`의 `options.includeDependencies`가 `false`이면 메인 프로세스는 원본 패키지 목록만 반환합니다.
참고: `download:start`는 `deliveryMethod`, `email`, `smtp`, `fileSplit` 옵션을 받아 패키징 뒤 로컬 저장 또는 이메일 전달까지 수행합니다.

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

현재 Java/Node 버전은 IPC가 아니라 렌더러의 정적 옵션을 주로 사용합니다.

### `updater.ts`

| 채널 | 설명 |
|------|------|
| `updater:check` | 업데이트 확인 |
| `updater:download` | 업데이트 다운로드 |
| `updater:install` | 설치 후 재시작 |
| `updater:status` | 현재 상태 조회 |
| `updater:set-auto-download` | 자동 다운로드 설정 |

이벤트:

| 이벤트 | 설명 |
|--------|------|
| `updater:status` | 상태 변경 브로드캐스트 |

## Preload 표면

`window.electronAPI`는 다음 그룹으로 정리되어 있습니다.

- `download`, `search`, `dependency`
- `config`, `cache`, `history`
- `os`, `docker.cache`, `maven`
- `updater`, `versions`
- `getAppVersion`, `getAppPath`, `selectFolder`, `saveFile`, `openFolder`, `log`

실제 타입과 반환값은 `electron/preload.ts`가 기준입니다.

## 관련 문서

- [Electron / Renderer](./electron-renderer.md)
- [아키텍처 개요](./architecture-overview.md)
