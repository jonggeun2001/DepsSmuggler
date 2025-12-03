# CLI (Command Line Interface)

## 개요
- 목적: 스크립트 자동화 및 터미널 기반 사용
- 위치: `src/cli/`
- 라이브러리: Commander.js

---

## 설치 및 실행

```bash
# 글로벌 설치
npm install -g depssmuggler

# 또는 로컬에서 실행
npx depssmuggler <명령어>

# 개발 모드
npm run cli -- <명령어>
```

---

## 명령어 구조

```
depssmuggler
├── download    패키지 다운로드
├── search      패키지 검색
├── config      설정 관리
│   ├── get     설정값 조회
│   ├── set     설정값 변경
│   ├── list    모든 설정 표시
│   └── reset   설정 초기화
└── cache       캐시 관리
    ├── size    캐시 크기 확인
    ├── clear   캐시 삭제
    └── list    캐시된 패키지 목록
```

---

## download 명령어

패키지를 의존성과 함께 다운로드

### 사용법
```bash
depssmuggler download [옵션]
```

### 옵션

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--type` | `-t` | 패키지 타입 (pip, conda, maven, yum, docker) | `pip` |
| `--package` | `-p` | 패키지명 | - |
| `--pkg-version` | `-V` | 패키지 버전 | `latest` |
| `--arch` | `-a` | 아키텍처 (x86_64, arm64 등) | `x86_64` |
| `--output` | `-o` | 출력 경로 | `./output` |
| `--format` | `-f` | 출력 형식 (zip, tar.gz, mirror) | `zip` |
| `--file` | - | 패키지 목록 파일 | - |
| `--no-deps` | - | 의존성 포함하지 않음 | `false` |
| `--concurrency` | - | 동시 다운로드 수 | `3` |

### 예시

```bash
# Python 패키지 다운로드
depssmuggler download -t pip -p requests -V 2.31.0

# Maven 아티팩트 다운로드
depssmuggler download -t maven -p org.springframework:spring-core -V 5.3.0

# Docker 이미지 다운로드
depssmuggler download -t docker -p nginx -V latest -a amd64

# requirements.txt에서 다운로드
depssmuggler download -t pip --file requirements.txt -o ./packages

# tar.gz로 출력
depssmuggler download -t pip -p flask -f tar.gz

# 미러 구조로 출력
depssmuggler download -t pip -p numpy --format mirror

# 의존성 없이 단일 패키지만
depssmuggler download -t pip -p requests --no-deps
```

### 구현 (`commands/download.ts`)

```typescript
interface DownloadOptions {
  type: string;
  package?: string;
  pkgVersion: string;
  arch: string;
  output: string;
  format: string;
  file?: string;
  deps: boolean;
  concurrency: string;
}

async function downloadCommand(options: DownloadOptions): Promise<void>;
```

#### 헬퍼 함수

| 함수 | 설명 |
|------|------|
| `parsePackageFile` | requirements.txt, pom.xml 등 파일 파싱 |
| `formatBytes` | 바이트를 읽기 쉬운 형식으로 변환 |
| `formatSpeed` | 다운로드 속도 포맷팅 |
| `formatDuration` | 소요 시간 포맷팅 |

---

## search 명령어

패키지 저장소에서 검색

### 사용법
```bash
depssmuggler search <검색어> [옵션]
```

### 옵션

| 옵션 | 단축 | 설명 | 기본값 |
|------|------|------|--------|
| `--type` | `-t` | 패키지 타입 | `pip` |
| `--limit` | `-l` | 결과 수 제한 | `20` |

### 예시

```bash
# PyPI에서 검색
depssmuggler search requests -t pip

# Maven Central에서 검색
depssmuggler search spring -t maven -l 10

# Docker Hub에서 검색
depssmuggler search nginx -t docker
```

### 구현 (`commands/search.ts`)

```typescript
interface SearchOptions {
  type: string;
  limit: string;
}

async function searchCommand(query: string, options: SearchOptions): Promise<void>;
```

---

## config 명령어

앱 설정 관리

### 서브 명령어

#### config get
설정값 조회

```bash
# 특정 키 조회
depssmuggler config get concurrentDownloads

# 모든 설정 조회 (키 없이)
depssmuggler config get
```

#### config set
설정값 변경

```bash
depssmuggler config set concurrentDownloads 5
depssmuggler config set cacheEnabled true
depssmuggler config set downloadDir /path/to/downloads
```

#### config list
모든 설정 표시

```bash
depssmuggler config list
```

#### config reset
설정 초기화

```bash
depssmuggler config reset
```

### 구현 (`commands/config.ts`)

```typescript
async function configGet(key?: string): Promise<void>;
async function configSet(key: string, value: string): Promise<void>;
async function configList(): Promise<void>;
async function configReset(): Promise<void>;
```

---

## cache 명령어

다운로드 캐시 관리

### 서브 명령어

#### cache size
캐시 크기 확인

```bash
depssmuggler cache size
# 출력: 캐시 크기: 1.5 GB
```

#### cache clear
캐시 삭제

```bash
# 확인 프롬프트와 함께
depssmuggler cache clear

# 확인 없이 삭제
depssmuggler cache clear --force
```

#### cache list
캐시된 패키지 목록

```bash
depssmuggler cache list
# 출력:
# pip/requests/2.31.0 - 150 KB
# maven/spring-core/5.3.0 - 1.2 MB
# ...
```

### 구현 (`commands/cache.ts`)

```typescript
async function cacheSize(): Promise<void>;
async function cacheClear(options: { force?: boolean }): Promise<void>;
async function cacheList(): Promise<void>;

// 헬퍼
async function getDirectorySize(dir: string): Promise<number>;
function formatBytes(bytes: number): string;
async function askConfirmation(message: string): Promise<boolean>;
```

---

## 출력 예시

### 다운로드 진행 중
```
DepsSmuggler - 패키지 다운로드

패키지 타입: pip
패키지: requests v2.31.0

의존성 해결 중...
✔ requests@2.31.0
  ├─ urllib3@2.0.7
  ├─ certifi@2023.11.17
  ├─ charset-normalizer@3.3.2
  └─ idna@3.6

다운로드 중...
[████████████████░░░░] 80% | 4/5 패키지 | 1.2 MB/s | 남은 시간: 5초

패키징 중...
✔ zip 파일 생성 완료: ./output/requests-2.31.0.zip

완료!
- 총 패키지: 5개
- 총 크기: 2.3 MB
- 소요 시간: 15초
```

### 검색 결과
```
DepsSmuggler - 패키지 검색

검색어: flask
타입: pip
결과: 20개

┌──────────────────┬──────────┬────────────────────────────────────┐
│ 패키지명         │ 버전     │ 설명                               │
├──────────────────┼──────────┼────────────────────────────────────┤
│ flask            │ 3.0.0    │ A simple framework for building... │
│ flask-restful    │ 0.3.10   │ Simple framework for creating RE...│
│ flask-sqlalchemy │ 3.1.1    │ SQLAlchemy support for Flask       │
│ ...              │          │                                    │
└──────────────────┴──────────┴────────────────────────────────────┘
```

---

## 종료 코드

| 코드 | 의미 |
|------|------|
| 0 | 성공 |
| 1 | 일반 오류 |
| 2 | 잘못된 명령어/옵션 |

---

## 환경 변수

| 변수 | 설명 |
|------|------|
| `DEPSSMUGGLER_CONFIG_DIR` | 설정 파일 디렉토리 |
| `DEPSSMUGGLER_CACHE_DIR` | 캐시 디렉토리 |
| `DEPSSMUGGLER_LOG_LEVEL` | 로그 레벨 (debug, info, warn, error) |

---

## 관련 문서
- [아키텍처 개요](./architecture-overview.md)
- [Downloaders 문서](./downloaders.md)
- [Resolvers 문서](./resolvers.md)
