/**
 * Axios 기반 HTTP 클라이언트 구현
 */
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import {
  HttpClient,
  HttpResponse,
  RequestOptions,
  HttpError,
  ProgressEvent,
} from './http-client';

/**
 * AxiosHttpClient 옵션
 */
export interface AxiosHttpClientOptions {
  baseURL?: string;
  timeout?: number;
  headers?: Record<string, string>;
  maxRedirects?: number;
}

/**
 * Axios 기반 HttpClient 구현
 */
export class AxiosHttpClient implements HttpClient {
  private readonly instance: AxiosInstance;

  constructor(options?: AxiosHttpClientOptions) {
    this.instance = axios.create({
      baseURL: options?.baseURL,
      timeout: options?.timeout ?? 30000,
      headers: {
        'User-Agent': 'DepsSmuggler/1.0',
        ...options?.headers,
      },
      maxRedirects: options?.maxRedirects ?? 5,
    });
  }

  /**
   * RequestOptions를 AxiosRequestConfig로 변환
   */
  private toAxiosConfig(options?: RequestOptions): AxiosRequestConfig {
    if (!options) return {};

    const config: AxiosRequestConfig = {};

    if (options.params) {
      config.params = options.params;
    }

    if (options.headers) {
      config.headers = options.headers;
    }

    if (options.timeout !== undefined) {
      config.timeout = options.timeout;
    }

    if (options.responseType) {
      config.responseType = options.responseType;
    }

    if (options.onDownloadProgress) {
      config.onDownloadProgress = (event) => {
        const progressEvent: ProgressEvent = {
          loaded: event.loaded,
          total: event.total,
          progress: event.progress,
        };
        options.onDownloadProgress!(progressEvent);
      };
    }

    if (options.signal) {
      config.signal = options.signal;
    }

    if (options.maxRedirects !== undefined) {
      config.maxRedirects = options.maxRedirects;
    }

    if (options.validateStatus) {
      config.validateStatus = options.validateStatus;
    }

    return config;
  }

  /**
   * AxiosResponse를 HttpResponse로 변환
   */
  private toHttpResponse<T>(response: AxiosResponse<T>): HttpResponse<T> {
    const headers: Record<string, string> = {};

    // axios 헤더를 일반 객체로 변환
    if (response.headers) {
      Object.entries(response.headers).forEach(([key, value]) => {
        if (typeof value === 'string') {
          headers[key.toLowerCase()] = value;
        } else if (Array.isArray(value)) {
          headers[key.toLowerCase()] = value.join(', ');
        }
      });
    }

    return {
      data: response.data,
      status: response.status,
      statusText: response.statusText,
      headers,
    };
  }

  /**
   * Axios 에러를 HttpError로 변환
   */
  private toHttpError(error: unknown): HttpError {
    if (axios.isAxiosError(error)) {
      const response = error.response
        ? this.toHttpResponse(error.response)
        : undefined;

      return new HttpError(
        error.message,
        error.response?.status,
        error.response?.statusText,
        response
      );
    }

    if (error instanceof Error) {
      return new HttpError(error.message);
    }

    return new HttpError(String(error));
  }

  async get<T = unknown>(url: string, options?: RequestOptions): Promise<HttpResponse<T>> {
    try {
      const response = await this.instance.get<T>(url, this.toAxiosConfig(options));
      return this.toHttpResponse(response);
    } catch (error) {
      throw this.toHttpError(error);
    }
  }

  async post<T = unknown>(
    url: string,
    data?: unknown,
    options?: RequestOptions
  ): Promise<HttpResponse<T>> {
    try {
      const response = await this.instance.post<T>(url, data, this.toAxiosConfig(options));
      return this.toHttpResponse(response);
    } catch (error) {
      throw this.toHttpError(error);
    }
  }

  async put<T = unknown>(
    url: string,
    data?: unknown,
    options?: RequestOptions
  ): Promise<HttpResponse<T>> {
    try {
      const response = await this.instance.put<T>(url, data, this.toAxiosConfig(options));
      return this.toHttpResponse(response);
    } catch (error) {
      throw this.toHttpError(error);
    }
  }

  async delete<T = unknown>(url: string, options?: RequestOptions): Promise<HttpResponse<T>> {
    try {
      const response = await this.instance.delete<T>(url, this.toAxiosConfig(options));
      return this.toHttpResponse(response);
    } catch (error) {
      throw this.toHttpError(error);
    }
  }

  async head(url: string, options?: RequestOptions): Promise<HttpResponse<void>> {
    try {
      const response = await this.instance.head(url, this.toAxiosConfig(options));
      return this.toHttpResponse(response);
    } catch (error) {
      throw this.toHttpError(error);
    }
  }

  async getStream(
    url: string,
    options?: RequestOptions
  ): Promise<HttpResponse<NodeJS.ReadableStream>> {
    try {
      const config = this.toAxiosConfig(options);
      config.responseType = 'stream';

      const response = await this.instance.get<NodeJS.ReadableStream>(url, config);
      return this.toHttpResponse(response);
    } catch (error) {
      throw this.toHttpError(error);
    }
  }
}

/**
 * 기본 HTTP 클라이언트 인스턴스
 * 싱글톤 패턴으로 재사용
 */
let defaultHttpClient: HttpClient | null = null;

/**
 * 기본 HTTP 클라이언트 가져오기
 */
export function getDefaultHttpClient(): HttpClient {
  if (!defaultHttpClient) {
    defaultHttpClient = new AxiosHttpClient();
  }
  return defaultHttpClient;
}

/**
 * 기본 HTTP 클라이언트 설정 (테스트용)
 */
export function setDefaultHttpClient(client: HttpClient): void {
  defaultHttpClient = client;
}

/**
 * 기본 HTTP 클라이언트 리셋 (테스트용)
 */
export function resetDefaultHttpClient(): void {
  defaultHttpClient = null;
}
