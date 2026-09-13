import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { getYumResolver } from './yum-resolver';
import { OsPackageCache } from '../downloaders/os-shared/cache-manager';
import type { DependencyResolverOptions } from '../downloaders/os-shared/base-resolver';
import type { OSDistribution, Repository } from '../downloaders/os-shared/types';

const distribution: OSDistribution = {
  id: 'fixture-rocky-9',
  name: 'Fixture Rocky',
  version: '9',
  packageManager: 'yum',
  architectures: ['x86_64'],
  defaultRepos: [],
  extendedRepos: [],
};

const primary = gzipSync(Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
  <metadata xmlns="http://linux.duke.edu/metadata/common" packages="1">
    <package type="rpm">
      <name>cache-provenance</name>
      <arch>x86_64</arch>
      <version epoch="0" ver="1.0" rel="1" />
      <checksum type="sha256">fixture</checksum>
      <summary>Repository identity fixture</summary>
      <size package="1" installed="1" archive="1" />
      <location href="Packages/cache-provenance-1.0-1.x86_64.rpm" />
    </package>
  </metadata>`, 'utf8'));

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('YUM identity fixture did not expose a port'));
        return;
      }
      resolve(address.port);
    });
  });
}

function createFixtureServer(requests: string[]): Server {
  return createServer((request, response) => {
    const requestPath = request.url ?? '';
    requests.push(requestPath);
    if (requestPath === '/repodata/repomd.xml') {
      response.writeHead(200, { 'content-type': 'application/xml' });
      response.end(
        '<?xml version="1.0"?><repomd xmlns="http://linux.duke.edu/metadata/repomd"><revision>1</revision><data type="primary"><checksum type="sha256">fixture</checksum><location href="repodata/primary.xml.gz" /></data></repomd>'
      );
      return;
    }
    if (requestPath === '/repodata/primary.xml.gz') {
      response.writeHead(200, { 'content-type': 'application/gzip' });
      response.end(primary);
      return;
    }
    response.writeHead(404);
    response.end('fixture not found');
  });
}

function options(
  repository: Repository,
  cacheManager: DependencyResolverOptions['cacheManager']
): DependencyResolverOptions {
  return {
    distribution,
    repositories: [repository],
    architecture: 'x86_64',
    includeOptional: false,
    includeRecommends: false,
    cacheManager,
  };
}

describe('YUM resolver repository identity and persistent metadata cache', () => {
  const servers: Server[] = [];
  let cacheDirectory: string;

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(async (server) => {
      if (server.listening) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }));
    if (cacheDirectory) rmSync(cacheDirectory, { recursive: true, force: true });
  });

  it('does not reuse disk metadata when the repository URL or verification policy changes', async () => {
    cacheDirectory = mkdtempSync(join(tmpdir(), 'depssmuggler-yum-identity-'));
    const requestsA: string[] = [];
    const requestsB: string[] = [];
    const serverA = createFixtureServer(requestsA);
    const serverB = createFixtureServer(requestsB);
    servers.push(serverA, serverB);
    const portA = await listen(serverA);
    const portB = await listen(serverB);
    const cache = () => new OsPackageCache({ type: 'persistent', directory: cacheDirectory });
    const repositoryA: Repository = {
      id: 'same-repository-id', name: 'Fixture repository A', baseUrl: `http://127.0.0.1:${portA}`,
      enabled: true, gpgCheck: false, isOfficial: false,
    };
    const repositoryB: Repository = {
      ...repositoryA, name: 'Fixture repository B', baseUrl: `http://127.0.0.1:${portB}`,
    };
    const repositoryC: Repository = {
      ...repositoryB, gpgCheck: true, priority: 20,
    };

    const first = await getYumResolver(options(repositoryA, cache())).searchPackages('cache-provenance', 'exact');
    const second = await getYumResolver(options(repositoryB, cache())).searchPackages('cache-provenance', 'exact');
    const third = await getYumResolver(options(repositoryC, cache())).searchPackages('cache-provenance', 'exact');
    const fourth = await getYumResolver(options(repositoryC, cache())).searchPackages('cache-provenance', 'exact');

    expect(first[0]?.latest.repository).toEqual(repositoryA);
    expect(second[0]?.latest.repository).toEqual(repositoryB);
    expect(third[0]?.latest.repository).toEqual(repositoryC);
    expect(fourth[0]?.latest.repository).toEqual(repositoryC);
    expect(requestsA).toEqual(['/repodata/repomd.xml', '/repodata/primary.xml.gz']);
    expect(requestsB).toEqual([
      '/repodata/repomd.xml', '/repodata/primary.xml.gz',
      '/repodata/repomd.xml', '/repodata/primary.xml.gz',
    ]);
  });
});
