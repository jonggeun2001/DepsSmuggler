import { PassThrough } from 'stream';
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AxiosHttpClient,
  getDefaultHttpClient,
  resetDefaultHttpClient,
  setDefaultHttpClient,
} from './axios-http-client';
import { HttpError } from './http-client';

const transport = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  head: vi.fn(),
}));
vi.mock('axios', () => ({ default: { create: vi.fn(), isAxiosError: vi.fn() } }));

describe('Axios HTTP 어댑터', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetDefaultHttpClient();
    vi.mocked(axios.create).mockReturnValue(transport as never);
    vi.mocked(axios.isAxiosError).mockImplementation((error) => Boolean(error?.isAxiosError));
  });
  afterEach(() => resetDefaultHttpClient());

  it('기본 timeout, redirect 제한 및 사용자 에이전트를 설정한다', () => {
    new AxiosHttpClient();
    expect(axios.create).toHaveBeenCalledWith({
      baseURL: undefined,
      timeout: 30000,
      headers: { 'User-Agent': 'DepsSmuggler/1.0' },
      maxRedirects: 5,
    });
  });

  it('명시한 0 옵션과 사용자 헤더를 덮어쓰지 않는다', () => {
    new AxiosHttpClient({
      baseURL: 'https://registry.example',
      timeout: 0,
      maxRedirects: 0,
      headers: { 'User-Agent': 'custom', Accept: 'application/json' },
    });
    expect(axios.create).toHaveBeenCalledWith({
      baseURL: 'https://registry.example',
      timeout: 0,
      maxRedirects: 0,
      headers: { 'User-Agent': 'custom', Accept: 'application/json' },
    });
  });

  it.each(['get', 'post', 'put', 'delete', 'head'] as const)(
    '%s 응답의 데이터, 상태 및 헤더를 보존한다',
    async (method) => {
      transport[method].mockResolvedValue({
        data: null,
        status: 204,
        statusText: 'No Content',
        headers: { 'X-Token': 'abc', 'Set-Cookie': ['a=1', 'b=2'], ignored: undefined },
      });
      const client = new AxiosHttpClient();
      const result = await client[method]('/packages');
      expect(result).toEqual({
        data: null,
        status: 204,
        statusText: 'No Content',
        headers: { 'x-token': 'abc', 'set-cookie': 'a=1, b=2' },
      });
      if (method === 'post' || method === 'put') {
        expect(transport[method]).toHaveBeenCalledExactlyOnceWith('/packages', undefined, {});
      } else {
        expect(transport[method]).toHaveBeenCalledExactlyOnceWith('/packages', {});
      }
    }
  );

  it.each(['post', 'put'] as const)('%s 요청의 빈 본문을 그대로 전달한다', async (method) => {
    transport[method].mockResolvedValue({ data: {}, status: 200, statusText: 'OK' });
    await new AxiosHttpClient()[method]('/packages', '', { headers: { Accept: 'text/plain' } });
    expect(transport[method]).toHaveBeenCalledWith('/packages', '', {
      headers: { Accept: 'text/plain' },
    });
  });

  it('요청 옵션과 진행률 및 취소 signal을 전달한다', async () => {
    transport.get.mockResolvedValue({ data: 'ok', status: 200, statusText: 'OK' });
    const signal = new AbortController().signal;
    const onDownloadProgress = vi.fn();
    const validateStatus = (status: number) => status < 400;
    await new AxiosHttpClient().get('/packages', {
      params: { q: '', limit: 0, all: false },
      headers: { Accept: 'text/plain' },
      timeout: 0,
      maxRedirects: 0,
      responseType: 'text',
      onDownloadProgress,
      signal,
      validateStatus,
    });
    const config = transport.get.mock.calls[0][1];
    expect(config).toEqual({
      params: { q: '', limit: 0, all: false },
      headers: { Accept: 'text/plain' },
      timeout: 0,
      maxRedirects: 0,
      responseType: 'text',
      onDownloadProgress: expect.any(Function),
      signal,
      validateStatus,
    });
    config.onDownloadProgress({ loaded: 3, total: 6, progress: 0.5, bytes: 3 });
    expect(onDownloadProgress).toHaveBeenCalledExactlyOnceWith({
      loaded: 3,
      total: 6,
      progress: 0.5,
    });
  });

  it('스트림 요청은 responseType을 stream으로 설정한다', async () => {
    const stream = new PassThrough();
    transport.get.mockResolvedValue({ data: stream, status: 200, statusText: 'OK', headers: {} });
    const result = await new AxiosHttpClient().getStream('/large-package', {
      responseType: 'json',
    });
    expect(transport.get).toHaveBeenCalledWith('/large-package', { responseType: 'stream' });
    expect(result.data).toBe(stream);
    stream.destroy();
  });

  it.each(['get', 'post', 'put', 'delete', 'head', 'getStream'] as const)(
    '%s의 인증 거부 상태와 응답을 HttpError로 전달한다',
    async (method) => {
      const denied = {
        isAxiosError: true,
        message: 'Forbidden',
        response: {
          status: 403,
          statusText: 'Forbidden',
          data: { error: 'access denied' },
          headers: { 'X-Request-ID': 'trace-123' },
        },
      };
      transport[method === 'getStream' ? 'get' : method].mockRejectedValue(denied);
      const result = new AxiosHttpClient()[method]('/private');
      await expect(result).rejects.toBeInstanceOf(HttpError);
      await expect(result).rejects.toMatchObject({
        message: 'Forbidden',
        status: 403,
        statusText: 'Forbidden',
        response: { data: { error: 'access denied' }, headers: { 'x-request-id': 'trace-123' } },
      });
    }
  );

  it.each([
    [{ isAxiosError: true, message: 'timeout' }, 'timeout'],
    [new TypeError('invalid URL'), 'invalid URL'],
    ['network offline', 'network offline'],
    [null, 'null'],
  ])('응답 없는 오류를 HttpError로 정규화한다: %s', async (failure, message) => {
    transport.get.mockRejectedValue(failure);
    await expect(new AxiosHttpClient().get('')).rejects.toMatchObject({
      name: 'HttpError',
      message,
      status: undefined,
      response: undefined,
    });
  });

  it('기본 클라이언트 주입과 리셋을 독립적으로 수행한다', () => {
    const initial = getDefaultHttpClient();
    expect(getDefaultHttpClient()).toBe(initial);
    const custom = new AxiosHttpClient({ baseURL: 'https://custom.example' });
    setDefaultHttpClient(custom);
    expect(getDefaultHttpClient()).toBe(custom);
    resetDefaultHttpClient();
    expect(getDefaultHttpClient()).not.toBe(custom);
    expect(axios.create).toHaveBeenCalledTimes(3);
  });
});
