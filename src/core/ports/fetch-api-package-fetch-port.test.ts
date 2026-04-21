import { describe, expect, it, vi } from 'vitest';
import { FetchApiPackageFetchPort } from './fetch-api-package-fetch-port';

async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];

  return await new Promise((resolve, reject) => {
    stream.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });
    stream.on('error', reject);
  });
}

describe('FetchApiPackageFetchPort', () => {
  it('GET 응답 body를 Node readable stream으로 변환해야 함', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('payload-data', {
        status: 200,
        headers: {
          'content-type': 'application/octet-stream',
        },
      })
    );

    const port = new FetchApiPackageFetchPort({
      fetchImpl,
      defaultHeaders: {
        'x-default-header': 'default-value',
      },
    });

    const stream = await port.fetchPackageFile({
      url: 'https://example.com/package.tgz',
      headers: {
        authorization: 'Bearer token',
      },
      signal: controller.signal,
    });

    await expect(readStream(stream)).resolves.toBe('payload-data');
    expect(fetchImpl).toHaveBeenCalledWith('https://example.com/package.tgz', {
      method: 'GET',
      headers: {
        'x-default-header': 'default-value',
        authorization: 'Bearer token',
      },
      signal: controller.signal,
    });
  });

  it('HEAD 응답 헤더를 표준 PackageHead로 매핑해야 함', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: {
          'content-length': '42',
          'content-type': 'application/gzip',
          etag: '"abc123"',
          'last-modified': 'Mon, 21 Apr 2026 10:00:00 GMT',
        },
      })
    );

    const port = new FetchApiPackageFetchPort({ fetchImpl });

    await expect(
      port.headPackage({
        url: 'https://example.com/packages/pkg.tar.gz',
        signal: controller.signal,
      })
    ).resolves.toEqual({
      url: 'https://example.com/packages/pkg.tar.gz',
      status: 200,
      contentLength: 42,
      contentType: 'application/gzip',
      etag: '"abc123"',
      lastModified: 'Mon, 21 Apr 2026 10:00:00 GMT',
      headers: {
        'content-length': '42',
        'content-type': 'application/gzip',
        etag: '"abc123"',
        'last-modified': 'Mon, 21 Apr 2026 10:00:00 GMT',
      },
    });
    expect(fetchImpl).toHaveBeenCalledWith('https://example.com/packages/pkg.tar.gz', {
      method: 'HEAD',
      headers: {},
      signal: controller.signal,
    });
  });

  it('비정상 HTTP 응답이면 에러를 던져야 함', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 404,
        statusText: 'Not Found',
      })
    );

    const port = new FetchApiPackageFetchPort({ fetchImpl });

    await expect(
      port.fetchPackageFile({
        url: 'https://example.com/missing.tar.gz',
      })
    ).rejects.toThrow('패키지 다운로드 스트림 조회 실패');
  });
});
