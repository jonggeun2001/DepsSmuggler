import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { AptMetadataParser } from './apt';
import { getDownloadedFileKey } from './os-shared/package-file-utils';
import { OSRepoPackager } from './os-shared/repo-packager';
import type { Repository } from './os-shared/types';

type ControlFields = Map<string, string>;

function parseControlFields(content: string): ControlFields {
  const fields = new Map<string, string>();
  let key = '';
  let value = '';
  for (const line of content.split('\n')) {
    if (/^[ \t]/.test(line)) {
      if (key) value += `\n${line.slice(1)}`;
    } else if (line.includes(':')) {
      if (key) fields.set(key, value);
      const separator = line.indexOf(':');
      key = line.slice(0, separator);
      value = line.slice(separator + 1).trim();
    }
  }
  if (key) fields.set(key, value);
  return fields;
}

function listen(server: http.Server): Promise<number> {
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

describe('APT repository metadata semantic fidelity', () => {
  const tempDirs: string[] = [];
  let server: http.Server | undefined;

  afterEach(async () => {
    const activeServer = server;
    server = undefined;
    if (activeServer?.listening) {
      await new Promise<void>((resolve) => activeServer.close(() => resolve()));
    }
    for (const directory of tempDirs.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('preserves APT semantic fields and derives transport metadata from copied bytes', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'depssmuggler apt metadata-'));
    tempDirs.push(tempDir);
    const payload = Buffer.from('actual local deb payload\n', 'utf8');
    const sourcePath = path.join(tempDir, 'downloaded-package.deb');
    fs.writeFileSync(sourcePath, payload);
    const repository: Repository = {
      id: 'fixture-apt',
      name: 'Fixture APT',
      baseUrl: 'http://127.0.0.1',
      enabled: true,
      gpgCheck: false,
      isOfficial: false,
    };
    const packages = `Package: fixture-apt\nVersion: 1.2.3\nArchitecture: amd64\nSize: 999\nInstalled-Size: 42\nFilename: pool/stale-fixture.deb\nSHA256: stale-sha256\nSHA1: stale-sha1\nMD5sum: stale-md5\nSHA512: stale-sha512\nDepends: dep-a (= 1.2) | dep-b (>= 2.0), dep-c (<< 4.0)\nPre-Depends: base (= 1.0)\nProvides: virtual-name (= 3.0)\nConflicts: conflict-a (<< 2.0)\nBreaks: broken-a (>= 4.0)\nReplaces: replaced-a (= 5.0)\nMulti-Arch: same\nDescription: Fixture summary\n long description\n .\n final paragraph\n`;
    server = http.createServer((request, response) => {
      if (request.url === '/main/binary-amd64/Packages.gz') {
        response.writeHead(200, { 'content-type': 'application/gzip' });
        response.end(gzipSync(Buffer.from(packages, 'utf8')));
        return;
      }
      response.writeHead(404);
      response.end();
    });
    const port = await listen(server);
    const parsedRepository = { ...repository, baseUrl: `http://127.0.0.1:${port}` };
    const parsed = await new AptMetadataParser(parsedRepository, 'main', 'amd64').parsePackages();
    expect(parsed).toHaveLength(1);
    const pkg = parsed[0];
    const repoPath = path.join(tempDir, 'generated repo');

    await new OSRepoPackager().createLocalRepo(
      [pkg],
      new Map([[getDownloadedFileKey(pkg), sourcePath]]),
      {
        packageManager: 'apt',
        outputPath: repoPath,
        repoName: 'fixture',
        includeSetupScript: false,
      }
    );

    const generated = gunzipSync(fs.readFileSync(path.join(repoPath, 'Packages.gz'))).toString(
      'utf8'
    );
    const fields = parseControlFields(generated);
    const sha256 = createHash('sha256').update(payload).digest('hex');
    const sha1 = createHash('sha1').update(payload).digest('hex');
    const md5 = createHash('md5').update(payload).digest('hex');
    const plain = fs.readFileSync(path.join(repoPath, 'Packages'), 'utf8');
    expect(gunzipSync(fs.readFileSync(path.join(repoPath, 'Packages.gz'))).toString('utf8')).toBe(
      plain
    );

    expect(fields.get('Depends')).toBe('dep-a (= 1.2) | dep-b (>= 2.0), dep-c (<< 4.0)');
    expect(fields.get('Pre-Depends')).toBe('base (= 1.0)');
    expect(fields.get('Provides')).toBe('virtual-name (= 3.0)');
    expect(fields.get('Conflicts')).toBe('conflict-a (<< 2.0)');
    expect(fields.get('Breaks')).toBe('broken-a (>= 4.0)');
    expect(fields.get('Replaces')).toBe('replaced-a (= 5.0)');
    expect(fields.get('Multi-Arch')).toBe('same');
    expect(fields.get('Installed-Size')).toBe('42');
    expect(fields.get('Description')).toBe('Fixture summary\nlong description\n.\nfinal paragraph');
    expect(fields.get('Filename')).toBe('./downloaded-package.deb');
    expect(fields.get('Size')).toBe(String(payload.length));
    expect(fields.get('SHA256')).toBe(sha256);
    if (fields.has('SHA1')) expect(fields.get('SHA1')).toBe(sha1);
    if (fields.has('MD5sum')) expect(fields.get('MD5sum')).toBe(md5);
    expect(fields.get('SHA512')).toBeUndefined();
    expect(fs.readFileSync(path.join(repoPath, 'downloaded-package.deb'))).toEqual(payload);
  });
});
