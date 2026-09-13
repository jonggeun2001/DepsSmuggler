import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { getAptResolver } from './apt-resolver';
import { OsPackageCache } from '../downloaders/os-shared/cache-manager';
import type { DependencyResolverOptions } from '../downloaders/os-shared/base-resolver';
import type { OSDistribution, Repository } from '../downloaders/os-shared/types';

const distribution: OSDistribution = {
  id: 'apt-repository-identity-fixture',
  name: 'APT repository identity fixture',
  version: 'test',
  codename: 'test',
  packageManager: 'apt',
  architectures: ['amd64'],
  defaultRepos: [],
  extendedRepos: [],
};

const packagesGzip = gzipSync(Buffer.from(`Package: cache-provenance
Version: 1.0
Architecture: amd64
Filename: pool/main/c/cache-provenance_1.0_amd64.deb
Size: 1
SHA256: ${'a'.repeat(64)}
Description: repository identity fixture

`, 'utf8'));

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('APT repository identity fixture did not expose a port'));
        return;
      }
      resolve(address.port);
    });
  });
}

function createOptions(
  repository: Repository,
  cacheManager: DependencyResolverOptions['cacheManager']
): DependencyResolverOptions {
  return {
    distribution,
    repositories: [repository],
    architecture: 'amd64',
    includeOptional: false,
    includeRecommends: false,
    cacheManager,
  };
}

describe('APT repository identity and persistent metadata cache', () => {
  let server: Server | undefined;
  let cacheDirectory: string | undefined;

  afterEach(async () => {
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
    server = undefined;
    if (cacheDirectory) {
      rmSync(cacheDirectory, { recursive: true, force: true });
      cacheDirectory = undefined;
    }
  });

  it('keeps trailing-slash repository provenance separate from the persistent cache key', async () => {
    const requests: string[] = [];
    server = createServer((request, response) => {
      requests.push(request.url ?? '');
      if (request.url === '/dists/test/main/binary-amd64/Packages.gz') {
        response.writeHead(200, { 'content-type': 'application/gzip' });
        response.end(packagesGzip);
        return;
      }
      response.writeHead(404);
      response.end('fixture not found');
    });
    const port = await listen(server);
    cacheDirectory = mkdtempSync(join(tmpdir(), 'depssmuggler-apt-identity-'));

    const baseUrl = `http://127.0.0.1:${port}/dists/test`;
    const withoutTrailingSlash: Repository = {
      id: 'same-apt-repository',
      name: 'APT fixture without trailing slash',
      baseUrl,
      enabled: true,
      gpgCheck: false,
      isOfficial: false,
    };
    const withTrailingSlash: Repository = {
      ...withoutTrailingSlash,
      baseUrl: `${baseUrl}/`,
    };
    const cache = () => new OsPackageCache({ type: 'persistent', directory: cacheDirectory });

    const first = await getAptResolver(
      createOptions(withoutTrailingSlash, cache())
    ).searchPackages('cache-provenance', 'exact');
    const second = await getAptResolver(
      createOptions(withTrailingSlash, cache())
    ).searchPackages('cache-provenance', 'exact');
    const third = await getAptResolver(
      createOptions(withTrailingSlash, cache())
    ).searchPackages('cache-provenance', 'exact');

    expect(first[0]?.latest.repository).toEqual(withoutTrailingSlash);
    expect(second[0]?.latest.repository).toEqual(withTrailingSlash);
    expect(third[0]?.latest.repository).toEqual(withTrailingSlash);
    expect(requests).toEqual([
      '/dists/test/main/binary-amd64/Packages.gz',
      '/dists/test/main/binary-amd64/Packages.gz',
    ]);
  });
});
