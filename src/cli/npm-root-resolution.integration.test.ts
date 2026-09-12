import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import * as fs from 'fs-extra';
import * as tar from 'tar';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const yauzl = require('yauzl') as {
  open: (
    filePath: string,
    options: { lazyEntries: boolean },
    callback: (error: Error | null, zipFile?: {
      readEntry: () => void;
      on: (event: string, listener: (...args: any[]) => void) => void;
      openReadStream: (entry: any, callback: (error: Error | null, stream?: NodeJS.ReadableStream) => void) => void;
      close: () => void;
    }) => void
  ) => void;
};

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const isolateHomeScript = path.join(projectRoot, 'tests/fixtures/isolate-home.cjs');

const childHarness = `
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const { createRequire } = require('node:module');
const projectRoot = process.env.DEPS_SMUGGLER_PROJECT_ROOT;
const externalRequestMarker = process.env.DEPS_SMUGGLER_EXTERNAL_REQUEST_MARKER;
let externalRequestCount = 0;
const guardRequest = (original) => function guardedRequest(...args) {
  const input = args[0];
  const host = typeof input === 'string'
    ? new URL(input).hostname
    : (input?.hostname || input?.host || '');
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    externalRequestCount += 1;
    throw new Error('Unexpected non-loopback request during npm root validation: ' + host);
  }
  return original.apply(this, args);
};
http.request = guardRequest(http.request);
http.get = guardRequest(http.get);
https.request = guardRequest(https.request);
https.get = guardRequest(https.get);
process.on('exit', () => fs.writeFileSync(externalRequestMarker, String(externalRequestCount)));
const axios = createRequire(path.join(projectRoot, 'package.json'))('axios');
const originalCreate = axios.create.bind(axios);
axios.create = (config = {}) => originalCreate({
  ...config,
  ...(config.baseURL === 'https://registry.npmjs.org'
    ? { baseURL: process.env.DEPS_SMUGGLER_NPM_REGISTRY_URL }
    : {}),
});
require(path.join(projectRoot, 'node_modules/ts-node')).register({
  project: path.join(projectRoot, 'tsconfig.cli.json'),
});
const { NPM_CONSTANTS } = require(path.join(projectRoot, 'src/core/constants/npm.ts'));
NPM_CONSTANTS.DEFAULT_REGISTRY_URL = process.env.DEPS_SMUGGLER_NPM_REGISTRY_URL;
process.argv = [
  process.execPath,
  path.join(projectRoot, 'src/cli/index.ts'),
  ...JSON.parse(process.env.DEPS_SMUGGLER_NPM_ARGS),
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
      if (!address || typeof address === 'string') reject(new Error('fixture server did not expose a port'));
      else resolve(address.port);
    });
  });
}

async function runChild(
  harnessPath: string,
  isolatedHome: string,
  registryUrl: string,
  output: string,
  externalRequestMarker: string,
  archiveFormat: 'zip' | 'tar.gz',
): Promise<ChildResult> {
  try {
    const result = await execFileAsync(process.execPath, [harnessPath], {
      cwd: path.dirname(harnessPath),
      env: {
        ...process.env,
        DEPS_SMUGGLER_PROJECT_ROOT: projectRoot,
        DEPS_SMUGGLER_NPM_REGISTRY_URL: registryUrl,
        DEPS_SMUGGLER_EXTERNAL_REQUEST_MARKER: externalRequestMarker,
        DEPS_SMUGGLER_NPM_ARGS: JSON.stringify([
          'download', '--type', 'npm', '--package', 'fixture-root',
          '--output', output, '--format', archiveFormat, '--concurrency', '1',
        ]),
        DEPS_SMUGGLER_TEST_USER_DIR: isolatedHome,
        NODE_OPTIONS: `--require ${JSON.stringify(isolateHomeScript)}`,
      },
      maxBuffer: 4 * 1024 * 1024,
      timeout: 120_000,
    });
    return { code: 0, signal: null, killed: false, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as typeof error & {
      code?: number;
      signal?: string | null;
      stdout?: string;
      stderr?: string;
    };
    if (failure.killed === true || failure.signal || typeof failure.code !== 'number') throw error;
    return {
      code: failure.code,
      signal: failure.signal ?? null,
      killed: false,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

async function createPackageTarball(
  root: string,
  name: string,
  version: string,
  dependency?: Record<string, string>,
): Promise<Buffer> {
  const safeName = name.replace(/^@/, '').replace(/\//g, '-');
  const workDirectory = path.join(root, `package-${safeName}-${version}`);
  const packageDirectory = path.join(workDirectory, 'package');
  const archivePath = path.join(root, `${safeName}-${version}.tgz`);
  await fs.ensureDir(packageDirectory);
  await fs.writeJson(path.join(packageDirectory, 'package.json'), {
    name,
    version,
    main: 'index.js',
    ...(dependency ? { dependencies: dependency } : {}),
  });
  const dependencyRequire = dependency ? "const dependency = require('fixture-dependency');\n" : '';
  await fs.writeFile(
    path.join(packageDirectory, 'index.js'),
    `${dependencyRequire}module.exports = { name: ${JSON.stringify(name)}, version: ${JSON.stringify(version)}${dependency ? ', dependency' : ''} };\n`,
  );
  await tar.create({ cwd: workDirectory, file: archivePath, gzip: true }, ['package']);
  return fs.readFile(archivePath);
}

async function readZipEntries(filePath: string): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (error, zipFile) => {
      if (error || !zipFile) return reject(error ?? new Error('ZIP 열기 실패'));
      const entries = new Map<string, Buffer>();
      zipFile.on('error', reject);
      zipFile.on('end', () => resolve(entries));
      zipFile.on('entry', (entry: { fileName: string }) => {
        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            zipFile.close();
            reject(streamError ?? new Error(`ZIP entry 열기 실패: ${entry.fileName}`));
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

async function readTarEntries(filePath: string): Promise<string[]> {
  const entries: string[] = [];
  await tar.t({ file: filePath, onentry: (entry) => entries.push(entry.path) });
  return entries;
}

async function extractZip(entries: Map<string, Buffer>, destination: string): Promise<void> {
  for (const [entryName, bytes] of entries) {
    if (entryName.endsWith('/')) {
      await fs.ensureDir(path.join(destination, entryName));
      continue;
    }
    const target = path.join(destination, entryName);
    await fs.ensureDir(path.dirname(target));
    await fs.writeFile(target, bytes);
  }
}

describe('npm CLI resolved root install integration', () => {
  let tempRoot: string | undefined;
  let server: Server | undefined;
  let installTrapServer: Server | undefined;

  afterEach(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
    server = undefined;
    if (installTrapServer?.listening) {
      await new Promise<void>((resolve) => installTrapServer?.close(() => resolve()));
    }
    installTrapServer = undefined;
    if (tempRoot) await fs.remove(tempRoot);
    tempRoot = undefined;
  });

  it.each(['zip', 'tar.gz'] as const)('includes native installer scripts in the %s archive', async (archiveFormat) => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-npm-root-'));
    const rootTgz = await createPackageTarball(tempRoot, 'fixture-root', '3.0.1', {
      'fixture-dependency': '1.0.0',
    });
    const dependencyTgz = await createPackageTarball(tempRoot, 'fixture-dependency', '1.0.0');
    const requests: string[] = [];
    const fixtureServer = createServer((request, response) => {
      const requestPath = request.url ?? '';
      requests.push(requestPath);
      const port = (fixtureServer.address() as { port: number }).port;
      const metadata = (name: string, version: string, bytes: Buffer, dependencies?: Record<string, string>) => ({
        name,
        'dist-tags': { latest: version },
        versions: {
          [version]: {
            name,
            version,
            ...(dependencies ? { dependencies } : {}),
            dist: {
              tarball: `http://127.0.0.1:${port}/${name}/-/${name}-${version}.tgz`,
              shasum: require('node:crypto').createHash('sha1').update(bytes).digest('hex'),
            },
          },
        },
      });
      if (requestPath === '/fixture-root') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(metadata('fixture-root', '3.0.1', rootTgz, {
          'fixture-dependency': '1.0.0',
        })));
        return;
      }
      if (requestPath === '/fixture-dependency') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(metadata('fixture-dependency', '1.0.0', dependencyTgz)));
        return;
      }
      if (requestPath === '/fixture-root/-/fixture-root-3.0.1.tgz') {
        response.writeHead(200, { 'content-type': 'application/octet-stream' });
        response.end(rootTgz);
        return;
      }
      if (requestPath === '/fixture-dependency/-/fixture-dependency-1.0.0.tgz') {
        response.writeHead(200, { 'content-type': 'application/octet-stream' });
        response.end(dependencyTgz);
        return;
      }
      response.writeHead(404);
      response.end('fixture not found');
    });
    server = fixtureServer;
    const port = await listen(fixtureServer);
    const registryUrl = `http://127.0.0.1:${port}`;
    const harnessPath = path.join(tempRoot, 'npm cli harness with spaces.cjs');
    const isolatedHome = path.join(tempRoot, 'isolated user');
    const output = path.join(tempRoot, 'output with spaces');
    await fs.writeFile(harnessPath, childHarness);

    const externalRequestMarker = path.join(tempRoot, 'external-request-count.txt');
    const child = await runChild(harnessPath, isolatedHome, registryUrl, output, externalRequestMarker, archiveFormat);
    expect(child.code, child.stderr).toBe(0);
    expect(child.signal).toBeNull();
    expect(child.killed).toBe(false);
    expect(child.stdout).toContain('압축 파일 생성 완료');
    expect(requests).toEqual(expect.arrayContaining([
      '/fixture-root',
      '/fixture-dependency',
      '/fixture-root/-/fixture-root-3.0.1.tgz',
      '/fixture-dependency/-/fixture-dependency-1.0.0.tgz',
    ]));

    const archiveName = (await fs.readdir(output)).find(name => new RegExp(`^packages-.*\\.${archiveFormat === 'zip' ? 'zip' : 'tar\\.gz'}$`).test(name));
    expect(archiveName).toBeDefined();
    const archivePath = path.join(output, archiveName as string);
    const bundle = path.join(tempRoot, `bundle extracted with spaces ${archiveFormat}`);
    await fs.ensureDir(bundle);
    const zipEntries = archiveFormat === 'zip' ? await readZipEntries(archivePath) : undefined;
    const entryNames = zipEntries ? [...zipEntries.keys()] : await readTarEntries(archivePath);
    if (archiveFormat === 'zip') {
      await extractZip(zipEntries!, bundle);
    } else {
      await tar.x({ file: archivePath, cwd: bundle });
    }
    const manifest = JSON.parse(await fs.readFile(path.join(bundle, 'manifest.json'), 'utf8')) as {
      packages?: Array<{ name: string; version: string }>;
    };
    const manifestIdentity = (manifest.packages ?? [])
      .map(({ name, version }) => `${name}@${version}`)
      .sort();
    expect(manifestIdentity).toEqual(['fixture-dependency@1.0.0', 'fixture-root@3.0.1']);
    const packageEntries = entryNames.filter(name => name.startsWith('packages/') && name.endsWith('.tgz'));
    expect(packageEntries).toHaveLength(2);
    expect(entryNames).toContain('install.sh');
    expect(entryNames).toContain('install.ps1');
    const scriptNames = ['install.sh', 'install.ps1'] as const;
    for (const scriptName of scriptNames) {
      expect(await fs.pathExists(path.join(bundle, scriptName))).toBe(true);
    }

    if (server?.listening) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }

    const installUser = path.join(tempRoot, 'install user');
    const npmCache = path.join(tempRoot, 'empty npm cache');
    const npmConfig = path.join(tempRoot, 'empty npm user config');
    const npmGlobalConfig = path.join(tempRoot, 'empty npm global config');
    const installRequests: string[] = [];
    const trap = createServer((request, response) => {
      installRequests.push(request.url ?? '');
      response.writeHead(503);
      response.end('installer network access is forbidden');
    });
    installTrapServer = trap;
    const trapPort = await listen(trap);
    const trapRegistry = `http://127.0.0.1:${trapPort}`;
    await fs.ensureDir(installUser);
    await fs.ensureDir(npmCache);
    await fs.writeFile(npmConfig, '');
    await fs.writeFile(npmGlobalConfig, '');
    const installEnv = { ...process.env };
    for (const key of [
      'npm_config_cache', 'NPM_CONFIG_CACHE', 'npm_config_userconfig', 'NPM_CONFIG_USERCONFIG',
      'npm_config_globalconfig', 'NPM_CONFIG_GLOBALCONFIG', 'npm_config_registry', 'NPM_CONFIG_REGISTRY',
      'npm_config_prefix', 'NPM_CONFIG_PREFIX', 'npm_config_proxy', 'NPM_CONFIG_PROXY',
      'npm_config_https_proxy', 'NPM_CONFIG_HTTPS_PROXY',
      'npm_config_offline', 'NPM_CONFIG_OFFLINE',
    ]) delete installEnv[key];
    const installCommand = process.platform === 'win32'
      ? { file: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(bundle, 'install.ps1')] }
      : { file: 'bash', args: [path.join(bundle, 'install.sh')] };
    let install: { stdout: string; stderr: string };
    try {
      install = await execFileAsync(installCommand.file, installCommand.args, {
        cwd: bundle,
        env: {
          ...installEnv,
          DEPS_SMUGGLER_TEST_USER_DIR: installUser,
          NODE_OPTIONS: `--require ${JSON.stringify(isolateHomeScript)}`,
          npm_config_cache: npmCache,
          npm_config_userconfig: npmConfig,
          npm_config_registry: trapRegistry,
          npm_config_globalconfig: npmGlobalConfig,
          npm_config_prefix: path.join(tempRoot, 'unused global prefix'),
          npm_config_proxy: '',
          npm_config_https_proxy: '',
          NO_PROXY: '127.0.0.1,localhost',
        },
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024,
      });
    } catch (error) {
      const failure = error as typeof error & { stdout?: string; stderr?: string };
      const npmProjectManifest = path.join(bundle, 'npm-project', 'package.json');
      const npmLogs: string[] = [];
      if (await fs.pathExists(path.join(npmCache, '_logs'))) {
        for (const file of await fs.readdir(path.join(npmCache, '_logs'))) {
          const logPath = path.join(npmCache, '_logs', file);
          if ((await fs.stat(logPath)).isFile()) {
            npmLogs.push(`--- ${file} ---\n${await fs.readFile(logPath, 'utf8')}`);
          }
        }
      }
      const scriptName = process.platform === 'win32' ? 'install.ps1' : 'install.sh';
      const scriptLines = (await fs.readFile(path.join(bundle, scriptName), 'utf8'))
        .split(/\r?\n/)
        .filter((line) => /ScriptDir|PackageDir|NpmSetup|NpmProject|npm install/.test(line))
        .join('\n');
      const manifestState = await fs.pathExists(npmProjectManifest)
        ? await fs.readFile(npmProjectManifest, 'utf8')
        : '<missing>';
      throw new Error([
        `installer failed: ${failure.message ?? String(error)}`,
        `stdout:\n${failure.stdout ?? ''}`,
        `stderr:\n${failure.stderr ?? ''}`,
        `npm-project/package.json:\n${manifestState}`,
        `generated setup lines:\n${scriptLines}`,
        `npm cache logs:\n${npmLogs.join('\n')}`,
      ].join('\n\n'));
    }
    expect(install.stderr).not.toContain('npm ERR!');
    expect(installRequests).toEqual([]);
    expect(await fs.readFile(externalRequestMarker, 'utf8')).toBe('0');
    const npmProject = path.join(bundle, 'npm-project');
    expect(await fs.pathExists(path.join(npmProject, 'node_modules', 'fixture-root', 'package.json'))).toBe(true);
    expect(await fs.pathExists(path.join(npmProject, 'node_modules', 'fixture-dependency', 'package.json'))).toBe(true);
    const rootPath = path.join(npmProject, 'node_modules', 'fixture-root');
    const dependencyPath = path.join(npmProject, 'node_modules', 'fixture-dependency');
    const npmProjectReal = await fs.realpath(npmProject);
    const rootReal = await fs.realpath(rootPath);
    const dependencyReal = await fs.realpath(dependencyPath);
    expect(rootReal.startsWith(`${npmProjectReal}${path.sep}`)).toBe(true);
    expect(dependencyReal.startsWith(`${npmProjectReal}${path.sep}`)).toBe(true);
    const runtime = await execFileAsync(process.execPath, ['-e', [
      `const root = require(${JSON.stringify(rootReal)});`,
      `const dependency = require(${JSON.stringify(dependencyReal)});`,
      'process.stdout.write(JSON.stringify({ root, dependency }));',
    ].join('\n')], { cwd: npmProject, timeout: 30_000 });
    const payload = JSON.parse(runtime.stdout) as {
      root: { name: string; version: string; dependency: { name: string; version: string } };
      dependency: { name: string; version: string };
    };
    expect(payload.root).toMatchObject({ name: 'fixture-root', version: '3.0.1' });
    expect(payload.root.dependency).toMatchObject({ name: 'fixture-dependency', version: '1.0.0' });
    expect(payload.dependency).toMatchObject({ name: 'fixture-dependency', version: '1.0.0' });
  }, 300_000);
});
