# DepsSmuggler (의존성 밀수꾼)

폐쇄망 환경으로 옮겨야 하는 라이브러리, OS 패키지, 컨테이너 이미지를 의존성까지 포함해 수집하는 Electron 기반 데스크톱 앱과 CLI입니다.

## 현재 상태

- GUI: `pip`, `conda`, `maven`, `npm`, `yum`, `apt`, `apk`, `docker` 흐름을 제공합니다.
- CLI: 일반 패키지용 `download`, `search`, `config`, `cache`와 OS 패키지용 `os` 네임스페이스를 제공합니다.
- 자동 업데이트, 다운로드 히스토리, 설정 저장, SMTP 설정 UI가 포함되어 있습니다. 파일 분할은 설정 UI와 기반 코드는 있으나 현재 다운로드 경로에는 연결되어 있지 않습니다.
- 설정/로그/캐시는 모두 사용자 홈 디렉터리의 `~/.depssmuggler/` 아래에 저장됩니다.

## 지원 범위

| 영역 | GUI | CLI | 비고 |
|------|-----|-----|------|
| Python `pip` | 지원 | 지원 | PyPI 검색/버전 조회/다운로드 |
| Python `conda` | 지원 | 지원 | 채널 선택 지원 |
| Java `maven` | 지원 | 지원 | 네이티브 classifier 확인 지원 |
| Node.js `npm` | 지원 | 부분 지원 | CLI `download`는 지원하지만 `search`는 아직 미구현 |
| OS `yum` | 지원 | 부분 지원 | CLI는 `os` 네임스페이스 중심이며 `download/cache`는 재구현 중 |
| OS `apt` | 지원 | 부분 지원 | CLI `os download`는 재구현 중 안내만 출력 |
| OS `apk` | 지원 | 부분 지원 | GUI 기준 기능이 더 완전함 |
| Container `docker` | 지원 | 지원 | GUI는 Docker Hub 외 레지스트리 선택 UI 포함 |

## 주요 기능

- 의존성 해결: 패키지 타입별 resolver로 전이 의존성을 계산하고 트리를 시각화합니다.
- 위자드 UI: 검색, 버전 선택, 장바구니, 다운로드, 히스토리, 설정을 한 흐름으로 제공합니다.
- 출력물 생성: 설정 UI에는 `zip`/`tar.gz`가 노출되지만, 현재 연결된 일반 다운로드 경로에서 실제 아카이브 생성은 `zip`만 보장됩니다. 설치 스크립트 생성은 동작합니다.
- OS 패키지 전용 출력: 전용 저장소/복합 출력 컴포넌트와 IPC는 코드에 남아 있지만, 현재 라우트된 GUI에서는 end-to-end로 연결되지 않았습니다.
- 운영 보조 기능: 패키지 메타데이터 캐시 관리, 다운로드 히스토리, SMTP 설정, 자동 업데이트 알림을 포함합니다.

## 설치

```bash
npm install
```

소스 체크아웃에서 CLI를 전역 설치하려면 먼저 빌드가 필요합니다.

```bash
npm run build
npm install -g .
```

## 개발 명령어

```bash
# GUI 개발 서버
npm run dev

# CLI 실행
npm run cli -- --help

# 빌드
npm run build

# 패키징
npm run package:win
npm run package:mac
npm run package:linux

# 검증
npm run test
INTEGRATION_TEST=true npm run test
npm run test:coverage
npm run lint
npx tsc --noEmit
```

`playwright.config.ts`는 존재하지만 현재 저장소에는 `tests/e2e` 시나리오가 없어 `npm run test:e2e`를 상시 검증 명령으로 보지 않습니다.

## 사용 예시

### GUI

```bash
npm run dev
```

주요 화면:

1. `홈`에서 패키지 매니저를 선택합니다.
2. `패키지 검색` 위자드에서 패키지명, 버전, 아키텍처, 대상 배포판을 선택합니다.
3. `장바구니`에서 여러 패키지를 조합하거나 텍스트 입력 결과를 정리합니다.
4. `다운로드`에서 의존성 해결 결과를 검토하고 아카이브를 생성합니다.
5. `히스토리`와 `설정`에서 재다운로드, SMTP, 캐시, 업데이트 설정을 관리합니다. 파일 분할은 현재 설정 UI 단계에 머물러 있습니다.

### CLI

```bash
# 일반 패키지 검색
depssmuggler search requests -t pip
depssmuggler search spring -t maven
depssmuggler search nginx -t docker

# 일반 패키지 다운로드
depssmuggler download -t pip -p requests -V 2.31.0 -o ./output
depssmuggler download -t maven -p org.springframework:spring-core -V 5.3.0
depssmuggler download -t npm -p react -V 19.2.0
depssmuggler download -t docker -p nginx -V latest

# 파일 입력 기반 다운로드
depssmuggler download -t pip --file requirements.txt

# OS 패키지 지원 배포판/검색
depssmuggler os list-distros
depssmuggler os search nginx --distro rocky-9
```

현재 CLI의 `download`는 `pip`, `conda`, `maven`, `npm`, `docker` 중심이며, OS 패키지는 `os` 네임스페이스에서 다룹니다. 다만 `os download`, `os cache stats`, `os cache clear`는 재구현 중이며 Electron GUI 사용을 안내합니다.

## 저장 위치

```text
~/.depssmuggler/
├── settings.json
├── history.json
├── cache/
└── logs/
```

## 프로젝트 구조

```text
depssmuggler/
├── electron/         # Electron main/preload/IPC/updater
├── src/
│   ├── renderer/     # React + Zustand UI
│   ├── cli/          # Commander 기반 CLI
│   ├── core/         # downloaders, resolver, packager, mailer, shared
│   ├── types/        # 공용 타입
│   └── utils/        # 로깅/마스킹 등
├── docs/             # 현재 문서와 설계/분석 문서
└── .github/workflows/
```

## 문서

- [문서 상태와 source of truth](docs/documentation-status.md)
- [아키텍처 개요](docs/architecture-overview.md)
- [Electron / Renderer](docs/electron-renderer.md)
- [IPC 핸들러](docs/ipc-handlers.md)
- [CLI](docs/cli.md)
- [테스트](docs/testing.md)
- [Downloaders](docs/downloaders.md)
- [Resolvers](docs/resolvers.md)

## 기술 스택

| 구분 | 기술 |
|------|------|
| Desktop | Electron |
| UI | React 19, Ant Design, Zustand, React Router |
| Language | TypeScript |
| Build | Vite, TypeScript Compiler, electron-builder |
| Test | Vitest, Playwright |
| Target OS | Windows, macOS, Linux |

## 라이선스

MIT
