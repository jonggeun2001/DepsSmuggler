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
| `--strict` | 직접 패키지 하나라도 의존성 해결에 실패하면 다운로드 중단 | 라이브러리 타입 | `false` |
| `--max-depth <num>` | 라이브러리 패키지 의존성 해결의 최대 탐색 깊이. 0 이상의 정수이며 `0`이면 루트만 포함 | 라이브러리 타입 | `5` |
| `--concurrency <num>` | 동시 다운로드 수 | 전체 | `3` |

기본 의존성 포함 다운로드는 라이브러리 패키지(`pip`, `conda`, `maven`, `npm`)에 대해 `--max-depth`로 지정한 깊이까지 해결된 모든 패키지와 의존성을 다운로드하는 것입니다. 기본 깊이는 `5`입니다. pip에서 경계 깊이에 도달한 노드에 적용 가능한 의존성이 더 있으면 그 노드까지는 결과에 포함하고 하위 노드 확장만 중단하며, 깊이와 생략한 의존성 수를 담은 경고를 애플리케이션 로그에 기록합니다. 이 경계 도달만으로 직접 루트를 해결 실패로 처리하지 않습니다.

`--no-deps`는 의도적으로 루트 패키지의 대상 아티팩트만 선택해 다운로드하는 옵션입니다. 전이 의존성을 탐색하지 않으며 최대 깊이 경고도 기록하지 않으므로, `--no-deps` 결과를 깊이 제한으로 인한 경고나 실패로 해석하면 안 됩니다. 직접 지정한 패키지 중 실제로 해결하지 못한 항목이 있으면 기본 모드는 실패한 직접 패키지만 경고와 함께 건너뛰고, 나머지 해결된 패키지와 의존성을 계속 다운로드합니다. 모든 직접 패키지를 해결하지 못해 남은 다운로드 항목이 없으면 빈 아카이브를 만들지 않고 오류로 종료합니다. 전체 실패 정책이 필요하면 `--strict`를 사용합니다. OS 패키지 의존성 다운로드는 `depssmuggler os download` 경로를 사용합니다.

`pip`에서 `--python-version`을 지정하면 해당 버전의 `python_version` 환경 마커를 평가하고, `--target-os` 및 `--arch`와 호환되는 wheel 태그를 선택합니다. Python 버전은 `major.minor` 형식만 허용합니다. 따라서 `python_full_version`과 `implementation_version`처럼 patch가 필요한 marker는 값을 알 수 없는 조건으로 처리합니다. wheel은 대상 버전의 CPython 태그와 범용 `py3`/`py2.py3` 태그, 또는 대상보다 같거나 낮은 CPython 버전의 `abi3` 태그만 선택합니다. PyPI의 패키지·파일 `requires_python`과 Simple API 파일의 `requiresPython`도 PEP 440 specifier set으로 확인하므로, 대상 Python보다 높은 버전만 지원하는 wheel과 source distribution은 선택하지 않습니다. `latest`와 버전 범위는 PyPI 또는 Simple API에서 대상 Python과 호환되는 산출물이 있는 가장 높은 안정 버전을 선택하고, 철회(yanked) 릴리스는 wildcard가 없는 정확한 버전 고정 외에는 제외합니다. 프리릴리스는 버전 제약이 명시적으로 포함하거나 안정 후보가 없을 때만 선택합니다. 지원하지 않는 marker 문법이나 값이 없는 `platform_release`/`platform_version`은 의존성을 포함하지 않는 것으로 처리합니다.

대상 환경 옵션은 다운로드 전에 검증됩니다.

- `--python-version`과 `--cuda-version`은 숫자 `major.minor` 형식만 허용합니다. `3.12.1`, `cuda12` 같은 값은 오류입니다.
- `--max-depth`는 0 이상의 정수만 허용합니다. 빈 값, 공백만 있는 값, 음수, 소수, 숫자가 아닌 값은 다운로드를 시작하기 전에 오류로 종료합니다.
- pip와 Conda의 대상 아티팩트 선택에는 `x86_64`, `amd64`, `arm64`, `aarch64`만 허용합니다. 지원하지 않는 값을 다른 64비트 아티팩트로 묵시적으로 바꾸지 않고 오류로 종료합니다.
- pip에서는 `arm64`와 `aarch64`, `amd64`와 `x86_64`를 같은 아키텍처로 처리합니다. 대상 Python 버전은 wheel 태그(`abi3` 최소 버전 포함)와 저장소의 `Requires-Python` 조건(PEP 440 wildcard 포함)을 모두 만족해야 합니다.
- 표의 적용 타입과 맞지 않는 선택 옵션을 사용하면 오류가 발생합니다. 예를 들어 npm에 `--target-os linux`를 지정하거나 pip에 `--cuda-version 12.4`를 지정할 수 없습니다.
- 기본값인 `--target-os any`와 `--conda-channel conda-forge`는 적용 대상이 아닌 타입에서 기존 동작을 유지합니다. 그러나 다른 OS나 채널을 명시하면 적용 타입을 검사합니다.
- pip에서 대상 OS가 `any`이면 특정 OS wheel을 임의로 선택하지 않고 범용 wheel 또는 `Requires-Python` 조건을 만족하는 소스 배포본을 선택합니다. `--python-version`도 생략하면 특정 CPython ABI wheel 대신 Python 버전 독립 wheel 또는 소스 배포본만 선택합니다.
- pip 의존성의 PEP 508 환경 마커는 지정한 OS, 아키텍처, Python 버전과 extra를 기준으로 평가합니다. `--python-version`은 `major.minor`만 받으므로 `python_full_version`처럼 patch 버전이 필요한 조건은 결과를 확정할 수 없을 때 제외합니다. 필요한 대상 값이 없거나 마커를 해석할 수 없으면 해당 조건부 의존성을 임의로 포함하지 않습니다.
- Conda에서 대상 OS가 `any`이면 특정 플랫폼을 임의로 가정하지 않고 `noarch` 빌드만 조회합니다. 플랫폼별 빌드가 필요하면 `--target-os`를 명시해야 합니다.
- Conda에서 지정한 OS, 아키텍처, Python/CUDA 조건과 일치하는 대상 subdir 또는 `noarch` 빌드를 찾지 못하면 다른 플랫폼으로 재조회하지 않고 다운로드 전에 실패합니다.
- pip와 Conda에서 필수 전이 의존성의 호환 버전이나 아티팩트를 찾지 못하면 해당 직접 루트의 해결이 실패합니다. 기본 모드는 그 직접 루트만 건너뛰고, `--strict`는 명령 전체를 실패 처리합니다. Conda의 OpenSSL, zlib 같은 런타임 라이브러리도 성공한 루트의 오프라인 묶음에 포함됩니다.
- 깊이 경계 도달은 위 규칙에 따른 정상적인 bounded traversal이며 직접 루트 실패가 아닙니다. 반대로 호환되는 필수 의존성 버전을 찾지 못한 경우, 의존성 메타데이터 조회가 실패한 경우, 네트워크 오류가 발생한 경우처럼 실제 필수 의존성 해결 오류는 직접 루트 실패로 처리됩니다.
- pip 하위 의존성은 버전 제약과 대상 환경에 호환되는 아티팩트를 함께 만족하는 최신 릴리스를 선택하며, 같은 패키지에 여러 경로로 요청된 기본/extra 컨텍스트는 합쳐서 평가합니다. Conda 하위 의존성은 버전뿐 아니라 build MatchSpec도 실제 파일 선택까지 유지하고, 같은 버전의 서로 다른 build가 필요하면 각 아티팩트를 모두 보존합니다.
- Maven classifier 형식은 라이브러리마다 다르므로 OS와 아키텍처만으로 자동 생성하지 않습니다. Maven에 `--target-os` 또는 기본값이 아닌 `--arch`를 지정할 때는 실제 네이티브 아티팩트를 선택할 `--classifier`를 함께 지정해야 합니다.
- pip, Conda, Maven에서 대상 환경을 명시하고 `--no-deps`를 사용하면 해당 환경에 맞는 루트 아티팩트만 선택하고 전이 의존성은 다운로드하지 않습니다. pip/Conda의 기본값이 아닌 `--arch`도 대상 환경 명시로 처리합니다.
- pip은 PyPI JSON API와 Simple API 모두에서 호환 wheel을 우선하고, 없으면 `Requires-Python` 조건을 만족하는 source distribution(`.tar.gz`, `.zip`, `.tar.bz2`, `.tar.xz`)을 선택합니다. source distribution은 대상 환경에서 빌드하지 않고 그대로 반입합니다. 호환 wheel과 source distribution이 모두 없으면 다른 아키텍처 wheel로 바꾸지 않으며, 요청한 정확 버전·`latest`·범위 spec과 대상 Python/OS/아키텍처를 포함한 오류를 반환합니다.
- Simple API의 source distribution은 `--no-deps`에서 artifact hash가 있으면 Core Metadata 없이도 반입할 수 있습니다. wheel과 의존성 확장 모드는 검증된 Core Metadata를 계속 요구합니다.

### 예시

```bash
depssmuggler download -t pip -p requests -V 2.31.0
depssmuggler download -t maven -p org.springframework:spring-core -V 5.3.0
depssmuggler download -t npm -p react -V 19.2.0
depssmuggler download -t docker -p nginx -V latest
depssmuggler download -t pip --file requirements.txt -o ./packages
depssmuggler download -t pip --file requirements.txt --python-version 3.12 -o ./packages
depssmuggler download -t pip --file requirements.txt --python-version 3.12 --strict -o ./packages
depssmuggler download -t pip -p flask --max-depth 8 -o ./packages
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
