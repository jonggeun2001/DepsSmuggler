import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DockerAuthClient } from './docker-auth-client';
import { DockerManifestService } from './docker-manifest-service';
import type { DockerManifest, DockerManifestEntry } from './docker-types';

vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('../../utils/logger', () => ({ default: { error: vi.fn(), debug: vi.fn() } }));

const get = vi.mocked(axios.get);
const single: DockerManifest = {
  schemaVersion: 2,
  mediaType: 'application/vnd.oci.image.manifest.v1+json',
  layers: [],
};
function entry(arch: string, os = 'linux', variant?: string): DockerManifestEntry {
  return {
    mediaType: single.mediaType,
    size: 123,
    digest: `sha256:${os}-${arch}-${variant || 'default'}`,
    platform: { architecture: arch, os, ...(variant ? { variant } : {}) },
  };
}
function index(manifests: DockerManifestEntry[]): DockerManifest {
  return { schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests };
}

describe('DockerManifestService', () => {
  let service: DockerManifestService;
  beforeEach(() => {
    vi.resetAllMocks();
    service = new DockerManifestService(new DockerAuthClient());
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(['token', ''])(
    'requests all Docker/OCI media types and adds authorization only for a nonempty token (%j)',
    async (token) => {
      get.mockResolvedValue({ data: single });
      await expect(service.getManifest('library/nginx', 'latest', token)).resolves.toBe(single);
      expect(get).toHaveBeenCalledExactlyOnceWith(
        'https://registry-1.docker.io/v2/library/nginx/manifests/latest',
        {
          headers: {
            Accept: [
              'application/vnd.docker.distribution.manifest.v2+json',
              'application/vnd.docker.distribution.manifest.list.v2+json',
              'application/vnd.oci.image.manifest.v1+json',
              'application/vnd.oci.image.index.v1+json',
            ].join(', '),
            ...(token ? { Authorization: 'Bearer token' } : {}),
          },
        }
      );
    }
  );

  it('selects the requested Linux architecture and variant, skipping Windows and other variants', async () => {
    const selected = entry('arm', 'linux', 'v7');
    get
      .mockResolvedValueOnce({
        data: index([entry('arm', 'windows', 'v7'), entry('arm', 'linux', 'v6'), selected]),
      })
      .mockResolvedValueOnce({ data: single });

    await expect(
      service.getManifestForArchitecture('team/image', 'v1', 'token', 'ghcr.io', 'arm', 'v7')
    ).resolves.toBe(single);
    expect(get.mock.calls.map(([url]) => url)).toEqual([
      'https://ghcr.io/v2/team/image/manifests/v1',
      `https://ghcr.io/v2/team/image/manifests/${selected.digest}`,
    ]);
    expect(get.mock.calls[1][1]?.headers).toMatchObject({ Authorization: 'Bearer token' });
  });

  it('accepts any Linux variant when none is specified and returns undefined for a single manifest', () => {
    const selected = entry('arm', 'linux', 'v6');
    expect(
      service.findArchitectureManifest(
        index([entry('arm', 'windows'), selected, entry('arm', 'linux', 'v7')]),
        'arm'
      )
    ).toBe(selected);
    expect(service.findArchitectureManifest(single, 'amd64')).toBeUndefined();
    expect(service.findArchitectureManifest(index([]), 'amd64')).toBeUndefined();
  });

  it('returns a single-platform manifest without a second request', async () => {
    get.mockResolvedValue({ data: single });
    await expect(
      service.getManifestForArchitecture(
        'team/image',
        'sha256:config',
        '',
        'registry.example.test',
        'amd64'
      )
    ).resolves.toBe(single);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('reports available platforms when the requested variant is unavailable', async () => {
    get.mockResolvedValue({
      data: index([entry('amd64'), entry('arm', 'linux', 'v6'), entry('arm64', 'windows')]),
    });
    await expect(
      service.getManifestForArchitecture('team/image', 'v1', '', 'quay.io', 'arm', 'v7')
    ).rejects.toThrow(
      '아키텍처 arm/v7를 지원하지 않습니다. 지원 아키텍처: linux/amd64, linux/arm/v6, windows/arm64'
    );
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('rejects an empty multi-platform index without attempting a digest request', async () => {
    get.mockResolvedValue({ data: index([]) });
    await expect(
      service.getManifestForArchitecture('team/image', 'v1', '', 'quay.io', 'amd64')
    ).rejects.toThrow('아키텍처 amd64를 지원하지 않습니다.');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it.each([401, 404])('preserves a registry HTTP %i error', async (status) => {
    const failure = Object.assign(new Error('registry rejected manifest'), {
      response: { status },
    });
    get.mockRejectedValue(failure);
    await expect(
      service.getManifestForArchitecture('team/image', 'v1', 'bad-token', 'ghcr.io', 'amd64')
    ).rejects.toBe(failure);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('preserves failure when fetching the selected platform digest', async () => {
    const failure = new Error('digest missing');
    get.mockResolvedValueOnce({ data: index([entry('amd64')]) }).mockRejectedValueOnce(failure);
    await expect(
      service.getManifestForArchitecture('team/image', 'v1', '', 'ghcr.io', 'amd64')
    ).rejects.toBe(failure);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('forwards signal to both index and selected manifest requests', async () => {
    const controller = new AbortController();
    const selected = entry('amd64');
    get
      .mockResolvedValueOnce({ data: index([selected]) })
      .mockResolvedValueOnce({ data: single });

    await service.getManifestForArchitecture(
      'team/image', 'v1', 'token', 'ghcr.io', 'amd64', undefined, { signal: controller.signal }
    );

    expect(get.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
    expect(get.mock.calls[1][1]).toMatchObject({ signal: controller.signal });
  });

  it('uses a refreshed token for both index and selected manifest requests', async () => {
    const selected = entry('amd64');
    get
      .mockResolvedValueOnce({ data: index([selected]) })
      .mockResolvedValueOnce({ data: single });
    const getAuthToken = vi.fn()
      .mockResolvedValueOnce('index-token')
      .mockResolvedValueOnce('selected-token');
    const options = { getAuthToken };

    await service.getManifestForArchitecture(
      'team/image', 'v1', 'stale-token', 'ghcr.io', 'amd64', undefined, options
    );

    expect(getAuthToken).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer index-token' } });
    expect(get.mock.calls[1][1]).toMatchObject({ headers: { Authorization: 'Bearer selected-token' } });
  });

  it('does not start the manifest request when token refresh is aborted', async () => {
    const controller = new AbortController();
    const getAuthToken = vi.fn(() => new Promise<string>((_resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('token refresh aborted')), { once: true });
    }));
    const options = {
      signal: controller.signal,
      getAuthToken,
    };
    const pending = service.getManifest('team/image', 'v1', 'stale-token', 'ghcr.io', options);
    await vi.waitFor(() => expect(getAuthToken).toHaveBeenCalledOnce());
    controller.abort();

    await expect(pending).rejects.toThrow('token refresh aborted');
    expect(get).not.toHaveBeenCalled();
  });

  it('does not request the selected digest after aborting the index request', async () => {
    const controller = new AbortController();
    get.mockImplementationOnce(async (_url, options?: { signal?: AbortSignal }) => {
      controller.abort();
      options?.signal?.throwIfAborted();
      return { data: index([entry('amd64')]) };
    });

    await expect(
      service.getManifestForArchitecture(
        'team/image', 'v1', '', 'ghcr.io', 'amd64', undefined, { signal: controller.signal }
      )
    ).rejects.toBeDefined();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('does not request the selected digest while paused after the index response', async () => {
    let paused = false;
    get
      .mockImplementationOnce(async () => {
        paused = true;
        return { data: index([entry('amd64')]) };
      })
      .mockResolvedValueOnce({ data: single });
    const pending = service.getManifestForArchitecture(
      'team/image', 'v1', '', 'ghcr.io', 'amd64', undefined, { shouldPause: () => paused }
    );
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(get).toHaveBeenCalledTimes(1);
    paused = false;
    await expect(pending).resolves.toBe(single);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('propagates abort from a pending selected manifest request', async () => {
    const controller = new AbortController();
    get
      .mockResolvedValueOnce({ data: index([entry('amd64')]) })
      .mockImplementationOnce((_url, options: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new Error('manifest aborted')), { once: true });
      }));
    const pending = service.getManifestForArchitecture(
      'team/image', 'v1', '', 'ghcr.io', 'amd64', undefined, { signal: controller.signal }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    await expect(pending).rejects.toThrow('manifest aborted');
    expect(get).toHaveBeenCalledTimes(2);
  });
});
