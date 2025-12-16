/**
 * HTTP 클라이언트 테스트
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { HttpError } from './http-client';
import { MockHttpClient } from './mock-http-client';
import { AxiosHttpClient, getDefaultHttpClient, setDefaultHttpClient, resetDefaultHttpClient } from './axios-http-client';

describe('HttpError', () => {
  it('에러 메시지와 상태 코드를 포함해야 함', () => {
    const error = new HttpError('Not Found', 404, 'Not Found');
    expect(error.message).toBe('Not Found');
    expect(error.status).toBe(404);
    expect(error.statusText).toBe('Not Found');
  });

  it('isNotFound()가 404에서 true를 반환해야 함', () => {
    const error = new HttpError('Not Found', 404);
    expect(error.isNotFound()).toBe(true);
  });

  it('isClientError()가 4xx에서 true를 반환해야 함', () => {
    expect(new HttpError('Bad Request', 400).isClientError()).toBe(true);
    expect(new HttpError('Forbidden', 403).isClientError()).toBe(true);
    expect(new HttpError('Not Found', 404).isClientError()).toBe(true);
    expect(new HttpError('Internal Server Error', 500).isClientError()).toBe(false);
  });

  it('isServerError()가 5xx에서 true를 반환해야 함', () => {
    expect(new HttpError('Internal Server Error', 500).isServerError()).toBe(true);
    expect(new HttpError('Bad Gateway', 502).isServerError()).toBe(true);
    expect(new HttpError('Not Found', 404).isServerError()).toBe(false);
  });
});

describe('MockHttpClient', () => {
  let mockClient: MockHttpClient;

  beforeEach(() => {
    mockClient = new MockHttpClient();
  });

  describe('onGet', () => {
    it('문자열 URL 매칭으로 응답을 반환해야 함', async () => {
      mockClient.onGet('https://api.example.com/data', { data: { message: 'Hello' } });

      const response = await mockClient.get('https://api.example.com/data');

      expect(response.data).toEqual({ message: 'Hello' });
      expect(response.status).toBe(200);
    });

    it('RegExp URL 매칭으로 응답을 반환해야 함', async () => {
      mockClient.onGet(/example\.com/, { data: { matched: true } });

      const response = await mockClient.get('https://api.example.com/anything');

      expect(response.data).toEqual({ matched: true });
    });

    it('함수 매칭으로 응답을 반환해야 함', async () => {
      mockClient.onGet(
        (url) => url.includes('special'),
        { data: { special: true } }
      );

      const response = await mockClient.get('https://api.example.com/special/endpoint');

      expect(response.data).toEqual({ special: true });
    });
  });

  describe('onGetError', () => {
    it('에러를 반환해야 함', async () => {
      mockClient.onGetError('https://api.example.com/error', {
        message: 'Server Error',
        status: 500,
      });

      await expect(mockClient.get('https://api.example.com/error'))
        .rejects.toThrow('Server Error');
    });
  });

  describe('onAny', () => {
    it('모든 요청에 대해 응답을 반환해야 함', async () => {
      mockClient.onAny({ data: { default: true } });

      const response1 = await mockClient.get('https://any-url.com/1');
      const response2 = await mockClient.get('https://other-url.com/2');

      expect(response1.data).toEqual({ default: true });
      expect(response2.data).toEqual({ default: true });
    });
  });

  describe('호출 기록', () => {
    it('getCallHistory로 호출 기록을 확인할 수 있어야 함', async () => {
      mockClient.onAny({ data: {} });

      await mockClient.get('https://api.example.com/first');
      await mockClient.get('https://api.example.com/second');

      const history = mockClient.getCallHistory();
      expect(history).toHaveLength(2);
      expect(history[0].url).toBe('https://api.example.com/first');
      expect(history[1].url).toBe('https://api.example.com/second');
    });

    it('wasCalled로 URL 호출 여부를 확인할 수 있어야 함', async () => {
      mockClient.onAny({ data: {} });

      await mockClient.get('https://api.example.com/called');

      expect(mockClient.wasCalled('https://api.example.com/called')).toBe(true);
      expect(mockClient.wasCalled('https://api.example.com/not-called')).toBe(false);
    });

    it('getCallCount로 호출 횟수를 확인할 수 있어야 함', async () => {
      mockClient.onAny({ data: {} });

      expect(mockClient.getCallCount()).toBe(0);

      await mockClient.get('https://api.example.com/1');
      await mockClient.get('https://api.example.com/2');

      expect(mockClient.getCallCount()).toBe(2);
    });

    it('reset으로 핸들러와 기록을 초기화할 수 있어야 함', async () => {
      mockClient.onAny({ data: {} });
      await mockClient.get('https://api.example.com/test');

      mockClient.reset();

      expect(mockClient.getCallCount()).toBe(0);
      await expect(mockClient.get('https://api.example.com/test'))
        .rejects.toThrow();
    });
  });

  describe('다양한 HTTP 메서드', () => {
    beforeEach(() => {
      mockClient.onAny({ data: { success: true } });
    });

    it('POST 요청을 처리해야 함', async () => {
      const response = await mockClient.post('https://api.example.com/data', { body: 'test' });
      expect(response.data).toEqual({ success: true });
    });

    it('PUT 요청을 처리해야 함', async () => {
      const response = await mockClient.put('https://api.example.com/data', { body: 'test' });
      expect(response.data).toEqual({ success: true });
    });

    it('DELETE 요청을 처리해야 함', async () => {
      const response = await mockClient.delete('https://api.example.com/data');
      expect(response.data).toEqual({ success: true });
    });

    it('HEAD 요청을 처리해야 함', async () => {
      const response = await mockClient.head('https://api.example.com/data');
      expect(response.status).toBe(200);
    });
  });
});

describe('AxiosHttpClient', () => {
  it('인스턴스를 생성할 수 있어야 함', () => {
    const client = new AxiosHttpClient();
    expect(client).toBeDefined();
  });

  it('옵션으로 생성할 수 있어야 함', () => {
    const client = new AxiosHttpClient({
      baseURL: 'https://api.example.com',
      timeout: 5000,
      headers: { 'Custom-Header': 'value' },
    });
    expect(client).toBeDefined();
  });
});

describe('기본 HTTP 클라이언트', () => {
  beforeEach(() => {
    resetDefaultHttpClient();
  });

  it('getDefaultHttpClient가 싱글톤 인스턴스를 반환해야 함', () => {
    const client1 = getDefaultHttpClient();
    const client2 = getDefaultHttpClient();
    expect(client1).toBe(client2);
  });

  it('setDefaultHttpClient로 클라이언트를 교체할 수 있어야 함', () => {
    const mockClient = new MockHttpClient();
    setDefaultHttpClient(mockClient);

    const client = getDefaultHttpClient();
    expect(client).toBe(mockClient);
  });

  it('resetDefaultHttpClient 후 새 인스턴스가 생성되어야 함', () => {
    const client1 = getDefaultHttpClient();
    resetDefaultHttpClient();
    const client2 = getDefaultHttpClient();
    expect(client1).not.toBe(client2);
  });
});
