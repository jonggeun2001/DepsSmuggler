# CLI

## 개요

CLI 엔트리포인트는 `src/cli/index.ts`이며 Commander 기반으로 구성됩니다. 현재 CLI는 일반 패키지 작업과 OS 패키지 보조 명령을 함께 제공합니다.

비동기 명령은 `parseAsync`로 완료/실패까지 기다립니다. 명령 핸들러 밖으로 전파된 예외는 `CLI 명령 실행 실패` 로그와 콘솔 오류를 남기고 종료 코드 `1`로 마무리합니다. 파일 로거 초기화가 실패하면 경고를 남기고 콘솔 로깅으로 명령 실행을 계속합니다. `src/cli/index.test.ts`가 두 실패 경계를 검증합니다. 핸들러가 내부에서 오류를 출력하고 반환하는 경우의 종료 상태는 아래 현재 한계를 참고합니다.

## 실행

`npm run cli`는 `scripts/cli.cjs`에서 `ts-node`를 등록해 `src/cli/index.ts`를 실행합니다. 빌드 산출물과 `package.json`의 `bin` 경로는 `dist/src/cli/index.js`입니다. 개발·테스트 환경의 Node 버전 조건은 [테스트 문서](./testing.md#로컬-검증-명령)를 참고합니다.

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

## 버전 확인

`-v`와 `--version`은 실행 파일의 위치에서 상위 디렉터리를 검색해 버전 필드가 있는 패키지 `package.json`을 읽습니다. 따라서 소스 실행, 빌드 산출물 실행, npm으로 설치한 CLI가 배포 패키지 버전을 함께 표시합니다. Electron 빌드가 생성하는 `dist/package.json`에는 모듈 형식만 기록되므로, 버전 필드가 없으면 패키지 루트의 메타데이터를 계속 검색합니다.

```bash
npm run cli -- --version
npm run cli -- -v
node dist/src/cli/index.js --version
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

`--target-os`는 CLI에서 선택한 OS 값을 pip·Conda·Maven 다운로드 핸들러의 대상 환경 옵션으로 전달합니다. 따라서 `linux`, `windows`, `macos`를 지정하면 해당 플랫폼에 맞는 아티팩트를 선택하며, 지원하지 않는 OS나 적용할 수 없는 패키지 타입은 다운로드 전에 오류로 종료합니다.

`--concurrency`에는 `2`처럼 양의 정수를 지정합니다. `1.5`, `0.5`, `1abc`처럼 정수로 절삭되거나 일부만 해석되는 값과 안전한 정수 범위를 넘는 값은 의존성 조회와 출력 생성 전에 오류로 종료합니다. 일반 `download`와 `os download`에 동일하게 적용되며, 일반 다운로드 안내에는 실제 사용할 정수를 표시합니다. 기존 `0`, `-1`, `abc` 처리 방식은 유지합니다. OS 경로는 설정의 `concurrentDownloads`로 대체하고, 일반 경로는 기존 다운로드 처리에 전달합니다.

Maven ZIP/TAR.GZ에는 선택된 각 아티팩트의 부속 POM과 다운로드에 성공한 `.sha1` 체크섬도 포함됩니다. `--no-deps`나 `--max-depth`로 의존성 탐색 범위를 줄여도 선택된 JAR 자체의 POM은 함께 전달됩니다. 파일은 `packages/` 아래 Maven 저장소 디렉터리 구조를 유지하며, 같은 POM을 여러 항목에서 참조해도 한 번만 포함합니다.

Maven의 `-V latest`는 POM을 조회하기 전에 `maven-metadata.xml`의 `latest` 값으로 해석하며, 그 값이 없으면 `release`를 사용합니다. 해석된 실제 버전이 다운로드 경로·파일명과 manifest에 기록됩니다. `--no-deps`에서도 이 버전 조회는 수행하며 전이 라이브러리를 확장하지 않습니다. 사용 가능한 버전 정보가 없으면 해당 루트의 해결 실패로 처리합니다.

npm 의존성 포함 다운로드는 버전을 생략하거나 `latest`, dist-tag, 버전 범위를 지정해도 직접 요청한 패키지를 해결된 실제 버전으로 다운로드 목록에 유지합니다. 예를 들어 `is-odd@latest`는 해결된 `is-odd`와 전이 의존성 `is-number`를 모두 아카이브와 manifest에 넣습니다. 직접 패키지가 빠져 설치 스크립트를 생성할 수 없던 문제를 방지합니다.

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
- `--conda-channel defaults`는 `https://repo.anaconda.com/pkgs/main`에서 메타데이터와 패키지를 받습니다. 대상 플랫폼과 `noarch` 선택 규칙은 동일하며, 명시적 `main`과 `conda-forge` 같은 일반 채널은 `https://conda.anaconda.org/<채널>`을 사용합니다.
- Conda에서 대상 OS가 `any`이면 특정 플랫폼을 임의로 가정하지 않고 `noarch` 빌드만 조회합니다. 플랫폼별 빌드가 필요하면 `--target-os`를 명시해야 합니다.
- Conda에서 지정한 OS, 아키텍처, Python/CUDA 조건과 일치하는 대상 subdir 또는 `noarch` 빌드를 찾지 못하면 다른 플랫폼으로 재조회하지 않고 다운로드 전에 실패합니다.
- pip와 Conda에서 필수 전이 의존성의 호환 버전이나 아티팩트를 찾지 못하면 해당 직접 루트의 해결이 실패합니다. 기본 모드는 그 직접 루트만 건너뛰고, `--strict`는 명령 전체를 실패 처리합니다. Conda의 OpenSSL, zlib 같은 런타임 라이브러리도 성공한 루트의 오프라인 묶음에 포함됩니다.
- 깊이 경계 도달은 위 규칙에 따른 정상적인 bounded traversal이며 직접 루트 실패가 아닙니다. 반대로 호환되는 필수 의존성 버전을 찾지 못한 경우, 의존성 메타데이터 조회가 실패한 경우, 네트워크 오류가 발생한 경우처럼 실제 필수 의존성 해결 오류는 직접 루트 실패로 처리됩니다.
- pip 하위 의존성은 버전 제약과 대상 환경에 호환되는 아티팩트를 함께 만족하는 최신 릴리스를 선택하며, 같은 패키지에 여러 경로로 요청된 기본/extra 컨텍스트는 합쳐서 평가합니다. Conda 하위 의존성은 버전뿐 아니라 build MatchSpec도 실제 파일 선택까지 유지하고, 같은 버전의 서로 다른 build가 필요하면 각 아티팩트를 모두 보존합니다.
- Maven classifier 형식은 라이브러리마다 다르므로 OS와 아키텍처만으로 자동 생성하지 않습니다. Maven에 `--target-os` 또는 기본값이 아닌 `--arch`를 지정할 때는 실제 네이티브 아티팩트를 선택할 `--classifier`를 함께 지정해야 합니다.
- pip·Conda의 `--no-deps`는 환경 옵션을 생략해도 깊이 0 resolver로 호환되는 루트 아티팩트를 선택·검증하며, 전이 의존성은 다운로드하지 않습니다. 기본값이 아닌 `--arch`를 비롯해 지정한 환경 옵션도 이 파일 선택에 반영됩니다. Maven은 classifier 등 대상 환경을 명시하거나 요청 목록에 `latest`가 있으면 깊이 0으로 루트를 해결합니다. 명시적 버전만 지정한 기본 환경의 Maven과 npm·Docker는 `--no-deps`에서 resolver를 생략합니다.
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

참고: `--file`은 현재 XML `pom.xml`이나 `package.json`을 직접 파싱하지 않고, 줄 단위 텍스트 입력만 처리합니다. Maven은 각 줄에 `groupId:artifactId[:version]` 형식으로 적어야 합니다. pip은 패키지명과 버전 제약을 읽지만 extras, 환경 마커, requirements 옵션을 완전하게 파싱하는 입력기는 아닙니다. 그 외 타입의 `name@version` 파서는 단순 `@` 분리이므로 npm scoped 패키지는 `-p @scope/name -V <version>`으로 지정합니다. 빈 줄과 `#`로 시작하는 주석 줄은 제외합니다. 파일에서 유효한 패키지가 하나도 남지 않으면 입력 오류로 종료하며 archive나 설치 스크립트를 만들지 않습니다.

### 현재 동작

- 실제 파일 다운로드 항목이 하나라도 실패하면 실패 목록을 출력하고 종료 코드 `1`로 끝납니다. 이 경우 이번 실행의 아카이브와 설치 스크립트를 생성하지 않습니다. 성공한 다운로드의 종료 코드는 `0`이며, 다운로드 전 의존성 해결 단계의 기본 건너뛰기 정책과 `--strict`는 위 설명을 따릅니다.
- 다운로드 성공 시 출력 디렉터리에 `packages-<timestamp>.zip` 또는 `.tar.gz`를 만든 뒤, 같은 디렉터리에 설치 스크립트를 생성합니다. 이 호출 순서에서는 별도로 생성한 설치 스크립트가 앞서 만든 아카이브에 포함되지 않습니다.
- 이 명령이 생성하는 Bash·PowerShell 설치 스크립트는 실패한 패키지와 설치 그룹을 누적하고 이후 설치도 계속 시도합니다. 마지막에 실패 목록을 요약하며, 필수 설치가 하나라도 실패하면 종료 코드 `1`을 반환합니다. `모든 설치가 완료되었습니다!`는 실패가 없을 때만 출력합니다. 실행 도구·필수 파일이 없거나 패키지 디렉터리를 읽지 못한 경우도 실패로 처리합니다.
- Conda는 압축을 풀어 생긴 `packages/`와 설치 스크립트를 같은 폴더에 두고 실행합니다. 설치된 Conda를 사용해 전달된 `.conda`·`.tar.bz2` 파일만 `--offline`으로 설치하며, pip 패키지는 별도 pip 분기로 처리합니다. 기본 대상은 스크립트 폴더의 `conda-env`이고 새 환경에 사용자 설정의 기본 패키지를 추가하지 않습니다. 기존 Conda 환경이면 재생성하지 않고 설치 명령을 실행하며, 같은 위치에 일반 파일·디렉터리가 있으면 오류로 종료합니다.
- 기존 Python 환경에 설치하려면 스크립트 실행 전에 `DEPS_SMUGGLER_CONDA_PREFIX`에 해당 Conda 환경 경로를 지정합니다. 상대 경로는 스크립트 폴더를 기준으로 해석합니다. 예를 들어 Bash에서는 `DEPS_SMUGGLER_CONDA_PREFIX=/path/to/env bash install.sh`, PowerShell에서는 `$env:DEPS_SMUGGLER_CONDA_PREFIX = 'C:\path\to\env'; .\install.ps1`로 실행합니다. 설치 후 `conda activate <환경 경로>`로 사용할 수 있습니다.
- Conda 설치 스크립트는 전달된 파일 집합을 그대로 설치하며 의존성·버전·아키텍처 호환성을 다시 해결하지 않습니다. `--no-deps`로 받은 `six` 같은 Python 패키지만으로는 새 환경에 Python 런타임이 생기지 않으므로 호환되는 기존 환경을 지정하거나 필요한 런타임과 의존성도 함께 전달해야 합니다. Conda 부재·파일 누락·설치 실패는 스크립트의 오류 종료로 이어지고 완료 메시지를 출력하지 않습니다.
- Docker는 압축을 풀어 생긴 `packages/`와 설치 스크립트를 같은 폴더에 두고 실행합니다. Bash·PowerShell 모두 실제 이미지 파일명(예: `packages/busybox-1.36.tar`)을 `docker load -i`에 전달합니다. `amd64`·`arm64`와 ZIP·tar.gz 출력에서 같은 이름 규칙을 사용하며, 대상 환경에는 실행 중인 Docker가 필요합니다.
- npm은 압축을 풀어 생긴 `packages/` 폴더와 설치 스크립트를 같은 폴더에 두고 실행합니다. Node.js와 npm이 설치된 환경에서 전달된 `.tgz`를 `npm install --offline`으로 설치하며, 결과는 스크립트 폴더의 `npm-project/node_modules`에 생깁니다. 이 전용 프로젝트에 설치용 `package.json`을 생성하며 상위 폴더의 사용자 manifest는 변경하지 않습니다. Windows에서도 압축을 푼 폴더에 별도의 `package.json`을 만들 필요가 없습니다.
- npm 다운로드가 성공하면 아카이브의 `manifest.json`에는 실제로 받은 버전을 기록합니다. `--no-deps`에서 버전을 생략하거나 `latest`를 지정한 경우도 tarball 내부 `package.json`과 같은 버전을 표시합니다.
- npm 설치 스크립트는 tarball 내부 이름·버전과 전달 경로를 기록합니다. 직접 요청한 패키지만 최상위 의존성으로 등록하고, 선택한 버전과 전이 의존성의 여러 버전을 필요한 하위 경로에 설치합니다. scoped 패키지도 지원합니다. 같은 이름의 서로 다른 버전을 직접 루트로 함께 지정하면 모호한 설치 결과를 만들지 않고 스크립트 생성에 실패합니다. 기존 `npm-project`에 사용자 프로젝트가 있으면 다른 폴더에 압축을 풀어 실행해야 합니다.
- `--no-deps` 출력에 필요한 npm 의존성이 빠져 있으면 오프라인 설치가 실패할 수 있으며, 이 경우 스크립트도 오류로 종료합니다. 설치 대상 환경의 Node.js·OS·아키텍처에 맞는 패키지를 전달해야 하며, npm의 일반 설치 lifecycle은 그대로 실행됩니다.
- Maven 설치 스크립트는 아카이브의 `packages/` canonical 저장소 경로를 GAV별로 `MAVEN_REPO_LOCAL`에 복사합니다. 기본 대상은 `~/.m2/repository`이며, GUI 출력의 `packages/m2repo/`도 지원합니다. 원본 POM·parent/BOM·POM-only·classifier·checksum은 같은 GAV 디렉터리에서 함께 보존되며 Maven 플러그인이나 네트워크 호출은 필요하지 않습니다.
- Maven의 기존 `_remote.repositories` 기록은 보존하고, 이번에 복사한 아티팩트에만 로컬 설치 기록을 추가합니다. 파일 복사나 기록 저장에 실패하면 설치 스크립트도 오류로 종료합니다. PowerShell 스크립트는 Windows PowerShell 5에서도 한글을 읽을 수 있도록 UTF-8 BOM으로 저장합니다.
- `MAVEN_REPO_LOCAL`을 상대 경로로 지정하면 설치 스크립트가 있는 폴더를 기준으로 사용합니다. 사용자 Maven 설정에서 별도의 `localRepository`를 사용하는 경우 이 변수에도 같은 위치를 지정합니다.
- 출력 형식은 `zip` 또는 `tar.gz`만 지원합니다. `--format rar`처럼 지원하지 않는 값을 지정하면 허용 형식을 안내하고 종료 코드 `1`을 반환합니다. 입력 파일 읽기·의존성 해결·다운로드·출력 디렉터리 생성 전에 검사하며, 다른 형식의 압축물이나 설치 스크립트를 만들지 않습니다.
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
- YUM 저장소의 메타데이터 조회·파싱에 실패하거나 활성 저장소에 primary 메타데이터가 없으면 저장소 이름과 원인을 표시하고 종료 코드 `1`을 반환합니다. 일부 저장소만 읽은 결과를 정상 검색 목록으로 반환하지 않습니다. 정상적으로 읽은 목록에서 일치하는 패키지가 없는 경우에는 빈 검색 결과로 종료합니다.
- `-d, --distro`는 필수이고, `-a, --arch` 기본값은 `x86_64`, `-l, --limit` 기본값은 `20`입니다. APT 배포판에는 예시처럼 `amd64` 등 해당 프리셋이 지원하는 아키텍처를 명시해야 합니다.

### `os download`

```bash
depssmuggler os download httpd --distro rocky-9
depssmuggler os download httpd nginx --distro rocky-9 --format both --scripts
depssmuggler os download bash --distro ubuntu-22.04 --arch amd64 --format repository
```

- 배포판 ID와 아키텍처를 기준으로 OS resolver를 실행해 전이 의존성을 함께 계산합니다.
- 버전 충돌로 여러 버전을 다운로드할 때는 함께 받을 각 버전의 전이 의존성도 탐색합니다. 이름·버전·RPM release·아키텍처가 모두 같은 패키지는 한 번만 처리하며, 단일 루트 탐색에서 고유 패키지 10,000개를 처리한 뒤에도 작업이 남으면 부분 결과를 성공으로 반환하지 않고 오류로 종료합니다.
- APK의 `so:`, `cmd:`, `pc:` 의존성도 저장소의 `provides` 항목과 매칭해 제공 패키지를 포함합니다. 버전 조건은 제공 기능의 버전으로 확인하며, 제공자를 찾지 못하거나 조건을 만족하지 못하면 해결되지 않은 의존성과 경고로 남깁니다. `--no-deps`에서는 이 탐색을 생략하고 요청한 패키지만 다운로드합니다.
- 같은 기능이나 `/bin/sh` 같은 경로를 제공하는 서로 다른 APK는 대체 제공자로 취급해 하나를 선택합니다. 대체 제공자가 여러 개라는 이유만으로 버전 충돌을 만들거나 설치 스크립트를 생략하지 않습니다.
- `--format archive|repository|both`에 따라 아카이브, 로컬 저장소, 또는 둘 다 생성합니다.
- APT 저장소 출력은 원본 의존성 연산자·대안과 `Provides`, 충돌 조건, `Multi-Arch`, 설치 크기 등을 보존합니다. 저장소의 파일 경로·크기·SHA256은 실제 전달 파일과 맞춥니다.
- APK 저장소 출력은 원본 체크섬 표기, 의존성 조건, 버전이 있는 provides와 설치 크기를 보존하며, 다운로드 크기는 실제 전달 APK 파일에 맞춥니다. 로컬 파일이나 유효한 체크섬·설치 크기가 없으면 저장소 생성에 실패합니다. 인덱스 생성에 호스트의 `apk` 설치는 필요하지 않습니다.
- `--scripts`를 주면 의존성 순서 설치 스크립트와 로컬 저장소 설정 스크립트를 생성합니다. 버전 충돌이 있으면 자동 설치 스크립트 생성을 생략하고 경고합니다.
- `--archive-format zip|tar.gz`로 압축 형식을 선택하며 기본값은 `zip`입니다. `--no-deps`는 의존성 해결을 끕니다.
- `-d, --distro`는 필수입니다. `--arch` 기본값은 `x86_64`, `-o, --output`은 `./os-packages`, `--concurrency`는 `3`입니다.
- `--concurrency 1.5` 같은 소수 입력은 다운로드 전에 오류로 종료합니다. 동시 다운로드 수의 입력 규칙과 기존 fallback은 일반 `download` 설명을 따릅니다.
- OS 메타데이터 캐시는 `<cachePath>/os-packages` 아래 persistent JSON 파일로 관리됩니다. 기본 경로는 `~/.depssmuggler/cache/os-packages`이며 CLI 설정의 `cachePath`, `cacheEnabled`, `maxCacheSize`를 따릅니다. `cacheEnabled=false`이면 새 메타데이터를 캐시에 저장하지 않습니다. 최대 크기의 CLI 기본값은 10GiB이며, 저장할 때 추정 데이터 크기를 기준으로 LRU 정리를 수행합니다.
- YUM의 메타데이터 로딩 실패는 다운로드에서도 원인을 포함한 오류로 전달됩니다. 같은 resolver에서 재시도할 때 실패 직전의 일부 패키지 목록을 완성된 목록으로 재사용하지 않으며, 정상 저장된 저장소별 디스크 캐시는 재사용할 수 있습니다.

### `os cache`

```bash
depssmuggler os cache stats
depssmuggler os cache clear
```

- `stats`는 OS 메타데이터 캐시 디렉터리, 항목 수, 총 크기를 출력합니다.
- `clear`는 OS 메타데이터 캐시 JSON 파일만 삭제합니다. `--force`가 없으면 확인 프롬프트를 표시합니다.

## `config`

설정 파일은 `~/.depssmuggler/settings.json`을 사용합니다.

읽기에 실패하거나 동시 다운로드 수·캐시 여부·최대 캐시 크기·캐시 경로·로그 레벨의 타입/범위가 잘못된 경우 해당 값은 기존 CLI 기본값을 사용하고 `[config:get]` 로그를 남깁니다. 읽기만으로 손상된 파일을 덮어쓰지 않으며, 명시적인 설정 저장/초기화 실패는 오류로 유지합니다.

```bash
depssmuggler config get
depssmuggler config get concurrentDownloads
depssmuggler config set concurrentDownloads 5
depssmuggler config set cacheEnabled false
depssmuggler config get cacheEnabled
depssmuggler config set maxCacheSize 1048576
depssmuggler config get maxCacheSize
depssmuggler config list
depssmuggler config reset
```

현재 CLI가 직접 다루는 핵심 항목:

- `concurrentDownloads`
- `cacheEnabled`
- `cachePath`
- `maxCacheSize`
- `logLevel`

`cacheEnabled`는 불리언만, `maxCacheSize`는 0보다 큰 유한한 안전 정수(바이트)만 저장할 수 있습니다. 잘못된 값은 파일을 바꾸지 않고 오류로 종료합니다. 최대 크기는 OS 메타데이터 캐시의 추정 데이터 크기 한도이며, JSON 파일의 부가 필드까지 포함한 디스크 사용량이나 다른 라이브러리 캐시 전체의 합계를 제한하는 값은 아닙니다. 한 항목이 한도보다 크면 검색·다운로드는 계속하고 해당 항목의 캐시 저장만 생략합니다. 한도를 낮춘 뒤 다시 실행하면 기존 캐시도 새 한도에 맞게 정리합니다.

설정 파일에는 캐시 여부를 GUI와 같은 `enableCache`로 저장합니다. 기존 파일은 `enableCache`, `cachingEnabled`, `cacheEnabled` 순서로 처음 나온 null/undefined가 아닌 값을 읽고 불리언인지 확인합니다. 캐시 여부를 명시적으로 저장하면 이전 별칭을 제거하며 다른 설정은 보존합니다. CLI 조회 이름은 계속 `cacheEnabled`입니다.

`config set`은 문자열 `true`/`false`와 숫자를 변환하고 나머지는 문자열로 저장합니다. JSON 객체 입력이나 점 표기법으로 중첩 SMTP 설정을 만드는 명령은 아닙니다. 일반 `download`의 동시성 기본값은 명령에 선언된 `3`이므로 `config set concurrentDownloads 5`만으로 기본 다운로드 병렬도가 바뀌지는 않습니다.

## `cache`

일반 캐시 관리 명령입니다.

```bash
depssmuggler cache size
depssmuggler cache clear --force
depssmuggler cache list
```

- `size`: 캐시 디렉터리 용량 출력
- `clear`: 캐시 삭제, `--force` 없으면 확인 프롬프트 표시
- `list`: 캐시 루트의 디렉터리 항목을 표로 출력하고, `manifest.json`이 있으면 메타데이터를 채웁니다. 일반 파일과 심볼릭 링크는 목록과 패키지 개수에서 제외합니다. 디렉터리가 없으면 캐시된 패키지가 없다고 안내합니다.

`cache size/clear/list`는 경로가 일반 파일이거나 접근·삭제 권한이 없는 등 파일 작업에 실패하면 원인을 출력하고 종료 코드 `1`을 반환합니다. 크기 조회가 실패한 경우 `clear`는 삭제를 진행하지 않습니다. 캐시 디렉터리가 없는 경우는 정상 상태로 처리하며 종료 코드 `0`을 유지합니다.

## 현재 한계

- CLI는 GUI보다 지원 범위가 좁습니다.
- OS 패키지 CLI는 `list-distros`, `search`, `download`, `cache`를 독립적으로 수행하며 Electron GUI에 의존하지 않습니다.
- 일반 패키지 `search`는 `pip`, `conda`, `maven`, `npm`, `docker`에 연결되어 있지만, GUI 전용 위자드/시각화 흐름은 CLI에 없습니다.
- CLI에는 SMTP 발송, 전달용 자동 분할, GUI 히스토리 저장 명령이 없습니다. 해당 기능은 Electron 일반 다운로드 전달 파이프라인에서 사용합니다.

## 관련 문서

- [README](../README.md)
- [아키텍처 개요](./architecture-overview.md)
- [IPC 핸들러](./ipc-handlers.md)
