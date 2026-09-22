import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRendererDataClient } from './renderer-data-client';
import { requestQueryJson } from './query-http';
import { toQueryFailure } from '../../utils/query-error';

afterEach(() => vi.useRealTimers());

describe('renderer query failures', () => {
  it('keeps successful empty IPC results separate from structured failures', async () => {
    const packages = vi
      .fn()
      .mockResolvedValueOnce({ results: [] })
      .mockResolvedValue({ results: [], error: { code: 'TLS_CERTIFICATE' } });
    const versions = vi.fn().mockResolvedValue({ versions: [], error: { code: 'TIMEOUT' } });
    const fetchImpl = vi.fn();
    const client = createRendererDataClient({
      electronAPI: { search: { packages, versions } },
      fetchImpl,
    });
    expect(await client.searchPackages('maven', 'absent')).toEqual([]);
    await expect(client.searchPackages('maven', 'deequ')).rejects.toMatchObject({
      failure: { code: 'TLS_CERTIFICATE' },
    });
    await expect(client.getVersions('maven', 'g:a', undefined, ['1.0'])).rejects.toMatchObject({
      failure: { code: 'TIMEOUT' },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([400, 401, 404, 429, 500, 503])(
    'reports HTTP %i on search and version lookup',
    async (status) => {
      const client = createRendererDataClient({
        fetchImpl: vi.fn().mockResolvedValue({ ok: false, status }),
      });
      await expect(client.searchPackages('maven', 'deequ')).rejects.toMatchObject({
        failure: { code: 'HTTP', status },
      });
      await expect(client.getVersions('maven', 'g:a', undefined, ['1.0'])).rejects.toMatchObject({
        failure: { code: 'HTTP', status },
      });
    }
  );

  it.each(['pip', 'conda', 'maven', 'npm', 'docker'] as const)(
    'reports malformed %s responses and transport rejections',
    async (type) => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ unexpected: [] }) });
      const client = createRendererDataClient({ fetchImpl });
      await expect(client.searchPackages(type, 'test')).rejects.toMatchObject({
        failure: { code: 'INVALID_RESPONSE' },
      });
      await expect(client.getVersions(type, 'test')).rejects.toMatchObject({
        failure: { code: 'INVALID_RESPONSE' },
      });
      fetchImpl.mockResolvedValue({
        ok: true,
        json: async () => {
          throw new SyntaxError('HTML instead of JSON');
        },
      });
      await expect(client.searchPackages(type, 'test')).rejects.toMatchObject({
        failure: { code: 'INVALID_RESPONSE' },
      });
      fetchImpl.mockRejectedValue(new TypeError('Failed to fetch'));
      await client
        .searchPackages(type, 'test')
        .catch((error) => expect(toQueryFailure(error).code).toBe('NETWORK'));
    }
  );

  it('aborts an HTTP request that never responds', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_url, options) =>
        new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );
    const check = expect(requestQueryJson(fetchImpl, '/test')).rejects.toMatchObject({
      failure: { code: 'TIMEOUT' },
    });
    await vi.advanceTimersByTimeAsync(15000);
    await check;
  });
});
