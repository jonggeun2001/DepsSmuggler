import { createServer, type Server } from 'node:http';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { YumDependencyResolver } from '../resolver/yum-resolver';
import type { OSDistribution, Repository } from './os-shared/types';

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('YUM prerequisite fixture did not expose a port'));
        return;
      }
      resolve(address.port);
    });
  });
}

function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function entry(name: string, options: {
  flags?: string;
  epoch?: string;
  version?: string;
  pre?: string;
} = {}): string {
  const attributes = [
    `name="${xml(name)}"`,
    options.flags ? `flags="${options.flags}"` : '',
    options.epoch ? `epoch="${options.epoch}"` : '',
    options.version ? `ver="${xml(options.version)}"` : '',
    options.pre ? `pre="${options.pre}"` : '',
  ].filter(Boolean).join(' ');
  return `<rpm:entry ${attributes} />`;
}

function rpmPackage(options: {
  name: string;
  version: string;
  release: string;
  epoch?: string;
  requires?: string;
  provides?: string;
  recommends?: string;
}): string {
  const requires = options.requires || '';
  const provides = options.provides || '';
  const recommends = options.recommends || '';
  return `
    <package type="rpm">
      <name>${xml(options.name)}</name>
      <arch>x86_64</arch>
      <version epoch="${options.epoch ?? '0'}" ver="${xml(options.version)}" rel="${xml(options.release)}" />
      <checksum type="sha256">${xml(options.name)}-${xml(options.version)}-${xml(options.release)}</checksum>
      <summary>Fixture ${xml(options.name)}</summary>
      <description>Fixture ${xml(options.name)}</description>
      <packager>Fixture</packager>
      <url>https://fixture.invalid/${xml(options.name)}</url>
      <time file="0" build="0" />
      <size package="100" installed="100" archive="100" />
      <location href="Packages/${xml(options.name)}-${xml(options.version)}-${xml(options.release)}.x86_64.rpm" />
      <format xmlns:rpm="http://linux.duke.edu/metadata/rpm">
        <rpm:license>MIT</rpm:license>
        <rpm:requires>${requires}</rpm:requires>
        <rpm:provides>${provides}</rpm:provides>
        <rpm:recommends>${recommends}</rpm:recommends>
      </format>
    </package>`;
}

function primaryXml(): Buffer {
  const packages = [
    rpmPackage({
      name: 'bash', version: '5.1.8', release: '9.el9',
      requires: entry('filesystem', { flags: 'GE', epoch: '0', version: '3.16' }),
      recommends: entry('weak-extra', { flags: 'EQ', epoch: '0', version: '1.0' }),
    }),
    rpmPackage({
      name: 'filesystem', version: '3.16', release: '5.el9', epoch: '1',
      requires: `${entry('setup', { flags: 'EQ', epoch: '0', version: '2.13.7', pre: '1' })}${entry('pre-zero', { flags: 'GE', epoch: '0', version: '1.2', pre: '0' })}`,
    }),
    rpmPackage({ name: 'setup', version: '2.13.7', release: '10.el9', requires: `${entry('system-release')}${entry('plain-required')}` }),
    rpmPackage({ name: 'pre-zero', version: '1.2.4', release: '3.el9' }),
    rpmPackage({ name: 'plain-required', version: '4.0.0', release: '1.el9' }),
    rpmPackage({
      name: 'rocky-release', version: '9.8', release: '1.el9',
      requires: entry('rocky-repos', { flags: 'GE', epoch: '0', version: '9' }),
      provides: entry('system-release'),
    }),
    rpmPackage({
      name: 'rocky-repos', version: '9.8', release: '1.el9',
      requires: entry('rocky-release', { flags: 'GE', epoch: '0', version: '9' }),
    }),
    rpmPackage({ name: 'weak-extra', version: '1.0', release: '1.el9' }),
  ];
  const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
    <metadata xmlns="http://linux.duke.edu/metadata/common" xmlns:rpm="http://linux.duke.edu/metadata/rpm" packages="${packages.length}">
      ${packages.join('\n')}
    </metadata>`;
  return gzipSync(Buffer.from(xmlContent, 'utf8'));
}

const distribution: OSDistribution = {
  id: 'rocky-prerequisite-fixture',
  name: 'Fixture Rocky',
  version: '9',
  packageManager: 'yum',
  architectures: ['x86_64'],
  defaultRepos: [],
  extendedRepos: [],
};

describe('YUM required prerequisite closure through real metadata parsing', () => {
  let server: Server | undefined;

  afterEach(async () => {
    const activeServer = server;
    server = undefined;
    if (activeServer?.listening) {
      activeServer.closeAllConnections();
      await new Promise<void>((resolve) => activeServer.close(() => resolve()));
    }
  });

  it('keeps pre and unmarked requirements mandatory while excluding weak recommends', async () => {
    const primary = primaryXml();
    const requests: string[] = [];
    const fixtureServer = createServer((request, response) => {
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
    server = fixtureServer;
    const port = await listen(fixtureServer);
    const repository: Repository = {
      id: 'fixture-yum-prerequisites',
      name: 'Fixture YUM prerequisites',
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

    const searchResults = await resolver.searchPackages('bash', 'exact');
    expect(searchResults).toHaveLength(1);
    const result = await resolver.resolveDependencies([searchResults[0].latest]);

    expect(requests).toEqual(['/repodata/repomd.xml', '/repodata/primary.xml.gz']);
    expect(result.unresolved).toEqual([]);
    const names = result.packages.map((pkg) => pkg.name);
    expect(names).toEqual(expect.arrayContaining([
      'bash', 'filesystem', 'setup', 'pre-zero', 'plain-required', 'rocky-release', 'rocky-repos',
    ]));
    expect(names).not.toContain('weak-extra');
    expect(new Set(names).size).toBe(names.length);

    const filesystem = result.packages.find((pkg) => pkg.name === 'filesystem');
    expect(filesystem).toMatchObject({ version: '3.16', release: '5.el9', epoch: 1 });
    expect(filesystem?.dependencies).toEqual(expect.arrayContaining([
      { name: 'setup', version: '2.13.7', operator: '=', isOptional: false },
      { name: 'pre-zero', version: '1.2', operator: '>=', isOptional: false },
    ]));
    const setup = result.packages.find((pkg) => pkg.name === 'setup');
    expect(setup?.dependencies).toEqual(expect.arrayContaining([
      { name: 'system-release', version: undefined, operator: undefined, isOptional: false },
      { name: 'plain-required', version: undefined, operator: undefined, isOptional: false },
    ]));
    expect(result.packages.find((pkg) => pkg.name === 'rocky-release')).toMatchObject({
      version: '9.8', release: '1.el9', epoch: 0,
    });
  });
});
