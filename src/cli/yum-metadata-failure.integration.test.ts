import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import * as fs from 'fs-extra';
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

// Load the repository index first: its module initialization installs the
// built-in distribution reference before the child replaces it with the
// loopback fixture below.
require(path.join(projectRoot, 'src/core/downloaders/os-shared/repos/index.ts'));
const { setDistributionsRef } = require(
  path.join(projectRoot, 'src/core/downloaders/os-shared/repos/repository-utils.ts')
);
setDistributionsRef([
  {
    id: 'fixture-yum',
    name: 'Fixture YUM',
    version: '9',
    packageManager: 'yum',
    architectures: ['x86_64'],
    defaultRepos: [{
      id: 'fixture-yum-repo',
      name: 'Fixture YUM Repository',
      baseUrl: process.env.DEPS_SMUGGLER_YUM_REPO_URL,
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
  'os',
  'search',
  'zlib',
  '--distro',
  'fixture-yum',
  '--arch',
  'x86_64',
  '--limit',
  '3',
];
require(path.join(projectRoot, 'src/cli/index.ts'));
`;

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

function primaryFixture(): Buffer {
  const countedEntities = '&quot;'.repeat(100_001);
  const xml = [
    '<metadata packages="1">',
    '  <package type="rpm">',
    '    <name>zlib</name>',
    '    <arch>x86_64</arch>',
    '    <version epoch="0" ver="1.2.11" rel="1.el9" />',
    '    <checksum type="sha256">fixture-checksum</checksum>',
    '    <summary>Fixture zlib</summary>',
    `    <description>${countedEntities}</description>`,
    '    <size package="1" installed="1" />',
    '    <location href="Packages/z/zlib-1.2.11-1.el9.x86_64.rpm" />',
    '    <format />',
    '  </package>',
    '</metadata>',
  ].join('\n');
  return gzipSync(Buffer.from(xml, 'utf8'));
}

function repomdFixture(): string {
  return [
    '<repomd>',
    '  <revision>fixture-revision</revision>',
    '  <data type="primary">',
    '    <checksum type="sha256">fixture-checksum</checksum>',
    '    <location href="repodata/primary.xml.gz" />',
    '  </data>',
    '</repomd>',
  ].join('\n');
}

describe('YUM metadata parser CLI failure propagation', () => {
  let tempRoot: string | undefined;

  afterEach(async () => {
    if (tempRoot) await fs.remove(tempRoot);
    tempRoot = undefined;
  });

  it('returns nonzero instead of empty-success when primary XML exceeds entity limit', async () => {
    const requests: string[] = [];
    const primary = primaryFixture();
    const server = createServer((request, response) => {
      requests.push(request.url ?? '');
      if (request.url === '/fixture/repodata/repomd.xml') {
        response.writeHead(200, { 'content-type': 'application/xml' });
        response.end(repomdFixture());
        return;
      }
      if (request.url === '/fixture/repodata/primary.xml.gz') {
        response.writeHead(200, {
          'content-type': 'application/gzip',
          'content-length': primary.byteLength,
        });
        response.end(primary);
        return;
      }
      response.writeHead(404);
      response.end('fixture not found');
    });
    const port = await listen(server);
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-issue-74-'));
    const isolatedHome = path.join(tempRoot, 'isolated user directory');
    const harnessPath = path.join(tempRoot, 'yum-metadata-failure-harness.cjs');
    await fs.ensureDir(isolatedHome);
    await fs.writeFile(harnessPath, childHarness);

    try {
      let child: {
        code: number;
        signal: string | null;
        timedOut: boolean;
        stdout: string;
        stderr: string;
      };
      try {
        const result = await execFileAsync(process.execPath, [harnessPath], {
          cwd: projectRoot,
          env: {
            ...process.env,
            DEPS_SMUGGLER_PROJECT_ROOT: projectRoot,
            DEPS_SMUGGLER_YUM_REPO_URL: `http://127.0.0.1:${port}/fixture`,
            DEPS_SMUGGLER_TEST_USER_DIR: isolatedHome,
            NODE_OPTIONS: `--require ${JSON.stringify(isolateHomeScript)}`,
          },
          timeout: 180_000,
        });
        child = {
          code: 0,
          signal: null,
          timedOut: false,
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
        child = {
          code: typeof failure.code === 'number' ? failure.code : -1,
          signal: failure.signal ?? null,
          timedOut: failure.killed === true,
          stdout: failure.stdout ?? '',
          stderr: failure.stderr ?? '',
        };
      }

      const outputText = `${child.stdout}\n${child.stderr}`;
      expect(child.code, outputText).toBe(1);
      expect(child.signal).toBeNull();
      expect(child.timedOut).toBe(false);
      expect(outputText).toContain('Fixture YUM Repository');
      expect(outputText).toContain('Entity expansion limit exceeded');
      expect(outputText).not.toContain('검색 결과가 없습니다.');
      expect(requests).toEqual([
        '/fixture/repodata/repomd.xml',
        '/fixture/repodata/primary.xml.gz',
      ]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 240_000);
});
