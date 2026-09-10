import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import * as fs from 'fs-extra';
import * as tar from 'tar';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const isolateHomeScript = path.join(projectRoot, 'tests/fixtures/isolate-home.cjs');

const childHarness = `
const path = require('node:path');
const projectRoot = process.env.DEPS_SMUGGLER_PROJECT_ROOT;
require(path.join(projectRoot, 'node_modules/ts-node')).register({
  project: path.join(projectRoot, 'tsconfig.cli.json'),
});

if (process.env.DEPS_SMUGGLER_MODE === 'search') {
  const originalFetch = global.fetch;
  const loopback = new URL(process.env.DEPS_SMUGGLER_APK_REPO_URL);
  global.fetch = (input, init) => {
    const url = new URL(input);
    if (url.origin !== 'http://fixture-apk.invalid') {
      throw new Error('Unexpected fixture request: ' + url.href);
    }
    url.protocol = loopback.protocol;
    url.host = loopback.host;
    return originalFetch(url, init);
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
        baseUrl: 'http://fixture-apk.invalid/fixture',
        enabled: true,
        gpgCheck: false,
        isOfficial: false,
      }],
      extendedRepos: [],
    },
  ], []);
}

process.argv = [
  process.execPath,
  path.join(projectRoot, 'src/cli/index.ts'),
  ...JSON.parse(process.env.DEPS_SMUGGLER_ARGS),
];
require(path.join(projectRoot, 'src/cli/index.ts'));
`;

interface ChildResult {
  status: number;
  signal: string | null;
  stdout: string;
  stderr: string;
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('fixture server did not expose a port'));
        return;
      }
      resolve(address.port);
    });
  });
}

async function runChild(
  harnessPath: string,
  isolatedHome: string,
  args: string[],
  mode: 'config' | 'search',
  repositoryUrl?: string
): Promise<ChildResult> {
  try {
    const result = await execFileAsync(process.execPath, [harnessPath], {
      cwd: projectRoot,
      env: {
        ...process.env,
        DEPS_SMUGGLER_PROJECT_ROOT: projectRoot,
        DEPS_SMUGGLER_ARGS: JSON.stringify(args),
        DEPS_SMUGGLER_MODE: mode,
        DEPS_SMUGGLER_APK_REPO_URL: repositoryUrl || 'http://127.0.0.1:1',
        DEPS_SMUGGLER_TEST_USER_DIR: isolatedHome,
        NODE_OPTIONS: `--require ${JSON.stringify(isolateHomeScript)}`,
      },
      maxBuffer: 2 * 1024 * 1024,
      timeout: 60_000,
    });
    return { status: 0, signal: null, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as typeof error & {
      code?: number;
      signal?: string | null;
      stdout?: string;
      stderr?: string;
    };
    if (
      failure.killed === true ||
      (failure.signal !== undefined && failure.signal !== null) ||
      typeof failure.code !== 'number'
    ) {
      throw error;
    }
    return {
      status: typeof failure.code === 'number' ? failure.code : -1,
      signal: failure.signal ?? null,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

async function createApkIndex(root: string): Promise<Buffer> {
  const directory = path.join(root, 'index');
  const indexPath = path.join(directory, 'APKINDEX');
  const archivePath = path.join(root, 'APKINDEX.tar.gz');
  await fs.ensureDir(directory);
  await fs.writeFile(
    indexPath,
    'P:zlib\nV:1.3.2-r0\nA:x86_64\nS:11\nI:11\nC:Q1AAAAAAAAAAAAAAAAAAAAAA=\nT:Fixture zlib\n\n',
    'utf8'
  );
  await tar.c({ cwd: directory, file: archivePath, gzip: true }, ['APKINDEX']);
  return fs.readFile(archivePath);
}

async function listFiles(root: string): Promise<string[]> {
  if (!(await fs.pathExists(root))) return [];
  const names: string[] = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory())
      names.push(...(await listFiles(entryPath)).map((name) => path.join(entry.name, name)));
    else names.push(entry.name);
  }
  return names;
}

describe('CLI cache settings integration', () => {
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

  it('round-trips cache settings across separate CLI processes', async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-cache-settings-'));
    const harnessPath = path.join(tempRoot, 'cli-harness.cjs');
    const isolatedHome = path.join(tempRoot, 'isolated user');
    await fs.writeFile(harnessPath, childHarness);

    const setEnabled = await runChild(
      harnessPath,
      isolatedHome,
      ['config', 'set', 'cacheEnabled', 'false'],
      'config'
    );
    const getEnabled = await runChild(
      harnessPath,
      isolatedHome,
      ['config', 'get', 'cacheEnabled'],
      'config'
    );
    const setSize = await runChild(
      harnessPath,
      isolatedHome,
      ['config', 'set', 'maxCacheSize', '1048576'],
      'config'
    );
    const getSize = await runChild(
      harnessPath,
      isolatedHome,
      ['config', 'get', 'maxCacheSize'],
      'config'
    );

    for (const result of [setEnabled, getEnabled, setSize, getSize]) {
      expect(result.status, result.stderr).toBe(0);
      expect(result.signal).toBeNull();
    }
    expect(getEnabled.stdout).toContain('cacheEnabled: false');
    expect(getSize.stdout).toContain('maxCacheSize: 1048576');
  }, 120_000);

  it('rejects representative invalid values without changing settings', async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-cache-settings-invalid-'));
    const harnessPath = path.join(tempRoot, 'cli-harness.cjs');
    const isolatedHome = path.join(tempRoot, 'isolated user');
    await fs.writeFile(harnessPath, childHarness);
    const setValid = await runChild(
      harnessPath,
      isolatedHome,
      ['config', 'set', 'maxCacheSize', '1048576'],
      'config'
    );
    expect(setValid.status).toBe(0);
    const settingsPath = path.join(isolatedHome, '.depssmuggler', 'settings.json');
    const before = await fs.readFile(settingsPath, 'utf8');

    for (const args of [
      ['config', 'set', 'maxCacheSize', '1.5'],
      ['config', 'set', 'cacheEnabled', 'maybe'],
    ]) {
      const result = await runChild(harnessPath, isolatedHome, args, 'config');
      expect(result.status, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`).toBe(1);
      expect(result.signal).toBeNull();
      expect(await fs.readFile(settingsPath, 'utf8')).toBe(before);
    }
  }, 120_000);

  it('uses cacheEnabled and maxCacheSize in real OS search processes', async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-cache-settings-search-'));
    const index = await createApkIndex(tempRoot);
    const requests: string[] = [];
    server = createServer((request, response) => {
      requests.push(request.url || '');
      if (request.url === '/fixture/x86_64/APKINDEX.tar.gz') {
        response.writeHead(200, { 'content-type': 'application/gzip' });
        response.end(index);
        return;
      }
      response.writeHead(404);
      response.end('fixture not found');
    });
    const port = await listen(server);
    const harnessPath = path.join(tempRoot, 'cli-harness.cjs');
    const isolatedHome = path.join(tempRoot, 'isolated user');
    const cacheRoot = path.join(tempRoot, 'cache');
    await fs.writeFile(harnessPath, childHarness);
    const repositoryUrl = `http://127.0.0.1:${port}/fixture`;
    const config = async (key: string, value: string) => {
      const result = await runChild(
        harnessPath,
        isolatedHome,
        ['config', 'set', key, value],
        'config'
      );
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.signal).toBeNull();
    };
    const search = () =>
      runChild(
        harnessPath,
        isolatedHome,
        ['os', 'search', 'zlib', '--distro', 'fixture-apk', '--arch', 'x86_64', '--limit', '3'],
        'search',
        repositoryUrl
      );

    await config('cachePath', cacheRoot);
    await config('cacheEnabled', 'false');
    const disabledFirst = await search();
    const disabledSecond = await search();
    const disabledOutput = `${disabledFirst.stdout}\n${disabledSecond.stdout}`;
    expect(disabledFirst.status).toBe(0);
    expect(disabledSecond.status).toBe(0);
    expect(disabledFirst.signal).toBeNull();
    expect(disabledSecond.signal).toBeNull();
    expect(disabledOutput).toContain('1.3.2-r0');
    expect(requests.filter((request) => request.endsWith('/APKINDEX.tar.gz'))).toHaveLength(2);
    expect(await listFiles(path.join(cacheRoot, 'os-packages'))).toEqual([]);

    requests.length = 0;
    await config('cacheEnabled', 'true');
    const enabledFirst = await search();
    const enabledSecond = await search();
    const enabledOutput = `${enabledFirst.stdout}\n${enabledSecond.stdout}`;
    expect(enabledFirst.status).toBe(0);
    expect(enabledSecond.status).toBe(0);
    expect(enabledFirst.signal).toBeNull();
    expect(enabledSecond.signal).toBeNull();
    expect(enabledOutput).toContain('1.3.2-r0');
    expect(requests.filter((request) => request.endsWith('/APKINDEX.tar.gz'))).toHaveLength(1);
    expect(await listFiles(path.join(cacheRoot, 'os-packages'))).not.toEqual([]);

    requests.length = 0;
    await config('maxCacheSize', '1');
    const bounded = await search();
    expect(bounded.status).toBe(0);
    expect(bounded.signal).toBeNull();
    expect(bounded.stdout).toContain('1.3.2-r0');
    expect(requests.filter((request) => request.endsWith('/APKINDEX.tar.gz'))).toHaveLength(1);
    expect(await listFiles(path.join(cacheRoot, 'os-packages'))).toEqual([]);
  }, 150_000);
});
