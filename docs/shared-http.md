# HTTP 클라이언트

## 개요
- 목적: HTTP 요청을 위한 추상화 레이어로, 구현체 교체 및 테스트 용이성 제공
- 위치: `src/core/shared/http-client.ts`, `axios-http-client.ts`, `mock-http-client.ts`

---

## 모듈 구조

```
src/core/shared/
├── http-client.ts        # HttpClient 인터페이스 정의
├── axios-http-client.ts  # Axios 기반 구현체
└── mock-http-client.ts   # 테스트용 Mock 구현체
```

---

## HttpClient 인터페이스 (`http-client.ts`)

```typescript
interface HttpClient {
  /**
   * GET 요청
   */
  get<T = unknown>(url: string, options?: RequestOptions): Promise<HttpResponse<T>>;

  /**
   * POST 요청
   */
  post<T = unknown>(url: string, data?: unknown, options?: RequestOptions): Promise<HttpResponse<T>>;

  /**
   * PUT 요청
   */
  put<T = unknown>(url: string, data?: unknown, options?: RequestOptions): Promise<HttpResponse<T>>;

  /**
   * DELETE 요청
   */
  delete<T = unknown>(url: string, options?: RequestOptions): Promise<HttpResponse<T>>;

  /**
   * HEAD 요청 (헤더만 조회)
   */
  head(url: string, options?: RequestOptions): Promise<HttpResponse<void>>;

  /**
   * 스트림 다운로드 (큰 파일 다운로드용)
   */
  getStream(url: string, options?: RequestOptions): Promise<HttpResponse<NodeJS.ReadableStream>>;
}
```

### RequestOptions

```typescript
interface RequestOptions {
  params?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
  timeout?: number;
  responseType?: 'json' | 'arraybuffer' | 'stream' | 'text';
  onDownloadProgress?: (progressEvent: ProgressEvent) => void;
  signal?: AbortSignal;
  maxRedirects?: number;
  validateStatus?: (status: number) => boolean;
}
```

### HttpResponse

```typescript
interface HttpResponse<T> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
}
```

### ProgressEvent

```typescript
interface ProgressEvent {
  loaded: number;
  total?: number;
  progress?: number;
}
```

### HttpError

```typescript
class HttpError extends Error {
  constructor(
    message: string,
    status?: number,
    statusText?: string,
    response?: HttpResponse<unknown>
  );
  isClientError(): boolean;
  isServerError(): boolean;
  isNotFound(): boolean;
}
```

`status`, `statusText`, `response`는 읽기 전용 선택 필드입니다. 네트워크 오류에는 HTTP 상태가 없을 수 있습니다. `ProgressEvent.progress`는 Axios에서 전달하는 0~1 비율이며, 전체 크기를 모를 때 `total`과 `progress`는 없을 수 있습니다.

---

## AxiosHttpClient (`axios-http-client.ts`)

프로덕션용 Axios 기반 구현체입니다. 기본 타임아웃은 30초, 최대 리다이렉트는 5회이며 `baseURL`, `headers`, `timeout`, `maxRedirects`를 생성자에서 설정할 수 있습니다. `getDefaultHttpClient()`는 공유 인스턴스를 반환하고 테스트에서는 `setDefaultHttpClient()`와 `resetDefaultHttpClient()`로 교체·초기화합니다.

```typescript
import { AxiosHttpClient } from './axios-http-client';

const client = new AxiosHttpClient({
  timeout: 30000,
  headers: { 'User-Agent': 'DepsSmuggler/1.0' }
});

const response = await client.get('https://api.example.com/data');
```

---

## MockHttpClient (`mock-http-client.ts`)

테스트용 Mock 구현체:

```typescript
import { MockHttpClient } from './mock-http-client';

const mockClient = new MockHttpClient();

// 응답 설정
mockClient.onGet('/api/packages', {
  data: [{ name: 'lodash', version: '4.17.21' }],
  status: 200
});

// 에러 시뮬레이션
mockClient.onGetError('/api/error', { message: 'Server Error', status: 500 });

// 호출 및 기록 확인
const response = await mockClient.get('/api/packages');
console.log(response.data, mockClient.getCallCount());
```

---

Mock은 URL의 문자열·정규식·조건 함수로 첫 핸들러를 선택합니다. 현재 핸들러 매칭은 HTTP 메서드를 구분하지 않으며 `getCallHistory()`에는 메서드와 옵션이 기록됩니다. `onPost()`, `onAny()`, `reset()`, `wasCalled()`도 제공합니다.

## 사용 예시

아래 클래스는 인터페이스 활용을 보여주는 독립 예시입니다.

```typescript
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { AxiosHttpClient } from './shared/axios-http-client';
import type { HttpClient } from './shared/http-client';

class ExampleDownloader {
  constructor(private httpClient: HttpClient = new AxiosHttpClient()) {}

  async downloadPackage(url: string, destPath: string): Promise<void> {
    const response = await this.httpClient.getStream(url, {
      onDownloadProgress: (event) => {
        if (event.progress !== undefined) console.log(`${event.progress * 100}% 완료`);
      }
    });

    await pipeline(response.data, createWriteStream(destPath));
  }
}
```

---

## 관련 문서

- [Shared Utilities 개요](./shared-utilities.md)
- [파일/경로 유틸리티](./shared-file-path.md)
