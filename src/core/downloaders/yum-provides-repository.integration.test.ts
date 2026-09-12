import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createServer, type Server } from 'node:http';
import { gzipSync, gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { YumMetadataParser } from './yum';
import { OSRepoPackager } from './os-shared/repo-packager';
import { getDownloadedFileKey, getPackageFilename } from './os-shared/package-file-utils';
import type { Repository } from './os-shared/types';

const repository: Repository = {
  id: 'fixture-9',
  name: 'YUM capability fixture',
  baseUrl: '',
  enabled: true,
  gpgCheck: false,
  isOfficial: false,
};

describe('YUM parser to local repository capability boundary', () => {
  let server: Server | undefined;
  let tempRoot: string | undefined;

  afterEach(async () => {
    if (server?.listening) await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  });

  it('preserves parsed provides and requires through generated primary.xml.gz', async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'depssmuggler-yum-provides-'));
    const primaryXml = `<?xml version="1.0" encoding="UTF-8"?>
<metadata xmlns="http://linux.duke.edu/metadata/common" xmlns:rpm="http://linux.duke.edu/metadata/rpm" packages="2">
  <package type="rpm">
    <name>consumer</name><arch>x86_64</arch><version epoch="0" ver="1.0" rel="1"/>
    <checksum type="sha256">${crypto.createHash('sha256').update('consumer').digest('hex')}</checksum>
    <summary>consumer</summary><description>consumer</description><size package="8" installed="8" archive="8"/>
    <location href="Packages/consumer-1.0-1.x86_64.rpm"/>
    <format><rpm:requires><rpm:entry name="libtinfo.so.6()(64bit)"/></rpm:requires>
      <rpm:provides><rpm:entry name="consumer"/><rpm:entry name="capability &lt;x&gt;&amp;y"/></rpm:provides></format>
  </package>
  <package type="rpm">
    <name>ncurses-libs</name><arch>x86_64</arch><version epoch="0" ver="6.0" rel="2"/>
    <checksum type="sha256">${crypto.createHash('sha256').update('ncurses').digest('hex')}</checksum>
    <summary>ncurses</summary><description>ncurses</description><size package="7" installed="7" archive="7"/>
    <location href="Packages/ncurses-libs-6.0-2.x86_64.rpm"/>
    <format><rpm:provides>
      <rpm:entry name="ncurses-libs"/><rpm:entry name="libtinfo.so.6()(64bit)"/>
      <rpm:entry name="libtinfo.so.6()(64bit)"/><rpm:entry name="capability &lt;x&gt;&amp;y"/>
    </rpm:provides></format>
  </package>
</metadata>`;
    server = createServer((request, response) => {
      if (request.url === '/repodata/primary.xml.gz') {
        response.writeHead(200, { 'content-type': 'application/gzip' });
        response.end(gzipSync(Buffer.from(primaryXml)));
      } else {
        response.writeHead(404);
        response.end();
      }
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fixture server did not start');

    const parser = new YumMetadataParser({ ...repository, baseUrl: `http://127.0.0.1:${address.port}` });
    const packages = await parser.parsePrimary('repodata/primary.xml.gz');
    expect(packages).toHaveLength(2);
    const consumer = packages.find((pkg) => pkg.name === 'consumer');
    const provider = packages.find((pkg) => pkg.name === 'ncurses-libs');
    expect(consumer?.dependencies).toEqual([{ name: 'libtinfo.so.6()(64bit)', version: undefined, operator: undefined, isOptional: false }]);
    expect(provider?.provides).toEqual([
      'ncurses-libs',
      'libtinfo.so.6()(64bit)',
      'libtinfo.so.6()(64bit)',
      'capability <x>&y',
    ]);

    const downloaded = new Map<string, string>();
    for (const pkg of packages) {
      const file = path.join(tempRoot, getPackageFilename(pkg, 'yum'));
      fs.writeFileSync(file, `${pkg.name}-${pkg.version}-${pkg.release}`);
      downloaded.set(getDownloadedFileKey(pkg), file);
    }
    const repoPath = path.join(tempRoot, 'local yum repo');
    const result = await new OSRepoPackager().createLocalRepo(packages, downloaded, {
      packageManager: 'yum',
      outputPath: repoPath,
      repoName: 'fixture',
      includeSetupScript: false,
    });
    const primaryPath = result.metadataFiles.find((file) => file.endsWith('primary.xml.gz'));
    expect(primaryPath).toBeDefined();
    const generated = gunzipSync(fs.readFileSync(primaryPath!)).toString('utf8');
    expect(generated).toContain('name="libtinfo.so.6()(64bit)"');
    expect(generated).toContain('name="capability &lt;x&gt;&amp;y"');
    expect((generated.match(/name="libtinfo\.so\.6\(\)\(64bit\)"/g) ?? []).length).toBe(2);
    expect((generated.match(/name="capability &lt;x&gt;&amp;y"/g) ?? []).length).toBe(2);
    expect(result.packageCount).toBe(2);
  });
});
