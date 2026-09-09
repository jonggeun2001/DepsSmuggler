import { createServer, type Server } from 'node:http';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { YumDependencyResolver } from './yum-resolver';
import type { OSDistribution, Repository } from '../downloaders/os-shared/types';

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('YUM fixture server did not expose a port'));
        return;
      }
      resolve(address.port);
    });
  });
}

function rpmPackage(options: {
  name: string;
  version: string;
  release: string;
  requires?: string;
}): string {
  const requires = options.requires
    ? `<rpm:requires>${options.requires}</rpm:requires>`
    : '<rpm:requires />';
  return `
    <package type="rpm">
      <name>${options.name}</name>
      <arch>x86_64</arch>
      <version epoch="0" ver="${options.version}" rel="${options.release}" />
      <checksum type="sha256">${options.name}-${options.release}</checksum>
      <summary>Fixture ${options.name}</summary>
      <description>Fixture ${options.name} ${options.release}</description>
      <packager>Fixture</packager>
      <url>https://fixture.invalid/${options.name}</url>
      <time file="0" build="0" />
      <size package="100" installed="100" archive="100" />
      <location href="Packages/${options.name}-${options.version}-${options.release}.x86_64.rpm" />
      <format xmlns:rpm="http://linux.duke.edu/metadata/rpm">
        <rpm:license>MIT</rpm:license>
        ${requires}
      </format>
    </package>`;
}

function primaryXml(): Buffer {
  const requires = (name: string, version: string) =>
    `<rpm:entry name="${name}" flags="EQ" epoch="0" ver="${version}" />`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <metadata xmlns="http://linux.duke.edu/metadata/common" xmlns:rpm="http://linux.duke.edu/metadata/rpm" packages="5">
      ${rpmPackage({ name: 'app', version: '1.0.0', release: '1.el9', requires: `${requires('libfoo', '1.0.0')}${requires('libfoo', '1.0.0')}` })}
      ${rpmPackage({ name: 'libfoo', version: '1.0.0', release: '1.el9', requires: requires('child-old', '1.0.0') })}
      ${rpmPackage({ name: 'libfoo', version: '1.0.0', release: '2.el9', requires: requires('child-new', '1.0.0') })}
      ${rpmPackage({ name: 'child-old', version: '1.0.0', release: '1.el9' })}
      ${rpmPackage({ name: 'child-new', version: '1.0.0', release: '1.el9' })}
    </metadata>`;
  return gzipSync(Buffer.from(xml, 'utf8'));
}

const distribution: OSDistribution = {
  id: 'rocky-test',
  name: 'Fixture Rocky',
  version: '9',
  packageManager: 'yum',
  architectures: ['x86_64'],
  defaultRepos: [],
  extendedRepos: [],
};

describe('YUM release-aware alternative dependency closure', () => {
  let server: Server | undefined;

  afterEach(async () => {
    const activeServer = server;
    if (activeServer?.listening) {
      await new Promise<void>((resolve) => activeServer.close(() => resolve()));
    }
    server = undefined;
  });

  it('loads repomd and primary metadata over loopback and traverses same-version releases', async () => {
    const requests: string[] = [];
    const primary = primaryXml();
    const fixtureServer = createServer((request, response) => {
      const requestPath = request.url ?? '';
      requests.push(requestPath);
      if (requestPath === '/repodata/repomd.xml') {
        response.writeHead(200, { 'content-type': 'application/xml' });
        response.end(
          `<?xml version="1.0"?><repomd xmlns="http://linux.duke.edu/metadata/repomd"><revision>1</revision><data type="primary"><checksum type="sha256">fixture</checksum><location href="repodata/primary.xml.gz" /></data></repomd>`
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
    server = fixtureServer;
    const port = await listen(fixtureServer);
    const repository: Repository = {
      id: 'fixture-yum-9',
      name: 'Fixture YUM repository',
      baseUrl: `http://127.0.0.1:${port}`,
      enabled: true,
      gpgCheck: false,
      isOfficial: false,
    };
    const resolver = new YumDependencyResolver({
      distribution,
      repositories: [repository],
      architecture: 'x86_64',
      includeOptional: false,
      includeRecommends: false,
    });

    const searchResults = await resolver.searchPackages('app', 'exact');
    expect(searchResults).toHaveLength(1);
    const root = searchResults[0].latest;
    const result = await resolver.resolveDependencies([root]);

    expect(requests).toEqual(['/repodata/repomd.xml', '/repodata/primary.xml.gz']);
    const keys = result.packages.map(
      (pkg) => `${pkg.name}-${pkg.version}-${pkg.release ?? ''}-${pkg.architecture}`
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual([
      'app-1.0.0-1.el9-x86_64',
      'child-new-1.0.0-1.el9-x86_64',
      'child-old-1.0.0-1.el9-x86_64',
      'libfoo-1.0.0-1.el9-x86_64',
      'libfoo-1.0.0-2.el9-x86_64',
    ]);
    expect(result.unresolved).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        package: 'libfoo',
        versions: expect.arrayContaining([
          expect.objectContaining({ version: '1.0.0', release: '1.el9' }),
          expect.objectContaining({ version: '1.0.0', release: '2.el9' }),
        ]),
      }),
    ]);

    const oldRelease = result.packages.find(
      (pkg) => pkg.name === 'libfoo' && pkg.release === '1.el9'
    );
    const newRelease = result.packages.find(
      (pkg) => pkg.name === 'libfoo' && pkg.release === '2.el9'
    );
    expect(oldRelease?.dependencies).toEqual([
      { name: 'child-old', version: '1.0.0', operator: '=', isOptional: false },
    ]);
    expect(newRelease?.dependencies).toEqual([
      { name: 'child-new', version: '1.0.0', operator: '=', isOptional: false },
    ]);
  });
});
