# 문서 안내

현재 소스 기준으로 사용법을 확인하려면 [프로젝트 README](../README.md), [CLI](cli.md), [아키텍처 개요](architecture-overview.md)부터 읽으세요. 2026-09-08 점검 기준·변경 내역·내용 보존 표는 [문서 상태](documentation-status.md)에 정리했습니다.

## 사용과 개발

| 문서 | 내용 |
|------|------|
| [프로젝트 README](../README.md) | 소개, 설치·빠른 시작, 지원 범위, GUI/CLI 예시, 설정, 개발 명령 |
| [CLI](cli.md) | download/search/config/cache/os 명령, 대상 환경 옵션, 오류 처리 |
| [아키텍처 개요](architecture-overview.md) | 모듈, 데이터 흐름, 프로세스 경계 |
| [Electron / Renderer](electron-renderer.md) | 화면, 상태, renderer data client, 설정·업데이트 |
| [IPC 핸들러](ipc-handlers.md) | preload API와 main 채널·서비스 연결 |
| [다운로드 히스토리](download-history.md) | 기록 모델·저장·재다운로드·전달 설정 복원 |
| [코딩 규칙](coding-conventions.md) | 명명, 모듈 경계, 타입·로그·오류 처리 |
| [테스트](testing.md) | 실행 명령, Vitest·Playwright·CI·검증 한계 |
| [문서 상태](documentation-status.md) | 문서 분류, 전체 대조 범위, README 참고 조사, 유지보수 기준 |

## 수집·의존성·출력 구현

| 문서 | 내용 |
|------|------|
| [Downloaders](downloaders.md) | 패키지별 검색·버전·다운로드 인터페이스 |
| [Downloader factory](downloader-factory.md) | 일반·OS downloader 생성과 선택 |
| [Resolvers](resolvers.md) | 의존성 해결, 옵션, 트리·충돌·실패 결과 |
| [다운로드 유틸리티](download-utilities.md) | 진행률·파일·로그와 다운로드 공통 처리 |
| [Packagers](packagers.md) | 압축, manifest, 설치 스크립트, 파일 분할 |
| [OS 패키지](os-package-downloader.md) | yum/apt/apk, 배포판·저장소·캐시·출력·검증 제한 |
| [Docker 아키텍처](docker-architecture.md) | 레지스트리, 인증·검색·매니페스트·레이어 처리 |

## 공유 모듈과 타입

| 문서 | 내용 |
|------|------|
| [공유 유틸리티 개요](shared-utilities.md) | 모듈별 역할과 진입점 |
| [공유 타입](shared-types.md) | 기본 타입, 다운로드·의존성·패키지별 계약 |
| [HTTP](shared-http.md) | HTTP client, 파일 다운로드, 재시도·진행률 |
| [캐시](shared-cache.md) | 메타데이터·아티팩트·요청 세션 캐시, 만료·설정 |
| [의존성](shared-dependency.md) | 공통 resolver, artifact 식별자·병합, 결과 |
| [파일과 경로](shared-file-path.md) | 파일명·경로·다운로드 디렉터리 관리 |
| [pip](shared-pip.md) | 태그·wheel·후보·버전·Simple API·별도 backtracking 도구 |
| [Conda](shared-conda.md) | MatchSpec·버전·빌드·repodata·환경 검증 |
| [Maven](shared-maven.md) | POM·BOM·좌표·classifier·중복 처리 |
| [npm](shared-npm.md) | packument·버전·integrity·캐시 |
| [기타 공통 기능](shared-misc.md) | 설정·버전 사전 로드·다운로더 라우팅·보조 기능 |

## 알고리즘 배경과 현재 구현의 대응

외부 패키지 관리자의 알고리즘·옵션·소스 예시는 분석 자료입니다. 각 문서 첫머리의 **현재 구현 요약**으로 DepsSmuggler에 연결된 부분을 구분하세요.

| 문서 | 분석 대상과 구현 대조 |
|------|----------------------|
| [pip 의존성 해결](pip-dependency-resolution.md) | resolvelib·PEP 태그와 현재 BFS·파일 선택 |
| [Conda 의존성 해결](conda-dependency-resolution.md) | SAT·MatchSpec과 현재 BFS·Python/noarch 선택 |
| [Maven 의존성 해결](maven-dependency-resolution.md) | DF/BF·Skipper 참고 분석과 현재 모든 버전·POM·BOM 반입 |
| [npm 의존성 해결](npm-dependency-resolution.md) | Arborist·hoisting·peer·lockfile과 현재 resolver |

## 설계와 이행 기록

아래 문서는 결정 배경·코드 초안·구현 당시 단계를 보존합니다. 현재 API로 복사하거나 미완료 작업 목록으로 해석하지 마세요. 각 문서의 현재 구현 대응 표와 최신 가이드 링크를 먼저 확인하세요.

| 문서 | 기록의 성격 |
|------|-------------|
| [HTTP → IPC 이행](api-migration-ipc.md) | v0.1.17 마이그레이션 diff와 현재 data client·IPC의 차이 |
| [OS 다운로더 초기 설계](os-package-downloader-design.md) | 초기 모듈·인터페이스·프리셋·GPG·UI 계획과 구현 대응 |
| [CLI 대상 환경 옵션 설계](cli-download-environment-options-design.md) | 구현된 환경 옵션 계약·메타데이터 전달·검증 |
| [CLI 대상 환경 옵션 구현 계획](cli-download-environment-options-plan.md) | 완료된 Task 1–7, 구현·검증·인계 기록 |

## UI 검증 자료

| 문서 | 용도 |
|------|------|
| [UI 체크리스트](ui-testing-checklist.md) | 수동 확인 순서 |
| [UI 테스트 케이스](ui-testing-test-cases.md) | 시나리오와 기대 결과 |
| [Playwright 전환](ui-testing-playwright-conversion.md) | 자동화 범위와 수동 검증 경계 |
| [2026-04-14 발견 사항](ui-testing-findings-2026-04-14.md) | 당시 관찰 결과와 후속 구현 대조 |
| [2026-04-14 수정 요청 기록](ui-testing-fix-prompt-2026-04-14.md) | 당시 수정 요청·완료 조건과 현재 대응 |
