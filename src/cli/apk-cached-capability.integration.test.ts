/**
 * APK cache migration and capability-provider CLI integration.
 *
 * Runs by default with a loopback repository and isolated persistent cache.
 */

import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import * as fs from 'fs-extra';
import * as tar from 'tar';
import { afterEach, describe, expect, it } from 'vitest';
import { OsPackageCache } from '../core/downloaders/os-shared/cache-manager';
import type { OSPackageInfo, Repository } from '../core/downloaders/os-shared/types';

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const isolateHomeScript = path.join(projectRoot, 'tests/fixtures/isolate-home.cjs');

const childHarness = `
const path = require('node:path');
const projectRoot = process.env.DEPS_SMUGGLER_PROJECT_ROOT;
require(path.join(projectRoot, 'node_modules/ts-node')).register({
  project: path.join(projectRoot, 'tsconfig.cli.json'),
});

const originalFetch = global.fetch;
const repositoryUrl = process.env.DEPS_SMUGGLER_APK_REPO_URL;
if (!repositoryUrl) {
  throw new Error('Missing DEPS_SMUGGLER_APK_REPO_URL');
}
const repositoryOrigin = new URL(repositoryUrl).origin;
global.fetch = (input, init) => {
  const url = new URL(input);
  if (url.origin !== repositoryOrigin) {
    throw new Error('Unexpected fixture request: ' + url.href);
  }
  return originalFetch(input, init);
};

require(path.join(projectRoot, 'src/core/downloaders/os-shared/repos/index.ts'));
const { setDistributionsRef } = require(
  path.join(projectRoot, 'src/core/downloaders/os-shared/repos/repository-utils.ts')
);
setDistributionsRef([
  {
    id: 'fixture-apk',
    name: 'Fixture Alpine',
    version: '3.20',
    packageManager: 'apk',
    architectures: ['x86_64'],
    defaultRepos: [{
      id: 'fixture-apk-repo',
      name: 'Fixture APK Repository',
      baseUrl: repositoryUrl,
      enabled: true,
      gpgCheck: false,
      isOfficial: false,
    }],
    extendedRepos: [],
  },
], []);

process.argv = [
  process.execPath,
  path.join(projectRoot, 'src/cli/index.ts'),
  ...JSON.parse(process.env.DEPS_SMUGGLER_APK_ARGS),
];
require(path.join(projectRoot, 'src/cli/index.ts'));
`;

interface ChildResult {
  code: number;
  signal: string | null;
  killed: boolean;
  stdout: string;
  stderr: string;
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('loopback server did not expose a port'));
        return;
      }
      resolve(address.port);
    });
  });
}

async function runChild(
  harnessPath: string,
  isolatedHome: string,
  repositoryUrl: string,
  args: string[],
): Promise<ChildResult> {
  try {
    const result = await execFileAsync(process.execPath, [harnessPath], {
      cwd: projectRoot,
      env: {
        ...process.env,
        DEPS_SMUGGLER_PROJECT_ROOT: projectRoot,
        DEPS_SMUGGLER_APK_REPO_URL: repositoryUrl,
        DEPS_SMUGGLER_APK_ARGS: JSON.stringify(args),
        DEPS_SMUGGLER_TEST_USER_DIR: isolatedHome,
        NODE_OPTIONS: `--require ${JSON.stringify(isolateHomeScript)}`,
      },
      maxBuffer: 2 * 1024 * 1024,
      timeout: 60_000,
    });
    return {
      code: 0,
      signal: null,
      killed: false,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const failure = error as typeof error & {
      code?: number;
      killed?: boolean;
      signal?: string | null;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: typeof failure.code === 'number' ? failure.code : -1,
      signal: failure.signal ?? null,
      killed: failure.killed === true,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

function packageEntry(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([key, value]) => `${key}:${value}`)
    .join('\n');
}

async function createApkIndex(tempRoot: string): Promise<Buffer> {
  const fixtureDirectory = path.join(tempRoot, 'apk-index');
  const indexPath = path.join(fixtureDirectory, 'APKINDEX');
  const archivePath = path.join(tempRoot, 'APKINDEX.tar.gz');
  await fs.ensureDir(fixtureDirectory);
  const index = [
    packageEntry({
      P: 'zlib',
      V: '1.3.2-r0',
      A: 'x86_64',
      S: '11',
      I: '11',
      C: 'Q1AAAAAAAAAAAAAAAAAAAAAA=',
      T: 'Fixture zlib',
      L: 'MIT',
      D: 'so:libc.musl-x86_64.so.1',
      p: 'so:libz.so.1=1.3.2',
    }),
    packageEntry({
      P: 'musl',
      V: '1.2.5-r3',
      A: 'x86_64',
      S: '11',
      I: '11',
      C: 'Q1BBBBBBBBBBBBBBBBBBBBBB=',
      T: 'Fixture musl',
      L: 'MIT',
      p: 'so:libc.musl-x86_64.so.1=1.2.5',
    }),
  ].join('\n\n') + '\n\n';
  await fs.writeFile(indexPath, index, 'utf8');
  await tar.c({ cwd: fixtureDirectory, file: archivePath, gzip: true }, ['APKINDEX']);
  return fs.readFile(archivePath);
}

function packageInfo(repository: Repository, name: string, version: string): OSPackageInfo {
  return {
    name,
    version,
    architecture: 'x86_64',
    size: 11,
    checksum: { type: 'sha1', value: 'AAAAAAAAAAAAAAAAAAAAAA==' },
    location: `x86_64/${name}-${version}.apk`,
    repository,
    dependencies: [],
  };
}

async function archiveEntries(archivePath: string): Promise<string[]> {
  const entries: string[] = [];
  await tar.t({
    file: archivePath,
    onReadEntry: (entry) => {
      entries.push(entry.path);
      entry.resume();
    },
  });
  return entries;
}

describe('APK cached capability CLI integration', () => {
  let tempRoot: string | undefined;
  let server: Server | undefined;

  afterEach(async () => {
    const activeServer = server;
    if (activeServer?.listening) {
      await new Promise<void>((resolve) => activeServer.close(() => resolve()));
    }
    server = undefined;
    if (tempRoot) await fs.remove(tempRoot);
    tempRoot = undefined;
  });

  it('refreshes a legacy APKINDEX cache before resolving and reuses the current cache', async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-apk-cache-'));
    const index = await createApkIndex(tempRoot);
    const requests: string[] = [];
    const fixtureServer = createServer((request, response) => {
      const requestPath = request.url ?? '';
      requests.push(requestPath);
      if (requestPath === '/fixture/x86_64/APKINDEX.tar.gz') {
        response.writeHead(200, { 'content-type': 'application/gzip' });
        response.end(index);
        return;
      }
      if (/^\/fixture\/x86_64\/(zlib|musl)-[^/]+\.apk$/.test(requestPath)) {
        response.writeHead(200, { 'content-type': 'application/octet-stream' });
        response.end(Buffer.from(`dummy-${path.basename(requestPath)}`));
        return;
      }
      response.writeHead(404);
      response.end('fixture not found');
    });
    server = fixtureServer;
    const port = await listen(fixtureServer);
    const repositoryUrl = `http://127.0.0.1:${port}/fixture`;
    const isolatedHome = path.join(tempRoot, 'isolated user');
    const cacheRoot = path.join(tempRoot, 'cache');
    const outputDirectory = path.join(tempRoot, 'output archive');
    const harnessPath = path.join(tempRoot, 'apk-cache-harness.cjs');
    const repository: Repository = {
      id: 'fixture-apk-repo',
      name: 'Fixture APK Repository',
      baseUrl: repositoryUrl,
      enabled: true,
      gpgCheck: false,
      isOfficial: false,
    };
    const staleZlib = packageInfo(repository, 'zlib', '1.3.1-r0');
    const cacheDirectory = path.join(cacheRoot, 'os-packages');
    const cacheKey = OsPackageCache.createKey('apk', repository, 'x86_64', 'apkindex');
    const cacheFilename = `${Buffer.from(cacheKey, 'utf8').toString('base64url')}.json`;
    const now = Date.now();

    await fs.ensureDir(path.join(isolatedHome, '.depssmuggler'));
    await fs.ensureDir(cacheDirectory);
    await fs.writeFile(harnessPath, childHarness);
    await fs.writeJson(path.join(isolatedHome, '.depssmuggler', 'settings.json'), {
      enableCache: true,
      cachePath: cacheRoot,
    });
    await fs.writeJson(path.join(cacheDirectory, cacheFilename), {
      data: [staleZlib],
      timestamp: now,
      size: JSON.stringify([staleZlib]).length,
      lastAccess: now,
    });

    try {
      const search = await runChild(
        harnessPath,
        isolatedHome,
        repositoryUrl,
        ['os', 'search', 'zlib', '--distro', 'fixture-apk', '--arch', 'x86_64', '--limit', '3'],
      );
      const searchOutput = `${search.stdout}\n${search.stderr}`;
      expect(search.code, searchOutput).toBe(0);
      expect(search.signal).toBeNull();
      expect(search.killed).toBe(false);
      expect(searchOutput).toContain('zlib');
      const afterSearchCache = await fs.readJson(path.join(cacheDirectory, cacheFilename));
      expect(afterSearchCache, searchOutput).toMatchObject({
        data: {
          schemaVersion: 2,
          packages: expect.any(Array),
        },
      });
      expect(afterSearchCache.data.packages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: 'zlib',
          apkIndexFields: expect.objectContaining({
            C: 'Q1AAAAAAAAAAAAAAAAAAAAAA=',
            D: 'so:libc.musl-x86_64.so.1',
            I: '11',
            p: 'so:libz.so.1=1.3.2',
          }),
        }),
        expect.objectContaining({
          name: 'musl',
          apkIndexFields: expect.objectContaining({
            C: 'Q1BBBBBBBBBBBBBBBBBBBBBB=',
            I: '11',
            p: 'so:libc.musl-x86_64.so.1=1.2.5',
          }),
        }),
      ]));
      expect(
        requests.filter((requestPath) => requestPath.endsWith('/APKINDEX.tar.gz')),
        JSON.stringify(requests),
      ).toHaveLength(1);

      const archivePath = path.join(outputDirectory, 'zlib-with-capability-deps.tar.gz');
      const download = await runChild(
        harnessPath,
        isolatedHome,
        repositoryUrl,
        [
          'os',
          'download',
          'zlib',
          '--distro',
          'fixture-apk',
          '--arch',
          'x86_64',
          '--output',
          archivePath,
          '--archive-format',
          'tar.gz',
          '--concurrency',
          '1',
        ],
      );
      const downloadOutput = `${download.stdout}\n${download.stderr}`;
      expect(download.code, downloadOutput).toBe(0);
      expect(download.signal).toBeNull();
      expect(download.killed).toBe(false);
      expect(downloadOutput).toContain('실제 다운로드: 2개');
      expect(
        requests.filter((requestPath) => requestPath.endsWith('/APKINDEX.tar.gz')),
        `${JSON.stringify(requests)}\n${downloadOutput}`,
      ).toHaveLength(1);
      expect(requests).toContain('/fixture/x86_64/zlib-1.3.2-r0.apk');
      expect(requests).toContain('/fixture/x86_64/musl-1.2.5-r3.apk');
      await expect(fs.pathExists(archivePath)).resolves.toBe(true);
      const entries = await archiveEntries(archivePath);
      expect(entries).toContain('packages/zlib-1.3.2-r0.apk');
      expect(entries).toContain('packages/musl-1.2.5-r3.apk');
    } finally {
      await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
    }
  }, 150_000);
});
