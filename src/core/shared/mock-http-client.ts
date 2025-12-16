/**
 * 테스트용 Mock HTTP 클라이언트
 */
import {
  HttpClient,
  HttpResponse,
  RequestOptions,
  HttpError,
} from './http-client';

/**
 * Mock 응답 설정
 */
export interface MockResponse<T = unknown> {
  data: T;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
}

/**
 * Mock 에러 설정
 */
export interface MockErrorConfig {
  message: string;
  status?: number;
  statusText?: string;
}

/**
 * URL 패턴 매처
 */
type UrlMatcher = string | RegExp | ((url: string) => boolean);

/**
 * Mock 핸들러
 */
interface MockHandler<T = unknown> {
  matcher: UrlMatcher;
  response?: MockResponse<T>;
  error?: MockErrorConfig;
  delay?: number;
}

/**
 * 테스트용 Mock HTTP 클라이언트
 */
export class MockHttpClient implements HttpClient {
  private handlers: MockHandler[] = [];
  private callHistory: Array<{ method: string; url: string; options?: RequestOptions }> = [];

  /**
   * GET 요청에 대한 Mock 응답 설정
   */
  onGet<T = unknown>(matcher: UrlMatcher, response: MockResponse<T>): this {
    this.handlers.push({ matcher, response: response as MockResponse });
    return this;
  }

  /**
   * GET 요청에 대한 Mock 에러 설정
   */
  onGetError(matcher: UrlMatcher, error: MockErrorConfig): this {
    this.handlers.push({ matcher, error });
    return this;
  }

  /**
   * POST 요청에 대한 Mock 응답 설정
   */
  onPost<T = unknown>(matcher: UrlMatcher, response: MockResponse<T>): this {
    this.handlers.push({ matcher, response: response as MockResponse });
    return this;
  }

  /**
   * 모든 요청에 대한 기본 응답 설정
   */
  onAny<T = unknown>(response: MockResponse<T>): this {
    this.handlers.push({ matcher: () => true, response: response as MockResponse });
    return this;
  }

  /**
   * 모든 핸들러 제거
   */
  reset(): this {
    this.handlers = [];
    this.callHistory = [];
    return this;
  }

  /**
   * 호출 기록 가져오기
   */
  getCallHistory(): Array<{ method: string; url: string; options?: RequestOptions }> {
    return [...this.callHistory];
  }

  /**
   * 특정 URL이 호출되었는지 확인
   */
  wasCalled(url: string): boolean {
    return this.callHistory.some((call) => call.url === url);
  }

  /**
   * 호출 횟수 가져오기
   */
  getCallCount(): number {
    return this.callHistory.length;
  }

  private matchUrl(url: string, matcher: UrlMatcher): boolean {
    if (typeof matcher === 'string') {
      return url === matcher || url.includes(matcher);
    }
    if (matcher instanceof RegExp) {
      return matcher.test(url);
    }
    return matcher(url);
  }

  private findHandler(url: string): MockHandler | undefined {
    return this.handlers.find((handler) => this.matchUrl(url, handler.matcher));
  }

  private async executeHandler<T>(
    method: string,
    url: string,
    options?: RequestOptions
  ): Promise<HttpResponse<T>> {
    this.callHistory.push({ method, url, options });

    const handler = this.findHandler(url);

    if (!handler) {
      throw new HttpError(`No mock handler for ${method} ${url}`, 404, 'Not Found');
    }

    if (handler.delay) {
      await new Promise((resolve) => setTimeout(resolve, handler.delay));
    }

    if (handler.error) {
      throw new HttpError(
        handler.error.message,
        handler.error.status,
        handler.error.statusText
      );
    }

    if (handler.response) {
      return {
        data: handler.response.data as T,
        status: handler.response.status ?? 200,
        statusText: handler.response.statusText ?? 'OK',
        headers: handler.response.headers ?? {},
      };
    }

    throw new HttpError(`Invalid mock handler for ${url}`);
  }

  async get<T = unknown>(url: string, options?: RequestOptions): Promise<HttpResponse<T>> {
    return this.executeHandler<T>('GET', url, options);
  }

  async post<T = unknown>(
    url: string,
    _data?: unknown,
    options?: RequestOptions
  ): Promise<HttpResponse<T>> {
    return this.executeHandler<T>('POST', url, options);
  }

  async put<T = unknown>(
    url: string,
    _data?: unknown,
    options?: RequestOptions
  ): Promise<HttpResponse<T>> {
    return this.executeHandler<T>('PUT', url, options);
  }

  async delete<T = unknown>(url: string, options?: RequestOptions): Promise<HttpResponse<T>> {
    return this.executeHandler<T>('DELETE', url, options);
  }

  async head(url: string, options?: RequestOptions): Promise<HttpResponse<void>> {
    return this.executeHandler<void>('HEAD', url, options);
  }

  async getStream(
    url: string,
    options?: RequestOptions
  ): Promise<HttpResponse<NodeJS.ReadableStream>> {
    return this.executeHandler<NodeJS.ReadableStream>('GET_STREAM', url, options);
  }
}
