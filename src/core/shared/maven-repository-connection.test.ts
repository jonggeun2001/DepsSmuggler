import * as http from 'node:http';
import { PassThrough } from 'node:stream';
import axios from 'axios';
import { afterEach, expect, it, vi } from 'vitest';
import { testMavenRepositoryConnection } from './maven-repositories';

afterEach(() => vi.restoreAllMocks());

it.each([
  '',
  'repo.example.com',
  'file:///tmp/repo',
  'https://user:secret@repo.example.com',
  'https://repo.example.com?token=secret',
])('rejects invalid URLs without a request: %s', async (url) => {
  const get = vi.spyOn(axios, 'get');
  expect((await testMavenRepositoryConnection(url)).success).toBe(false);
  expect(get).not.toHaveBeenCalled();
});

it('checks the normalized URL once and closes the response stream', async () => {
  const stream = new PassThrough();
  const get = vi.spyOn(axios, 'get').mockResolvedValue({ status: 200, data: stream });
  expect(await testMavenRepositoryConnection(' https://repo.example.com/releases/// ')).toEqual({
    success: true,
    status: 200,
    repositoryUrl: 'https://repo.example.com/releases',
    message: '연결 성공 (HTTP 200)',
  });
  expect(get).toHaveBeenCalledExactlyOnceWith(
    'https://repo.example.com/releases/',
    expect.objectContaining({
      responseType: 'stream',
      timeout: 10000,
      maxRedirects: 5,
      signal: expect.any(AbortSignal),
    })
  );
  expect(stream.destroyed).toBe(true);
});

it.each([401, 403, 404, 500])(
  'reports HTTP %s without trying Central or another URL',
  async (status) => {
    const stream = new PassThrough();
    const get = vi.spyOn(axios, 'get').mockResolvedValue({ status, data: stream });
    const result = await testMavenRepositoryConnection('https://repo.example.com/releases');
    expect(result).toMatchObject({
      success: false,
      status,
      message: expect.stringContaining(`HTTP ${status}`),
    });
    expect(get).toHaveBeenCalledTimes(1);
    expect(stream.destroyed).toBe(true);
  }
);

it.each([
  ['ENOTFOUND', '연결하지 못했습니다'],
  ['ECONNABORTED', '시간이 초과'],
  ['SELF_SIGNED_CERT_IN_CHAIN', '인증서를 신뢰'],
])('reports %s using a safe user message', async (code, message) => {
  vi.spyOn(axios, 'get').mockRejectedValue({ code, message: 'internal sensitive request details' });
  const result = await testMavenRepositoryConnection('https://repo.example.com/releases');
  expect(result).toMatchObject({ success: false, message: expect.stringContaining(message) });
  expect(result.message).not.toContain('sensitive');
});

it('reports the deadline cancellation as a timeout', async () => {
  vi.spyOn(axios, 'get').mockRejectedValue(new axios.CanceledError());
  expect(await testMavenRepositoryConnection('https://repo.example.com')).toMatchObject({
    success: false,
    message: expect.stringContaining('시간이 초과'),
  });
});

it('follows a real redirect and finishes on headers without downloading an unfinished body', async () => {
  const requests: string[] = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url || '');
    if (request.url === '/repo/') {
      response.writeHead(302, { Location: '/final/' }).end();
    } else {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.flushHeaders();
      response.write('Repository listing');
      // Deliberately no response.end(): the client must close after headers.
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  try {
    const result = await testMavenRepositoryConnection(`http://127.0.0.1:${address.port}/repo`);
    expect(result).toMatchObject({ success: true, status: 200 });
    expect(requests).toEqual(['/repo/', '/final/']);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it.skipIf(process.env.DEPS_SMUGGLER_ALFRESCO_TEST !== '1')(
  'connects to the real Alfresco repository',
  async () => {
    expect(
      await testMavenRepositoryConnection(
        'https://artifacts.alfresco.com/nexus/content/repositories/public/'
      )
    ).toMatchObject({
      success: true,
      status: 200,
      repositoryUrl: 'https://artifacts.alfresco.com/nexus/content/repositories/public',
    });
  },
  15000
);
