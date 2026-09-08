# HTTP API에서 IPC로의 마이그레이션

> **이행 기록 · 2026-09-08 대조**: 아래 v0.1.17의 삭제 목록과 diff는 당시 변경을 보존한 기록입니다. 현재 파일 배치·API 계약은 [IPC 핸들러](ipc-handlers.md)와 [Electron / Renderer](electron-renderer.md)를 따릅니다.

## 현재 구현과의 연결

- Electron의 의존성 해결·실제 다운로드·OS 작업은 preload를 통해 main의 IPC 핸들러와 서비스로 연결됩니다. `electron/main.ts`는 등록을 조합하고, 다운로드 실행은 `electron/services/download-orchestrator.ts`, 전달·압축·분할은 `electron/services/download/delivery-pipeline.ts`가 담당합니다.
- 검색·버전·히스토리 접근은 `src/renderer/lib/renderer-data-client.ts`로 모였습니다. Electron IPC를 우선하고, 브라우저 검색·버전 조회에는 HTTP 폴백, 히스토리에는 `localStorage` 폴백이 있습니다. 따라서 아래의 “모든 API가 IPC 전용”이라는 당시 표현을 현재 브라우저 개발 경로 전체에 적용하면 안 됩니다.
- `download:onProgress`는 아래 이행 표의 옛 표기입니다. 현재 preload 메서드는 `window.electronAPI.download.onProgress`, 실제 이벤트 채널은 `download:progress`입니다. 구독 반환 함수로 해제합니다.
- 현재 화면 로직은 `pages/wizard-page/`, `pages/download-page/`, `pages/settings/` 등으로 나뉘어 있습니다. 아래 `DownloadPage.tsx` 등의 diff는 현재 파일에 그대로 적용할 패치가 아닙니다.

## 개요
- 목적: 개발/프로덕션 환경 통합 및 코드 단순화
- 완료 버전: v0.1.17
- 영향 범위: 렌더러 프로세스의 모든 API 호출

---

## 마이그레이션 배경

### 이전 구조 (이중 API)

```
개발 환경 (npm run dev):
  Renderer → HTTP fetch → Vite Plugin (vite-plugin-download-api.ts) → Core

프로덕션 환경 (패키징된 앱):
  Renderer → IPC → Main Process → Core
```

**문제점**:
- 동일 기능을 두 곳에서 구현해야 함 (HTTP API + IPC Handler)
- 개발/프로덕션 환경 간 동작 차이 발생 가능
- Vite 플러그인에서 SSE(Server-Sent Events) 사용으로 인한 복잡성

### 새 구조 (IPC 전용)

```
개발/프로덕션 환경 모두:
  Renderer → IPC → Main Process → Core
```

**장점**:
- 단일 API 구현으로 유지보수 용이
- 환경 간 일관된 동작 보장
- 코드베이스 약 1,500줄 감소

---

## 삭제된 파일

### `vite-plugin-download-api.ts` (1,427줄)

Vite 개발 서버에서 HTTP API를 제공하던 플러그인:

| API 엔드포인트 | 대체 IPC 채널 |
|---------------|--------------|
| `GET /api/pip/search` | `search:packages` |
| `GET /api/maven/versions` | `search:versions` |
| `POST /api/dependency/resolve` | `dependency:resolve` |
| `POST /api/download/start` | `download:start` |
| `GET /api/download/events` (SSE) | `download:onProgress` 등 |
| `POST /api/download/cancel` | `download:cancel` |
| `GET /api/download/check-path` | `download:check-path` |
| `POST /api/download/clear-path` | `download:clear-path` |
| `GET /api/cache/stats` | `cache:stats` |
| `POST /api/cache/clear` | `cache:clear` |
| `GET /api/os/distributions` | `os:getAllDistributions` |
| `POST /api/os/search` | `os:search` |

---

## 수정된 파일

### 1. `vite.config.ts`

```diff
- import { downloadApiPlugin } from './vite-plugin-download-api';

  export default defineConfig({
-   plugins: [react(), swaggerPlugin(), downloadApiPlugin()],
+   plugins: [react(), swaggerPlugin()],
    // ...
  });
```

### 2. `src/renderer/pages/DownloadPage.tsx`

**주요 변경사항**:
- `browserDownload()` 함수 삭제 (SSE 기반 다운로드 로직)
- 환경 분기 (`isDevelopment`) 제거
- IPC 전용 API 호출로 통합

```diff
- const isDevelopment = import.meta.env.DEV;
- if (isDevelopment || !window.electronAPI?.download?.start) {
-   await browserDownload();
- } else {
+ if (!window.electronAPI?.download?.start) {
+   throw new Error('다운로드 API를 사용할 수 없습니다');
+ }
  await window.electronAPI.download.start({ packages, options });
```

**삭제된 기능**:
- SSE EventSource 연결 (`/api/download/events`)
- HTTP fetch 기반 다운로드 시작/취소
- `eventSourceRef`, `clientIdRef` 등 SSE 관련 ref

### 3. `src/renderer/pages/CartPage.tsx`

의존성 해결 API를 IPC 전용으로 변경:

```diff
- if (import.meta.env.DEV) {
-   const response = await fetch('/api/dependency/resolve', {...});
-   result = await response.json();
- } else {
+ if (!window.electronAPI?.dependency?.resolve) {
+   throw new Error('의존성 해결 API를 사용할 수 없습니다');
+ }
  result = await window.electronAPI.dependency.resolve({...});
```

### 4. `src/renderer/pages/SettingsPage.tsx`

캐시 및 배포판 API를 IPC 전용으로 변경:

```diff
  // 캐시 정보 로드
- if (window.electronAPI?.cache?.getStats) {
-   const stats = await window.electronAPI.cache.getStats();
- } else {
-   const response = await fetch('/api/cache/stats');
-   const stats = await response.json();
- }
+ if (!window.electronAPI?.cache?.getStats) {
+   throw new Error('캐시 정보 API를 사용할 수 없습니다');
+ }
+ const stats = await window.electronAPI.cache.getStats();
```

### 5. `src/renderer/pages/WizardPage.tsx`

OS 패키지 검색을 IPC 전용으로 변경:

```diff
- if (window.electronAPI?.os?.search) {
-   result = await window.electronAPI.os.search({...});
- } else {
-   const response = await fetch('/api/os/search', {...});
-   result = await response.json();
- }
+ if (!window.electronAPI?.os?.search) {
+   throw new Error('OS 패키지 검색 API를 사용할 수 없습니다');
+ }
+ result = await window.electronAPI.os.search({...});
```

### 6. `src/renderer/components/os/OSPackageSearch.tsx`

OS 패키지 검색 컴포넌트에서 HTTP 폴백 제거.

### 7. `electron/main.ts`

다운로드 동시성 제어를 위해 `p-limit` 도입:

```typescript
import pLimit from 'p-limit';

// download:start 핸들러 내부
const limit = pLimit(concurrency);
const downloadPromises = allPackages.map((pkg) =>
  limit(() => downloadPackage(pkg))
);
const downloadResults = await Promise.all(downloadPromises);
```

---

## 영향받는 기능

| 기능 | 이전 방식 | 현재 방식 |
|------|----------|----------|
| 패키지 검색 | HTTP GET | IPC `search:packages` |
| 버전 조회 | HTTP GET | IPC `search:versions` |
| 의존성 해결 | HTTP POST | IPC `dependency:resolve` |
| 다운로드 시작 | HTTP POST + SSE | IPC `download:start` + events |
| 다운로드 취소 | HTTP POST | IPC `download:cancel` |
| 진행률 수신 | SSE EventSource | IPC `download:onProgress` |
| 캐시 관리 | HTTP GET/POST | IPC `cache:*` |
| OS 패키지 검색 | HTTP POST | IPC `os:search` |

---

## 개발자 가이드 (현재 호출 경계)

### API 호출 패턴

검색·버전·히스토리는 공용 data client를 사용하고, 실제 다운로드는 Electron IPC의 존재를 확인한 뒤 호출합니다:

```typescript
// 패키지 검색
import { getRendererDataClient } from '../lib/renderer-data-client';

const results = await getRendererDataClient().searchPackages('pip', 'requests');

// 의존성 해결
// packages는 호출부에서 구성한 요청 목록
const resolveOptions = { targetOS: 'linux', architecture: 'x86_64', pythonVersion: '3.12' };
if (!window.electronAPI?.dependency?.resolve || !window.electronAPI?.download?.start) {
  throw new Error('다운로드 API를 사용할 수 없습니다');
}
const deps = await window.electronAPI.dependency.resolve({ packages, options: resolveOptions });

// 진행률은 다운로드 시작 전에 구독
const unsub = window.electronAPI.download.onProgress((progress) => {
  console.log(progress);
});

// 다운로드 시작: 해결된 전체 목록 전달
await window.electronAPI.download.start({
  packages: deps.allPackages,
  options: { outputDir: './output', outputFormat: 'zip', includeScripts: true },
});

// 컴포넌트 effect의 cleanup에서 unsub() 호출
```

### API 사용 가능 여부 확인

다운로드처럼 IPC가 필수인 기능은 API가 없는 환경(예: 순수 브라우저)에서 명확한 에러를 표시합니다. 검색·버전·히스토리의 폴백과 구분합니다:

```typescript
if (!window.electronAPI?.download?.start) {
  throw new Error('다운로드 API를 사용할 수 없습니다');
}
```

---

## 관련 문서

- [Electron & Renderer](./electron-renderer.md)
- [아키텍처 개요](./architecture-overview.md)
