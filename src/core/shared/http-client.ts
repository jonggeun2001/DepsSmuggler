/**
 * HTTP 클라이언트 인터페이스
 * 의존성 역전 원칙(DIP)을 적용하여 HTTP 클라이언트를 추상화합니다.
 */

/**
 * HTTP 요청 옵션
 */
export interface RequestOptions {
  params?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
  timeout?: number;
  responseType?: 'json' | 'arraybuffer' | 'stream' | 'text';
  onDownloadProgress?: (progressEvent: ProgressEvent) => void;
  signal?: AbortSignal;
  maxRedirects?: number;
  validateStatus?: (status: number) => boolean;
}

/**
 * 다운로드 진행 이벤트
 */
export interface ProgressEvent {
  loaded: number;
  total?: number;
  progress?: number;
}

/**
 * HTTP 응답
 */
export interface HttpResponse<T> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

/**
 * HTTP 클라이언트 인터페이스
 * 모든 HTTP 클라이언트 구현체는 이 인터페이스를 따라야 합니다.
 */
export interface HttpClient {
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

/**
 * HTTP 에러
 */
export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly statusText?: string,
    public readonly response?: HttpResponse<unknown>
  ) {
    super(message);
    this.name = 'HttpError';
  }

  /**
   * 상태 코드가 4xx인지 확인
   */
  isClientError(): boolean {
    return this.status !== undefined && this.status >= 400 && this.status < 500;
  }

  /**
   * 상태 코드가 5xx인지 확인
   */
  isServerError(): boolean {
    return this.status !== undefined && this.status >= 500 && this.status < 600;
  }

  /**
   * 404 Not Found인지 확인
   */
  isNotFound(): boolean {
    return this.status === 404;
  }
}
