/**
 * Alpine APK capability/dependency integration test.
 *
 * Run explicitly with:
 *   INTEGRATION_TEST=true npm test -- apk.integration.test.ts
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as tar from 'tar';
import { afterAll, describe, expect, it } from 'vitest';
import { downloadOSPackages } from './os-shared/cli-backend';
import { getDistributionById } from './os-shared/repositories';

const INTEGRATION_TEST = process.env.INTEGRATION_TEST === 'true';
const describeIntegration = INTEGRATION_TEST ? describe : describe.skip;

interface ExtractedApk {
  filename: string;
  pkgInfo: string;
}

async function extractApkArchive(archivePath: string, destination: string): Promise<ExtractedApk[]> {
  await fs.mkdir(destination, { recursive: true });
  await tar.x({ file: archivePath, cwd: destination });

  const packagesDirectory = path.join(destination, 'packages');
  const filenames = (await fs.readdir(packagesDirectory))
    .filter((filename) => filename.endsWith('.apk'))
    .sort();
  const extracted: ExtractedApk[] = [];

  for (const filename of filenames) {
    const packageDirectory = await fs.mkdtemp(path.join(destination, 'apk-'));
    await tar.x({ file: path.join(packagesDirectory, filename), cwd: packageDirectory });
    const pkgInfoPath = path.join(packageDirectory, '.PKGINFO');
    extracted.push({
      filename,
      pkgInfo: await fs.readFile(pkgInfoPath, 'utf8'),
    });
  }

  return extracted;
}

function packageInfoFor(extracted: ExtractedApk[], packageName: string): string {
  const packageInfo = extracted.find((item) =>
    item.pkgInfo.split(/\r?\n/).some((line) => line === `pkgname = ${packageName}`)
  );
  if (!packageInfo) {
    throw new Error(`.PKGINFO for ${packageName} was not found`);
  }
  return packageInfo.pkgInfo;
}

describeIntegration('Alpine APK capability dependency integration', () => {
  const distribution = getDistributionById('alpine-3.20');
  let tempDirectory: string | undefined;

  afterAll(async () => {
    if (tempDirectory) {
      await fs.rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it('includes the musl capability provider with deps and only zlib without deps', async () => {
    if (!distribution) {
      throw new Error('alpine-3.20 distribution is not configured');
    }

    tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-apk-integration-'));
    const withDependenciesDirectory = path.join(tempDirectory, 'with-dependencies');
    const withoutDependenciesDirectory = path.join(tempDirectory, 'without-dependencies');

    const commonOptions = {
      distribution,
      architecture: 'x86_64' as const,
      packageNames: ['zlib'],
      outputType: 'archive' as const,
      archiveFormat: 'tar.gz' as const,
      includeScripts: false,
      concurrency: 1,
      cacheEnabled: true,
    };

    const withDependencies = await downloadOSPackages({
      ...commonOptions,
      outputPath: path.join(withDependenciesDirectory, 'zlib-with-dependencies'),
      resolveDependencies: true,
      cacheDirectory: path.join(withDependenciesDirectory, 'cache'),
    });
    const withoutDependencies = await downloadOSPackages({
      ...commonOptions,
      outputPath: path.join(withoutDependenciesDirectory, 'zlib-without-dependencies'),
      resolveDependencies: false,
      cacheDirectory: path.join(withoutDependenciesDirectory, 'cache'),
    });

    for (const result of [withDependencies, withoutDependencies]) {
      expect(result.requestedPackages).toHaveLength(1);
      expect(result.requestedPackages[0].name).toBe('zlib');
      expect(result.requestedPackages[0].architecture).toBe('x86_64');
      expect(result.requestedPackages[0].version).toBeTruthy();
      expect(result.requestedPackages[0].location).toMatch(/\.apk$/);
      expect(result.requestedPackages[0].checksum.type).toBe('sha1');
      expect(result.requestedPackages[0].checksum.value).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
      expect(result.requestedPackages[0].checksum.value.length).toBeGreaterThan(20);
      expect(result.requestedPackages[0].size).toBeGreaterThan(0);
      expect(result.unresolved).toEqual([]);
      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0].type).toBe('archive');
    }

    const withDependenciesPackages = new Set(withDependencies.packages.map((pkg) => pkg.name));
    const withoutDependenciesPackages = new Set(withoutDependencies.packages.map((pkg) => pkg.name));
    expect(withDependenciesPackages).toEqual(new Set(['musl', 'zlib']));
    expect(withoutDependenciesPackages).toEqual(new Set(['zlib']));

    const withDependenciesApks = await extractApkArchive(
      withDependencies.artifacts[0].path,
      path.join(withDependenciesDirectory, 'extracted'),
    );
    const withoutDependenciesApks = await extractApkArchive(
      withoutDependencies.artifacts[0].path,
      path.join(withoutDependenciesDirectory, 'extracted'),
    );
    expect(withDependenciesApks).toHaveLength(2);
    expect(withoutDependenciesApks).toHaveLength(1);
    expect(withDependenciesApks.map((apk) => apk.filename).join('\n')).toContain('zlib-');
    expect(withDependenciesApks.map((apk) => apk.filename).join('\n')).toContain('musl-');
    expect(withoutDependenciesApks[0].filename).toContain('zlib-');

    const zlibWithDependenciesInfo = packageInfoFor(withDependenciesApks, 'zlib');
    const muslInfo = packageInfoFor(withDependenciesApks, 'musl');
    const zlibWithoutDependenciesInfo = packageInfoFor(withoutDependenciesApks, 'zlib');
    expect(zlibWithDependenciesInfo).toMatch(/^depend = so:libc\.musl-x86_64\.so\.1$/m);
    expect(muslInfo).toMatch(/^provides = so:libc\.musl-x86_64\.so\.1=1$/m);
    expect(zlibWithoutDependenciesInfo).toMatch(/^depend = so:libc\.musl-x86_64\.so\.1$/m);
  }, 300_000);
});
