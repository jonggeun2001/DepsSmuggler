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
  get<T>(url: string, options?: RequestOptions): Promise<HttpResponse<T>>;
  post<T>(url: string, data?: unknown, options?: RequestOptions): Promise<HttpResponse<T>>;
  put<T>(url: string, data?: unknown, options?: RequestOptions): Promise<HttpResponse<T>>;
  delete<T>(url: string, options?: RequestOptions): Promise<HttpResponse<T>>;
  head(url: string, options?: RequestOptions): Promise<HttpResponse<void>>;
  getStream(url: string, options?: RequestOptions): Promise<NodeJS.ReadableStream>;
}
```

### RequestOptions

```typescript
interface RequestOptions {
  headers?: Record<string, string>;
  timeout?: number;
  responseType?: 'json' | 'text' | 'arraybuffer' | 'stream';
  onProgress?: (event: ProgressEvent) => void;
}
```

### HttpResponse

```typescript
interface HttpResponse<T> {
  data: T;
  status: number;
  headers: Record<string, string>;
}
```

### ProgressEvent

```typescript
interface ProgressEvent {
  loaded: number;      // 현재 다운로드된 바이트
  total: number;       // 전체 바이트 (알 수 없으면 0)
  percent: number;     // 진행률 (0-100)
}
```

### HttpError

```typescript
class HttpError extends Error {
  status: number;      // HTTP 상태 코드
  statusText: string;  // 상태 메시지
  url: string;         // 요청 URL
  response?: unknown;  // 응답 본문 (있는 경우)
}
```

---

## AxiosHttpClient (`axios-http-client.ts`)

프로덕션용 Axios 기반 구현체:

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
mockClient.onGet('/api/packages').respond({
  data: [{ name: 'lodash', version: '4.17.21' }],
  status: 200
});

// 에러 시뮬레이션
mockClient.onGet('/api/error').reject(new HttpError(500, 'Server Error'));

// 테스트에서 사용
const downloader = new PipDownloader({ httpClient: mockClient });
```

---

## 사용 예시

```typescript
import { AxiosHttpClient } from './shared/axios-http-client';
import type { HttpClient } from './shared/http-client';

class PipDownloader {
  constructor(private httpClient: HttpClient = new AxiosHttpClient()) {}

  async downloadPackage(url: string, destPath: string): Promise<void> {
    const stream = await this.httpClient.getStream(url, {
      onProgress: (event) => {
        console.log(`${event.percent}% 완료`);
      }
    });

    await pipeline(stream, fs.createWriteStream(destPath));
  }
}
```

---

## 관련 문서

- [Shared Utilities 개요](./shared-utilities.md)
- [파일/경로 유틸리티](./shared-file-path.md)
