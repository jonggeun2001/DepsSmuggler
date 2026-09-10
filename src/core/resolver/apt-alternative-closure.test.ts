import { createServer, type Server } from 'node:http';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { AptDependencyResolver } from './apt-resolver';
import type { OSDistribution, Repository } from '../downloaders/os-shared/types';

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('APT fixture server did not expose a port'));
        return;
      }
      resolve(address.port);
    });
  });
}

function packageEntry(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}

function fixturePackages(): Buffer {
  const entries = [
    packageEntry({
      Package: 'app',
      Version: '1.0',
      Architecture: 'amd64',
      Depends: 'libfoo, libfoo',
      Filename: 'pool/main/a/app_1.0_amd64.deb',
      Size: '100',
      SHA256: 'a'.repeat(64),
      Description: 'fixture root',
    }),
    packageEntry({
      Package: 'libfoo',
      Version: '1.0',
      Architecture: 'amd64',
      Depends: 'libbase (= 1.0)',
      Filename: 'pool/main/l/libfoo_1.0_amd64.deb',
      Size: '100',
      SHA256: 'b'.repeat(64),
      Description: 'fixture old branch',
    }),
    packageEntry({
      Package: 'libfoo',
      Version: '2.0',
      Architecture: 'amd64',
      Depends: 'libbase (= 2.0)',
      Filename: 'pool/main/l/libfoo_2.0_amd64.deb',
      Size: '100',
      SHA256: 'c'.repeat(64),
      Description: 'fixture new branch',
    }),
    packageEntry({
      Package: 'libbase',
      Version: '1.0',
      Architecture: 'amd64',
      Depends: 'leaf (= 1.0), leaf (= 1.0), missing-branch (= 1.0)',
      Filename: 'pool/main/l/libbase_1.0_amd64.deb',
      Size: '100',
      SHA256: 'd'.repeat(64),
      Description: 'fixture old base',
    }),
    packageEntry({
      Package: 'libbase',
      Version: '2.0',
      Architecture: 'amd64',
      Filename: 'pool/main/l/libbase_2.0_amd64.deb',
      Size: '100',
      SHA256: 'e'.repeat(64),
      Description: 'fixture new base',
    }),
    packageEntry({
      Package: 'leaf',
      Version: '1.0',
      Architecture: 'amd64',
      Depends: 'libbase (= 1.0)',
      Filename: 'pool/main/l/leaf_1.0_amd64.deb',
      Size: '100',
      SHA256: 'f'.repeat(64),
      Description: 'fixture cyclic child',
    }),
  ].join('\n\n');

  return gzipSync(Buffer.from(`${entries}\n\n`, 'utf8'));
}

const distribution: OSDistribution = {
  id: 'ubuntu-test',
  name: 'Fixture Ubuntu',
  version: 'test',
  codename: 'test',
  packageManager: 'apt',
  architectures: ['amd64'],
  defaultRepos: [],
  extendedRepos: [],
};

describe('APT alternative dependency closure', () => {
  let server: Server | undefined;

  afterEach(async () => {
    const activeServer = server;
    if (activeServer?.listening) {
      await new Promise<void>((resolve) => activeServer.close(() => resolve()));
    }
    server = undefined;
  });

  it('loads real Packages.gz and traverses retained alternatives, exact branches, cycles, and missing children', async () => {
    const requests: string[] = [];
    const packagesGzip = fixturePackages();
    const fixtureServer = createServer((request, response) => {
      const requestPath = request.url ?? '';
      requests.push(requestPath);
      if (requestPath === '/dists/test/main/binary-amd64/Packages.gz') {
        response.writeHead(200, { 'content-type': 'application/gzip' });
        response.end(packagesGzip);
        return;
      }
      response.writeHead(404);
      response.end('fixture not found');
    });
    server = fixtureServer;
    const port = await listen(fixtureServer);
    const repository: Repository = {
      id: 'fixture-apt-main',
      name: 'Fixture APT main',
      baseUrl: `http://127.0.0.1:${port}/dists/test`,
      enabled: true,
      gpgCheck: false,
      isOfficial: false,
    };

    const resolver = new AptDependencyResolver({
      distribution,
      repositories: [repository],
      architecture: 'amd64',
      includeOptional: false,
      includeRecommends: false,
    });
    const searchResults = await resolver.searchPackages('app', 'exact');
    expect(searchResults).toHaveLength(1);
    expect(searchResults[0].latest.version).toBe('1.0');
    expect(searchResults[0].versions).toHaveLength(1);

    const result = await resolver.resolveDependencies([searchResults[0].latest]);
    const packageKeys = result.packages.map(
      (pkg) => `${pkg.name}-${pkg.version}-${pkg.architecture}`
    );
    expect(new Set(packageKeys).size).toBe(packageKeys.length);
    expect(packageKeys.sort()).toEqual([
      'app-1.0-amd64',
      'leaf-1.0-amd64',
      'libbase-1.0-amd64',
      'libbase-2.0-amd64',
      'libfoo-1.0-amd64',
      'libfoo-2.0-amd64',
    ]);

    const libfooVersions = result.packages
      .filter((pkg) => pkg.name === 'libfoo')
      .map((pkg) => pkg.version)
      .sort();
    expect(libfooVersions).toEqual(['1.0', '2.0']);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        package: 'libfoo',
        versions: expect.arrayContaining([
          expect.objectContaining({ version: '1.0' }),
          expect.objectContaining({ version: '2.0' }),
        ]),
      }),
    ]);

    const libfooOld = result.packages.find((pkg) => pkg.name === 'libfoo' && pkg.version === '1.0');
    const libfooNew = result.packages.find((pkg) => pkg.name === 'libfoo' && pkg.version === '2.0');
    const libbaseOld = result.packages.find(
      (pkg) => pkg.name === 'libbase' && pkg.version === '1.0'
    );
    const leaf = result.packages.find((pkg) => pkg.name === 'leaf');
    expect(libfooOld?.dependencies).toEqual([{ name: 'libbase', version: '1.0', operator: '=' }]);
    expect(libfooNew?.dependencies).toEqual([{ name: 'libbase', version: '2.0', operator: '=' }]);
    expect(libbaseOld?.dependencies).toEqual([
      { name: 'leaf', version: '1.0', operator: '=' },
      { name: 'leaf', version: '1.0', operator: '=' },
      { name: 'missing-branch', version: '1.0', operator: '=' },
    ]);
    expect(leaf?.dependencies).toEqual([{ name: 'libbase', version: '1.0', operator: '=' }]);
    expect(result.unresolved).toEqual([{ name: 'missing-branch', version: '1.0', operator: '=' }]);
    expect(requests).toEqual(['/dists/test/main/binary-amd64/Packages.gz']);
  });
});
