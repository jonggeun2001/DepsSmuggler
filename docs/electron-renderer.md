# Electron & Renderer

## 개요
- 목적: 데스크톱 앱 UI 및 시스템 통합
- 프레임워크: Electron + React + Zustand

---

## Electron 메인 프로세스

### 개요
- 위치: `electron/main.ts`
- 역할: 윈도우 생성, IPC 핸들링, 시스템 API 접근

### 앱 아이콘

플랫폼별 아이콘 설정:

```
assets/icons/
├── icon.svg          # 소스 SVG
├── icon.png          # 512x512 PNG (기본)
├── icon.icns         # macOS용
├── icon-16.png       # 다양한 크기
├── icon-32.png
├── icon-48.png
├── icon-64.png
├── icon-128.png
├── icon-256.png
├── icon-512.png
└── icon-1024.png
```

#### 아이콘 생성 스크립트

`scripts/generate-icons.mjs` - SVG에서 다양한 크기의 PNG 및 플랫폼별 아이콘 생성

```bash
node scripts/generate-icons.mjs
```

- sharp 라이브러리로 PNG 생성
- macOS: iconutil로 .icns 생성
- Windows: electron-builder가 PNG에서 자동 변환

### 로깅 시스템 (`electron/utils/logger.ts`)

electron-log 기반 파일 로깅 시스템

#### 로그 파일 위치
- **개발 환경**: `프로젝트루트/logs/depssmuggler-YYYY-MM-DD.log`
- **프로덕션**: `앱실행경로/logs/depssmuggler-YYYY-MM-DD.log`

#### 설정
- **파일 로그 레벨**: debug
- **콘솔 로그 레벨**: debug (개발), warn (프로덕션)
- **최대 파일 크기**: 10MB
- **로그 보관 기간**: 7일 (자동 정리)

#### 사용 방법

```typescript
import { logInfo, logDebug, logWarn, logError, createScopedLogger } from './utils/logger';

// 기본 로깅
logInfo('다운로드 시작');
logDebug('패키지 정보:', packageInfo);
logWarn('캐시 만료');
logError('다운로드 실패:', error);

// 모듈별 스코프 로거
const logger = createScopedLogger('MavenDownloader');
logger.info('Maven 검색 시작');  // [MavenDownloader] Maven 검색 시작
```

#### 로그 형식
```
[2025-01-15 10:30:45.123] [info] 다운로드 시작
[2025-01-15 10:30:46.456] [debug] [MavenDownloader] 검색 쿼리: spring-core
```

### 주요 구성요소

| 구성요소 | 설명 |
|----------|------|
| `createWindow` | BrowserWindow 생성 및 설정 |
| `mainWindow` | 메인 윈도우 참조 |
| `isDev` | 개발 모드 여부 |
| `VITE_DEV_SERVER_URL` | Vite 개발 서버 URL |
| `waitForViteServer` | Vite 서버 준비 대기 함수 |

### Vite 서버 대기 로직

개발 모드에서 Electron이 Vite 개발 서버보다 먼저 시작될 경우를 처리:

```typescript
async function waitForViteServer(
  url: string,
  maxRetries = 30,
  retryDelay = 500
): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await axios.get(url, { timeout: 1000 });
      if (response.status === 200) {
        return true;
      }
    } catch {
      // 재시도
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelay));
  }
  return false;
}
```

- 최대 30회 재시도 (500ms 간격, 총 15초)
- 서버 준비 전 로드 시 발생하는 오류 방지

### IPC 핸들러

| 채널 | 설명 |
|------|------|
| `get-app-version` | 앱 버전 조회 |
| `get-app-path` | 앱 경로 조회 |
| `select-folder` | 폴더 선택 다이얼로그 |
| `select-directory` | 디렉토리 선택 다이얼로그 (설정용) |
| `save-file` | 파일 저장 다이얼로그 |
| `open-folder` | 폴더 열기 (Finder/Explorer) |
| `search:packages` | 패키지 검색 (PyPI, Maven 실제 API 연동) |
| `search:suggest` | 자동완성 제안 |
| `search:versions` | 패키지 버전 목록 조회 |
| `dependency:resolve` | 의존성 해결 |
| `download:start` | 다운로드 시작 |
| `download:pause` | 다운로드 일시정지 |
| `download:resume` | 다운로드 재개 |
| `download:cancel` | 다운로드 취소 |

### 히스토리 IPC 핸들러

다운로드 히스토리 관리를 위한 IPC 핸들러

| 채널 | 파라미터 | 반환값 | 설명 |
|------|----------|--------|------|
| `history:load` | - | DownloadHistory[] | 파일에서 히스토리 로드 |
| `history:save` | histories: unknown[] | { success: boolean } | 전체 히스토리 저장 |
| `history:add` | history: unknown | { success: boolean } | 히스토리 항목 추가 |
| `history:delete` | id: string | { success: boolean } | 특정 히스토리 삭제 |
| `history:clear` | - | { success: boolean } | 전체 히스토리 삭제 |

히스토리 파일 위치: `~/.depssmuggler/history.json`

### OS 패키지 IPC 핸들러

OS 패키지 관련 핸들러는 `electron/os-package-handlers.ts`에서 별도 관리됩니다.

| 채널 | 파라미터 | 반환값 | 설명 |
|------|----------|--------|------|
| `os:getDistributions` | osType: OSPackageManager | OSDistribution[] | 배포판 목록 |
| `os:getAllDistributions` | - | OSDistribution[] | 전체 배포판 |
| `os:getDistribution` | distributionId: string | OSDistribution \| undefined | 특정 배포판 |
| `os:search` | options: OSSearchOptions | OSPackageSearchResult | 패키지 검색 |
| `os:resolveDependencies` | options | DependencyResolutionResult | 의존성 해결 |
| `os:download:start` | options: OSDownloadOptions | OSPackageDownloadResult | 다운로드 시작 |
| `os:cache:stats` | - | CacheStats | 캐시 통계 |
| `os:cache:clear` | - | { success: boolean } | 캐시 초기화 |

#### 이벤트 채널

| 이벤트 | 데이터 | 설명 |
|--------|--------|------|
| `os:resolveDependencies:progress` | { message, current, total } | 의존성 해결 진행 |
| `os:download:progress` | OSDownloadProgress | 다운로드 진행 |

#### 에러 처리

다운로드 오류 발생 시 다이얼로그 표시:
- **재시도**: 해당 패키지 재다운로드
- **건너뛰기**: 해당 패키지 스킵
- **취소**: 전체 다운로드 취소

### 다운로더 타입 매핑

```typescript
const downloaderMap = {
  pip: getPipDownloader,
  conda: getCondaDownloader,
  maven: getMavenDownloader,
  docker: getDockerDownloader,
  yum: getYumDownloader,
};
```

### PyPI 패키지 캐시

앱 시작 시 PyPI Simple API에서 전체 패키지 목록을 백그라운드로 로드하여 검색 성능 향상

### 검색 결과 관련성 정렬

패키지 검색 시 `sortByRelevance` 함수를 사용하여 쿼리와의 관련성에 따라 결과를 정렬:

```typescript
// search:packages 핸들러 내부
case 'pip':
  results = await searchPyPI(query);
  results = sortByRelevance(results, query, 'pip');
  break;
case 'conda':
  results = await searchConda(query);
  results = sortByRelevance(results, query, 'conda');
  break;
case 'maven':
  results = await searchMaven(query);
  results = sortByRelevance(results, query, 'maven');
  break;
```

- 정확 일치 > 접두사 일치 > 포함 일치 > 유사도 순으로 정렬
- 패키지 타입별 핵심명 추출 (Maven: artifactId, npm: scoped name)

### Maven 버전 조회 개선

Maven 버전 목록 조회 시 하이브리드 접근 방식 사용:

1. **1차: maven-metadata.xml** - 정확한 버전 목록 및 순서 제공
2. **2차: Search API 폴백** - metadata.xml 조회 실패 시 사용

```typescript
async function getMavenVersions(packageName: string): Promise<string[]> {
  try {
    // maven-metadata.xml에서 정확한 버전 목록 조회
    return await getMavenVersionsFromMetadata(groupId, artifactId);
  } catch {
    // Search API 폴백
    return await getMavenVersionsFromSearchApi(groupId, artifactId);
  }
}
```

---

## Preload 스크립트

### 개요
- 위치: `electron/preload.ts`
- 역할: 렌더러-메인 간 안전한 통신 브릿지

### 노출된 API (window.electronAPI)

```typescript
interface ElectronAPI {
  // 앱 정보
  getAppVersion(): Promise<string>;
  getAppPath(): Promise<string>;

  // 파일 다이얼로그
  selectFolder(): Promise<string | null>;
  selectDirectory(): Promise<string | null>;  // 설정용 디렉토리 선택
  saveFile(defaultPath: string): Promise<string | null>;
  openFolder(folderPath: string): Promise<void>;  // Finder/Explorer로 열기

  // 다운로드 관련
  download: {
    start(data: { packages: unknown[]; options: unknown }): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    cancel(): Promise<void>;
    onProgress(callback: (progress: unknown) => void): () => void;
    onComplete(callback: (result: unknown) => void): () => void;
    onError(callback: (error: unknown) => void): () => void;
    onStatus(callback: (status: { phase: string; message: string }) => void): () => void;
    onDepsResolved(callback: (data: {
      originalPackages: unknown[];
      allPackages: unknown[];
      dependencyTrees?: unknown[];
      failedPackages?: unknown[];
    }) => void): () => void;
  };

  // 설정 관련
  config: {
    get(): Promise<unknown>;
    set(config: unknown): Promise<void>;
    reset(): Promise<void>;
  };

  // 파일 시스템
  fs: {
    selectDirectory(): Promise<string | null>;
    selectFile(filters?: unknown): Promise<string | null>;
    readFile(filePath: string): Promise<string>;
  };

  // 캐시 관련
  cache: {
    getSize(): Promise<number>;
    clear(): Promise<void>;
  };

  // 히스토리 관련
  history: {
    load(): Promise<unknown[]>;
    save(histories: unknown[]): Promise<{ success: boolean }>;
    add(history: unknown): Promise<{ success: boolean }>;
    delete(id: string): Promise<{ success: boolean }>;
    clear(): Promise<{ success: boolean }>;
  };

  // 패키지 검색
  search: {
    packages(type: string, query: string): Promise<{
      packages: Array<{ name: string; version: string; description?: string }>;
    }>;
    suggest(type: string, query: string): Promise<string[]>;
    versions(type: string, packageName: string): Promise<{ versions: string[] }>;
  };

  // 의존성 해결
  dependency: {
    resolve(packages: unknown[]): Promise<{
      originalPackages: unknown[];
      allPackages: unknown[];
      dependencyTrees?: unknown[];
      failedPackages?: unknown[];
    }>;
  };
}
```

---

## Renderer (React 앱)

### 구조

```
src/renderer/
├── index.tsx          # React 진입점
├── App.tsx            # 메인 앱 컴포넌트 (라우팅)
├── index.html         # HTML 템플릿
├── global.d.ts        # 전역 타입 선언
├── pages/             # 페이지 컴포넌트
│   ├── HomePage.tsx
│   ├── WizardPage.tsx
│   ├── CartPage.tsx
│   ├── DownloadPage.tsx
│   ├── HistoryPage.tsx    # 다운로드 히스토리
│   └── SettingsPage.tsx
├── components/        # 재사용 컴포넌트
│   ├── index.ts
│   └── DependencyTree.tsx
├── layouts/           # 레이아웃 컴포넌트
│   └── MainLayout.tsx
├── stores/            # Zustand 상태 관리
│   ├── cartStore.ts
│   ├── downloadStore.ts
│   ├── historyStore.ts    # 다운로드 히스토리
│   └── settingsStore.ts
└── styles/
    └── global.css
```

---

## 페이지 컴포넌트

### HomePage
- 경로: `/`
- 역할: 메인 대시보드, 패키지 타입 선택

### WizardPage
- 경로: `/wizard`
- 역할: 패키지 검색 및 선택 위자드
- 단계:
  1. 카테고리 선택 (라이브러리, OS 패키지, 컨테이너)
  2. 패키지 타입 선택 (pip, conda, maven, yum, docker)
  3. 언어/런타임 버전 선택 (Python, Java, Node.js - 타입에 따라)
  4. 패키지 검색 및 선택
  5. 버전 선택
  6. 타겟 OS/아키텍처 선택

#### 언어 버전 선택

pip/conda 선택 시 Python 버전 선택 UI 표시:
- 지원 버전: 3.8 ~ 3.13

#### Docker 레지스트리 선택 (신규)

Docker 타입 선택 시 레지스트리 선택 UI 표시:

```typescript
const dockerRegistryOptions = [
  { value: 'docker.io', label: 'Docker Hub', description: '공식 Docker Hub 레지스트리' },
  { value: 'ghcr.io', label: 'GitHub Container Registry', description: 'GitHub 컨테이너 레지스트리' },
  { value: 'ecr', label: 'Amazon ECR Public', description: 'AWS 퍼블릭 컨테이너 레지스트리' },
  { value: 'quay.io', label: 'Quay.io', description: 'Red Hat Quay 레지스트리' },
  { value: 'custom', label: '커스텀 레지스트리', description: '직접 레지스트리 URL 입력' },
];
```

- **기본 레지스트리**: 설정 페이지의 `dockerRegistry` 값이 기본 선택됨
- **커스텀 레지스트리**: 'custom' 선택 시 URL 입력 필드 표시
- **검색 및 태그 조회**: 선택된 레지스트리에 맞게 API 호출

#### Maven 버전 조회 (브라우저 환경)

브라우저 환경에서 Maven 패키지 선택 시 Vite 플러그인 API를 통해 버전 목록 조회:

```tsx
// WizardPage 내 Maven 버전 조회
if (packageType === 'maven') {
  const response = await fetch(`/api/maven/versions?package=${encodeURIComponent(record.name)}`);
  const data = await response.json();
  setAvailableVersions(data.versions);
}
```

### CartPage
- 경로: `/cart`
- 역할: 선택한 패키지 목록 관리 (장바구니)

#### 주요 기능
- 패키지 목록 표시 (타입, 이름, 버전, 아키텍처)
- 개별/전체 삭제
- 텍스트 파일에서 패키지 추가 (requirements.txt, pom.xml, package.json)
- 예상 다운로드 크기 및 소요 시간 표시
- 의존성 트리 미리보기
- 다운로드 시작 → 다운로드 페이지로 이동

#### 다운로드 옵션
다운로드 옵션(출력 형식, 전달 방식 등)은 설정 페이지에서 관리합니다.
장바구니에서 "다운로드 시작" 클릭 시 바로 다운로드 페이지로 이동합니다.

### DownloadPage
- 경로: `/download`
- 역할: 다운로드 진행 상황, 의존성 트리 표시, 로그 뷰어

#### 주요 기능
- 실시간 진행률 표시 (패키지별, 전체)
- 다운로드 속도 및 남은 시간 표시
- 패키지별 상태 (대기/다운로드 중/완료/실패)
- 에러 발생 시 재시도/건너뛰기/취소 선택
- 완료 후 폴더 열기 (Finder/Explorer)
- 다운로드 완료 시 히스토리 자동 저장

#### 출력 설정 통합

DownloadPage에서 출력 형식은 설정 페이지(SettingsPage)의 값을 직접 사용합니다:

- **출력 형식**: 읽기 전용 Tag로 표시 (선택 불가)
- **설정 변경**: 설정 페이지로 이동하는 링크 제공
- **자동 적용**: settingsStore의 `defaultOutputFormat` 값이 모든 다운로드에 자동 적용

```tsx
// DownloadPage에서의 출력 형식 사용
const { defaultOutputFormat } = useSettingsStore();
const outputFormat = defaultOutputFormat;  // 설정 페이지 값 직접 사용

// UI: 읽기 전용 Tag로 표시
<Tag color="blue">{formatLabel}</Tag>
<Text type="secondary">
  <a onClick={() => navigate('/settings')}>설정 페이지</a>에서 변경 가능
</Text>
```

### HistoryPage
- 경로: `/history`
- 역할: 다운로드 이력 관리 및 재다운로드

#### 주요 기능
- 히스토리 목록 테이블 (날짜, 패키지, 상태, 크기, 출력 형식)
- 상태별 필터링 (성공/부분 성공/실패)
- 통계 카드 (전체/성공/실패 건수, 총 용량)
- 상세 정보 모달
- 폴더 열기 (Finder/Explorer)
- 재다운로드 (장바구니에 추가 후 다운로드 페이지 이동)
- 개별/전체 삭제

### SettingsPage
- 경로: `/settings`
- 역할: 앱 설정 관리

#### 설정 항목
- **다운로드 설정**: 동시 다운로드 수, 기본 다운로드 경로
- **언어 버전 설정**: Python, Java, Node.js 기본 버전
- **캐시 설정**: 캐시 사용 여부, 디렉토리, 최대 크기
- **출력 설정**: 기본 출력 형식, 설치 스크립트 포함 여부
- **파일 분할 설정**: 자동 분할, 분할 크기
- **SMTP 설정**: 메일 발송 설정
- **OS 배포판 설정**: YUM/APT/APK별 기본 배포판 및 아키텍처
- **Docker 설정**: 기본 레지스트리, 커스텀 레지스트리 URL, 이미지 아키텍처 등

#### 레이아웃 개선
- 헤더 고정: 저장/초기화 버튼이 상단에 항상 표시
- 스크롤 가능한 콘텐츠 영역

#### 출력 설정 자동 적용

설정 페이지에서 선택한 출력 옵션은 모든 다운로드에 자동으로 적용됩니다:

- **자동 적용 안내**: Alert 컴포넌트로 사용자에게 자동 적용됨을 알림
- **출력 형식**: ZIP 압축, TAR.GZ 압축, 오프라인 미러 구조 중 선택
- **설치 스크립트**: Bash/PowerShell 스크립트 포함 여부

```tsx
// 설정 페이지 UI
<Alert
  message="다운로드 시 자동 적용"
  description="여기서 설정한 출력 형식과 설치 스크립트 옵션이 모든 다운로드에 자동으로 적용됩니다."
  type="info"
  showIcon
/>
```

---

## Zustand Stores

### HistoryStore (`stores/historyStore.ts`)

다운로드 히스토리 상태 관리

```typescript
interface HistoryState {
  histories: DownloadHistory[];

  // Actions
  addHistory: (
    packages: HistoryPackageItem[],
    settings: HistorySettings,
    outputPath: string,
    totalSize: number,
    status: HistoryStatus,
    downloadedCount?: number,
    failedCount?: number
  ) => string;
  getHistory: (id: string) => DownloadHistory | undefined;
  getHistories: () => DownloadHistory[];
  deleteHistory: (id: string) => void;
  clearAll: () => void;
}

const useHistoryStore = create<HistoryState>()(persist(...));
```

- **영속성**: Zustand persist (`localStorage`)
- **최대 개수**: 100개 (초과 시 오래된 항목 삭제)
- **자세한 내용**: [다운로드 히스토리 문서](./download-history.md) 참조

### CartStore (`stores/cartStore.ts`)

장바구니 상태 관리

```typescript
interface CartItem {
  id: string;
  name: string;
  version: string;
  type: PackageType;
  architecture?: Architecture;
  description?: string;
  size?: number;
}

interface CartState {
  items: CartItem[];

  // Actions
  addItem(item: Omit<CartItem, 'id'>): void;
  removeItem(id: string): void;
  updateItem(id: string, updates: Partial<CartItem>): void;
  clearCart(): void;
  hasItem(name: string, type: PackageType): boolean;
}

const useCartStore = create<CartState>(...);
```

### DownloadStore (`stores/downloadStore.ts`)

다운로드 진행 상태 관리

```typescript
type DownloadStatus =
  | 'idle'
  | 'resolving'
  | 'downloading'
  | 'packaging'
  | 'completed'
  | 'error'
  | 'cancelled';

type PackagingStatus =
  | 'idle'
  | 'archiving'
  | 'mirroring'
  | 'scripting'
  | 'completed';

interface DownloadItem {
  id: string;
  name: string;
  version: string;
  type: PackageType;
  status: 'pending' | 'downloading' | 'completed' | 'error' | 'skipped';
  progress: number;
  size?: number;
  downloadedSize?: number;
  error?: string;
  parentPackage?: string;  // 의존성인 경우 부모 패키지명
}

interface LogEntry {
  id: string;
  timestamp: Date;
  level: 'info' | 'warn' | 'error';
  message: string;
}

interface DownloadState {
  status: DownloadStatus;
  items: DownloadItem[];
  packagingStatus: PackagingStatus;
  overallProgress: number;
  currentSpeed: number;
  estimatedTime: number;
  logs: LogEntry[];
  outputPath?: string;
  error?: string;
  originalPackages: DownloadItem[];  // 원본 패키지 목록

  // Actions
  setStatus(status: DownloadStatus): void;
  addItem(item: Omit<DownloadItem, 'id'>): void;
  updateItem(id: string, updates: Partial<DownloadItem>): void;
  setPackagingStatus(status: PackagingStatus): void;
  setOverallProgress(progress: number): void;
  addLog(level: LogEntry['level'], message: string): void;
  reset(): void;
}

const useDownloadStore = create<DownloadState>(...);
```

### SettingsStore (`stores/settingsStore.ts`)

앱 설정 상태 관리

```typescript
interface LanguageVersions {
  python: string;   // 예: '3.11'
  java: string;     // 예: '17'
  node: string;     // 예: '20'
}

// Docker 레지스트리 타입
type DockerRegistry = 'docker.io' | 'ghcr.io' | 'ecr' | 'quay.io' | 'custom';

interface SettingsState {
  // 다운로드 설정
  concurrentDownloads: number;
  downloadDir: string;
  defaultDownloadPath: string;  // 기본 다운로드 경로

  // 언어 버전 설정
  languageVersions: LanguageVersions;

  // 캐시 설정
  cacheEnabled: boolean;
  cacheDir: string;
  maxCacheSize: number; // GB

  // 출력 설정
  defaultOutputFormat: 'zip' | 'tar.gz' | 'mirror';
  includeScripts: boolean;

  // 파일 분할 설정
  autoSplit: boolean;
  splitSize: number; // MB

  // SMTP 설정
  smtpEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;

  // OS 배포판 설정 (신규)
  yumDistribution: { id: string; architecture: string };   // 예: { id: 'rocky-9', architecture: 'x86_64' }
  aptDistribution: { id: string; architecture: string };   // 예: { id: 'ubuntu-22.04', architecture: 'amd64' }
  apkDistribution: { id: string; architecture: string };   // 예: { id: 'alpine-3.18', architecture: 'x86_64' }

  // Docker 설정 (신규)
  dockerRegistry: DockerRegistry;           // 기본 레지스트리
  dockerCustomRegistry: string;             // 커스텀 레지스트리 URL
  dockerArchitecture: string;               // Docker 이미지 아키텍처 (예: 'amd64')
  dockerLayerCompression: boolean;          // 레이어 압축 여부
  dockerRetryStrategy: 'none' | 'linear' | 'exponential';  // 재시도 전략
  dockerIncludeLoadScript: boolean;         // docker load 스크립트 포함 여부

  // Actions
  setSetting<K extends keyof SettingsState>(key: K, value: SettingsState[K]): void;
  updateSettings(updates: Partial<SettingsState>): void;
  resetSettings(): void;
  loadSettings(): Promise<void>;
  saveSettings(): Promise<void>;
}

const useSettingsStore = create<SettingsState>(...);
```

---

## 컴포넌트

### DependencyTree (`components/DependencyTree.tsx`)

의존성 트리 시각화 컴포넌트

```typescript
interface DependencyTreeProps {
  tree: DependencyNode;
  onNodeClick?: (node: DependencyNode) => void;
  expandLevel?: number;
}
```

### MainLayout (`layouts/MainLayout.tsx`)

메인 레이아웃 (사이드바, 헤더, 컨텐츠 영역)

#### 사이드바 메뉴

| 경로 | 아이콘 | 라벨 |
|------|--------|------|
| `/` | HomeOutlined | 홈 |
| `/wizard` | SearchOutlined | 패키지 검색 |
| `/cart` | ShoppingCartOutlined | 장바구니 |
| `/download` | DownloadOutlined | 다운로드 |
| `/history` | HistoryOutlined | 히스토리 |
| `/settings` | SettingOutlined | 설정 |

#### 레이아웃 구조
- **사이드바**: 고정(fixed) 위치, 화면 왼쪽에 항상 표시
- **콘텐츠**: 사이드바 너비만큼 margin-left 적용 (80px collapsed, 200px expanded)

### OS 패키지 컴포넌트 (`components/os/`)

OS 패키지 검색 및 선택을 위한 UI 컴포넌트 모음

#### OSTypeSelector

OS 타입 (패키지 관리자) 선택 컴포넌트

```typescript
interface OSTypeSelectorProps {
  selectedType: OSPackageManager | null;
  onTypeChange: (type: OSPackageManager) => void;
}
```

- **RHEL/CentOS 계열 (yum)**: Rocky Linux, AlmaLinux, CentOS 등
- **Ubuntu/Debian 계열 (apt)**: Ubuntu, Debian
- **Alpine (apk)**: Alpine Linux

#### OSVersionSelector

배포판 버전 선택 컴포넌트

```typescript
interface OSVersionSelectorProps {
  packageManager: OSPackageManager | null;
  selectedDistribution: OSDistribution | null;
  onDistributionChange: (distribution: OSDistribution) => void;
}
```

- 선택된 패키지 관리자에 맞는 배포판 목록 표시
- 추천 배포판 배지 표시 (LTS, 안정판)

#### ArchitectureSelector

CPU 아키텍처 선택 컴포넌트

```typescript
interface ArchitectureSelectorProps {
  distribution: OSDistribution | null;
  selectedArchitecture: OSArchitecture;
  onArchitectureChange: (arch: OSArchitecture) => void;
}
```

- 배포판에서 지원하는 아키텍처만 표시
- 기본값: x86_64/amd64

#### RepositorySelector

저장소 선택 컴포넌트

```typescript
interface RepositorySelectorProps {
  distribution: OSDistribution | null;
  selectedRepos: Repository[];
  onReposChange: (repos: Repository[]) => void;
}
```

- 기본 저장소 (자동 선택)
- 확장 저장소 (EPEL, Universe 등)
- 사용자 정의 저장소 추가 지원

#### OSPackageSearch

패키지 검색 및 결과 표시 컴포넌트

```typescript
interface OSPackageSearchProps {
  distribution: OSDistribution | null;
  architecture: OSArchitecture;
  repositories: Repository[];
  onAddToCart: (pkg: OSPackageInfo) => void;
}
```

- 검색 모드: 부분 일치, 정확 일치, 시작 문자, 와일드카드
- 검색 결과 테이블 (이름, 버전, 아키텍처, 크기, 설명)
- 장바구니 추가 버튼

#### OSOutputOptions

다운로드 출력 옵션 설정 컴포넌트

```typescript
interface OSOutputOptionsProps {
  outputOptions: OSPackageOutputOptions;
  onOptionsChange: (options: OSPackageOutputOptions) => void;
}
```

- **출력 형식**: 아카이브만, 로컬 저장소만, 둘 다
- **압축 형식**: zip, tar.gz
- **스크립트 포함**: 의존성 순서 설치, 로컬 저장소 설정

#### OSPackageCart

선택된 패키지 목록 및 다운로드 시작 컴포넌트

```typescript
interface OSPackageCartProps {
  packages: OSPackageInfo[];
  distribution: OSDistribution | null;
  onRemove: (pkg: OSPackageInfo) => void;
  onClearAll: () => void;
  onStartDownload: (options: OSPackageDownloadOptions) => void;
}
```

- 선택된 패키지 목록 표시 (이름, 버전, 크기)
- 개별/전체 삭제 기능
- 총 크기 계산 및 표시
- 출력 옵션 설정 (OSOutputOptions 통합)
- 다운로드 시작 버튼

#### OSDownloadResult

다운로드 완료 결과 표시 컴포넌트

```typescript
interface OSDownloadResultProps {
  result: OSPackageDownloadResult;
  outputOptions: OSPackageOutputOptions;
  onClose: () => void;
  onOpenFolder: (path: string) => void;
}
```

- 다운로드 결과 요약 (성공/실패 개수, 총 크기)
- 생성된 파일 목록 (아카이브, 저장소, 스크립트)
- 설치 명령어 표시 (패키지 관리자별)
- 폴더 열기 버튼

---

## 데이터 흐름

```
┌─────────────────────────────────────────────────────────┐
│                     React Components                     │
│  (HomePage, WizardPage, CartPage, DownloadPage, etc.)   │
└─────────────────────────────────────────────────────────┘
                          ↓ useStore()
┌─────────────────────────────────────────────────────────┐
│                    Zustand Stores                        │
│     (cartStore, downloadStore, settingsStore)           │
└─────────────────────────────────────────────────────────┘
                          ↓ window.electronAPI
┌─────────────────────────────────────────────────────────┐
│                  Preload Bridge                          │
│            (contextBridge, ipcRenderer)                 │
└─────────────────────────────────────────────────────────┘
                          ↓ IPC
┌─────────────────────────────────────────────────────────┐
│                   Electron Main                          │
│        (ipcMain handlers, system APIs)                  │
└─────────────────────────────────────────────────────────┘
```

---

## 사용 예시

### 장바구니에 패키지 추가
```tsx
import { useCartStore } from '../stores/cartStore';

function PackageSearchResult({ pkg }) {
  const addItem = useCartStore(state => state.addItem);

  return (
    <button onClick={() => addItem({
      name: pkg.name,
      version: pkg.version,
      type: 'pip',
      description: pkg.description
    })}>
      장바구니에 추가
    </button>
  );
}
```

### 다운로드 진행 상황 표시
```tsx
import { useDownloadStore } from '../stores/downloadStore';

function DownloadProgress() {
  const { status, overallProgress, currentSpeed, items } = useDownloadStore();

  const completedCount = items.filter(i => i.status === 'completed').length;
  const failedCount = items.filter(i => i.status === 'error').length;

  return (
    <div>
      <p>상태: {status}</p>
      <progress value={overallProgress} max={100} />
      <p>속도: {currentSpeed} MB/s</p>
      <p>완료: {completedCount} / {items.length}</p>
      {failedCount > 0 && <p>실패: {failedCount}개</p>}
    </div>
  );
}
```

### Electron API 호출
```tsx
function FolderSelector() {
  const handleSelect = async () => {
    const folder = await window.electronAPI.selectFolder();
    if (folder) {
      console.log('선택된 폴더:', folder);
    }
  };

  return <button onClick={handleSelect}>폴더 선택</button>;
}
```

### 언어 버전 설정 사용
```tsx
import { useSettingsStore } from '../stores/settingsStore';

function LanguageVersionSelector() {
  const { languageVersions, setSetting } = useSettingsStore();

  return (
    <select
      value={languageVersions.python}
      onChange={(e) => setSetting('languageVersions', {
        ...languageVersions,
        python: e.target.value
      })}
    >
      <option value="3.8">Python 3.8</option>
      <option value="3.9">Python 3.9</option>
      <option value="3.10">Python 3.10</option>
      <option value="3.11">Python 3.11</option>
      <option value="3.12">Python 3.12</option>
      <option value="3.13">Python 3.13</option>
    </select>
  );
}
```

---

## 관련 문서
- [아키텍처 개요](./architecture-overview.md)
- [Shared Utilities](./shared-utilities.md)
- [Downloaders](./downloaders.md)
- [Resolvers](./resolvers.md)
- [OS 패키지 다운로더](./os-package-downloader.md)
- [다운로드 히스토리](./download-history.md)
