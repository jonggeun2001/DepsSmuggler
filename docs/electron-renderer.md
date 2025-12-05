# Electron & Renderer

## 개요
- 목적: 데스크톱 앱 UI 및 시스템 통합
- 프레임워크: Electron + React + Zustand

---

## Electron 메인 프로세스

### 개요
- 위치: `electron/main.ts`
- 역할: 윈도우 생성, IPC 핸들링, 시스템 API 접근

### 주요 구성요소

| 구성요소 | 설명 |
|----------|------|
| `createWindow` | BrowserWindow 생성 및 설정 |
| `mainWindow` | 메인 윈도우 참조 |
| `isDev` | 개발 모드 여부 |
| `VITE_DEV_SERVER_URL` | Vite 개발 서버 URL |

### IPC 핸들러

| 채널 | 설명 |
|------|------|
| `get-app-version` | 앱 버전 조회 |
| `get-app-path` | 앱 경로 조회 |
| `select-folder` | 폴더 선택 다이얼로그 |
| `save-file` | 파일 저장 다이얼로그 |
| `search:packages` | 패키지 검색 (PyPI, Maven 실제 API 연동) |
| `search:suggest` | 자동완성 제안 |
| `search:versions` | 패키지 버전 목록 조회 |
| `dependency:resolve` | 의존성 해결 |
| `download:start` | 다운로드 시작 |
| `download:pause` | 다운로드 일시정지 |
| `download:resume` | 다운로드 재개 |
| `download:cancel` | 다운로드 취소 |

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
  saveFile(defaultPath: string): Promise<string | null>;

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
│   └── SettingsPage.tsx
├── components/        # 재사용 컴포넌트
│   ├── index.ts
│   └── DependencyTree.tsx
├── layouts/           # 레이아웃 컴포넌트
│   └── MainLayout.tsx
├── stores/            # Zustand 상태 관리
│   ├── cartStore.ts
│   ├── downloadStore.ts
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

### CartPage
- 경로: `/cart`
- 역할: 선택한 패키지 목록 관리 (장바구니)

### DownloadPage
- 경로: `/download`
- 역할: 다운로드 진행 상황, 의존성 트리 표시, 로그 뷰어

#### 주요 기능
- 실시간 진행률 표시 (패키지별, 전체)
- 다운로드 속도 및 남은 시간 표시
- 패키지별 상태 (대기/다운로드 중/완료/실패)
- 에러 발생 시 재시도/건너뛰기/취소 선택
- 완료 후 폴더 열기

### SettingsPage
- 경로: `/settings`
- 역할: 앱 설정 관리

#### 설정 항목
- **다운로드 설정**: 동시 다운로드 수, 저장 디렉토리
- **언어 버전 설정**: Python, Java, Node.js 기본 버전
- **캐시 설정**: 캐시 사용 여부, 디렉토리, 최대 크기
- **출력 설정**: 기본 출력 형식, 설치 스크립트 포함 여부
- **파일 분할 설정**: 자동 분할, 분할 크기
- **SMTP 설정**: 메일 발송 설정

---

## Zustand Stores

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

interface SettingsState {
  // 다운로드 설정
  concurrentDownloads: number;
  downloadDir: string;

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

  // Actions
  setSetting<K extends keyof SettingsState>(key: K, value: SettingsState[K]): void;
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
