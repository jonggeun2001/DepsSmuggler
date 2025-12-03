# DepsSmuggler (의존성 밀수꾼)

폐쇄망 환경을 위한 패키지 의존성 다운로드 및 전달 애플리케이션

인터넷이 차단된 폐쇄망 환경에서 라이브러리, OS 패키지, 컨테이너 이미지를 **의존성 포함**하여 설치할 수 있도록 패키지를 다운로드하고 전달하는 도구입니다.

---

## 주요 기능

- **의존성 자동 해결**: 전이적 의존성까지 자동으로 탐색 및 다운로드
- **다양한 패키지 지원**: Python(pip/conda), Java(Maven), RHEL/CentOS(yum), Docker 이미지
- **유연한 출력 형식**: ZIP/tar.gz 압축, 오프라인 미러 구조, 설치 스크립트
- **GUI & CLI**: Electron 기반 데스크톱 앱 + 명령줄 도구

---

## 지원 패키지 관리자

| 타입 | 패키지 관리자 | 저장소 |
|------|---------------|--------|
| Python | pip | PyPI |
| Python | conda | Anaconda |
| Java | Maven | Maven Central |
| OS | yum/rpm | CentOS/RHEL |
| Container | docker | Docker Hub |

---

## 설치

```bash
# 의존성 설치
npm install

# 개발 모드 실행 (GUI)
npm run dev

# CLI 글로벌 설치
npm install -g .
```

---

## 사용법

### GUI 앱

```bash
npm run dev
```

1. 패키지 타입 선택 (pip, maven, conda, yum, docker)
2. 패키지 검색 및 선택
3. 버전/아키텍처 선택
4. 장바구니에 추가
5. 다운로드 실행
6. 출력 형식 선택 후 저장

### CLI

```bash
# 패키지 검색
depssmuggler search requests -t pip

# 패키지 다운로드 (의존성 포함)
depssmuggler download -t pip -p requests -V 2.31.0 -o ./output

# Maven 아티팩트 다운로드
depssmuggler download -t maven -p org.springframework:spring-core -V 5.3.0

# Docker 이미지 다운로드
depssmuggler download -t docker -p nginx -V latest

# requirements.txt에서 일괄 다운로드
depssmuggler download -t pip --file requirements.txt

# 미러 구조로 출력
depssmuggler download -t pip -p flask --format mirror
```

#### CLI 명령어

| 명령어 | 설명 |
|--------|------|
| `download` | 패키지 다운로드 (의존성 포함) |
| `search` | 패키지 검색 |
| `config` | 설정 관리 (get/set/list/reset) |
| `cache` | 캐시 관리 (size/clear/list) |

---

## 출력 형식

| 형식 | 설명 | 용도 |
|------|------|------|
| `zip` | 단일 ZIP 압축 파일 | 메일 첨부, USB 전달 |
| `tar.gz` | tar.gz 압축 파일 | Linux 환경 |
| `mirror` | 오프라인 미러 구조 | 로컬 저장소로 바로 사용 |

미러 구조 예시:
```
mirror/
├── pip/simple/           # pip install --find-links
├── maven/repository/     # Maven 로컬 저장소
├── yum/packages/         # yum localinstall
└── docker/               # docker load
```

---

## 프로젝트 구조

```
depssmuggler/
├── electron/           # Electron 메인 프로세스
├── src/
│   ├── renderer/       # React UI
│   ├── core/           # 핵심 로직
│   │   ├── downloaders/  # 패키지별 다운로더
│   │   ├── resolver/     # 의존성 해결
│   │   └── packager/     # 출력물 패키징
│   ├── cli/            # CLI 도구
│   └── types/          # TypeScript 타입
└── docs/               # 문서
```

---

## 개발 명령어

```bash
# 개발 모드 (GUI)
npm run dev

# 빌드
npm run build

# 패키징 (Windows)
npm run package:win

# 패키징 (macOS)
npm run package:mac
```

---

## 문서

자세한 내용은 `docs/` 디렉토리를 참조하세요:

- [아키텍처 개요](docs/architecture-overview.md)
- [Downloaders](docs/downloaders.md)
- [Resolvers](docs/resolvers.md)
- [Packagers](docs/packagers.md)
- [Electron/Renderer](docs/electron-renderer.md)
- [CLI](docs/cli.md)

---

## 기술 스택

| 구분 | 기술 |
|------|------|
| 프레임워크 | Electron |
| 언어 | TypeScript |
| UI | React + Zustand |
| 빌드 | Vite |
| 대상 OS | Windows, macOS |

---

## 라이선스

MIT License
