# HTTP API에서 IPC로의 마이그레이션

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

## 개발자 가이드

### API 호출 패턴

모든 렌더러 코드에서 IPC API를 사용합니다:

```typescript
// 패키지 검색
const { results } = await window.electronAPI.search.packages('pip', 'requests');

// 의존성 해결
const deps = await window.electronAPI.dependency.resolve({ packages, options });

// 다운로드 시작
await window.electronAPI.download.start({ packages, options });

// 진행률 수신
const unsub = window.electronAPI.download.onProgress((progress) => {
  console.log(progress);
});
```

### API 사용 가능 여부 확인

IPC API가 없는 환경(예: 순수 브라우저)에서는 명확한 에러를 표시합니다:

```typescript
if (!window.electronAPI?.download?.start) {
  throw new Error('다운로드 API를 사용할 수 없습니다');
}
```

---

## 관련 문서

- [Electron & Renderer](./electron-renderer.md)
- [아키텍처 개요](./architecture-overview.md)
