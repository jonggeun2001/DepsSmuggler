<p align="center">
  <img src="assets/icons/icon-128.png" width="96" height="96" alt="DepsSmuggler 아이콘">
</p>

# DepsSmuggler (의존성 밀수꾼)

**인터넷이 되는 곳에서 의존성까지 모으고, 폐쇄망으로 옮기세요.**

라이브러리, Linux OS 패키지, 컨테이너 이미지를 수집하는 Electron 데스크톱 앱과 CLI입니다. 개발자·시스템 관리자뿐 아니라 명령어에 익숙하지 않은 사용자도 한국어 위자드로 패키지를 선택하고 전달할 수 있습니다.

[![Test](https://github.com/jonggeun2001/DepsSmuggler/actions/workflows/test.yml/badge.svg)](https://github.com/jonggeun2001/DepsSmuggler/actions/workflows/test.yml)
[![Release](https://img.shields.io/github/v/release/jonggeun2001/DepsSmuggler)](https://github.com/jonggeun2001/DepsSmuggler/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[다운로드](#다운로드) · [빠른 시작](#빠른-시작) · [지원 범위](#지원-범위) · [CLI 예시](#cli) · [전체 문서](docs/README.md) · [이슈](https://github.com/jonggeun2001/DepsSmuggler/issues)

## 주요 기능

- **의존성까지 수집** — 패키지 타입별 resolver가 전이 의존성을 계산하고 트리로 보여줍니다. 탐색 깊이와 대상 환경을 지정할 수 있습니다.
- **검색부터 전달까지** — 홈 → 패키지 검색 위자드 → 장바구니 → 다운로드 → 히스토리로 이어집니다. 여러 패키지 선택과 텍스트 입력을 지원합니다.
- **폐쇄망용 출력물** — ZIP 또는 tar.gz 아카이브와 설치 스크립트를 생성합니다. OS 패키지는 아카이브, 로컬 저장소 또는 둘 다 만들 수 있습니다.
- **파일 저장과 이메일** — 일반 GUI 다운로드에서 로컬 저장 또는 SMTP 전달을 선택합니다. 이메일 첨부 한도를 넘으면 설정에 따라 파일을 분할하고 병합 스크립트를 함께 보냅니다.
- **반복 작업 지원** — 다운로드 히스토리, 설정 저장, 메타데이터·아티팩트 캐시, 동시 다운로드와 CLI 자동화를 제공합니다.
- **데스크톱 업데이트** — 배포 앱에서 업데이트 확인, 다운로드, 설치 UI를 제공합니다. 설정 토글의 연결 범위는 [현재 동작 범위](#현재-동작-범위)를 참고하세요.

패키지 조회·다운로드는 인터넷에 연결된 컴퓨터에서 수행합니다. 생성된 출력물을 USB, 수동 파일 복사 또는 이메일로 전달한 뒤 대상 환경에서 설치합니다.

## 다운로드

[GitHub Releases](https://github.com/jonggeun2001/DepsSmuggler/releases/latest)에서 운영체제에 맞는 설치 파일을 선택하세요.

| 운영체제 | 배포 파일 |
|----------|-----------|
| Windows | `.exe` 설치 프로그램 |
| macOS | `.dmg` 디스크 이미지 |
| Linux | `.AppImage` |

릴리스마다 제공하는 아키텍처와 파일은 Assets 목록에서 확인합니다. 이 README와 `docs/`는 **현재 main 소스 기준**이며, 이미 배포된 릴리스의 기능과 차이가 있을 수 있습니다. 소스에서 최신 구현을 실행하려면 아래 빠른 시작을 따르세요.

## 빠른 시작

소스 실행에는 Git, Node.js, npm이 필요합니다. 잠금 파일의 설치·테스트·패키징 도구 요구사항을 함께 만족하는 버전은 **Node.js 22.13 이상인 22.x 또는 24 이상**입니다. CI는 Node.js 20을 사용하지만 일부 패키징 도구의 요구 버전과 차이가 있습니다. 세부 사항은 [테스트 문서](docs/testing.md)를 참고하세요.

```bash
git clone https://github.com/jonggeun2001/DepsSmuggler.git
cd DepsSmuggler
npm install
npm run dev
```

`npm run dev`는 Vite와 Electron을 함께 실행합니다. 브라우저 UI만 살펴보려면 `npm run dev:vite`를 사용할 수 있지만, 실제 다운로드와 OS 작업에는 Electron이 필요합니다.

CLI는 소스에서 바로 실행할 수 있습니다.

```bash
npm run cli -- --help
npm run cli -- search requests -t pip
```

`depssmuggler` 명령을 전역으로 사용하려면 같은 소스 체크아웃에서 빌드 후 설치합니다.

```bash
npm run build
npm install -g .
depssmuggler --help
```

전역 CLI의 진입점은 `dist/src/cli/index.js`입니다. npm 레지스트리 배포 여부와 무관하게 위 명령은 현재 체크아웃을 설치합니다.

## 지원 범위

| 영역 | GUI | CLI | 주요 지원 |
|------|-----|-----|-----------|
| Python `pip` | 지원 | 지원 | PyPI 검색·버전 조회, 대상 Python·OS·아키텍처에 맞는 파일 선택 |
| Python `conda` | 지원 | 지원 | 채널 선택, Python·CUDA·플랫폼을 고려한 빌드 선택 |
| Java `maven` | 지원 | 지원 | Maven Central, POM·BOM·플러그인, 네이티브 classifier 선택 |
| Node.js `npm` | 지원 | 지원 | npm Registry 검색·버전 조회·tarball 다운로드 |
| OS `yum` | 지원 | 지원 | RPM 계열 배포판, 의존성 해결과 로컬 저장소 출력 |
| OS `apt` | 지원 | 지원 | Ubuntu/Debian, 의존성 포함 DEB 다운로드 |
| OS `apk` | 지원 | 지원 | Alpine, APK 다운로드·아카이브·로컬 저장소 출력 |
| Container `docker` | 지원 | 지원 | Docker Hub 이미지·태그·플랫폼 선택과 이미지 아카이브 |

OS 패키지 CLI는 `os list-distros/search/download/cache`를 사용합니다. 배포판과 아키텍처 목록은 저장소 프리셋 및 조회 결과에 따라 달라지므로 `depssmuggler os list-distros`로 확인하세요.

GUI에는 Docker Hub 외 GHCR, ECR Public, Quay, 사용자 지정 레지스트리 선택도 있습니다. 익명 pull과 검색 전략이 구현되어 있으나 GHCR/ECR Public은 정확한 이미지명을 입력해야 하며, 공통 메타데이터 조회는 Docker Hub 중심입니다. 모든 레지스트리에서 같은 검색·메타데이터 기능을 제공하지는 않습니다. 자세한 범위는 [Docker 아키텍처](docs/docker-architecture.md)를 참고하세요.

## 사용 예시

### GUI

1. **설정**에서 대상 OS, Python/CUDA 버전, 아키텍처·배포판과 일반 다운로드 출력 형식을 준비한 뒤 **홈**에서 패키지 매니저를 선택합니다.
2. **패키지 검색** 위자드에서 적용된 환경을 확인하고 패키지명·버전을 고릅니다. 패키지 타입에 따라 채널·레지스트리·classifier를 선택합니다.
3. **장바구니**에서 여러 패키지를 조합하거나 텍스트 입력 결과를 정리합니다.
4. **다운로드**에서 의존성 트리와 예상 크기, 설정된 출력 형식을 확인하고 전달 방식을 선택합니다. OS 전용 흐름에서는 출력 옵션을 직접 선택합니다.
5. **히스토리**에서 결과를 확인하거나 재다운로드하고, **설정**에서 출력·전달·SMTP·캐시·업데이트 설정을 관리합니다.

OS 패키지만 담겨 있고 관리자·배포판·아키텍처가 모두 일치하면 전용 다운로드 화면에서 아카이브/로컬 저장소/복합 출력을 선택합니다. 필요한 OS 문맥이 없는 예전 항목은 검색 화면에서 다시 선택하라는 안내를 표시합니다.

### CLI

아래 예시는 전역 설치 후 실행합니다. 소스 실행 시에는 `depssmuggler`를 `npm run cli --`로 바꾸면 됩니다.

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

# 대상 환경별 아티팩트 다운로드
depssmuggler download -t pip -p cryptography -V 43.0.0 --target-os linux --python-version 3.12 --arch aarch64
depssmuggler download -t conda -p pytorch -V 2.5.0 --target-os linux --python-version 3.12 --cuda-version 12.4 --conda-channel pytorch --arch x86_64
depssmuggler download -t maven -p org.lwjgl:lwjgl -V 3.3.6 --target-os linux --arch x86_64 --classifier natives-linux

# 파일 입력 기반 다운로드
depssmuggler download -t pip --file requirements.txt

# 의존성 탐색과 압축 형식 지정
depssmuggler download -t pip -p requests -V 2.31.0 --max-depth 10 --strict --format tar.gz

# OS 패키지 지원 배포판/검색/다운로드
depssmuggler os list-distros
depssmuggler os search nginx --distro rocky-9
depssmuggler os download httpd --distro rocky-9 --format both --scripts

# 일반 설정·캐시와 OS 메타데이터 캐시
depssmuggler config list
depssmuggler config set concurrentDownloads 5
depssmuggler cache size
depssmuggler cache clear
depssmuggler os cache stats
depssmuggler os cache clear
```

일반 `download --format`은 `zip`/`tar.gz`, `os download --format`은 `archive`/`repository`/`both`입니다. OS 아카이브 압축 형식은 별도의 `--archive-format`으로 지정합니다. `--file`은 줄 단위 목록을 읽으며 `pom.xml`·`package.json`의 구조를 자동 파싱하는 옵션이 아닙니다.

대상 OS, Python/CUDA 버전, 아키텍처, Conda 채널, Maven classifier, 탐색 깊이와 오류 처리 규칙은 [CLI 문서](docs/cli.md#download)에 정리되어 있습니다.

## 현재 동작 범위

| 항목 | 현재 동작 |
|------|-----------|
| 압축·설치 스크립트 | 일반 GUI와 CLI에서 ZIP/tar.gz 지원. 일반 GUI는 설치 스크립트 포함 여부를 선택하고 OS 출력에는 전용 스크립트 생성기가 있습니다. |
| 설치 스크립트 범위 | npm은 전달된 `.tgz`를 오프라인으로 설치해 스크립트 폴더의 `npm-project/node_modules`에 배치하며, 전이 의존성의 여러 버전을 함께 보존합니다. Conda 항목은 아직 pip 명령으로 처리하므로 Conda 오프라인 설치를 보장하지 않습니다. 생성기별 범위는 [Packagers](docs/packagers.md)를 참고하세요. |
| 파일 분할 | 일반 GUI의 이메일 전달 중 첨부 한도를 초과하고 분할 설정이 켜진 경우 적용합니다. 로컬 저장 경로에서 자동 분할하지 않습니다. |
| SMTP 테스트 | Electron IPC로 실제 연결을 테스트합니다. 브라우저 개발 환경에서는 시뮬레이션이며, Electron API가 일부 누락되면 안내 후 비활성화됩니다. |
| 업데이트 | 배포 앱에서 시작 후 확인하고 사용자가 다운로드·설치할 수 있습니다. 개발 환경은 모의 동작입니다. `autoUpdate`·`autoDownloadUpdate` 설정은 저장되지만 updater 동작을 제어하는 연결은 아직 없습니다. |
| 브라우저 실행·E2E | 일부 조회·히스토리 폴백과 UI 검증용입니다. Playwright는 `window.electronAPI` mock/stub을 사용하므로 실제 Electron·외부 저장소·SMTP 통합 검증과 구분합니다. |
| 저장소 인증·무결성 | 공개 저장소 사용을 대상으로 하며 사용자 자격 증명을 쓰는 프라이빗 저장소 인증 UI/CLI는 없습니다. 체크섬 처리는 downloader마다 다르고, OS의 실제 GPG 서명 검증은 미구현입니다. |
| OS 로컬 저장소 | 관리자별 메타데이터 생성 코드가 있습니다. APK 인덱스 출력은 간소화 구현이므로 실제 Alpine 저장소 호환성은 [OS 문서](docs/os-package-downloader.md)의 제한을 확인해야 합니다. |

이 범위는 기존 구현을 설명합니다. 상세 동작과 설계 기록의 구분은 [문서 상태](docs/documentation-status.md)에서 확인할 수 있습니다.

## 설정과 저장 위치

GUI 설정은 전달/출력, 캐시, 업데이트 등의 섹션으로 나뉩니다. 출력 경로·압축 형식·설치 스크립트, SMTP와 수신자·첨부 크기·파일 분할, 동시 다운로드 수·캐시 사용 여부를 관리합니다. CLI 설정은 `config list/get/set/reset`으로 조회·변경합니다.

기본 파일 저장 위치는 다음과 같습니다. 다운로드 출력 경로와 캐시 경로는 별도로 지정할 수 있습니다.

```text
~/.depssmuggler/
├── settings.json     # GUI/CLI 설정
├── history.json      # Electron 다운로드 히스토리
├── cache/            # 패키지 메타데이터·아티팩트 캐시
└── logs/             # 애플리케이션 로그
```

Renderer의 Python 버전 캐시, 설정 백업과 브라우저 히스토리는 `localStorage`도 사용합니다. 상세 저장 방식은 [히스토리](docs/download-history.md), [캐시](docs/shared-cache.md), [Electron / Renderer](docs/electron-renderer.md)를 참고하세요.

## 개발 명령어

```bash
# GUI / 브라우저 UI / 소스 CLI
npm run dev
npm run dev:vite
npm run cli -- --help

# 빌드
npm run build

# 운영체제별 패키징
npm run package:win
npm run package:mac
npm run package:linux

# 단위 테스트와 표준 worktree 검증 진입점
npm run test
bash scripts/verify-worktree.sh
npm run test:watch
npm run test:coverage

# 외부 네트워크 통합 테스트 포함 (POSIX 셸)
INTEGRATION_TEST=true npm run test

# 정적 검사
npm run lint
npx tsc --noEmit
npx tsc --noEmit -p tsconfig.electron.json

# 브라우저 E2E
npm run test:e2e
npm run test:e2e:ui
```

Playwright는 Chromium 설치가 필요합니다. 설치·실행 조건과 테스트 범위는 [테스트 문서](docs/testing.md)를 참고하세요. 기본 E2E는 설정 반영, 장바구니→다운로드, 히스토리 기반 이메일 전달 복원, OS 전용 다운로드 흐름을 검증합니다.

## 프로젝트 구조

```text
DepsSmuggler/
├── electron/         # main/preload, IPC 핸들러, 실행·전달 서비스, updater
├── src/
│   ├── renderer/     # React 페이지·컴포넌트, Zustand, renderer data client
│   ├── cli/          # Commander 명령과 다운로드 실행
│   ├── core/         # downloaders, resolver, packager, mailer, shared, ports
│   ├── types/        # 공용 계약과 타입
│   └── utils/        # 로깅·마스킹 등
├── scripts/          # CLI 실행·검증·자산 생성 도구
├── tests/e2e/        # Playwright 브라우저 회귀 테스트
├── assets/           # 앱 아이콘
├── docs/             # 사용·구현 문서와 설계·분석 기록
└── .github/workflows/ # 테스트와 릴리스 CI
```

## 문서

| 알아볼 내용 | 문서 |
|-------------|------|
| 전체 문서 목록과 점검 기준 | [문서 인덱스](docs/README.md), [문서 상태](docs/documentation-status.md) |
| 구조·프로세스 경계 | [아키텍처 개요](docs/architecture-overview.md), [Electron / Renderer](docs/electron-renderer.md), [IPC 핸들러](docs/ipc-handlers.md) |
| CLI·검증 | [CLI](docs/cli.md), [테스트](docs/testing.md), [코딩 규칙](docs/coding-conventions.md) |
| 수집·의존성·출력 | [Downloaders](docs/downloaders.md), [Resolvers](docs/resolvers.md), [Packagers](docs/packagers.md) |
| 패키지별 심화 | [OS 패키지](docs/os-package-downloader.md), [Docker](docs/docker-architecture.md), [공유 유틸리티](docs/shared-utilities.md) |

## 기술 스택

| 구분 | 기술 |
|------|------|
| Desktop | Electron |
| UI | React 19, Ant Design, Zustand, React Router |
| Language | TypeScript (Node.js) |
| CLI | Commander |
| Build | Vite, TypeScript Compiler, electron-builder |
| Test | Vitest, Playwright |
| Target OS | Windows, macOS, Linux |

## 기여와 문제 제보

오류를 제보할 때는 사용한 앱 버전 또는 커밋, 운영체제·아키텍처, 패키지 타입과 이름·버전, 재현 단계 및 관련 로그를 [Issues](https://github.com/jonggeun2001/DepsSmuggler/issues)에 남겨 주세요. 코드나 문서를 수정할 때는 [코딩 규칙](docs/coding-conventions.md)과 [테스트 안내](docs/testing.md)를 확인하고 관련 문서도 함께 갱신합니다.

## 라이선스

[MIT](LICENSE)
