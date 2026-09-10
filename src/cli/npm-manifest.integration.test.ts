import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
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

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const isolateHomeScript = path.join(projectRoot, 'tests/fixtures/isolate-home.cjs');

const childHarness = `
const path = require('node:path');
const projectRoot = process.env.DEPS_SMUGGLER_PROJECT_ROOT;
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
  registryUrl: string,
  output: string,
  version: string
): Promise<ChildResult> {
  try {
    const result = await execFileAsync(process.execPath, [harnessPath], {
      cwd: projectRoot,
      env: {
        ...process.env,
        DEPS_SMUGGLER_PROJECT_ROOT: projectRoot,
        DEPS_SMUGGLER_NPM_REGISTRY_URL: registryUrl,
        DEPS_SMUGGLER_NPM_ARGS: JSON.stringify([
          'download',
          '--type',
          'npm',
          '--package',
          'fixture-package',
          '--pkg-version',
          version,
          '--output',
          output,
          '--format',
          'zip',
          '--no-deps',
          '--concurrency',
          '1',
        ]),
        DEPS_SMUGGLER_TEST_USER_DIR: isolatedHome,
        NODE_OPTIONS: `--require ${JSON.stringify(isolateHomeScript)}`,
      },
      maxBuffer: 2 * 1024 * 1024,
      timeout: 120_000,
    });
    return { code: 0, signal: null, killed: false, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as typeof error & {
      code?: number;
      killed?: boolean;
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
      code: failure.code,
      signal: failure.signal ?? null,
      killed: false,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

async function createPackageTarball(
  root: string
): Promise<{ path: string; bytes: Buffer; sha1: string }> {
  const packageDirectory = path.join(root, 'package');
  const archivePath = path.join(root, 'fixture-package-3.0.1.tgz');
  await fs.ensureDir(packageDirectory);
  await fs.writeJson(path.join(packageDirectory, 'package.json'), {
    name: 'fixture-package',
    version: '3.0.1',
    description: 'local npm fixture',
  });
  await tar.create({ cwd: root, file: archivePath, gzip: true }, ['package']);
  const bytes = await fs.readFile(archivePath);
  return {
    path: archivePath,
    bytes,
    sha1: createHash('sha1').update(bytes).digest('hex'),
  };
}

async function readZipEntries(filePath: string): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (error, zipFile) => {
      if (error || !zipFile) {
        reject(error ?? new Error('ZIP 열기 실패'));
        return;
      }
      const entries = new Map<string, Buffer>();
      zipFile.on('error', reject);
      zipFile.on('end', () => resolve(entries));
      zipFile.on('entry', (entry: { fileName: string }) => {
        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            reject(streamError ?? new Error(`ZIP entry 열기 실패: ${entry.fileName}`));
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

async function readNestedManifest(
  tgzBytes: Buffer,
  root: string
): Promise<Record<string, unknown>> {
  const extractionRoot = await fs.mkdtemp(path.join(root, 'nested-tarball-'));
  const tgzPath = path.join(extractionRoot, 'archive-package.tgz');
  await fs.writeFile(tgzPath, tgzBytes);
  await tar.extract({ file: tgzPath, cwd: extractionRoot, strip: 0 });
  return fs.readJson(path.join(extractionRoot, 'package/package.json'));
}

describe('npm CLI manifest version integration', () => {
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

  it('uses the resolved npm version in the ZIP manifest and downloaded tarball', async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-npm-manifest-'));
    const tarball = await createPackageTarball(tempRoot);
    const requests: string[] = [];
    const fixtureServer = createServer((request, response) => {
      const requestPath = request.url ?? '';
      requests.push(requestPath);
      if (requestPath === '/fixture-package') {
        const port = (fixtureServer.address() as { port: number }).port;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            name: 'fixture-package',
            'dist-tags': { latest: '3.0.1' },
            versions: {
              '3.0.1': {
                name: 'fixture-package',
                version: '3.0.1',
                dist: {
                  tarball: `http://127.0.0.1:${port}/fixture-package/-/fixture-package-3.0.1.tgz`,
                  shasum: tarball.sha1,
                },
              },
            },
          })
        );
        return;
      }
      if (requestPath === '/fixture-package/-/fixture-package-3.0.1.tgz') {
        response.writeHead(200, { 'content-type': 'application/octet-stream' });
        response.end(tarball.bytes);
        return;
      }
      response.writeHead(404);
      response.end('fixture not found');
    });
    server = fixtureServer;
    const port = await listen(fixtureServer);
    const registryUrl = `http://127.0.0.1:${port}`;
    const harnessPath = path.join(tempRoot, 'npm-cli-harness.cjs');
    const isolatedHome = path.join(tempRoot, 'isolated user');
    const latestOutput = path.join(tempRoot, 'output latest');
    const fixedOutput = path.join(tempRoot, 'output fixed');
    await fs.writeFile(harnessPath, childHarness);
    await fs.ensureDir(isolatedHome);

    const latest = await runChild(harnessPath, isolatedHome, registryUrl, latestOutput, 'latest');
    const fixed = await runChild(harnessPath, isolatedHome, registryUrl, fixedOutput, '3.0.1');

    for (const result of [latest, fixed]) {
      expect(result.code, result.stderr).toBe(0);
      expect(result.signal).toBeNull();
      expect(result.killed).toBe(false);
      expect(result.stdout).toContain('압축 파일 생성 완료');
    }

    expect(requests.filter((requestPath) => requestPath === '/fixture-package')).toHaveLength(2);
    expect(
      requests.filter(
        (requestPath) => requestPath === '/fixture-package/-/fixture-package-3.0.1.tgz'
      )
    ).toHaveLength(2);
    expect(requests).toHaveLength(4);

    for (const output of [latestOutput, fixedOutput]) {
      const archives = (await fs.readdir(output)).filter((name) => /^packages-.*\.zip$/.test(name));
      expect(archives).toHaveLength(1);
      const archiveName = archives[0];
      if (!archiveName) throw new Error('ZIP archive was not created');
      const entries = await readZipEntries(path.join(output, archiveName));
      expect(entries.has('manifest.json')).toBe(true);
      const manifestEntry = entries.get('manifest.json');
      if (!manifestEntry) throw new Error('ZIP manifest.json was not created');
      const manifest = JSON.parse(manifestEntry.toString('utf8')) as {
        packages: Array<{ name: string; version: string }>;
      };
      expect(manifest.packages).toHaveLength(1);
      expect(manifest.packages[0]).toMatchObject({ name: 'fixture-package', version: '3.0.1' });
      const tarballEntry = entries.get('packages/fixture-package-3.0.1.tgz');
      if (!tarballEntry) throw new Error('ZIP npm tarball was not created');
      if (!tempRoot) throw new Error('fixture root was removed before inspection');
      const nestedManifest = await readNestedManifest(tarballEntry, tempRoot);
      expect(nestedManifest).toMatchObject({ name: 'fixture-package', version: '3.0.1' });
    }
  }, 240_000);
});
