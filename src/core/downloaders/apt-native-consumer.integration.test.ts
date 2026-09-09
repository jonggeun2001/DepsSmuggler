import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { AptMetadataParser } from './apt';
import { getDownloadedFileKey } from './os-shared/package-file-utils';
import { OSRepoPackager } from './os-shared/repo-packager';
import type { Repository } from './os-shared/types';

const execFile = promisify(execFileCallback);
const nativeEnabled = process.env.DEPS_SMUGGLER_NATIVE_APT === '1';
const nativeSuite = nativeEnabled ? describe : describe.skip;

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('APT native fixture server did not expose a port'));
        return;
      }
      resolve(address.port);
    });
  });
}

async function requireTool(tool: string): Promise<void> {
  try {
    await execFile(tool, ['--version'], { timeout: 15_000 });
  } catch (error) {
    throw new Error(
      `DEPS_SMUGGLER_NATIVE_APT=1 requires ${tool} on Linux: ${(error as Error).message}`
    );
  }
}

function parseControlFields(content: string): Map<string, string> {
  const fields = new Map<string, string>();
  let key = '';
  let value = '';
  for (const line of content.trimEnd().split('\n')) {
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

nativeSuite('native APT repository consumer', () => {
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

  it('consumes generated Packages metadata through isolated apt-get and apt-cache', async () => {
    if (process.platform !== 'linux') {
      throw new Error('DEPS_SMUGGLER_NATIVE_APT=1 requires Linux with the APT toolchain');
    }
    await Promise.all(['apt-get', 'apt-cache', 'dpkg-deb'].map(requireTool));

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'depssmuggler-native-apt-'));
    tempDirs.push(tempDir);
    const debRoot = path.join(tempDir, 'deb-root');
    fs.mkdirSync(path.join(debRoot, 'DEBIAN'), { recursive: true });
    fs.mkdirSync(path.join(debRoot, 'usr', 'share', 'doc', 'fixture-apt'), { recursive: true });
    const control = `Package: fixture-apt\nVersion: 1.2.3\nSection: misc\nPriority: optional\nArchitecture: amd64\nMaintainer: Fixture Maintainer <fixture@example.invalid>\nInstalled-Size: 42\nDepends: dep-a (= 1.2) | dep-b (>= 2.0), dep-c (<< 4.0)\nPre-Depends: base (= 1.0)\nProvides: virtual-name (= 3.0)\nConflicts: conflict-a (<< 2.0)\nBreaks: broken-a (>= 4.0)\nReplaces: replaced-a (= 5.0)\nMulti-Arch: same\nDescription: Fixture summary\n long description\n .\n final paragraph\n`;
    fs.writeFileSync(path.join(debRoot, 'DEBIAN', 'control'), control);
    fs.writeFileSync(path.join(debRoot, 'usr', 'share', 'doc', 'fixture-apt', 'README'), 'fixture');
    const debPath = path.join(tempDir, 'fixture-apt_1.2.3_amd64.deb');
    await execFile('dpkg-deb', ['--build', debRoot, debPath], { timeout: 30_000 });

    const repository: Repository = {
      id: 'fixture-apt-native',
      name: 'Fixture APT native',
      baseUrl: 'http://127.0.0.1',
      enabled: true,
      gpgCheck: false,
      isOfficial: false,
    };
    const sourceControl = parseControlFields(
      (await execFile('dpkg-deb', ['--field', debPath], { timeout: 15_000 })).stdout
    );
    const packageIndex = `${control}Size: 1\nFilename: stale/fixture-apt.deb\nSHA256: stale\n`;
    server = http.createServer((request, response) => {
      if (request.url === '/main/binary-amd64/Packages.gz') {
        response.writeHead(200, { 'content-type': 'application/gzip' });
        response.end(gzipSync(Buffer.from(packageIndex, 'utf8')));
        return;
      }
      response.writeHead(404);
      response.end();
    });
    const port = await listen(server);
    const parsed = await new AptMetadataParser(
      { ...repository, baseUrl: `http://127.0.0.1:${port}` },
      'main',
      'amd64'
    ).parsePackages();
    const repoPath = path.join(tempDir, 'generated-repository');
    await new OSRepoPackager().createLocalRepo(
      parsed,
      new Map([[getDownloadedFileKey(parsed[0]), debPath]]),
      {
        packageManager: 'apt',
        outputPath: repoPath,
        repoName: 'fixture',
        includeSetupScript: false,
      }
    );

    const aptRoot = path.join(tempDir, 'apt-root');
    for (const directory of ['etc', 'state', 'state/lists/partial', 'cache', 'log']) {
      fs.mkdirSync(path.join(aptRoot, directory), { recursive: true });
    }
    fs.writeFileSync(path.join(aptRoot, 'state', 'status'), '');
    fs.writeFileSync(
      path.join(aptRoot, 'etc', 'sources.list'),
      `deb [trusted=yes] ${pathToFileURL(`${repoPath}${path.sep}`).href} ./\n`
    );
    const aptConfig = path.join(tempDir, 'apt.conf');
    fs.writeFileSync(
      aptConfig,
      `Dir "${aptRoot}";\nDir::Etc "${path.join(aptRoot, 'etc')}";\nDir::Etc::main "apt.conf";\nDir::Etc::parts "-";\nDir::Etc::sourcelist "${path.join(aptRoot, 'etc', 'sources.list')}";\nDir::Etc::sourceparts "-";\nDir::State "${path.join(aptRoot, 'state')}";\nDir::State::lists "${path.join(aptRoot, 'state', 'lists')}";\nDir::State::status "${path.join(aptRoot, 'state', 'status')}";\nDir::Cache "${path.join(aptRoot, 'cache')}";\nDir::Cache::archives "${path.join(aptRoot, 'cache', 'archives')}";\nDir::Cache::pkgcache "${path.join(aptRoot, 'cache', 'pkgcache.bin')}";\nDir::Cache::srcpkgcache "${path.join(aptRoot, 'cache', 'srcpkgcache.bin')}";\nDir::Log "${path.join(aptRoot, 'log')}";\nAcquire::AllowInsecureRepositories "true";\nAcquire::AllowDowngradeToInsecureRepositories "true";\n`
    );
    const env = { ...process.env, APT_CONFIG: aptConfig };
    await execFile('apt-get', ['update'], { env, timeout: 60_000 });
    const { stdout } = await execFile('apt-cache', ['show', 'fixture-apt', '--no-all-versions'], {
      env,
      timeout: 30_000,
    });
    const nativeFields = parseControlFields(stdout);
    for (const field of [
      'Package',
      'Version',
      'Architecture',
      'Maintainer',
      'Depends',
      'Pre-Depends',
      'Provides',
      'Conflicts',
      'Breaks',
      'Replaces',
      'Multi-Arch',
      'Installed-Size',
      'Description',
    ]) {
      expect(nativeFields.get(field), field).toBe(sourceControl.get(field));
    }
    const payload = fs.readFileSync(debPath);
    const expectedSha256 = createHash('sha256').update(payload).digest('hex');
    expect(nativeFields.get('Filename')).toBe(`./${path.basename(debPath)}`);
    expect(nativeFields.get('Size')).toBe(String(payload.length));
    expect(nativeFields.get('SHA256')).toBe(expectedSha256);
    const listEntries = fs.readdirSync(path.join(aptRoot, 'state', 'lists'));
    expect(listEntries.some((entry) => entry.includes('Packages'))).toBe(true);
    expect(stdout).toContain('Package: fixture-apt');
  }, 120_000);
});
