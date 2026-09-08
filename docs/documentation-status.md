# 문서 상태

## 목적과 점검 기준

2026-09-08에 현재 main의 소스(`cbeaf65`, 문서 수정 전 기준)와 루트 `README.md` 및 기존 `docs/` 문서 39개를 대조했습니다. 이번 변경은 문서만 수정하며 기능·설정 기본값·타입·테스트 코드는 변경하지 않습니다.

현재 문서의 전체 목록은 [문서 인덱스](README.md)에서 확인합니다. 사용자가 실행할 명령과 공개 API는 현재 구현 문서를, 결정 배경은 설계·분석 기록을 참고하세요.

## 현재 구현을 설명하는 문서

| 영역 | 문서 | 대조한 소스·계약 |
|------|------|-----------------|
| 소개·설치·지원 범위 | [프로젝트 README](../README.md) | `package.json`, 잠금 파일, CLI, renderer, Electron 서비스, GitHub Releases |
| 구조·UI·IPC | [아키텍처](architecture-overview.md), [Electron / Renderer](electron-renderer.md), [IPC](ipc-handlers.md) | `electron/main.ts`, `preload.ts`, 핸들러·서비스, `src/renderer/` |
| CLI | [CLI](cli.md) | `src/cli/index.ts`, `commands/`, `scripts/cli.cjs` |
| 수집·해결 | [Downloaders](downloaders.md), [Factory](downloader-factory.md), [Resolvers](resolvers.md), [다운로드 유틸리티](download-utilities.md) | `src/core/downloaders/`, `resolver/`, 공용 다운로드·의존성 계약 |
| OS·Docker | [OS 패키지](os-package-downloader.md), [Docker](docker-architecture.md) | `yum/`, `apt/`, `apk/`, `os-shared/`, Docker 인증·검색·레이어 서비스 |
| 출력·히스토리 | [Packagers](packagers.md), [히스토리](download-history.md) | `src/core/packager/`, mailer, Electron delivery pipeline, history store/handlers |
| 공유 모듈 | [공유 개요](shared-utilities.md), [타입](shared-types.md), [HTTP](shared-http.md), [캐시](shared-cache.md), [의존성](shared-dependency.md), [파일·경로](shared-file-path.md), [기타](shared-misc.md) | `src/core/shared/`, `src/types/`, `src/core/ports/` 및 실제 호출부 |
| 패키지별 공유 모듈 | [pip](shared-pip.md), [Conda](shared-conda.md), [Maven](shared-maven.md), [npm](shared-npm.md) | 각 shared 모듈의 export·옵션·구현·호출 테스트 |
| 개발·검증 | [코딩 규칙](coding-conventions.md), [테스트](testing.md) | ESLint/TypeScript 설정, Vitest/Playwright 설정, 테스트 코드, CI |
| UI 검증 절차 | [체크리스트](ui-testing-checklist.md), [테스트 케이스](ui-testing-test-cases.md), [Playwright 전환](ui-testing-playwright-conversion.md) | 현재 화면·스토어와 `tests/e2e/`의 자동화 범위 |

이 문서들은 현재 호출 순서·인자·기본값·경로를 설명합니다. 구현에 없는 통합 클래스나 옵션을 실제 API처럼 쓰던 예시를 교체하고, 이해를 위한 축약 코드에는 그 범위를 표시했습니다.

## 설계·분석·이행 기록의 성격

| 문서 | 보존한 내용 | 현재 구현과 구분한 내용 |
|------|-------------|------------------------|
| [pip 분석](pip-dependency-resolution.md) | resolvelib·태그·후보 선택·백트래킹 배경 | 앱의 BFS와 별도 BacktrackingResolver, 실제 호환 파일·크기 선택 |
| [Conda 분석](conda-dependency-resolution.md) | SAT·MatchSpec·버전 비교·BFS 설명 | SAT 미사용, 채널 URL, Python/noarch 제약·실패 조건·메타데이터 전달 |
| [Maven 분석](maven-dependency-resolution.md) | DF/BF·Skipper·scope·packaging·성능 참고 | JVM 옵션과 앱 옵션, BOM·classifier/type 선택, 크기 조회 제한 |
| [npm 분석](npm-dependency-resolution.md) | Arborist·hoisting·peer·lockfile·미러 설계 | 자체 resolver, 실제 공개 옵션, lockfile/미러 자동 생성과의 차이 |
| [HTTP → IPC 이행](api-migration-ipc.md) | v0.1.17 삭제 목록·diff·이행 효과 | 현재 renderer data client의 HTTP/storage 폴백과 IPC 서비스 분리 |
| [OS 초기 설계](os-package-downloader-design.md) | 인터페이스·프리셋·파서·GPG·출력·UI 단계 초안 | 실제 개별 downloader와 os-shared 경로, GPG 미구현, 완료된 UI 연결 |
| [CLI 환경 옵션 설계](cli-download-environment-options-design.md), [구현 계획](cli-download-environment-options-plan.md) | 요구사항·병합 계약·Task 1–7·검증·인계 기록 | 구현 완료 상태와 현재 파일 위치·후속 보강 |
| [UI 발견 사항](ui-testing-findings-2026-04-14.md), [UI 수정 요청](ui-testing-fix-prompt-2026-04-14.md) | 2026-04-14 당시 관찰·재현·요청 | 이후 구현과 현재 자동화 검증의 범위 |

분석 문서의 외부 알고리즘 예시와 성능 수치를 DepsSmuggler의 실행 결과로 취급하지 않습니다. 역사적 자료는 문서 첫머리에서 성격과 현재 가이드 링크를 안내하며, 현재 구현 세부사항은 같은 문서에서도 따로 최신화합니다.

## 이번 점검에서 바로잡은 주요 차이

- 일반 GUI는 ZIP과 tar.gz를 모두 생성합니다. 이메일 첨부 한도 초과 시 분할 설정에 따라 파일을 분할하는 전달 경로가 실제 연결되어 있습니다.
- OS 전용 GUI는 관리자·배포판·아키텍처 문맥이 일치하는 OS 항목에서 실행되며, 아카이브·로컬 저장소·복합 출력을 제공합니다. 실제 OS GPG 서명 검증과 APK 인덱스 완전 호환성은 별도의 미완료 범위입니다.
- Docker의 추가 공개 레지스트리에는 익명 pull·검색 전략이 있으나, GHCR/ECR Public의 검색과 공통 메타데이터 API에 제한이 있습니다.
- 업데이트 확인·다운로드·설치는 구현되어 있지만 `autoUpdate`/`autoDownloadUpdate` 설정 토글이 updater 동작을 제어하도록 연결되어 있지는 않습니다.
- CLI의 실제 옵션, `--file`의 줄 단위 입력, 환경별 아티팩트 선택과 OS 출력 형식의 구분을 반영했습니다.
- pip/Conda의 대상 파일 선택과 noarch 조건, Maven type/classifier·POM 처리, 캐시·공유 타입·함수 예시를 현재 구현에 맞췄습니다.
- 테스트 도구와 CI의 범위를 구분했습니다. 특히 브라우저 E2E mock을 실제 Electron·SMTP·외부 저장소 통합 검증으로 설명하지 않습니다. Node 요구사항과 CI 버전, coverage 업로드의 기존 차이도 기록합니다.

## README 구성 참고 조사

2026-09-08 GitHub 원본 README와 API의 star 수를 확인했습니다. 수치는 조사 시점의 스냅샷이며 프로젝트 품질이나 기능 호환성의 보증으로 사용하지 않습니다.

| 참고 프로젝트 | 조사 시점 stars | 확인한 구성 | 이번 README에 적용 |
|---------------|------------------|-------------|--------------------|
| [uv](https://github.com/astral-sh/uv#readme) | 89,633 | 짧은 소개, 핵심 기능, 설치, 문서, 기능별 실행 예시 | 소개 → 핵심 기능 → 빠른 시작 → 구체적인 명령 예시 |
| [pnpm](https://github.com/pnpm/pnpm#readme) | 36,462 | 로고·배지, 기능의 가치 설명, 시작 안내 링크, 상세 배경 | 기존 아이콘·CI/릴리스/라이선스 배지와 목적별 문서 탐색 |
| [LocalSend](https://github.com/localsend/localsend#readme) | 90,350 | 탐색 링크, 운영체제별 다운로드, 소스 실행, CLI, 개발·기여 안내 | 배포 파일 표, 소스 실행과 배포 버전 구분, GUI/CLI·개발 안내 |

레이아웃 원칙만 참고하고 다른 프로젝트의 성능 주장·지원 플랫폼·설치 명령은 가져오지 않았습니다. 조사한 README 원문은 각 프로젝트 링크에서 확인할 수 있습니다.

## README 내용 보존 표

기존 항목을 삭제해 축약하지 않고 다음 위치로 옮기거나 잘못된 동작 설명을 수정했습니다.

| 기존 항목 | 현재 위치·보존 내용 |
|-----------|---------------------|
| 제목·소개 | 제목과 도입부: 폐쇄망, 라이브러리·OS 패키지·컨테이너, Electron·CLI |
| 현재 상태 | 주요 기능, 현재 동작 범위, 설정과 저장 위치 |
| 지원 범위 | 같은 8개 패키지 타입의 GUI/CLI 표와 레지스트리 세부 범위 |
| 주요 기능 | 의존성 트리·위자드·출력·OS 전용 출력·캐시·히스토리·SMTP·업데이트 |
| 설치 | 다운로드, 빠른 시작: npm install, 소스 CLI, 빌드 후 전역 설치 |
| 개발 명령어 | 기존 개발·빌드·3개 OS 패키징·단위/통합/coverage/lint/typecheck 명령, E2E 설명 |
| GUI 예시 | 사용 예시의 5단계 화면 흐름, OS 전용 조건, SMTP·분할 동작 범위 |
| CLI 예시 | 기존 검색 3개, 일반 다운로드 4개, 환경 지정 3개, 파일 입력, OS 검색/다운로드/캐시 명령 전체 |
| 저장 위치 | settings.json, history.json, cache, logs와 renderer localStorage |
| 프로젝트 구조 | electron, renderer, cli, core, types, utils, docs, CI 및 관련 디렉터리 |
| 문서 링크 | 기존 8개 링크 유지, 전체 문서 인덱스와 주제별 링크 추가 |
| 기술 스택·라이선스 | 기존 기술·3개 대상 OS·MIT 유지 |

전체 문서는 인덱스에서 연결하고, 설계 기록의 장·절과 주제는 유지합니다. 오래된 코드 예시를 현재 예시로 교체한 경우에도 해당 책임·동작·실패 조건 설명은 남깁니다.

## 검증과 유지보수 원칙

- 문서 상대 링크·앵커·코드펜스, README의 기존 CLI 예시 보존 여부, 문서 인덱스의 전체 파일 포함 여부를 검사합니다.
- README/CLI 명령은 `package.json`과 Commander help를 대조하고, 관련 검증은 [테스트 문서](testing.md)의 표준 진입점을 사용합니다. 실제 실행 결과와 CI 결과는 변경 PR에 기록합니다.
- 기능·경로·명령·채널을 바꾸면 README뿐 아니라 관련 심화 문서와 인덱스까지 갱신합니다. 과거 분석·계획은 이력을 보존하되 현재 구현 대응도 함께 갱신합니다.
- API·타입·설정의 정확한 선언은 소스에 두고 문서의 복제 코드는 필요한 만큼만 유지합니다. 의사 코드·외부 프로젝트 예시·현재 API를 구분합니다.
- 이번 점검은 기존 2026-04-13 문서 감사와 2026-04-14 Wizard 모듈 분리·UI 검증 기록을 이어받습니다. 당시 확인한 GUI 지원 확대, CLI 범위 차이, 존재하지 않던 IPC 파일, 오래된 경로와 테스트 개수 문제는 현재 문서에 반영했습니다.
