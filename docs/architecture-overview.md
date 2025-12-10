# DepsSmuggler 아키텍처 개요

## 개요
- 목적: 폐쇄망 환경을 위한 패키지 의존성 다운로드 및 전달 애플리케이션
- 프레임워크: Electron + TypeScript
- 대상 OS: Windows, macOS

---

## 프로젝트 구조

```
depssmuggler/
├── electron/               # Electron 메인 프로세스
│   ├── main.ts            # 메인 프로세스 진입점
│   └── preload.ts         # 프리로드 스크립트 (IPC 브릿지)
├── src/
│   ├── renderer/          # React 기반 UI (렌더러 프로세스)
│   │   ├── App.tsx        # 메인 앱 컴포넌트
│   │   ├── pages/         # 페이지 컴포넌트
│   │   ├── components/    # 재사용 컴포넌트
│   │   ├── layouts/       # 레이아웃 컴포넌트
│   │   └── stores/        # Zustand 상태 관리
│   ├── core/              # 핵심 비즈니스 로직
│   │   ├── index.ts       # Core 모듈 통합 내보내기
│   │   ├── shared/        # 공통 유틸리티 모듈
│   │   │   ├── types.ts           # 공통 타입 정의
│   │   │   ├── dependency-resolver.ts # 의존성 해결
│   │   │   ├── pypi-utils.ts      # PyPI 유틸리티
│   │   │   ├── file-utils.ts      # 파일 다운로드/압축
│   │   │   └── script-utils.ts    # 스크립트 생성
│   │   ├── downloaders/   # 패키지 관리자별 다운로더
│   │   │   └── os/        # OS 패키지 다운로더 (yum, apt, apk)
│   │   ├── resolver/      # 의존성 해결기
│   │   ├── packager/      # 출력물 패키징
│   │   ├── mailer/        # 메일 발송
│   │   ├── config.ts      # 설정 관리
│   │   ├── cacheManager.ts    # 캐시 관리
│   │   └── downloadManager.ts # 다운로드 관리
│   ├── cli/               # CLI 인터페이스
│   │   ├── index.ts       # CLI 진입점
│   │   └── commands/      # CLI 명령어
│   ├── types/             # TypeScript 타입 정의
│   └── utils/             # 유틸리티 함수
└── scripts/               # 설치 스크립트 템플릿
```

---

## 계층 구조

```
┌─────────────────────────────────────────────────────────┐
│                    UI Layer (Renderer)                   │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────────┐│
│  │HomePage │ │WizardPage│ │CartPage│ │DownloadPage    ││
│  └─────────┘ └─────────┘ └─────────┘ └─────────────────┘│
│                         ↓                                │
│  ┌──────────────────────────────────────────────────────┐│
│  │              Zustand Stores                          ││
│  │  (cartStore, downloadStore, settingsStore)           ││
│  └──────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
                          ↓ IPC
┌─────────────────────────────────────────────────────────┐
│                 Electron Main Process                    │
│  ┌──────────────────────────────────────────────────────┐│
│  │                    IPC Handlers                      ││
│  │  (search:packages, search:suggest, save-file, etc.) ││
│  └──────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                    Core Layer                            │
│  ┌────────────┐  ┌──────────┐  ┌──────────────────────┐ │
│  │Downloaders │  │Resolvers │  │    DownloadManager   │ │
│  │ (pip,maven │  │(pip,maven│  │  (큐 관리, 동시성)   │ │
│  │  conda,yum,│  │ conda,yum│  └──────────────────────┘ │
│  │  docker)   │  │  )       │                           │
│  └────────────┘  └──────────┘                           │
│                          ↓                               │
│  ┌──────────────────────────────────────────────────────┐│
│  │                   CacheManager                       ││
│  │            (캐시 저장/조회, LRU 정리)                ││
│  └──────────────────────────────────────────────────────┘│
│                          ↓                               │
│  ┌────────────────────────────────────────────────────┐  │
│  │                    Packagers                        │ │
│  │  ┌────────────────┐ ┌────────────────────────────┐ │ │
│  │  │ArchivePackager │ │ ScriptGenerator            │ │ │
│  │  └────────────────┘ └────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                   External APIs                          │
│  PyPI, Maven Central, Anaconda, Docker Hub, YUM Repos   │
└─────────────────────────────────────────────────────────┘
```

---

## 핵심 모듈

### 1. Downloaders (`src/core/downloaders/`)
패키지 관리자별 다운로드 구현체

| 모듈 | 설명 | 위치 |
|------|------|------|
| PipDownloader | PyPI 패키지 다운로드 | `pip.ts` |
| MavenDownloader | Maven Central 아티팩트 다운로드 | `maven.ts` |
| CondaDownloader | Anaconda 패키지 다운로드 | `conda.ts` |
| YumDownloader | YUM/RPM 패키지 다운로드 | `yum.ts` |
| DockerDownloader | Docker 이미지 다운로드 | `docker.ts` |
| NpmDownloader | npm 패키지 다운로드 | `npm.ts` |

### 1-1. OS 패키지 다운로더 (`src/core/downloaders/os/`)

Linux OS 패키지 다운로드 통합 모듈 (상세: [OS 패키지 다운로더 문서](./os-package-downloader.md))

| 모듈 | 설명 | 위치 |
|------|------|------|
| OSPackageDownloader | 통합 다운로더 | `downloader.ts` |
| BaseOSDownloader | 기본 다운로더 추상 클래스 | `base-downloader.ts` |
| BaseOSDependencyResolver | 기본 의존성 해결기 추상 클래스 | `base-resolver.ts` |
| YumDownloader | YUM/RPM 다운로더 | `yum/downloader.ts` |
| AptDownloader | APT/DEB 다운로더 | `apt/downloader.ts` |
| ApkDownloader | APK 다운로더 | `apk/downloader.ts` |
| OSCacheManager | OS 패키지 캐시 관리 | `utils/cache-manager.ts` |
| GPGVerifier | GPG 서명 검증 | `utils/gpg-verifier.ts` |
| OSScriptGenerator | 설치 스크립트 생성 | `utils/script-generator.ts` |

### 2. Resolvers (`src/core/resolver/`)
의존성 트리 해결

| 모듈 | 설명 | 위치 |
|------|------|------|
| PipResolver | Python 의존성 해결 | `pipResolver.ts` |
| MavenResolver | Maven 의존성 해결 | `mavenResolver.ts` |
| CondaResolver | Conda 의존성 해결 | `condaResolver.ts` |
| YumResolver | YUM 의존성 해결 | `yumResolver.ts` |

### 3. Packagers (`src/core/packager/`)
출력물 패키징

| 모듈 | 설명 | 위치 |
|------|------|------|
| ArchivePackager | zip/tar.gz 압축 | `archivePackager.ts` |
| ScriptGenerator | 설치 스크립트 생성 | `scriptGenerator.ts` |
| FileSplitter | 대용량 파일 분할 | `fileSplitter.ts` |

### 4. Core Services

| 모듈 | 설명 | 위치 |
|------|------|------|
| DownloadManager | 다운로드 큐 및 동시성 관리 | `downloadManager.ts` |
| CacheManager | 다운로드 캐시 관리 | `cacheManager.ts` |
| ConfigManager | 앱 설정 관리 | `config.ts` |
| EmailSender | SMTP 메일 발송 | `mailer/emailSender.ts` |

---

## 데이터 흐름

### 패키지 검색 및 다운로드

```
1. 사용자 입력 (UI)
       ↓
2. IPC 요청 (search:packages)
       ↓
3. Downloader.searchPackages()
       ↓
4. 패키지 선택 → 장바구니 추가
       ↓
5. Resolver.resolveDependencies()
       ↓
6. DownloadManager.startDownload()
       ↓
7. CacheManager (캐시 확인)
       ↓
8. Downloader.downloadPackage()
       ↓
9. Packager (압축/미러/스크립트)
       ↓
10. 파일 저장 또는 메일 발송
```

---

## 싱글톤 패턴

모든 핵심 서비스는 싱글톤 패턴으로 구현:

```typescript
// 예: PipDownloader
let pipDownloaderInstance: PipDownloader | null = null;

export function getPipDownloader(): PipDownloader {
  if (!pipDownloaderInstance) {
    pipDownloaderInstance = new PipDownloader();
  }
  return pipDownloaderInstance;
}
```

---

## 테스트

### 테스트 설정 (`vitest.config.ts`)

Vitest 기반 단위 테스트 환경

| 설정 | 값 | 설명 |
|------|-----|------|
| environment | node | Node.js 환경 |
| include | `src/**/*.test.ts` | 테스트 파일 패턴 |
| testTimeout | 30000 | 테스트 타임아웃 (30초) |
| coverage.provider | v8 | 커버리지 측정 |
| coverage.include | `src/core/**/*.ts` | 커버리지 대상 |

### 테스트 파일

| 모듈 | 테스트 파일 | 설명 |
|------|-------------|------|
| CacheManager | `cacheManager.test.ts` | 캐시 관리자 테스트 |
| PipDownloader | `pip.test.ts` | PyPI 다운로더 테스트 |
| CondaDownloader | `conda.test.ts` | Conda 다운로더 테스트 |
| MavenDownloader | `maven.test.ts` | Maven 다운로더 테스트 |
| NpmDownloader | `npm.test.ts` | npm 다운로더 테스트 |
| DockerDownloader | `docker.test.ts` | Docker 다운로더 테스트 |
| YumDownloader | `yum.test.ts` | YUM 다운로더 테스트 |
| OS Package | `os/os-package.test.ts` | OS 패키지 통합 테스트 |
| Packager | `packager/packager.test.ts` | 패키저 테스트 |
| search-utils | `shared/search-utils.test.ts` | 검색 유틸 테스트 |
| version-utils | `shared/version-utils.test.ts` | 버전 유틸 테스트 |
| conda-matchspec | `shared/conda-matchspec.test.ts` | MatchSpec 파서 테스트 |

### 테스트 실행

```bash
# 전체 테스트 실행
npm run test

# 커버리지 포함 테스트
npm run test:coverage

# 특정 파일 테스트
npx vitest run src/core/downloaders/pip.test.ts
```

---

## 관련 문서
- [Downloaders 문서](./downloaders.md)
- [Resolver 문서](./resolvers.md)
- [Packagers 문서](./packagers.md)
- [Shared Utilities 문서](./shared-utilities.md)
- [Electron & Renderer 문서](./electron-renderer.md)
- [CLI 문서](./cli.md)
- [OS 패키지 다운로더 문서](./os-package-downloader.md)
- [OS 패키지 설계 문서](./os-package-downloader-design.md)
