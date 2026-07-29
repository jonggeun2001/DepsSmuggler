# CLI

## 개요

CLI 엔트리포인트는 `src/cli/index.ts`이며 Commander 기반으로 구성됩니다. 현재 CLI는 일반 패키지 작업과 OS 패키지 보조 명령을 함께 제공합니다.

## 실행

```bash
# 로컬 개발 실행
npm run cli -- --help

# 빌드 후 직접 실행
node dist/src/cli/index.js --help

# source checkout에서 글로벌 설치 후 실행
npm run build
npm install -g .
depssmuggler --help
```

## 명령 구조

```text
depssmuggler
├── download
├── search
├── os
│   ├── list-distros
│   ├── search
│   ├── download
│   └── cache
│       ├── stats
│       └── clear
├── config
│   ├── get
│   ├── set
│   ├── list
│   └── reset
└── cache
    ├── size
    ├── clear
    └── list
```

## `download`

일반 패키지 다운로드 명령입니다. 현재 구현 기준으로 `pip`, `conda`, `maven`, `npm`, `docker` 타입을 처리합니다.

### 사용법

```bash
depssmuggler download [옵션]
```

### 옵션

| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `-t, --type <type>` | 패키지 타입 (`pip`, `conda`, `maven`, `npm`, `docker`) | `pip` |
| `-p, --package <name>` | 패키지명 | - |
| `-V, --pkg-version <version>` | 패키지 버전 | `latest` |
| `-a, --arch <arch>` | 아키텍처 | `x86_64` |
| `-o, --output <path>` | 출력 경로 | `./output` |
| `-f, --format <format>` | 아카이브 형식 (`zip`, `tar.gz`) | `zip` |
| `--file <file>` | 줄 단위 패키지 목록 파일 (`requirements.txt`, Maven 좌표 목록 등) | - |
| `--python-version <version>` | `pip`/`conda` 의존성 해결 대상 Python 버전 | - |
| `--no-deps` | 의존성 해결 비활성화 | `false` |
| `--strict` | 직접 패키지 하나라도 의존성 해결에 실패하면 다운로드 중단 | `false` |
| `--concurrency <num>` | 동시 다운로드 수 | `3` |

기본 동작은 라이브러리 패키지(`pip`, `conda`, `maven`, `npm`)에 대해 의존성을 함께 해결해 다운로드하는 것입니다. `--no-deps`를 지정하면 원본 패키지 목록만 다운로드합니다. 직접 지정한 패키지 중 일부를 해결하지 못하면 기본 모드는 실패한 직접 패키지만 경고와 함께 건너뛰고, 나머지 해결된 패키지와 의존성을 계속 다운로드합니다. 모든 직접 패키지를 해결하지 못해 남은 다운로드 항목이 없으면 빈 아카이브를 만들지 않고 오류로 종료합니다. 전체 실패 정책이 필요하면 `--strict`를 사용합니다. OS 패키지 의존성 다운로드는 `depssmuggler os download` 경로를 사용합니다.

`pip`에서 `--python-version`을 지정하면 해당 버전의 `python_version` 환경 마커를 평가하고, 호환되는 wheel 태그를 선택합니다. Python 버전은 `major.minor` 또는 `major.minor.patch` 형식만 허용하며, patch가 있으면 `major.minor`로 정규화합니다. wheel은 대상 버전의 CPython 태그와 범용 `py3`/`py2.py3` 태그, 또는 대상보다 같거나 낮은 CPython 버전의 `abi3` 태그만 선택합니다. PyPI의 패키지·파일 `requires_python`과 Simple API 파일의 `requiresPython`도 PEP 440 specifier set으로 확인하므로, 대상 Python보다 높은 버전만 지원하는 wheel과 source distribution은 선택하지 않습니다. `latest`와 버전 범위는 PyPI 또는 Simple API에서 대상 Python과 호환되는 산출물이 있는 가장 높은 버전을 선택합니다. CLI에 OS 옵션이 없으므로 wheel 대상 OS는 기존 resolver와 동일하게 Linux를 사용하며, Linux ARM64의 `arm64`/`aarch64` 별칭은 `aarch64`로 통일합니다. `--python-version`을 생략해도 이 Linux/아키텍처 대상은 resolver와 downloader에 동일하게 전달됩니다. `--arch` 값이 pip wheel 아키텍처로 지원되지 않으면 `x86_64`로 처리합니다.

### 예시

```bash
depssmuggler download -t pip -p requests -V 2.31.0
depssmuggler download -t maven -p org.springframework:spring-core -V 5.3.0
depssmuggler download -t npm -p react -V 19.2.0
depssmuggler download -t docker -p nginx -V latest
depssmuggler download -t pip --file requirements.txt -o ./packages
depssmuggler download -t pip --file requirements.txt --python-version 3.12 -o ./packages
depssmuggler download -t pip --file requirements.txt --python-version 3.12 --strict -o ./packages
depssmuggler download -t maven --file ./maven-packages.txt
depssmuggler download -t pip -p flask -f tar.gz
```

참고: `--file`은 현재 XML `pom.xml`을 직접 파싱하지 않고, 줄 단위 텍스트 입력만 처리합니다. Maven은 각 줄에 `groupId:artifactId[:version]` 형식으로 적어야 합니다.

### 현재 동작

- 다운로드 성공 시 아카이브 생성과 설치 스크립트 생성을 연달아 수행합니다.
- 출력 형식은 현재 `zip` 또는 `tar.gz`만 지원합니다.
- OS 패키지(`yum`, `apt`, `apk`)는 이 명령이 아니라 `os` 네임스페이스를 사용해야 합니다.

## `search`

일반 패키지 검색 명령입니다. 구현상 `pip`, `conda`, `maven`, `npm`, `docker`를 직접 검색합니다.

### 사용법

```bash
depssmuggler search <query> [옵션]
```

### 옵션

| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `-t, --type <type>` | 패키지 타입 | `pip` |
| `-l, --limit <num>` | 출력 건수 제한 | `20` |

### 예시

```bash
depssmuggler search requests -t pip
depssmuggler search spring -t maven -l 10
depssmuggler search react -t npm
depssmuggler search nginx -t docker
```

### 참고

- `yum`, `apt`, `apk`를 `search`로 호출하면 CLI는 `os search` 사용을 안내하고 종료합니다.

## `os`

OS 패키지 전용 보조 명령입니다.

### `os list-distros`

```bash
depssmuggler os list-distros
depssmuggler os list-distros --type yum
```

- 저장소 프리셋 기준 지원 배포판을 출력합니다.
- `yum`, `apt`, `apk` 패키지 관리자별 필터링이 가능합니다.

### `os search`

```bash
depssmuggler os search nginx --distro rocky-9
depssmuggler os search bash --distro ubuntu-22.04 --arch amd64
```

- 배포판 ID와 아키텍처를 기준으로 저장소 메타데이터를 직접 조회합니다.
- 배포판별 parser는 shared shim(`src/core/shared/{yum,apt,apk}-metadata-parser.ts`)을 통해 사용합니다.

### `os download`

```bash
depssmuggler os download httpd --distro rocky-9
depssmuggler os download httpd nginx --distro rocky-9 --format both --scripts
depssmuggler os download bash --distro ubuntu-22.04 --arch amd64 --format repository
```

- 배포판 ID와 아키텍처를 기준으로 OS resolver를 실행해 전이 의존성을 함께 계산합니다.
- `--format archive|repository|both`에 따라 아카이브, 로컬 저장소, 또는 둘 다 생성합니다.
- `--scripts`를 주면 설치 스크립트와 로컬 저장소 설정 스크립트를 함께 생성합니다.
- OS 메타데이터 캐시는 `~/.depssmuggler/cache/os-packages` 아래 persistent JSON 파일로 관리됩니다.

### `os cache`

```bash
depssmuggler os cache stats
depssmuggler os cache clear
```

- `stats`는 OS 메타데이터 캐시 디렉터리, 항목 수, 총 크기를 출력합니다.
- `clear`는 OS 메타데이터 캐시 JSON 파일만 삭제합니다. `--force`가 없으면 확인 프롬프트를 표시합니다.

## `config`

설정 파일은 `~/.depssmuggler/settings.json`을 사용합니다.

```bash
depssmuggler config get
depssmuggler config get concurrentDownloads
depssmuggler config set concurrentDownloads 5
depssmuggler config list
depssmuggler config reset
```

현재 CLI가 직접 다루는 핵심 항목:

- `concurrentDownloads`
- `cacheEnabled`
- `cachePath`
- `maxCacheSize`
- `logLevel`

## `cache`

일반 캐시 관리 명령입니다.

```bash
depssmuggler cache size
depssmuggler cache clear --force
depssmuggler cache list
```

- `size`: 캐시 디렉터리 용량 출력
- `clear`: 캐시 삭제, `--force` 없으면 확인 프롬프트 표시
- `list`: 캐시 루트 엔트리를 표로 출력하고, 엔트리가 디렉터리이며 `manifest.json`이 있으면 메타데이터를 채웁니다.

## 현재 한계

- CLI는 GUI보다 지원 범위가 좁습니다.
- OS 패키지 CLI는 `list-distros`, `search`, `download`, `cache`를 독립적으로 수행하며 Electron GUI에 의존하지 않습니다.
- 일반 패키지 `search`는 `pip`, `conda`, `maven`, `npm`, `docker`에 연결되어 있지만, GUI 전용 위자드/시각화 흐름은 CLI에 없습니다.
- `cache list`는 현재 캐시 루트가 디렉터리 위주라는 가정을 두고 있어, `cache-manifest.json` 같은 일반 파일이 섞인 경우 실패할 수 있습니다.

## 관련 문서

- [README](../README.md)
- [아키텍처 개요](./architecture-overview.md)
- [IPC 핸들러](./ipc-handlers.md)
