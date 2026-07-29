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

| 옵션 | 설명 | 적용 타입 | 기본값 |
|------|------|-----------|--------|
| `-t, --type <type>` | 패키지 타입 (`pip`, `conda`, `maven`, `npm`, `docker`) | 전체 | `pip` |
| `-p, --package <name>` | 패키지명 | 전체 | - |
| `-V, --pkg-version <version>` | 패키지 버전 | 전체 | `latest` |
| `-a, --arch <arch>` | 아키텍처. pip/Conda 대상 선택은 `x86_64`, `amd64`, `arm64`, `aarch64` 지원 | 전체 | `x86_64` |
| `--target-os <os>` | 대상 OS (`any`, `linux`, `windows`, `macos`) | `pip`, `conda`, `maven` (`maven`은 classifier 필요) | `any` |
| `--python-version <version>` | 대상 Python 버전 (`major.minor`, 예: `3.12`) | `pip`, `conda` | - |
| `--cuda-version <version>` | 대상 CUDA 버전 (`major.minor`, 예: `12.4`) | `conda` | - |
| `--conda-channel <channel>` | Conda 채널 | `conda` | `conda-forge` |
| `--classifier <classifier>` | Maven classifier | `maven` | - |
| `-o, --output <path>` | 출력 경로 | 전체 | `./output` |
| `-f, --format <format>` | 아카이브 형식 (`zip`, `tar.gz`) | 전체 | `zip` |
| `--file <file>` | 줄 단위 패키지 목록 파일 (`requirements.txt`, Maven 좌표 목록 등) | 전체 | - |
| `--no-deps` | 전이 의존성 다운로드 비활성화 | 전체 | `false` |
| `--concurrency <num>` | 동시 다운로드 수 | 전체 | `3` |

기본 동작은 라이브러리 패키지(`pip`, `conda`, `maven`, `npm`)에 대해 의존성을 함께 해결해 다운로드하는 것입니다. `--no-deps`를 지정하면 원본 패키지 목록만 다운로드합니다. 라이브러리 패키지의 의존성 해결이 실패하면 명령은 오류로 종료됩니다. OS 패키지 의존성 다운로드는 `depssmuggler os download` 경로를 사용합니다.

대상 환경 옵션은 다운로드 전에 검증됩니다.

- `--python-version`과 `--cuda-version`은 숫자 `major.minor` 형식만 허용합니다. `3.12.1`, `cuda12` 같은 값은 오류입니다.
- pip와 Conda의 대상 아티팩트 선택에는 `x86_64`, `amd64`, `arm64`, `aarch64`만 허용합니다. 지원하지 않는 값을 다른 64비트 아티팩트로 묵시적으로 바꾸지 않고 오류로 종료합니다.
- 표의 적용 타입과 맞지 않는 선택 옵션을 사용하면 오류가 발생합니다. 예를 들어 npm에 `--target-os linux`를 지정하거나 pip에 `--cuda-version 12.4`를 지정할 수 없습니다.
- 기본값인 `--target-os any`와 `--conda-channel conda-forge`는 적용 대상이 아닌 타입에서 기존 동작을 유지합니다. 그러나 다른 OS나 채널을 명시하면 적용 타입을 검사합니다.
- Maven classifier 형식은 라이브러리마다 다르므로 OS와 아키텍처만으로 자동 생성하지 않습니다. Maven에 `--target-os`를 지정할 때는 실제 네이티브 아티팩트를 선택할 `--classifier`를 함께 지정해야 합니다.
- pip, Conda, Maven에서 대상 환경을 명시하고 `--no-deps`를 사용하면 해당 환경에 맞는 루트 아티팩트만 선택하고 전이 의존성은 다운로드하지 않습니다.
- pip 대상 환경에 호환되는 wheel이 없으면 sdist를 사용하며, sdist도 없으면 다른 아키텍처 wheel로 바꾸지 않고 오류로 종료합니다.

### 예시

```bash
depssmuggler download -t pip -p requests -V 2.31.0
depssmuggler download -t maven -p org.springframework:spring-core -V 5.3.0
depssmuggler download -t npm -p react -V 19.2.0
depssmuggler download -t docker -p nginx -V latest
depssmuggler download -t pip --file requirements.txt -o ./packages
depssmuggler download -t maven --file ./maven-packages.txt
depssmuggler download -t pip -p flask -f tar.gz

# Linux ARM64, Python 3.12용 pip 아티팩트
depssmuggler download -t pip -p cryptography -V 43.0.0 \
  --target-os linux --python-version 3.12 --arch aarch64

# Linux x86_64, Python 3.12, CUDA 12.4용 Conda 아티팩트
depssmuggler download -t conda -p pytorch -V 2.5.0 \
  --target-os linux --python-version 3.12 --cuda-version 12.4 \
  --conda-channel pytorch --arch x86_64

# Linux 네이티브 Maven JAR
depssmuggler download -t maven -p org.lwjgl:lwjgl -V 3.3.6 \
  --target-os linux --arch x86_64 --classifier natives-linux
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
