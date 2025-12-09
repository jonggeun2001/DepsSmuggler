# 다운로드 히스토리

## 개요
- 목적: 다운로드 이력 관리 및 재다운로드 지원
- 위치:
  - 스토어: `src/renderer/stores/historyStore.ts`
  - 페이지: `src/renderer/pages/HistoryPage.tsx`
  - 타입: `src/types/index.ts`
  - IPC: `electron/main.ts`

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| 자동 저장 | 다운로드 완료 시 히스토리 자동 저장 |
| 재다운로드 | 이전 다운로드 설정을 복원하여 재다운로드 |
| 파일 동기화 | Zustand persist + 파일 기반 동기화 |
| 폴더 열기 | 다운로드 경로를 Finder/Explorer로 열기 |
| 상태 필터링 | 성공/부분 성공/실패 상태별 필터 |
| 통계 표시 | 전체/성공/실패 건수 및 총 용량 |

---

## 타입 정의

### HistoryPackageItem

히스토리에 저장되는 패키지 정보

```typescript
interface HistoryPackageItem {
  type: PackageType;           // pip, maven, npm 등
  name: string;                // 패키지 이름
  version: string;             // 패키지 버전
  arch?: Architecture;         // 아키텍처
  languageVersion?: string;    // 언어/런타임 버전
  metadata?: Record<string, unknown>;
}
```

### HistorySettings

다운로드 시 사용된 설정 정보

```typescript
interface HistorySettings {
  outputFormat: 'zip' | 'tar.gz' | 'mirror';
  includeScripts: boolean;
  includeDependencies: boolean;
}
```

### DownloadHistory

히스토리 항목 전체 정보

```typescript
interface DownloadHistory {
  id: string;                  // 고유 ID (타임스탬프 + 랜덤)
  timestamp: string;           // ISO 8601 형식
  packages: HistoryPackageItem[];
  settings: HistorySettings;
  outputPath: string;          // 출력 파일/폴더 경로
  totalSize: number;           // 바이트 단위
  status: 'success' | 'partial' | 'failed';
  downloadedCount?: number;    // 성공한 파일 수
  failedCount?: number;        // 실패한 파일 수
}
```

---

## Zustand Store

### 파일 위치
`src/renderer/stores/historyStore.ts`

### 상태

```typescript
interface HistoryState {
  histories: DownloadHistory[];
}
```

### 액션

| 액션 | 파라미터 | 설명 |
|------|----------|------|
| `addHistory` | packages, settings, outputPath, totalSize, status, downloadedCount?, failedCount? | 히스토리 추가 (100개 초과 시 오래된 것 삭제) |
| `getHistory` | id | ID로 특정 히스토리 조회 |
| `getHistories` | - | 전체 히스토리 조회 |
| `deleteHistory` | id | 특정 히스토리 삭제 |
| `clearAll` | - | 전체 히스토리 삭제 |

### 영속성

- **Zustand persist**: `localStorage` (`depssmuggler-history` 키)
- **파일 기반**: `~/.depssmuggler/history.json` (Electron 환경)

---

## IPC 핸들러

### 파일 위치
`electron/main.ts` (히스토리 관련 IPC 핸들러 섹션)

### 히스토리 파일 경로
```
~/.depssmuggler/
└── history.json    # 히스토리 데이터 (JSON 배열)
```

### 핸들러 목록

| 채널 | 파라미터 | 반환값 | 설명 |
|------|----------|--------|------|
| `history:load` | - | `DownloadHistory[]` | 파일에서 히스토리 로드 |
| `history:save` | histories: unknown[] | `{ success: boolean }` | 전체 히스토리 저장 (덮어쓰기) |
| `history:add` | history: unknown | `{ success: boolean }` | 단일 히스토리 추가 |
| `history:delete` | id: string | `{ success: boolean }` | 특정 히스토리 삭제 |
| `history:clear` | - | `{ success: boolean }` | 전체 히스토리 삭제 |

### 특징

- 디렉토리 자동 생성: `~/.depssmuggler` 없으면 생성
- 파일 자동 생성: `history.json` 없으면 빈 배열로 생성
- 최대 100개 유지: `history:add` 시 초과분 자동 삭제

---

## Preload API

### 파일 위치
`electron/preload.ts`

### 노출된 API

```typescript
// window.electronAPI.history
history: {
  load: () => Promise<unknown[]>;
  save: (histories: unknown[]) => Promise<{ success: boolean }>;
  add: (history: unknown) => Promise<{ success: boolean }>;
  delete: (id: string) => Promise<{ success: boolean }>;
  clear: () => Promise<{ success: boolean }>;
}
```

---

## UI 컴포넌트

### HistoryPage

경로: `/history`

#### 주요 기능

| 기능 | 설명 |
|------|------|
| 테이블 뷰 | 히스토리 목록 (날짜, 패키지, 상태, 크기, 출력 형식) |
| 상태 필터 | 성공/부분 성공/실패별 필터링 |
| 정렬 | 날짜, 크기 기준 정렬 |
| 통계 카드 | 전체/성공/부분 성공/실패 건수, 총 용량 |
| 상세 모달 | 패키지 목록, 설정, 경로 상세 정보 |

#### 작업 버튼

| 버튼 | 아이콘 | 설명 |
|------|--------|------|
| 상세 정보 | InfoCircleOutlined | 상세 정보 모달 열기 |
| 폴더 열기 | FolderOpenOutlined | 다운로드 경로 탐색기 열기 |
| 재다운로드 | ReloadOutlined | 장바구니에 추가 후 다운로드 페이지 이동 |
| 삭제 | DeleteOutlined | 개별 히스토리 삭제 |
| 전체 삭제 | ClearOutlined | 모든 히스토리 삭제 |

#### 재다운로드 흐름

1. 재다운로드 버튼 클릭
2. 확인 모달 표시
3. 패키지들을 장바구니에 추가 (`cartStore.addItem`)
4. 설정 복원 (`settingsStore.updateSettings`)
5. 다운로드 페이지로 이동

---

## 히스토리 저장 시점

### DownloadPage에서 자동 저장

다운로드 완료 시 (`download:all-complete` 이벤트) 자동으로 히스토리 저장:

```typescript
// DownloadPage.tsx 내 download:all-complete 핸들러

// 패키지 정보 변환
const historyPackages: HistoryPackageItem[] = cartState.map((item) => ({
  type: item.type,
  name: item.name,
  version: item.version,
  arch: item.arch,
  languageVersion: item.languageVersion,
  metadata: item.metadata,
}));

// 상태 계산
const completedCount = finalItems.filter((i) => i.status === 'completed').length;
const failedCount = finalItems.filter((i) => i.status === 'failed').length;

let historyStatus: HistoryStatus = 'success';
if (failedCount === totalCount) {
  historyStatus = 'failed';
} else if (failedCount > 0) {
  historyStatus = 'partial';
}

// 히스토리 저장
addHistory(
  historyPackages,
  historySettings,
  data.outputPath,
  totalSize,
  historyStatus,
  completedCount,
  failedCount
);
```

---

## 사용 예시

### 히스토리 조회

```tsx
import { useHistoryStore } from '../stores/historyStore';

function HistoryList() {
  const { histories, deleteHistory } = useHistoryStore();

  return (
    <ul>
      {histories.map((h) => (
        <li key={h.id}>
          {formatDate(h.timestamp)} - {h.packages.length}개 패키지
          <button onClick={() => deleteHistory(h.id)}>삭제</button>
        </li>
      ))}
    </ul>
  );
}
```

### 재다운로드 구현

```tsx
const handleRedownload = (history: DownloadHistory) => {
  // 장바구니에 패키지 추가
  history.packages.forEach((pkg) => {
    addItem({
      type: pkg.type,
      name: pkg.name,
      version: pkg.version,
      arch: pkg.arch,
      languageVersion: pkg.languageVersion,
    });
  });

  // 설정 복원
  updateSettings({
    defaultOutputFormat: history.settings.outputFormat,
    includeInstallScripts: history.settings.includeScripts,
    includeDependencies: history.settings.includeDependencies,
  });

  // 다운로드 페이지로 이동
  navigate('/download');
};
```

---

## 관련 문서
- [Electron & Renderer](./electron-renderer.md)
- [Downloaders](./downloaders.md)
- [아키텍처 개요](./architecture-overview.md)
