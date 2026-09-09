import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';
import { gunzipSync } from 'zlib';
import * as tar from 'tar';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OSRepoPackager } from './repo-packager';
import type { OSPackageInfo } from './types';
import { getDownloadedFileKey } from './package-file-utils';

vi.mock('tar', async () => {
  const actual = await vi.importActual<typeof import('tar')>('tar');
  return { ...actual, c: vi.fn(actual.c) };
});

function createRpmPackage(): OSPackageInfo {
  return {
    name: 'httpd',
    version: '2.4.57',
    release: '3.el9',
    architecture: 'x86_64',
    size: 1024,
    checksum: {
      type: 'sha256',
      value: 'checksum-httpd',
    },
    location: 'Packages/httpd-2.4.57-3.el9.x86_64.rpm',
    repository: {
      id: 'baseos',
      name: 'BaseOS',
      baseUrl: 'https://example.test/baseos',
      enabled: true,
      gpgCheck: false,
      isOfficial: true,
    },
    dependencies: [],
    summary: 'Apache HTTP Server',
    description: 'Apache HTTP Server',
  };
}

function createAptPackage(overrides: Partial<OSPackageInfo> = {}): OSPackageInfo {
  return {
    name: 'raw-package',
    version: '1.0-1',
    architecture: 'amd64',
    size: 9999,
    installedSize: 4096,
    checksum: { type: 'sha256', value: 'stale-checksum' },
    location: 'pool/main/r/old-package_1.0-1_amd64.deb',
    repository: {
      id: 'ubuntu-main',
      name: 'Ubuntu Main',
      baseUrl: 'https://example.test/ubuntu',
      enabled: true,
      gpgCheck: false,
      isOfficial: true,
    },
    dependencies: [
      { name: 'foo', operator: '>=', version: '1.2' },
      { name: 'bar', operator: '<<', version: '3.0' },
    ],
    description: 'Fallback description',
    ...overrides,
  };
}

function createApkPackage(): OSPackageInfo {
  return {
    name: 'zlib',
    version: '1.3.2-r0',
    architecture: 'x86_64',
    size: 1024,
    checksum: {
      type: 'sha1',
      value: Buffer.alloc(20, 1).toString('base64'),
    },
    location: 'x86_64/zlib-1.3.2-r0.apk',
    repository: {
      id: 'alpine-main',
      name: 'Alpine Main',
      baseUrl: 'https://example.test/alpine',
      enabled: true,
      gpgCheck: false,
      isOfficial: true,
    },
    dependencies: [{ name: 'so:libc.musl-x86_64.so.1' }],
    description: 'Zlib compression library',
  };
}

async function readTarMembers(archivePath: string): Promise<Map<string, string>> {
  const members = new Map<string, string>();
  await new Promise<void>((resolve, reject) => {
    const stream = Readable.from(gunzipSync(fs.readFileSync(archivePath)));
    stream
      .pipe(
        tar.t({
          onReadEntry: (entry) => {
            const chunks: Buffer[] = [];
            entry.on('data', (chunk: Buffer) => chunks.push(chunk));
            entry.on('end', () => {
              members.set(entry.path, Buffer.concat(chunks).toString('utf8'));
            });
          },
        })
      )
      .on('end', resolve)
      .on('error', reject);
  });
  return members;
}

describe('OSRepoPackager', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'depssmuggler-repo-packager-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('APT 메타데이터는 복사된 payload의 basename, bytes, SHA256과 raw fields를 반영한다', async () => {
    const packager = new OSRepoPackager();
    const payload = Buffer.from('actual deb payload\n');
    const downloadedFile = path.join(tempDir, 'downloaded payload.deb');
    const repoPath = path.join(tempDir, 'apt-repo');
    fs.writeFileSync(downloadedFile, payload);
    const pkg = createAptPackage({
      aptControlFields: {
        Package: 'stale-name',
        Version: 'stale-version',
        Architecture: 'i386',
        Maintainer: 'Original Maintainer',
        Depends: 'foo (>= 1.2) | bar',
        'Pre-Depends': 'init-system (>= 1.0)',
        Provides: 'virtual-raw (= 1.0)',
        Conflicts: 'old-package',
        Breaks: 'broken-package',
        Replaces: 'replaced-package',
        'Multi-Arch': 'same',
        'Installed-Size': '42',
        Filename: 'old/path.deb',
        Size: '9999',
        MD5sum: 'stale-md5',
        SHA1: 'stale-sha1',
        SHA256: 'stale-sha256',
        SHA512: 'stale-sha512',
        Description: 'Raw summary\ncontinuation\n.\nfinal',
      },
    });

    await packager.createLocalRepo(
      [pkg],
      new Map([[getDownloadedFileKey(pkg), downloadedFile]]),
      { packageManager: 'apt', outputPath: repoPath, repoName: 'ubuntu-main', includeSetupScript: false }
    );

    const content = fs.readFileSync(path.join(repoPath, 'Packages'), 'utf8');
    const expectedHash = crypto.createHash('sha256').update(payload).digest('hex');
    expect(content).toContain('Package: raw-package');
    expect(content).toContain('Version: 1.0-1');
    expect(content).toContain('Architecture: amd64');
    expect(content).toContain('Filename: ./downloaded payload.deb');
    expect(content).toContain(`Size: ${payload.length}`);
    expect(content).toContain(`SHA256: ${expectedHash}`);
    expect(content).toContain('Depends: foo (>= 1.2) | bar');
    expect(content).toContain('Pre-Depends: init-system (>= 1.0)');
    expect(content).toContain('Description: Raw summary\n continuation\n .\n final');
    expect(content).not.toMatch(/^(?:MD5sum|SHA1|SHA512):/m);
    expect(content).not.toContain('old/path.deb');
    expect(content).not.toContain('Size: 9999');
  });

  it('APT fallback은 실제 payload를 요구하고 installedSize와 dependency operator를 보존한다', async () => {
    const packager = new OSRepoPackager();
    const payload = Buffer.from('fallback deb payload');
    const downloadedFile = path.join(tempDir, 'fallback.deb');
    const repoPath = path.join(tempDir, 'apt-fallback');
    fs.writeFileSync(downloadedFile, payload);
    const pkg = createAptPackage({
      aptControlFields: undefined,
      dependencies: [
        { name: 'strict-lower', operator: '<', version: '2.0' },
        { name: 'lower-or-equal', operator: '<=', version: '2.1' },
        { name: 'strict-higher', operator: '>', version: '3.0' },
        { name: 'higher-or-equal', operator: '>=', version: '3.1' },
        { name: 'exact', operator: '=', version: '4.0' },
      ],
      provides: ['virtual-raw'],
      conflicts: ['old-package'],
      recommends: ['recommended-package'],
      suggests: ['suggested-package'],
      description: 'Fallback description\n\ncontinued description',
    });

    await packager.createLocalRepo(
      [pkg],
      new Map([[getDownloadedFileKey(pkg), downloadedFile]]),
      { packageManager: 'apt', outputPath: repoPath, repoName: 'ubuntu-main', includeSetupScript: false }
    );

    const content = fs.readFileSync(path.join(repoPath, 'Packages'), 'utf8');
    expect(content).toContain('Installed-Size: 4');
    expect(content).toContain(
      'Depends: strict-lower (<< 2.0), lower-or-equal (<= 2.1), strict-higher (>> 3.0), higher-or-equal (>= 3.1), exact (= 4.0)'
    );
    expect(content).toContain('Provides: virtual-raw');
    expect(content).toContain('Conflicts: old-package');
    expect(content).toContain('Recommends: recommended-package');
    expect(content).toContain('Suggests: suggested-package');
    expect(content).toContain('Description: Fallback description\n .\n continued description');
    expect(content).not.toContain('Installed-Size: 9999');
  });

  it('APT 메타데이터는 복사되지 않은 payload를 성공으로 기록하지 않고 기존 index를 보존한다', async () => {
    const packager = new OSRepoPackager();
    const pkg = createAptPackage();
    const repoPath = path.join(tempDir, 'apt-missing');
    fs.mkdirSync(repoPath, { recursive: true });
    fs.writeFileSync(path.join(repoPath, 'Packages'), 'caller-owned Packages');

    await expect(packager.createLocalRepo(
      [pkg],
      new Map(),
      { packageManager: 'apt', outputPath: repoPath, repoName: 'ubuntu-main', includeSetupScript: false }
    )).rejects.toThrow(/payload|다운로드/i);
    expect(fs.readFileSync(path.join(repoPath, 'Packages'), 'utf8')).toBe('caller-owned Packages');
  });

  it('YUM 메타데이터에 실제 RPM release와 파일명을 반영한다', async () => {
    const packager = new OSRepoPackager();
    const pkg = createRpmPackage();
    const downloadedFile = path.join(tempDir, 'httpd-2.4.57-3.el9.x86_64.rpm');
    fs.writeFileSync(downloadedFile, 'rpm');

    const result = await packager.createLocalRepo(
      [pkg],
      new Map([[getDownloadedFileKey(pkg), downloadedFile]]),
      {
        packageManager: 'yum',
        outputPath: path.join(tempDir, 'repo'),
        repoName: 'test-repo',
      }
    );

    const primaryXmlGz = result.metadataFiles.find((file) => file.endsWith('primary.xml.gz'));
    expect(primaryXmlGz).toBeTruthy();

    const content = gunzipSync(fs.readFileSync(primaryXmlGz!)).toString('utf8');
    expect(content).toContain('Packages/httpd-2.4.57-3.el9.x86_64.rpm');
    expect(content).toContain('rel="3.el9"');
  });

  it('APK 메타데이터는 APKINDEX 단일 member를 갖는 gzip tar archive를 생성한다', async () => {
    const packager = new OSRepoPackager();
    const pkg = createApkPackage();
    const downloadedFile = path.join(tempDir, 'zlib-1.3.2-r0.apk');
    const repoPath = path.join(tempDir, 'repo');
    fs.writeFileSync(downloadedFile, 'apk');

    const result = await packager.createLocalRepo(
      [pkg],
      new Map([[getDownloadedFileKey(pkg), downloadedFile]]),
      {
        packageManager: 'apk',
        outputPath: repoPath,
        repoName: 'alpine-main',
        includeSetupScript: false,
      }
    );

    const archivePath = path.join(repoPath, 'APKINDEX.tar.gz');
    expect(result.metadataFiles).toEqual([archivePath]);
    expect(fs.readFileSync(archivePath).subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
    const members = await readTarMembers(archivePath);

    expect([...members.keys()]).toEqual(['APKINDEX']);
    expect(members.get('APKINDEX')).toContain('P:zlib');
    expect(members.get('APKINDEX')).toContain('V:1.3.2-r0');
    expect(members.get('APKINDEX')).toContain('A:x86_64');
    expect(members.get('APKINDEX')).toContain('D:so:libc.musl-x86_64.so.1');
    expect(fs.existsSync(path.join(repoPath, 'APKINDEX'))).toBe(false);
  });

  it('APK tar 생성 실패는 기존 plain/index archive를 보존하고 staging을 정리한다', async () => {
    const packager = new OSRepoPackager();
    const pkg = createApkPackage();
    const downloadedFile = path.join(tempDir, 'zlib-1.3.2-r0.apk');
    const repoPath = path.join(tempDir, 'repo');
    const plainIndex = Buffer.from('caller-owned-index');
    const oldArchive = Buffer.from('caller-owned-archive');
    fs.mkdirSync(repoPath, { recursive: true });
    fs.writeFileSync(downloadedFile, 'apk');
    fs.writeFileSync(path.join(repoPath, 'APKINDEX'), plainIndex);
    fs.writeFileSync(path.join(repoPath, 'APKINDEX.tar.gz'), oldArchive);
    vi.mocked(tar.c).mockRejectedValueOnce(new Error('tar fixture failure'));

    await expect(
      packager.createLocalRepo(
        [pkg],
        new Map([[getDownloadedFileKey(pkg), downloadedFile]]),
        {
          packageManager: 'apk',
          outputPath: repoPath,
          repoName: 'alpine-main',
          includeSetupScript: false,
        }
      )
    ).rejects.toThrow('tar fixture failure');

    expect(fs.readFileSync(path.join(repoPath, 'APKINDEX'))).toEqual(plainIndex);
    expect(fs.readFileSync(path.join(repoPath, 'APKINDEX.tar.gz'))).toEqual(oldArchive);
    expect(fs.readdirSync(repoPath).filter((entry) => entry.startsWith('.depssmuggler-apkindex-'))).toEqual([]);
  });

  it('APK metadata 생성은 기존 plain APKINDEX를 보존하면서 최종 archive만 교체한다', async () => {
    const packager = new OSRepoPackager();
    const pkg = createApkPackage();
    const downloadedFile = path.join(tempDir, 'zlib-1.3.2-r0.apk');
    const repoPath = path.join(tempDir, 'repo');
    const plainIndex = Buffer.from('caller-owned-index');
    const oldArchive = Buffer.from('caller-owned-archive');
    fs.mkdirSync(repoPath, { recursive: true });
    fs.writeFileSync(downloadedFile, 'apk');
    fs.writeFileSync(path.join(repoPath, 'APKINDEX'), plainIndex);
    fs.writeFileSync(path.join(repoPath, 'APKINDEX.tar.gz'), oldArchive);

    const result = await packager.createLocalRepo(
      [pkg],
      new Map([[getDownloadedFileKey(pkg), downloadedFile]]),
      {
        packageManager: 'apk',
        outputPath: repoPath,
        repoName: 'alpine-main',
        includeSetupScript: false,
      }
    );

    expect(fs.readFileSync(path.join(repoPath, 'APKINDEX'))).toEqual(plainIndex);
    expect(result.metadataFiles).toEqual([path.join(repoPath, 'APKINDEX.tar.gz')]);
    expect(fs.readFileSync(path.join(repoPath, 'APKINDEX.tar.gz'))).not.toEqual(oldArchive);
    const members = await readTarMembers(path.join(repoPath, 'APKINDEX.tar.gz'));
    expect([...members.keys()]).toEqual(['APKINDEX']);
    expect(fs.readdirSync(repoPath).filter((entry) => entry.startsWith('.depssmuggler-apkindex-'))).toEqual([]);
  });
});
