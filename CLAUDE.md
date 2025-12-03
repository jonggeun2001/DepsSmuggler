# DepsSmuggler (의존성 밀수꾼)

폐쇄망 환경을 위한 패키지 의존성 다운로드 및 전달 애플리케이션

## 프로젝트 개요

### 목적
인터넷이 차단된 폐쇄망 환경에서 라이브러리, OS 패키지, 컨테이너 이미지를 의존성 포함하여 설치할 수 있도록 패키지를 다운로드하고 전달하는 도구

### 주요 사용자
- 개발자
- 시스템 관리자/인프라 담당자
- 일반 사용자 (기술 지식 적음)

### 핵심 가치
- 의존성 자동 해결 및 다운로드
- 직관적이고 쉬운 UI
- 다양한 출력 형태 지원

---

## 기술 스택

| 구분 | 기술 |
|------|------|
| 프레임워크 | Electron |
| 언어 | TypeScript (Node.js) |
| 대상 OS | Windows, macOS |
| 라이선스 | MIT |
| 배포 | GitHub Releases + npm |

---

## 지원 패키지 관리자

### 라이브러리 (MVP 우선순위 표시)
| 패키지 관리자 | 언어 | MVP | 비고 |
|--------------|------|-----|------|
| pip + conda | Python | ✅ | PyPI, Anaconda |
| Maven | Java | ✅ | 플러그인 포함 |
| Gradle | Java | | 플러그인 포함 |
| npm | Node.js | | npm Registry |

### OS 패키지 (MVP 우선순위 표시)
| 패키지 관리자 | OS | MVP | 비고 |
|--------------|-----|-----|------|
| apt/deb | Ubuntu/Debian | | |
| yum/rpm | RHEL/CentOS | ✅ | |
| apk | Alpine | | |

### 컨테이너 이미지 (MVP)
| 레지스트리 | 비고 |
|-----------|------|
| Docker Hub | ✅ MVP |
| ghcr.io | GitHub Container Registry |
| ECR Public | AWS |
| Quay.io | Red Hat |
| 커스텀 | 사용자 입력 가능 |

---

## 핵심 기능

### 1. 패키지 검색 및 선택
- **순차 검색 UI**: 언어/OS → 버전 → 패키지명 → 패키지 버전 → 아키텍처
- **API 직접 호출**: PyPI, Maven Central, npm Registry 등
- **아키텍처 선택**: x86_64, ARM64, i386 등 사용자 선택 가능

### 2. 다중 패키지 선택
- **장바구니 방식**: 여러 패키지를 담고 한 번에 다운로드
- **텍스트 입력**: requirements.txt, pom.xml 등 파일 붙여넣기/업로드

### 3. 의존성 해결
- 전이적 의존성 자동 탐색 및 다운로드
- 의존성 충돌 시 모든 버전 다운로드
- **의존성 트리 시각화**: 그래프로 표시

### 4. 다운로드 옵션
- **동시 다운로드 수**: 사용자 설정 가능
- **캐싱**: 사용자 선택 (설정에서 관리)
- **체크섬 검증**: 다운로드 파일 무결성 확인

### 5. 출력물 형태
| 형태 | 설명 |
|------|------|
| 단일 압축 파일 | zip/tar.gz, 메일 첨부에 적합 |
| 오프라인 미러 구조 | 로컬 저장소로 바로 사용 가능 |
| 설치 스크립트 포함 | Bash + PowerShell 스크립트 생성 |

### 6. 전달 방식
- **파일 저장**: 로컬에 저장 (USB, 수동 전달)
- **메일 발송**: SMTP 설정하여 직접 발송
- 사용자 선택 가능

### 7. 파일 크기 관리
- **경고 표시**: 설정 크기 초과 시 "메일 첨부 불가" 경고
- **자동 분할**: 큰 파일 여러 개로 분할
- 분할 기준 크기: 사용자 설정 가능

---

## CLI 지원

GUI 외에 CLI도 지원하여 스크립트 자동화 가능

```bash
# 예시 명령어 구조
depssmuggler download --type pip --package requests --version 2.28.0
depssmuggler download --type maven --artifact org.springframework:spring-core:5.3.0
depssmuggler download --type docker --image nginx:latest --arch amd64
```

---

## 설정 및 저장

### 설정 파일 위치
```
~/.depssmuggler/
├── config.json      # 앱 설정 (SMTP, 동시 다운로드 수, 캐시 설정 등)
├── logs/            # 오류 로그 파일
└── cache/           # 패키지 캐시 (선택적)
```

### 주요 설정 항목
- SMTP 서버 정보 (메일 발송용)
- 동시 다운로드 수
- 캐시 사용 여부
- 파일 분할 기준 크기

---

## 에러 처리

### 네트워크 오류 시
사용자에게 선택 요청:
- 재시도
- 건너뛰기
- 취소

### 로깅
- 오류 로그 저장: `~/.depssmuggler/logs/`

---

## UI/UX

### 언어
- 한국어만 지원

### 사용자 경험
- 일반 사용자도 쉽게 사용 가능한 직관적 UI
- 순차적 선택 방식 (위자드 형태)
- 장바구니 + 텍스트 입력 병행

---

## MVP 우선순위

### Phase 1: 핵심 기능
1. Python (pip + conda) 지원
2. Java (Maven + 플러그인) 지원
3. RHEL/CentOS (yum) 지원
4. 컨테이너 이미지 (Docker Hub) 지원
5. 기본 GUI (Electron)
6. CLI 기본 명령어

### Phase 2: 확장 기능
1. Java (Gradle + 플러그인)
2. Node.js (npm)
3. Ubuntu/Debian (apt)
4. Alpine (apk)
5. 추가 컨테이너 레지스트리

### Phase 3: 부가 기능
1. 의존성 트리 시각화
2. 메일 발송 기능
3. 파일 자동 분할

---

## 참고 오픈소스

의존성 해결 시스템 참고:
- **pip**: https://github.com/pypa/pip
- **conda**: https://github.com/conda/conda
- **Maven**: https://github.com/apache/maven
- **Gradle**: https://github.com/gradle/gradle
- **npm**: https://github.com/npm/cli
- **yum/dnf**: https://github.com/rpm-software-management/dnf
- **apt**: https://salsa.debian.org/apt-team/apt
- **apk-tools**: https://gitlab.alpinelinux.org/alpine/apk-tools

---

## 프로젝트 구조 (예상)

```
depssmuggler/
├── package.json
├── tsconfig.json
├── electron/
│   ├── main.ts           # Electron 메인 프로세스
│   └── preload.ts
├── src/
│   ├── renderer/         # React/Vue 등 UI
│   ├── cli/              # CLI 진입점
│   ├── core/             # 핵심 로직
│   │   ├── downloaders/  # 패키지 관리자별 다운로더
│   │   │   ├── pip.ts
│   │   │   ├── conda.ts
│   │   │   ├── maven.ts
│   │   │   ├── gradle.ts
│   │   │   ├── npm.ts
│   │   │   ├── yum.ts
│   │   │   ├── apt.ts
│   │   │   ├── apk.ts
│   │   │   └── docker.ts
│   │   ├── resolver/     # 의존성 해결
│   │   ├── packager/     # 출력물 패키징
│   │   └── mailer/       # 메일 발송
│   └── utils/
├── scripts/              # 설치 스크립트 템플릿
│   ├── install.sh
│   └── install.ps1
└── docs/                 # 문서 (별도 제공)
```

---

## 제약사항

- 프록시 지원: 불필요
- 프라이빗 저장소 인증: 미지원 (공개 저장소만)
- 앱 자동 업데이트: 미지원
- 다운로드 이력 관리: 미지원
- 테스트: 수동 테스트만
- 오프라인 도움말: 미포함 (별도 문서)

---

## 개발 명령어

```bash
# 의존성 설치
npm install

# 개발 모드 실행
npm run dev

# 빌드
npm run build

# 패키징 (Windows)
npm run package:win

# 패키징 (macOS)
npm run package:mac

# CLI 글로벌 설치
npm install -g .
```
