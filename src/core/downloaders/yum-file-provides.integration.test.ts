import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { gzipSync } from 'node:zlib';
import { XMLParser } from 'fast-xml-parser';
import { afterEach, describe, expect, it } from 'vitest';
import { getDownloadedFileKey } from './os-shared/package-file-utils';
import { OSRepoPackager } from './os-shared/repo-packager';
import { YumMetadataParser } from './yum';
import type { OSPackageInfo, Repository } from './os-shared/types';

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('YUM file fixture server did not expose a port'));
        return;
      }
      resolve(address.port);
    });
  });
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function packageXml(options: {
  name: string;
  version: string;
  release: string;
  files?: string;
}): string {
  return `
    <package type="rpm">
      <name>${escapeXml(options.name)}</name>
      <arch>x86_64</arch>
      <version epoch="0" ver="${escapeXml(options.version)}" rel="${escapeXml(options.release)}" />
      <checksum type="sha256">${options.name}-checksum</checksum>
      <summary>Fixture ${escapeXml(options.name)}</summary>
      <description>Fixture ${escapeXml(options.name)}</description>
      <size package="10" installed="10" archive="10" />
      <location href="Packages/${escapeXml(options.name)}-${escapeXml(options.version)}-${escapeXml(options.release)}.x86_64.rpm" />
      <format xmlns:rpm="http://linux.duke.edu/metadata/rpm">
        <rpm:license>MIT</rpm:license>
        ${options.files ?? ''}
      </format>
    </package>`;
}

function primaryXml(): Buffer {
  const primary = [
    packageXml({
      name: 'shell-fixture', version: '1.0', release: '1.el9',
      files: '<file>/usr/bin/sh</file><file type="dir">/usr/bin</file><file type="ghost">/var/lib/&amp;&lt;quote&gt;</file><file>/usr/bin/sh</file><file type="invalid">/ignored</file><file />',
    }),
    packageXml({
      name: 'single-fixture', version: '2.0', release: '2.el9',
      files: '<file>/single/plain</file>',
    }),
    packageXml({ name: 'typed-single-fixture', version: '4.0', release: '4.el9', files: '<file type="ghost">/etc/ghost &quot;entry&quot;</file>' }),
    packageXml({ name: 'empty-fixture', version: '3.0', release: '3.el9' }),
  ].join('\n');
  return gzipSync(Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
    <metadata xmlns="http://linux.duke.edu/metadata/common" xmlns:rpm="http://linux.duke.edu/metadata/rpm" packages="4">
      ${primary}
    </metadata>`, 'utf8'));
}

const repositoryBase: Omit<Repository, 'baseUrl'> = {
  id: 'yum-file-fixture',
  name: 'YUM file fixture',
  enabled: true,
  gpgCheck: false,
  isOfficial: false,
};

describe('YUM primary file metadata survives parser, JSON, and local repository packaging', () => {
  let server: Server | undefined;
  let tempDir: string | undefined;

  afterEach(async () => {
    const activeServer = server;
    server = undefined;
    if (activeServer?.listening) {
      activeServer.closeAllConnections();
      await new Promise<void>((resolve) => activeServer.close(() => resolve()));
    }
    if (tempDir) {
      await fsp.rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('parses single/array file forms, preserves typed paths through JSON, and emits escaped primary/filelists entries', async () => {
    const primary = primaryXml();
    const fixtureServer = createServer((request, response) => {
      if (request.url === '/repodata/repomd.xml') {
        response.writeHead(200, { 'content-type': 'application/xml' });
        response.end('<?xml version="1.0"?><repomd><data type="primary"><location href="repodata/primary.xml.gz" /></data></repomd>');
        return;
      }
      if (request.url === '/repodata/primary.xml.gz') {
        response.writeHead(200, { 'content-type': 'application/gzip' });
        response.end(primary);
        return;
      }
      response.writeHead(404);
      response.end('not found');
    });
    server = fixtureServer;
    const port = await listen(fixtureServer);
    const repository: Repository = { ...repositoryBase, baseUrl: `http://127.0.0.1:${port}` };
    const parser = new YumMetadataParser(repository, 'x86_64');
    const repomd = await parser.parseRepomd();
    const parsed = await parser.parsePrimary(repomd.primary?.location ?? '');
    const roundTripped = JSON.parse(JSON.stringify(parsed)) as OSPackageInfo[];

    const shell = roundTripped.find((pkg) => pkg.name === 'shell-fixture');
    const single = roundTripped.find((pkg) => pkg.name === 'single-fixture');
    const empty = roundTripped.find((pkg) => pkg.name === 'empty-fixture');
    expect(shell?.rpmPrimaryFiles).toEqual([
      { path: '/usr/bin/sh', type: 'file' },
      { path: '/usr/bin', type: 'dir' },
      { path: '/var/lib/&<quote>', type: 'ghost' },
    ]);
    expect(single?.rpmPrimaryFiles).toEqual([{ path: '/single/plain', type: 'file' }]);
    expect(empty?.rpmPrimaryFiles).toBeUndefined();

    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'yum-file-provides-'));
    const payloads = new Map<string, string>();
    for (const pkg of roundTripped) {
      const source = path.join(tempDir, `${pkg.name}.rpm`);
      fs.writeFileSync(source, `${pkg.name} payload`);
      payloads.set(getDownloadedFileKey(pkg), source);
    }
    const repoPath = path.join(tempDir, 'repo');
    await new OSRepoPackager().createLocalRepo(roundTripped, payloads, {
      packageManager: 'yum',
      outputPath: repoPath,
      repoName: 'fixture-yum',
      includeSetupScript: false,
    });

    const primaryOutput = await fsp.readFile(path.join(repoPath, 'repodata/primary.xml.gz'));
    const filelistsOutput = await fsp.readFile(path.join(repoPath, 'repodata/filelists.xml.gz'));
    const primaryText = (await import('node:zlib')).gunzipSync(primaryOutput).toString('utf8');
    const filelistsText = (await import('node:zlib')).gunzipSync(filelistsOutput).toString('utf8');
    const block = (content: string, name: string): string => {
      const match = content
        .split('<package ')
        .map((part) => `<package ${part}`)
        .find((part) => part.includes(`<name>${name}</name>`) || part.includes(`name="${name}"`));
      expect(match, `missing ${name} package block`).toBeTruthy();
      return match ?? '';
    };
    const primaryShell = block(primaryText, 'shell-fixture');
    const primarySingle = block(primaryText, 'single-fixture');
    const primaryEmpty = block(primaryText, 'empty-fixture');
    const filelistsShell = block(filelistsText, 'shell-fixture');
    const filelistsSingle = block(filelistsText, 'single-fixture');
    const filelistsEmpty = block(filelistsText, 'empty-fixture');
    expect(primaryShell).toContain('<file>/usr/bin/sh</file>');
    expect(primaryShell).toContain('<file type="dir">/usr/bin</file>');
    expect(primaryShell).toContain('<file type="ghost">/var/lib/&amp;&lt;quote&gt;</file>');
    expect(primaryShell.match(/<file>\/usr\/bin\/sh<\/file>/g)).toHaveLength(1);
    expect(primaryShell).not.toContain('/single/plain');
    expect(primarySingle).toContain('<file>/single/plain</file>');
    expect(primaryEmpty).not.toContain('<file');
    expect(filelistsShell).toContain('<file>/usr/bin/sh</file>');
    expect(filelistsShell).toContain('<file type="dir">/usr/bin</file>');
    expect(filelistsShell).toContain('<file type="ghost">/var/lib/&amp;&lt;quote&gt;</file>');
    expect(filelistsShell.match(/<file>\/usr\/bin\/sh<\/file>/g)).toHaveLength(1);
    expect(filelistsSingle).toContain('<file>/single/plain</file>');
    expect(filelistsEmpty).not.toContain('<file');
    expect(filelistsText).not.toContain('name="undefined"');
    const xmlParser = new XMLParser({ ignoreAttributes: false, parseAttributeValue: false });
    const primaryPackages = xmlParser.parse(primaryText).metadata.package;
    const filelistsPackages = xmlParser.parse(filelistsText).filelists.package;
    for (const pkg of roundTripped) {
      const primaryPkg = primaryPackages.find((entry: Record<string, unknown>) => entry.name === pkg.name);
      const filelistsPkg = filelistsPackages.find((entry: Record<string, unknown>) => entry['@_name'] === pkg.name);
      expect(filelistsPkg['@_pkgid']).toBe(primaryPkg.checksum['#text']);
      expect(filelistsPkg.version).toEqual(primaryPkg.version);
      expect(filelistsPkg.version['@_ver']).toBe(pkg.version);
      expect(filelistsPkg.version['@_rel']).toBe(pkg.release);
      const expectedFiles = pkg.rpmPrimaryFiles?.map((file) => file.type === 'file'
        ? file.path : { '#text': file.path, '@_type': file.type });
      const normalizedFiles = (value: unknown) => value === undefined ? undefined : Array.isArray(value) ? value : [value];
      expect(normalizedFiles(primaryPkg.format.file)).toEqual(expectedFiles);
      expect(normalizedFiles(filelistsPkg.file)).toEqual(expectedFiles);
    }
    expect(roundTripped.find((pkg) => pkg.name === 'typed-single-fixture')?.rpmPrimaryFiles)
      .toEqual([{ path: '/etc/ghost "entry"', type: 'ghost' }]);
  });
});
