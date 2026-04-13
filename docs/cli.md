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
| `--no-deps` | 의존성 해결 비활성화 | `false` |
| `--concurrency <num>` | 동시 다운로드 수 | `3` |

기본 동작은 라이브러리 패키지(`pip`, `conda`, `maven`, `npm`)에 대해 의존성을 함께 해결해 다운로드하는 것입니다. `--no-deps`를 지정하면 원본 패키지 목록만 다운로드합니다. 라이브러리 패키지의 의존성 해결이 실패하면 명령은 오류로 종료됩니다. OS 패키지 의존성 다운로드는 `depssmuggler os download` 경로를 사용합니다.

### 예시

```bash
depssmuggler download -t pip -p requests -V 2.31.0
depssmuggler download -t maven -p org.springframework:spring-core -V 5.3.0
depssmuggler download -t npm -p react -V 19.2.0
depssmuggler download -t docker -p nginx -V latest
depssmuggler download -t pip --file requirements.txt -o ./packages
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
- 배포판별 parser(`YumMetadataParser`, `AptMetadataParser`, `ApkMetadataParser`)를 사용합니다.

### `os download`

```bash
depssmuggler os download httpd --distro rocky-9
```

현재 구현은 실제 다운로드를 수행하지 않고, 재구현 중이라는 안내와 함께 Electron GUI 사용을 권장합니다.

### `os cache`

```bash
depssmuggler os cache stats
depssmuggler os cache clear
```

현재 구현은 실제 캐시 조작 대신 GUI 사용을 안내합니다.

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
- OS 패키지 CLI는 조회 중심이며 다운로드/캐시는 GUI 흐름이 기준입니다.
- `cache list`는 현재 캐시 루트가 디렉터리 위주라는 가정을 두고 있어, `cache-manifest.json` 같은 일반 파일이 섞인 경우 실패할 수 있습니다.

## 관련 문서

- [README](../README.md)
- [아키텍처 개요](./architecture-overview.md)
- [IPC 핸들러](./ipc-handlers.md)
