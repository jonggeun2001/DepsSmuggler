import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DockerAuthClient } from './docker-auth-client';
import { DockerCatalogCache } from './docker-catalog-cache';
import { DockerManifestService } from './docker-manifest-service';
import { DockerSearchService } from './docker-search-service';
import type { DockerManifest } from './docker-types';

const requests = vi.hoisted(() => ({ get: vi.fn(), hubGet: vi.fn(), create: vi.fn() }));
vi.mock('axios', () => ({ default: { get: requests.get, create: requests.create } }));
vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('DockerSearchService', () => {
  let service: DockerSearchService;
  let auth: DockerAuthClient;
  let catalog: DockerCatalogCache;
  let manifest: DockerManifestService;

  beforeEach(() => {
    vi.resetAllMocks();
    requests.create.mockReturnValue({ get: requests.hubGet });
    auth = new DockerAuthClient();
    catalog = new DockerCatalogCache(auth);
    manifest = new DockerManifestService(auth);
    service = new DockerSearchService(auth, catalog, manifest);
  });
  afterEach(() => vi.restoreAllMocks());

  it('queries Docker Hub and maps repository names and descriptions', async () => {
    requests.hubGet.mockResolvedValue({
      data: {
        results: [
          { repo_name: 'library/nginx', short_description: 'Web server' },
          { repo_name: 'team/nginx', short_description: '' },
        ],
      },
    });
    await expect(service.searchPackages('nginx')).resolves.toEqual([
      {
        type: 'docker',
        name: 'docker.io/library/nginx',
        version: 'latest',
        metadata: { description: 'Web server', registry: 'docker.io' },
      },
      {
        type: 'docker',
        name: 'docker.io/team/nginx',
        version: 'latest',
        metadata: { description: '', registry: 'docker.io' },
      },
    ]);
    expect(axios.create).toHaveBeenCalledExactlyOnceWith({
      baseURL: 'https://hub.docker.com/v2',
      timeout: 30000,
    });
    expect(requests.hubGet).toHaveBeenCalledExactlyOnceWith('/search/repositories/', {
      params: { query: 'nginx', page_size: 50 },
    });
    expect(requests.get).not.toHaveBeenCalled();
  });

  it('filters Quay private repositories before limiting public results and handles absent descriptions', async () => {
    requests.get.mockResolvedValue({
      data: {
        results: [
          {
            namespace: { name: 'secret' },
            name: 'private',
            description: 'secret',
            is_public: false,
          },
          ...Array.from({ length: 51 }, (_, i) => ({
            namespace: { name: 'public' },
            name: `image-${i}`,
            description: i === 0 ? null : 'Image',
            is_public: true,
          })),
        ],
      },
    });
    const result = await service.searchPackages('image', 'quay.io');
    expect(result).toHaveLength(50);
    expect(result[0]).toEqual({
      type: 'docker',
      name: 'quay.io/public/image-0',
      version: 'latest',
      metadata: { description: '', registry: 'quay.io' },
    });
    expect(result[49].name).toBe('quay.io/public/image-49');
    expect(requests.get).toHaveBeenCalledExactlyOnceWith(
      'https://quay.io/api/v1/find/repositories',
      { params: { query: 'image' }, timeout: 30000 }
    );
  });

  it.each(['ghcr.io', 'public.ecr.aws'])(
    'provides a direct image entry for %s without invoking an unsupported search API',
    async (registry) => {
      const cached = vi.spyOn(catalog, 'getCachedCatalog');
      const result = await service.searchPackages('org/image', registry);
      expect(result).toEqual([
        {
          type: 'docker',
          name: `${registry}/org/image`,
          version: 'latest',
          metadata: { registry, description: expect.stringContaining('정확한 이미지명 입력 필요') },
        },
      ]);
      expect(requests.get).not.toHaveBeenCalled();
      expect(requests.hubGet).not.toHaveBeenCalled();
      expect(cached).not.toHaveBeenCalled();
    }
  );

  it('searches custom catalogs case-insensitively and limits matching repositories', async () => {
    const cached = vi
      .spyOn(catalog, 'getCachedCatalog')
      .mockResolvedValue([
        'unrelated/image',
        ...Array.from({ length: 51 }, (_, i) => `Team/APP-${i}`),
      ]);
    const result = await service.searchPackages('app', 'registry.example.test');
    expect(cached).toHaveBeenCalledExactlyOnceWith('registry.example.test');
    expect(result).toHaveLength(50);
    expect(result[0]).toEqual({
      type: 'docker',
      name: 'registry.example.test/Team/APP-0',
      version: 'latest',
      metadata: { registry: 'registry.example.test' },
    });
    expect(result[49].name).toBe('registry.example.test/Team/APP-49');
    expect(requests.get).not.toHaveBeenCalled();
  });

  it.each(['docker.io', 'quay.io', 'registry.example.test'])(
    'returns no invented search results for an empty %s catalog',
    async (registry) => {
      requests.hubGet.mockResolvedValue({ data: { results: [] } });
      requests.get.mockResolvedValue({ data: { results: [] } });
      vi.spyOn(catalog, 'getCachedCatalog').mockResolvedValue([]);
      await expect(service.searchPackages('missing', registry)).resolves.toEqual([]);
    }
  );

  it('propagates search transport failure', async () => {
    const failure = new Error('search timed out');
    requests.hubGet.mockRejectedValue(failure);
    await expect(service.searchPackages('nginx')).rejects.toBe(failure);
  });

  it('uses Docker Hub tags for unqualified official images', async () => {
    requests.hubGet.mockResolvedValue({ data: { results: [{ name: 'latest' }, { name: '1.0' }] } });
    await expect(service.getVersions('nginx')).resolves.toEqual(['latest', '1.0']);
    expect(requests.hubGet).toHaveBeenCalledExactlyOnceWith('/repositories/library/nginx/tags', {
      params: { page_size: 100 },
    });
  });

  it('uses an explicit image registry instead of the default and preserves nested namespaces', async () => {
    const token = vi.spyOn(auth, 'getTokenForRegistry').mockResolvedValue('tags-token');
    requests.get.mockResolvedValue({ data: { tags: ['v2', 'v1'] } });
    await expect(service.getVersions('ghcr.io/org/nested/image', 'quay.io')).resolves.toEqual([
      'v2',
      'v1',
    ]);
    expect(token).toHaveBeenCalledExactlyOnceWith('ghcr.io', 'org/nested/image');
    expect(requests.get).toHaveBeenCalledExactlyOnceWith(
      'https://ghcr.io/v2/org/nested/image/tags/list',
      { headers: { Authorization: 'Bearer tags-token' } }
    );
    expect(requests.hubGet).not.toHaveBeenCalled();
  });

  it.each([{ tags: [] }, { tags: null }, {}])('handles empty non-Hub tags: %j', async (data) => {
    vi.spyOn(auth, 'getTokenForRegistry').mockResolvedValue('token');
    requests.get.mockResolvedValue({ data });
    await expect(service.getVersions('org/image', 'quay.io')).resolves.toEqual([]);
  });

  it('propagates denied tag authentication before requesting registry tags', async () => {
    const failure = Object.assign(new Error('Unauthorized'), { response: { status: 401 } });
    vi.spyOn(auth, 'getTokenForRegistry').mockRejectedValue(failure);
    await expect(service.getVersions('ghcr.io/team/private')).rejects.toBe(failure);
    expect(requests.get).not.toHaveBeenCalled();
  });

  it('propagates a missing Docker Hub repository error', async () => {
    const failure = Object.assign(new Error('Not found'), { response: { status: 404 } });
    requests.hubGet.mockRejectedValue(failure);
    await expect(service.getVersions('missing')).rejects.toBe(failure);
  });

  it('builds Docker Hub metadata with a default tag, config digest, and summed layer size', async () => {
    const token = vi.spyOn(auth, 'getToken').mockResolvedValue('metadata-token');
    const readManifest = vi.spyOn(manifest, 'getManifest').mockResolvedValue({
      schemaVersion: 2,
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      config: {
        digest: 'sha256:config',
        size: 10,
        mediaType: 'application/vnd.oci.image.config.v1+json',
      },
      layers: [
        { digest: 'sha256:a', size: 100, mediaType: 'layer' },
        { digest: 'sha256:b', size: 200, mediaType: 'layer' },
      ],
    });
    await expect(service.getPackageMetadata('nginx', '')).resolves.toEqual({
      type: 'docker',
      name: 'library/nginx',
      version: 'latest',
      metadata: { registry: 'docker.io', tag: 'latest', digest: 'sha256:config', size: 300 },
    });
    expect(token).toHaveBeenCalledExactlyOnceWith('library/nginx');
    expect(readManifest).toHaveBeenCalledExactlyOnceWith(
      'library/nginx',
      'latest',
      'metadata-token'
    );
  });

  it.each([
    { extra: { layers: [] }, size: 0 },
    { extra: { manifests: [] }, size: undefined },
  ])('supports metadata without config data: %j', async ({ extra, size }) => {
    vi.spyOn(auth, 'getToken').mockResolvedValue('token');
    vi.spyOn(manifest, 'getManifest').mockResolvedValue({
      schemaVersion: 2,
      mediaType: 'manifest',
      ...extra,
    } as DockerManifest);
    const result = await service.getPackageMetadata('org/image', 'v1');
    expect(result).toMatchObject({ name: 'org/image', version: 'v1', metadata: { tag: 'v1' } });
    expect(result.metadata?.size).toBe(size);
    expect(result.metadata?.digest).toBeUndefined();
  });

  it.each(['authentication', 'manifest'])('propagates metadata %s failure', async (stage) => {
    const failure = new Error('metadata unavailable');
    const token = vi.spyOn(auth, 'getToken').mockResolvedValue('token');
    const readManifest = vi.spyOn(manifest, 'getManifest').mockRejectedValue(failure);
    if (stage === 'authentication') token.mockRejectedValue(failure);
    await expect(service.getPackageMetadata('nginx', 'v1')).rejects.toBe(failure);
    expect(readManifest).toHaveBeenCalledTimes(stage === 'manifest' ? 1 : 0);
  });
});
