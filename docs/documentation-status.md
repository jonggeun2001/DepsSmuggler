# 문서 상태

## 목적

이 문서는 2026-04-13 기준으로 코드베이스와 문서를 대조한 뒤, 어떤 문서를 현재 source of truth로 봐야 하는지 정리합니다.

## 현재 source of truth 문서

다음 문서는 이번 점검에서 현재 코드 기준으로 다시 정리했습니다.

- `README.md`
- `docs/architecture-overview.md`
- `docs/cli.md`
- `docs/testing.md`
- `docs/ipc-handlers.md`
- `docs/electron-renderer.md`

이 영역들은 저장소를 처음 이해하거나, 현재 동작 범위를 빠르게 확인할 때 우선 참조해야 합니다.

## 심화 문서의 성격

`docs/` 아래의 나머지 문서는 크게 두 부류로 나뉩니다.

### 1. 현재 코드 구조를 설명하는 심화 문서

- `docs/downloaders.md`
- `docs/resolvers.md`
- `docs/packagers.md`
- `docs/os-package-downloader.md`
- `docs/docker-architecture.md`
- `docs/shared-*.md`

이 문서들은 여전히 유용하지만, 세부 파일명이나 내부 경로 예시는 시간이 지나며 일부 레거시 표기를 포함할 수 있습니다. 정확한 심볼/경로가 중요할 때는 문서보다 실제 소스 파일을 우선 확인해야 합니다.

### 2. 설계/분석/이행 기록 성격의 문서

- `docs/api-migration-ipc.md`
- `docs/os-package-downloader-design.md`
- `docs/*-dependency-resolution.md`

이 문서들은 "현재 인터페이스 설명"보다 "설계 배경과 알고리즘 분석"에 가깝습니다. 따라서 현재 구조와 1:1로 맞지 않는 예시가 남아 있을 수 있습니다.

## 이번 점검에서 확인한 핵심 차이

- GUI 지원 범위가 README보다 넓었습니다. 실제 UI는 `npm`, `apt`, `apk`, 다운로드 히스토리, 설정, 자동 업데이트를 포함합니다.
- CLI 문서는 일부 영역이 실제 구현보다 넓거나 좁게 적혀 있었습니다. 현재는 `os download/cache`가 CLI backend 기준으로 동작하며, 남은 차이는 주로 `npm` 일반 CLI 쪽입니다.
- IPC 문서는 존재하지 않는 `os-package-handlers.ts`를 기준으로 설명하고 있었습니다.
- Electron/Renderer 문서는 오래된 경로명과 채널 구성을 일부 포함하고 있었습니다.
- 테스트 문서는 고정된 테스트 개수와 오래된 파일명을 기준으로 설명하고 있었습니다.

## 유지보수 원칙

- 기능 범위, 경로, 명령, 채널처럼 쉽게 깨지는 정보는 상위 문서에 우선 반영합니다.
- 알고리즘 설명 문서는 개념 위주로 유지하고, 실제 파일 경로는 필요할 때만 최소한으로 명시합니다.
- 정확한 파일명/심볼이 중요한 작업에서는 문서보다 코드 검색 결과를 우선합니다.
