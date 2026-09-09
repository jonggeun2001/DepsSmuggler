import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { gunzipSync } from 'node:zlib';
import * as tar from 'tar';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('tar', async () => {
  const actual = await vi.importActual<typeof import('tar')>('tar');
  return { ...actual, c: vi.fn(actual.c) };
});

import { ApkMetadataParser } from '../apk';
import { getDownloadedFileKey, getPackageFilename } from './package-file-utils';
import { OSRepoPackager } from './repo-packager';
import type { OSPackageInfo } from './types';

function createApkPackage(): OSPackageInfo {
  return {
    name: 'fixture-package',
    version: '1.2.3-r0',
    architecture: 'x86_64',
    size: 17,
    checksum: {
      type: 'sha256',
      value: `sha256:${'a'.repeat(64)}`,
    },
    location: 'x86_64/fixture-package-1.2.3-r0.apk',
    repository: {
      id: 'fixture',
      name: 'Fixture repository',
      baseUrl: 'http://127.0.0.1',
      enabled: true,
      gpgCheck: false,
      isOfficial: false,
    },
    description: 'A package used by the APK repository consumer regression test',
    dependencies: [{ name: 'fixture-dependency', version: '2.0', operator: '>=' }],
  };
}

async function readTarEntries(payload: Buffer): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    const entries = new Map<string, string>();
    const stream = Readable.from(payload).pipe(
      tar.t({
        onReadEntry: (entry) => {
          const chunks: Buffer[] = [];
          entry.on('data', (chunk: Buffer) => chunks.push(chunk));
          entry.on('end', () => entries.set(entry.path, Buffer.concat(chunks).toString('utf8')));
        },
      })
    );

    stream.on('end', () => resolve(entries));
    stream.on('error', reject);
  });
}

describe('APK repository archive consumer contract', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('creates a tar archive consumed by ApkMetadataParser with only APKINDEX', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'depssmuggler-apk-consumer-'));
    tempDirs.push(tempDir);
    const repoPath = path.join(tempDir, 'repo');
    const pkg = createApkPackage();
    const packagePath = path.join(tempDir, getPackageFilename(pkg, 'apk'));
    fs.writeFileSync(packagePath, 'fixture apk bytes');
    fs.mkdirSync(repoPath, { recursive: true });
    const callerOwnedIndex = Buffer.from('caller-owned plain index');
    fs.writeFileSync(path.join(repoPath, 'APKINDEX'), callerOwnedIndex);

    const result = await new OSRepoPackager().createLocalRepo(
      [pkg],
      new Map([[getDownloadedFileKey(pkg), packagePath]]),
      {
        packageManager: 'apk',
        outputPath: repoPath,
        repoName: 'fixture',
        includeSetupScript: false,
      }
    );

    const metadataPath = path.join(repoPath, 'APKINDEX.tar.gz');
    expect(result.metadataFiles).toEqual([metadataPath]);
    expect(fs.readFileSync(path.join(repoPath, 'APKINDEX'))).toEqual(callerOwnedIndex);
    expect(fs.readFileSync(metadataPath).subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));

    const entries = await readTarEntries(gunzipSync(fs.readFileSync(metadataPath)));
    expect([...entries.keys()]).toEqual(['APKINDEX']);
    expect(entries.get('APKINDEX')).toContain('P:fixture-package');
    expect(entries.get('APKINDEX')).toContain('V:1.2.3-r0');
    expect(entries.get('APKINDEX')).toContain('A:x86_64');
    expect(entries.get('APKINDEX')).toContain('D:fixture-dependency');
    expect(entries.get('APKINDEX')).toContain(`C:${pkg.checksum.value}`);

    const server = http.createServer((request, response) => {
      if (request.url === '/x86_64/APKINDEX.tar.gz') {
        response.writeHead(200, { 'content-type': 'application/gzip' });
        response.end(fs.readFileSync(metadataPath));
        return;
      }
      response.writeHead(404);
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('fixture server did not bind');
      const parsed = await new ApkMetadataParser(
        { ...pkg.repository, baseUrl: `http://127.0.0.1:${address.port}` },
        'x86_64'
      ).parseIndex();
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toMatchObject({
        name: pkg.name,
        version: pkg.version,
        architecture: pkg.architecture,
        checksum: { type: 'sha256', value: 'a'.repeat(64) },
      });
      expect(parsed[0].dependencies).toEqual([
        { name: 'fixture-dependency', version: undefined, operator: undefined },
      ]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }

    expect(fs.readdirSync(repoPath).filter((entry) => entry.startsWith('APKINDEX'))).toEqual([
      'APKINDEX',
      'APKINDEX.tar.gz',
    ]);
  });

  it('propagates tar creation failure without touching caller-owned index files', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'depssmuggler-apk-consumer-failure-'));
    tempDirs.push(tempDir);
    const repoPath = path.join(tempDir, 'repo');
    const pkg = createApkPackage();
    const packagePath = path.join(tempDir, getPackageFilename(pkg, 'apk'));
    fs.writeFileSync(packagePath, 'fixture apk bytes');
    fs.mkdirSync(repoPath, { recursive: true });
    const plainSentinel = Buffer.from('plain sentinel');
    const archiveSentinel = Buffer.from('archive sentinel');
    fs.writeFileSync(path.join(repoPath, 'APKINDEX'), plainSentinel);
    fs.writeFileSync(path.join(repoPath, 'APKINDEX.tar.gz'), archiveSentinel);
    const tarCreate = vi.mocked(tar.c);
    tarCreate.mockRejectedValueOnce(new Error('tar fixture failure'));

    try {
      await expect(
        new OSRepoPackager().createLocalRepo(
          [pkg],
          new Map([[getDownloadedFileKey(pkg), packagePath]]),
          {
            packageManager: 'apk',
            outputPath: repoPath,
            repoName: 'fixture',
            includeSetupScript: false,
          }
        )
      ).rejects.toThrow('tar fixture failure');
    } finally {
      tarCreate.mockReset();
    }

    expect(fs.readFileSync(path.join(repoPath, 'APKINDEX'))).toEqual(plainSentinel);
    expect(fs.readFileSync(path.join(repoPath, 'APKINDEX.tar.gz'))).toEqual(archiveSentinel);
    expect(
      fs
        .readdirSync(repoPath)
        .filter((entry) => fs.statSync(path.join(repoPath, entry)).isDirectory())
    ).toEqual([]);
  });
});
