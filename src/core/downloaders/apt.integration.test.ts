/**
 * Opt-in Ubuntu APT backend integration tests.
 *
 * Run explicitly with:
 *   INTEGRATION_TEST=true npm test -- apt.integration.test.ts
 */

import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import * as tar from 'tar';
import { afterAll, describe, expect, it } from 'vitest';
import { downloadOSPackages, searchOSPackages } from './os-shared/cli-backend';
import { getDistributionById } from './os-shared/repositories';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const yauzl = require('yauzl') as {
  open: (
    filePath: string,
    options: { lazyEntries: boolean },
    callback: (
      error: Error | null,
      zipFile?: {
        readEntry: () => void;
        on: (event: string, listener: (...args: any[]) => void) => void;
        openReadStream: (
          entry: any,
          callback: (error: Error | null, stream?: NodeJS.ReadableStream) => void
        ) => void;
        close: () => void;
      }
    ) => void
  ) => void;
};
const INTEGRATION_TEST = process.env.INTEGRATION_TEST === 'true';
const describeIntegration = INTEGRATION_TEST ? describe : describe.skip;

async function readDebControl(debPath: string): Promise<string> {
  if (process.platform === 'win32') {
    throw new Error('DEB control inspection is unavailable on Windows');
  }
  const table = await execFileAsync('ar', ['t', debPath], { encoding: 'utf8' });
  const controlMember = table.stdout
    .split(/\r?\n/)
    .find((entry) => entry.startsWith('control.tar'));
  if (!controlMember) throw new Error(`control archive missing from ${debPath}`);
  const control = await execFileAsync('ar', ['p', debPath, controlMember], { encoding: 'buffer' });
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-deb-control-'));
  const controlPath = path.join(temporaryDirectory, controlMember);
  try {
    await fs.writeFile(controlPath, control.stdout);
    const extracted = await execFileAsync('tar', ['-xO', '-f', controlPath, './control'], {
      encoding: 'utf8',
    });
    return extracted.stdout;
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function field(control: string, name: string): string | undefined {
  return control.match(new RegExp(`^${name}: ([^\\n]+)`, 'm'))?.[1];
}

async function listTarGzEntries(archivePath: string): Promise<string[]> {
  const entries: string[] = [];
  await tar.t({
    file: archivePath,
    onentry: (entry) => {
      entries.push(entry.path);
      entry.resume();
    },
  });
  return entries;
}

async function readZipEntries(archivePath: string): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true }, (error, zipFile) => {
      if (error || !zipFile) {
        reject(error ?? new Error('ZIP archive could not be opened'));
        return;
      }
      const entries = new Map<string, Buffer>();
      zipFile.on('error', reject);
      zipFile.on('end', () => resolve(entries));
      zipFile.on('entry', (entry: { fileName: string }) => {
        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            reject(streamError ?? new Error(`ZIP entry could not be opened: ${entry.fileName}`));
            zipFile.close();
            return;
          }
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('error', reject);
          stream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(chunks));
            zipFile.readEntry();
          });
        });
      });
      zipFile.readEntry();
    });
  });
}

const distribution = getDistributionById('ubuntu-22.04');

describeIntegration('Ubuntu APT backend integration', () => {
  let tempDirectory: string | undefined;

  afterAll(async () => {
    if (tempDirectory) await fs.rm(tempDirectory, { recursive: true, force: true });
  });

  it('searches zlib1g from Ubuntu 22.04 metadata', async () => {
    if (!distribution) throw new Error('ubuntu-22.04 distribution is not configured');
    tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-apt-integration-'));

    const results = await searchOSPackages({
      distribution,
      architecture: 'amd64',
      query: 'zlib1g',
      matchType: 'exact',
      limit: 5,
      cacheDirectory: path.join(tempDirectory, 'search-cache'),
      cacheEnabled: true,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((result) => result.name === 'zlib1g')).toBe(true);
    expect(results[0].latest.architecture).toBe('amd64');
    expect(results[0].latest.version).toBeTruthy();
    expect(results[0].latest.location).toMatch(/\.deb$/);
  }, 300_000);

  it('downloads exactly zlib1g when dependency expansion is disabled', async () => {
    if (!distribution) throw new Error('ubuntu-22.04 distribution is not configured');
    if (!tempDirectory)
      tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-apt-integration-'));
    const outputPath = path.join(tempDirectory, 'no-deps');

    const result = await downloadOSPackages({
      distribution,
      architecture: 'amd64',
      packageNames: ['zlib1g'],
      outputPath,
      outputType: 'archive',
      archiveFormat: 'zip',
      resolveDependencies: false,
      includeScripts: false,
      concurrency: 1,
      cacheDirectory: path.join(outputPath, 'cache'),
      cacheEnabled: false,
    });

    expect(result.requestedPackages).toHaveLength(1);
    expect(result.requestedPackages[0].name).toBe('zlib1g');
    expect(result.packages).toHaveLength(1);
    expect(result.packages[0].name).toBe('zlib1g');
    expect(result.unresolved).toEqual([]);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].type).toBe('archive');
    const archiveStat = await fs.stat(result.artifacts[0].path);
    expect(archiveStat.isFile()).toBe(true);
    const archiveEntries = await readZipEntries(result.artifacts[0].path);
    const debEntries = [...archiveEntries.keys()].filter((entry) => entry.endsWith('.deb'));
    expect(debEntries).toHaveLength(1);
    const debBytes = archiveEntries.get(debEntries[0]);
    if (!debBytes) throw new Error('ZIP DEB entry was empty');
    const extractionDirectory = await fs.mkdtemp(path.join(tempDirectory, 'no-deps-control-'));
    const debPath = path.join(extractionDirectory, path.basename(debEntries[0]));
    await fs.writeFile(debPath, debBytes);
    const control = await readDebControl(debPath);
    expect(field(control, 'Package')).toBe('zlib1g');
    expect(field(control, 'Version')).toBe(result.packages[0].version);
    expect(field(control, 'Architecture')).toBe('amd64');
  }, 300_000);

  it('retains exact dependency closure and conflict alternatives in repository and tarball output', async () => {
    if (!distribution) throw new Error('ubuntu-22.04 distribution is not configured');
    if (!tempDirectory)
      tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-apt-integration-'));
    const outputPath = path.join(tempDirectory, 'with-deps');

    const result = await downloadOSPackages({
      distribution,
      architecture: 'amd64',
      packageNames: ['zlib1g'],
      outputPath,
      outputType: 'both',
      archiveFormat: 'tar.gz',
      resolveDependencies: true,
      includeScripts: true,
      concurrency: 2,
      cacheDirectory: path.join(outputPath, 'cache'),
      cacheEnabled: false,
    });

    expect(result.requestedPackages).toHaveLength(1);
    expect(result.requestedPackages[0].name).toBe('zlib1g');
    expect(result.unresolved).toEqual([]);
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.warnings.some((warning) => warning.includes('충돌'))).toBe(true);
    expect(result.artifacts).toHaveLength(2);
    const repositoryArtifact = result.artifacts.find((artifact) => artifact.type === 'repository');
    const archiveArtifact = result.artifacts.find((artifact) => artifact.type === 'archive');
    if (!repositoryArtifact || !archiveArtifact) {
      throw new Error('APT backend did not produce both repository and archive artifacts');
    }

    const debFiles = (await fs.readdir(repositoryArtifact.path)).filter((filename) =>
      filename.endsWith('.deb')
    );
    expect(debFiles.length).toBeGreaterThan(1);
    const controls = await Promise.all(
      debFiles.map(async (filename) => ({
        filename,
        text: await readDebControl(path.join(repositoryArtifact.path, filename)),
      }))
    );
    expect(controls).toHaveLength(result.packages.length);
    for (const controlEntry of controls) {
      const matchingPackage = result.packages.find(
        (pkg) =>
          field(controlEntry.text, 'Package') === pkg.name &&
          field(controlEntry.text, 'Version') === pkg.version &&
          field(controlEntry.text, 'Architecture') === pkg.architecture
      );
      expect(matchingPackage, `missing result package for ${controlEntry.filename}`).toBeDefined();
    }
    const libgccAlternatives = controls.filter(
      ({ text }) => field(text, 'Package') === 'libgcc-s1'
    );
    expect(libgccAlternatives.length).toBeGreaterThan(0);
    for (const alternative of libgccAlternatives) {
      const exactDependencyMatch = alternative.text.match(/gcc-12-base \(= ([^)]+)\)/);
      if (!exactDependencyMatch) {
        throw new Error(`missing exact gcc-12-base dependency in ${alternative.filename}`);
      }
      const exactDependency = exactDependencyMatch[1];
      const matchingBase = controls.find(
        ({ text }) =>
          field(text, 'Package') === 'gcc-12-base' && field(text, 'Version') === exactDependency
      );
      expect(matchingBase, `missing exact base for ${alternative.filename}`).toBeDefined();
    }

    const archiveEntries = await listTarGzEntries(archiveArtifact.path);
    const archiveDebNames = new Set(
      archiveEntries.filter((entry) => entry.endsWith('.deb')).map((entry) => path.basename(entry))
    );
    expect(archiveDebNames).toEqual(new Set(debFiles));
    expect(archiveEntries.some((entry) => entry.includes('zlib1g_'))).toBe(true);
    await expect(fs.access(path.join(outputPath, 'install.sh'))).rejects.toThrow();
    await expect(fs.access(path.join(outputPath, 'install.ps1'))).rejects.toThrow();
  }, 300_000);
});
