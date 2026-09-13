import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDownloadedFileKey } from './package-file-utils';
import { OSRepoPackager } from './repo-packager';
import type { OSPackageInfo } from './types';

function createYumPackage(overrides: Partial<OSPackageInfo> = {}): OSPackageInfo {
  return {
    name: 'fixture-rpm',
    version: '1.0',
    release: '1.el9',
    architecture: 'x86_64',
    size: 999,
    installedSize: 777,
    checksum: { type: 'sha256', value: '0'.repeat(64) },
    location: 'Packages/fixture-rpm-1.0-1.el9.x86_64.rpm',
    repository: {
      id: 'fixture-yum',
      name: 'Fixture YUM',
      baseUrl: 'https://example.test/rocky',
      enabled: true,
      gpgCheck: false,
      isOfficial: false,
    },
    dependencies: [],
    description: 'Fixture RPM',
    ...overrides,
  };
}

function writePayload(directory: string, filename: string, payload: Buffer | string): string {
  const filePath = path.join(directory, filename);
  fs.writeFileSync(filePath, payload);
  return filePath;
}

function metadataText(repoPath: string, filename: string): string {
  return gunzipSync(fs.readFileSync(path.join(repoPath, 'repodata', filename))).toString('utf8');
}

function packageBlock(xml: string): string {
  const match = xml.match(/<package\b[\s\S]*?<\/package>/);
  expect(match).toBeTruthy();
  return match?.[0] ?? '';
}

function attribute(block: string, name: string): string {
  const match = block.match(new RegExp(`${name}="([^"]*)"`));
  expect(match, `missing ${name} in ${block}`).toBeTruthy();
  return match?.[1] ?? '';
}

async function createYumRepo(
  packages: OSPackageInfo[],
  downloadedFiles: Map<string, string>,
  repoPath: string
) {
  return new OSRepoPackager().createLocalRepo(packages, downloadedFiles, {
    packageManager: 'yum',
    outputPath: repoPath,
    repoName: 'fixture-yum',
    includeSetupScript: false,
  });
}

describe('YUM payload validation and generated metadata', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'depssmuggler-yum-payload-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('rejects a missing mapping before creating metadata', async () => {
    const pkg = createYumPackage();
    const repoPath = path.join(tempDir, 'missing-map');

    await expect(createYumRepo([pkg], new Map(), repoPath)).rejects.toThrow(/payload|파일|다운로드/i);
    expect(fs.existsSync(path.join(repoPath, 'repodata'))).toBe(false);
  });

  it('rejects a missing source file before creating metadata', async () => {
    const pkg = createYumPackage();
    const repoPath = path.join(tempDir, 'missing-source');
    const missingSource = path.join(tempDir, 'does-not-exist.rpm');

    await expect(createYumRepo(
      [pkg], new Map([[getDownloadedFileKey(pkg), missingSource]]), repoPath
    )).rejects.toThrow(/payload|파일|다운로드/i);
    expect(fs.existsSync(path.join(repoPath, 'repodata'))).toBe(false);
  });

  it('validates every mapping before copying any payload', async () => {
    const first = createYumPackage({ name: 'first' });
    const second = createYumPackage({ name: 'second' });
    const firstSource = writePayload(tempDir, 'first.rpm', 'first payload');
    const repoPath = path.join(tempDir, 'preflight');

    await expect(createYumRepo(
      [first, second], new Map([[getDownloadedFileKey(first), firstSource]]), repoPath
    )).rejects.toThrow(/payload|파일|다운로드/i);
    expect(fs.existsSync(path.join(repoPath, 'Packages', 'first.rpm'))).toBe(false);
    expect(fs.existsSync(path.join(repoPath, 'repodata'))).toBe(false);
  });

  it('rejects a directory source as a payload', async () => {
    const pkg = createYumPackage();
    const sourceDirectory = path.join(tempDir, 'source-directory');
    fs.mkdirSync(sourceDirectory);

    await expect(createYumRepo(
      [pkg], new Map([[getDownloadedFileKey(pkg), sourceDirectory]]), path.join(tempDir, 'directory-source')
    )).rejects.toThrow();
  });

  it('rejects a non-file Packages destination', async () => {
    const pkg = createYumPackage();
    const source = writePayload(tempDir, 'source.rpm', 'source');
    const repoPath = path.join(tempDir, 'file-destination');
    fs.mkdirSync(repoPath, { recursive: true });
    fs.writeFileSync(path.join(repoPath, 'Packages'), 'caller-owned file');

    await expect(createYumRepo(
      [pkg], new Map([[getDownloadedFileKey(pkg), source]]), repoPath
    )).rejects.toThrow();
    expect(fs.readFileSync(path.join(repoPath, 'Packages'), 'utf8')).toBe('caller-owned file');
    expect(fs.existsSync(path.join(repoPath, 'repodata'))).toBe(false);
  });

  it('rejects a non-file payload leaf already present in Packages', async () => {
    const pkg = createYumPackage();
    const source = writePayload(tempDir, 'source.rpm', 'source');
    const repoPath = path.join(tempDir, 'directory-destination');
    fs.mkdirSync(path.join(repoPath, 'Packages', 'source.rpm'), { recursive: true });

    await expect(createYumRepo(
      [pkg], new Map([[getDownloadedFileKey(pkg), source]]), repoPath
    )).rejects.toThrow();
    expect(fs.existsSync(path.join(repoPath, 'repodata'))).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('rejects a symlink source payload', async () => {
    const pkg = createYumPackage();
    const target = writePayload(tempDir, 'target.rpm', 'target');
    const symlink = path.join(tempDir, 'source-link.rpm');
    fs.symlinkSync(target, symlink);

    await expect(createYumRepo(
      [pkg], new Map([[getDownloadedFileKey(pkg), symlink]]), path.join(tempDir, 'symlink-source')
    )).rejects.toThrow();
  });

  it.skipIf(process.platform === 'win32')('rejects a symlink Packages directory', async () => {
    const pkg = createYumPackage();
    const source = writePayload(tempDir, 'source.rpm', 'source');
    const repoPath = path.join(tempDir, 'symlink-destination');
    const packagesTarget = path.join(tempDir, 'packages-target');
    fs.mkdirSync(repoPath, { recursive: true });
    fs.mkdirSync(packagesTarget);
    fs.symlinkSync(packagesTarget, path.join(repoPath, 'Packages'), 'dir');

    await expect(createYumRepo(
      [pkg], new Map([[getDownloadedFileKey(pkg), source]]), repoPath
    )).rejects.toThrow();
    expect(fs.readdirSync(packagesTarget)).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')('rejects a symlink payload leaf already present in Packages', async () => {
    const pkg = createYumPackage();
    const source = writePayload(tempDir, 'source.rpm', 'source');
    const target = writePayload(tempDir, 'existing-target.rpm', 'existing');
    const repoPath = path.join(tempDir, 'symlink-file-destination');
    fs.mkdirSync(path.join(repoPath, 'Packages'), { recursive: true });
    fs.symlinkSync(target, path.join(repoPath, 'Packages', 'source.rpm'));

    await expect(createYumRepo(
      [pkg], new Map([[getDownloadedFileKey(pkg), source]]), repoPath
    )).rejects.toThrow();
    expect(fs.readFileSync(target, 'utf8')).toBe('existing');
  });

  it('rejects duplicate basenames before copying either payload', async () => {
    const first = createYumPackage({ name: 'first', version: '1.0' });
    const second = createYumPackage({ name: 'second', version: '2.0' });
    const firstDir = path.join(tempDir, 'first-source');
    const secondDir = path.join(tempDir, 'second-source');
    fs.mkdirSync(firstDir);
    fs.mkdirSync(secondDir);
    const firstSource = writePayload(firstDir, 'duplicate.rpm', 'first');
    const secondSource = writePayload(secondDir, 'duplicate.rpm', 'second');
    const repoPath = path.join(tempDir, 'duplicate');
    const files = new Map([
      [getDownloadedFileKey(first), firstSource],
      [getDownloadedFileKey(second), secondSource],
    ]);

    await expect(createYumRepo([first, second], files, repoPath)).rejects.toThrow(/중복|duplicate|basename/i);
    expect(fs.existsSync(path.join(repoPath, 'Packages', 'duplicate.rpm'))).toBe(false);
  });

  it('rejects case-only basename collisions for portable repositories', async () => {
    const first = createYumPackage({ name: 'first' });
    const second = createYumPackage({ name: 'second' });
    const lowerDir = path.join(tempDir, 'lower-source');
    const upperDir = path.join(tempDir, 'upper-source');
    fs.mkdirSync(lowerDir);
    fs.mkdirSync(upperDir);
    const lower = writePayload(lowerDir, 'package.rpm', 'first');
    const upper = writePayload(upperDir, 'PACKAGE.rpm', 'second');
    const files = new Map([
      [getDownloadedFileKey(first), lower],
      [getDownloadedFileKey(second), upper],
    ]);

    await expect(createYumRepo([first, second], files, path.join(tempDir, 'case-collision')))
      .rejects.toThrow(/파일명이 충돌|중복|duplicate|basename/i);
  });

  it('uses actual basename, bytes, and SHA256 consistently across all YUM indexes', async () => {
    const pkg = createYumPackage({
      name: 'model-name',
      version: '9.2',
      release: '4.el9',
      architecture: 'aarch64',
      size: 1,
      checksum: { type: 'sha256', value: 'f'.repeat(64) },
      location: 'Packages/model-name-9.2-4.el9.aarch64.rpm',
    });
    const payload = Buffer.from('actual RPM payload with metadata drift');
    const actualFilename = 'real payload #&%.rpm';
    const source = writePayload(tempDir, actualFilename, payload);
    const repoPath = path.join(tempDir, 'actual-metadata');
    const before = JSON.parse(JSON.stringify(pkg)) as OSPackageInfo;

    const result = await createYumRepo(
      [pkg], new Map([[getDownloadedFileKey(pkg), source]]), repoPath
    );

    const digest = crypto.createHash('sha256').update(payload).digest('hex');
    const encodedLocation = `Packages/${encodeURIComponent(actualFilename)}`;
    const primary = packageBlock(metadataText(repoPath, 'primary.xml.gz'));
    const filelists = packageBlock(metadataText(repoPath, 'filelists.xml.gz'));
    const other = packageBlock(metadataText(repoPath, 'other.xml.gz'));
    expect(fs.readFileSync(path.join(repoPath, 'Packages', actualFilename))).toEqual(payload);
    expect(primary).toContain(`href="${encodedLocation}"`);
    expect(primary).toContain(`type="sha256" pkgid="YES">${digest}</checksum>`);
    expect(primary).toContain(`package="${payload.length}"`);
    expect(primary).toContain('installed="777"');
    expect(primary).toContain(`archive="${payload.length}"`);
    expect(attribute(filelists, 'pkgid')).toBe(digest);
    expect(attribute(other, 'pkgid')).toBe(digest);
    expect(result.totalSize).toBe(payload.length);
    expect(pkg).toEqual(before);
  });

  it('preserves version, release, architecture, and known installed size for every entry', async () => {
    const packages = [
      createYumPackage({ name: 'versioned', version: '1.0', release: '01.el9', architecture: 'x86_64', installedSize: 0 }),
      createYumPackage({ name: 'versioned', version: '2.0', release: '02.el9', architecture: 'aarch64', installedSize: 202 }),
      createYumPackage({ name: 'versioned', version: '3.0', release: '03.el9', architecture: 'noarch', installedSize: 303 }),
      createYumPackage({ name: 'versioned', version: '1.0', release: '99.el9', architecture: 'x86_64', installedSize: 404 }),
      createYumPackage({ name: 'versioned', version: '1.0', release: '01.el9', architecture: 'aarch64', installedSize: 505 }),
    ];
    const files = new Map<string, string>();
    const payloadSizes: number[] = [];
    for (const [index, pkg] of packages.entries()) {
      const payload = Buffer.from(`${index}-payload`);
      const source = writePayload(tempDir, `${pkg.name}-${index}.rpm`, payload);
      payloadSizes.push(payload.length);
      files.set(getDownloadedFileKey(pkg), source);
    }
    const repoPath = path.join(tempDir, 'identity-fields');

    const result = await createYumRepo(packages, files, repoPath);
    const primary = metadataText(repoPath, 'primary.xml.gz');
    const blocks = [...primary.matchAll(/<package\b[\s\S]*?<\/package>/g)].map((match) => match[0]);
    expect(result.packageCount).toBe(5);
    expect(blocks).toHaveLength(5);
    expect(fs.readdirSync(path.join(repoPath, 'Packages'))).toHaveLength(5);
    expect(result.totalSize).toBe(payloadSizes.reduce((sum, size) => sum + size, 0));
    for (const pkg of packages) {
      const block = blocks.find((candidate) => candidate.includes(`<name>${pkg.name}</name>`)
        && candidate.includes(`ver="${pkg.version}"`)
        && candidate.includes(`rel="${pkg.release}"`)
        && candidate.includes(`<arch>${pkg.architecture}</arch>`)) ?? '';
      expect(block).toContain(`arch>${pkg.architecture}<`);
      expect(block).toContain(`ver="${pkg.version}"`);
      expect(block).toContain(`rel="${pkg.release}"`);
      expect(block).toContain(`installed="${pkg.installedSize}"`);
    }
  });

  it('overwrites an existing regular destination file with the current payload', async () => {
    const pkg = createYumPackage();
    const source = writePayload(tempDir, 'replacement.rpm', 'new bytes');
    const repoPath = path.join(tempDir, 'overwrite');
    fs.mkdirSync(path.join(repoPath, 'Packages'), { recursive: true });
    fs.writeFileSync(path.join(repoPath, 'Packages', 'replacement.rpm'), 'old bytes');

    await createYumRepo(
      [pkg], new Map([[getDownloadedFileKey(pkg), source]]), repoPath
    );
    expect(fs.readFileSync(path.join(repoPath, 'Packages', 'replacement.rpm'), 'utf8')).toBe('new bytes');
  });

  it('creates an empty repository without requiring payload mappings', async () => {
    const repoPath = path.join(tempDir, 'empty');

    const result = await createYumRepo([], new Map(), repoPath);

    expect(result.packageCount).toBe(0);
    expect(result.totalSize).toBe(0);
    expect(fs.existsSync(path.join(repoPath, 'Packages'))).toBe(true);
    expect(fs.existsSync(path.join(repoPath, 'repodata', 'primary.xml.gz'))).toBe(true);
  });
});
