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
});
