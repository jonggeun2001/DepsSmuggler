# 다운로드 히스토리

## 개요
- 목적: 다운로드 이력 관리 및 재다운로드 지원
- 위치:
  - 스토어: `src/renderer/stores/history-store.ts`
  - 페이지: `src/renderer/pages/HistoryPage.tsx`
  - 타입: `src/types/history.ts` (`src/types/index.ts` barrel re-export)
  - IPC: `electron/history-handlers.ts` (`electron/main.ts`에서 등록)
  - 영속화 클라이언트: `src/renderer/lib/renderer-data-client.ts`
  - 저장/복원 설정 변환: `src/renderer/pages/download-delivery-utils.ts`

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| 자동 저장 | 다운로드 완료 시 히스토리 자동 저장 |
| 재다운로드 | 이전 다운로드 설정을 복원하여 재다운로드 |
| 파일 동기화 | file-backed Zustand store가 `history.json`과 직접 동기화 |
| 폴더 열기 | 출력 경로가 폴더면 열고, 파일이면 Finder/Explorer에서 해당 산출물을 표시 |
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
  outputFormat: 'zip' | 'tar.gz';
  includeScripts: boolean;
  includeDependencies: boolean;
  deliveryMethod: 'local' | 'email';
  smtpTo?: string;
  fileSplitEnabled?: boolean;
  maxFileSizeMB?: number;
  osOutputOptions?: OSPackageOutputOptions; // OS 전용 archive/repository/both 설정
}
```

`OSPackageOutputOptions`는 `src/core/downloaders/os-shared/types.ts`의 타입이며 출력 종류, 압축 형식, 스크립트 생성 여부/종류 등을 담습니다. SMTP 호스트·비밀번호 자체는 히스토리 설정에 복사하지 않습니다.

### DownloadHistory

히스토리 항목 전체 정보

```typescript
interface DownloadHistory {
  id: string;                  // 고유 ID (타임스탬프 + 랜덤)
  timestamp: string;           // ISO 8601 형식
  packages: HistoryPackageItem[];
  settings: HistorySettings;
  outputPath: string;          // 실제 산출물 경로 (예: /path/to/output.zip)
  artifactPaths?: string[];    // 실제 산출물 전체 목록
  deliveryMethod?: 'local' | 'email';
  deliveryResult?: {
    emailSent: boolean;
    emailsSent?: number;
    attachmentsSent?: number;
    splitApplied?: boolean;
    error?: string;
  };
  totalSize: number;           // 바이트 단위
  status: 'success' | 'partial' | 'failed';
  downloadedCount?: number;    // 성공한 파일 수
  failedCount?: number;        // 실패한 파일 수
}
```

---

## Zustand Store

### 파일 위치
`src/renderer/stores/history-store.ts`

### 상태

```typescript
interface HistoryState {
  histories: DownloadHistory[];
  initialized: boolean;
  loading: boolean;
  hydrate: () => Promise<void>;
}
```

### 액션

| 액션 | 파라미터 | 설명 |
|------|----------|------|
| `addHistory` | packages, settings, outputPath, totalSize, status, downloadedCount?, failedCount?, options? | 영속화 성공 후 메모리에 추가하고 `Promise<string>` ID 반환. 시작 시점 설정과 산출물/전달 메타데이터를 저장하며 최대 100개 유지 |
| `hydrate` | - | 파일 기반 히스토리를 읽어 store 초기화 |
| `getHistory` | id | ID로 특정 히스토리 조회 |
| `getHistories` | - | 전체 히스토리 조회 |
| `deleteHistory` | id | 특정 히스토리 삭제 |
| `clearAll` | - | 전체 히스토리 삭제 |

### 영속성

- **Electron source of truth**: `~/.depssmuggler/history.json`
- **renderer 상태**: Zustand 메모리 목록. `add/delete/clear`를 순서대로 영속화하고 성공한 뒤 갱신하며, 실패하면 이전 목록을 보존합니다.
- **동시 로드**: mutation queue와 요청 버전을 확인해 늦게 도착한 hydrate 결과가 이후 변경을 덮어쓰지 않게 합니다.
- **브라우저 fallback**: `history.load/add/delete/clear`가 모두 있을 때만 Electron history client를 사용합니다. API가 없거나 일부 누락되면 `depssmuggler-history` localStorage를 사용하며, 과거 Zustand `{ state: { histories } }` 형태도 배열로 마이그레이션합니다.

---

## IPC 핸들러

### 파일 위치
`electron/history-handlers.ts`의 `registerHistoryHandlers()` (`electron/main.ts`에서 호출)

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
- `history:save`는 전달된 배열 전체를 덮어쓰며 이 핸들러 자체에는 100개 제한이 없습니다.
- `history:load`는 파일 초기화/읽기 실패 시 오류를 기록하고 빈 배열을 반환합니다. 저장/추가/삭제/전체 삭제는 파일 I/O 실패를 호출자에게 전파합니다.
- 렌더러는 `HistoryPage.tsx`에서 IPC를 직접 호출하지 않고 store hydrate/add/delete/clear 경로만 사용

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
3. 기존 장바구니를 유지하면서 패키지와 `metadata`를 추가 (`cartStore.addItem`의 중복 규칙 적용)
4. `buildHistoryRestoreSettings`로 출력 형식·설치 스크립트·의존성 포함·분할 여부·분할 기준 크기를 전역 설정에 복원
5. 전달 방식, 이메일 수신자(`smtpTo`), `osOutputOptions`는 `/download`의 라우트 상태로 전달. 전역 SMTP 수신자는 바꾸지 않음

OS 패키지의 `metadata.osContext`도 함께 복원합니다. 전용 화면 진입에는 장바구니 전체의 패키지 관리자·배포판·아키텍처가 일치해야 하며, 오래된 히스토리에 context가 없으면 OS 패키지 재선택이 필요합니다.

---

## 히스토리 저장 시점

### DownloadPage에서 자동 저장

일반 다운로드는 `use-download-page-controller.tsx`가 `download:all-complete`를 받아 store의 `addHistory`를 호출합니다. store는 `history:add` IPC 등 영속화 작업의 성공을 기다린 뒤 메모리 상태를 갱신합니다. 아카이브 출력(`zip`, `tar.gz`)에서는 이벤트의 `outputPath`가 대표 산출물 경로를 담고, `artifactPaths`는 실제 산출물 전체 목록을 담습니다. 이메일 전달에서는 `deliveryMethod=email`, `deliveryResult`, 그리고 재다운로드 복원용 `settings.smtpTo`가 함께 저장됩니다.

일반 실패 완료도 실패 이력으로 남깁니다. 취소만 되고 보존할 산출물·전달 정보가 없으면 새 이력을 만들지 않으며, 취소 시 이미 생성된 산출물이나 이메일 성공/오류가 있으면 해당 결과를 보존합니다. 시작 시점의 패키지·설정 스냅샷과 `sessionId`를 사용해 늦게 도착한 이전 세션 결과가 새 다운로드 설정과 섞이지 않게 합니다. 히스토리 저장 실패는 화면에 알리고 장바구니를 유지합니다.

OS 전용 흐름은 일반 완료 이벤트 대신 `os.download.start()` 반환값을 `use-os-download-flow.ts`에서 저장합니다. `unresolved`로 다운로드가 중단되거나 취소된 결과는 저장하지 않습니다. 정상 반환 결과는 로컬 전달 방식, `osOutputOptions`, 출력 루트, 패키지 metadata와 성공/실패 수를 저장합니다. 현재 OS 저장 호출은 `generatedOutputs` 목록을 `artifactPaths`로 복사하지 않으므로, 이력의 폴더 열기는 출력 루트를 사용합니다.

아래는 일반 완료 저장 구조를 보여주는 축약 예시입니다. 실제 상태 계산에는 세션에 속한 항목만 포함하고 `data.results`를 항목 상태보다 우선하며, 실패/취소 경로에서는 상태를 명시적으로 지정하기도 합니다.

```typescript
// use-download-page-controller.tsx의 persistHistoryEntry 구조

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
if (failedCount === totalCount && totalCount > 0) {
  historyStatus = 'failed';
} else if (failedCount > 0) {
  historyStatus = 'partial';
}

// 히스토리 저장
await addHistory(
  historyPackages,
  historySettings,
  data.outputPath,
  totalSize,
  historyStatus,
  completedCount,
  failedCount,
  {
    artifactPaths: data.artifactPaths,
    deliveryMethod: data.deliveryMethod || historySettings.deliveryMethod,
    deliveryResult: data.deliveryResult,
  }
);
```

일반 이력의 `totalSize`는 세션 항목의 `totalBytes` 합계이며 아카이브 파일의 `stat.size`가 아닙니다. OS 이력은 성공한 패키지의 `size` 합계를 사용합니다.

---

## 사용 예시

### 히스토리 조회

스토어는 브라우저에서 생성될 때 기본 hydrate를 시작합니다. 아래 조회 예시는 삭제 오류 표시 등 UI 처리를 생략한 형태이며 실제 `HistoryPage`는 비동기 삭제 결과를 기다립니다.

```tsx
import { useHistoryStore } from '../stores/history-store';

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

실제 페이지는 확인 모달의 `onOk`에서 아래 복원 작업을 수행합니다.

```tsx
import { buildHistoryRestoreSettings } from './download-delivery-utils';

const handleRedownload = (history: DownloadHistory) => {
  // 장바구니에 패키지 추가
  history.packages.forEach((pkg) => {
    addItem({
      type: pkg.type,
      name: pkg.name,
      version: pkg.version,
      arch: pkg.arch,
      languageVersion: pkg.languageVersion,
      metadata: pkg.metadata,
    });
  });

  // 설정 복원
  updateSettings(buildHistoryRestoreSettings(history.settings));

  // 전달 방식과 수신자/OS 출력 옵션은 이번 재다운로드에 전달
  navigate('/download', {
    state: {
      deliveryMethod: history.deliveryMethod || history.settings.deliveryMethod || 'local',
      emailRecipient: history.settings.smtpTo,
      osOutputOptions: history.settings.osOutputOptions,
    },
  });
};
```

---

## 관련 문서
- [Electron & Renderer](./electron-renderer.md)
- [Downloaders](./downloaders.md)
- [아키텍처 개요](./architecture-overview.md)
