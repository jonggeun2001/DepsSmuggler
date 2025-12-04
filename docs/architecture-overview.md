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
│  │  ┌────────────┐ ┌────────────┐ ┌────────────────┐  │ │
│  │  │Archive     │ │Mirror      │ │Script          │  │ │
│  │  │Packager    │ │Packager    │ │Generator       │  │ │
│  │  └────────────┘ └────────────┘ └────────────────┘  │ │
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
| MirrorPackager | 오프라인 미러 구조 생성 | `mirrorPackager.ts` |
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

## 관련 문서
- [Downloaders 문서](./downloaders.md)
- [Resolver 문서](./resolvers.md)
- [Packagers 문서](./packagers.md)
- [Shared Utilities 문서](./shared-utilities.md)
- [Electron & Renderer 문서](./electron-renderer.md)
- [CLI 문서](./cli.md)
