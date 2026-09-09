import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import * as fs from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const isolateHomeScript = path.join(projectRoot, 'tests/fixtures/isolate-home.cjs');
const childHarness = `
const path = require('node:path');
const projectRoot = process.env.DEPS_SMUGGLER_PROJECT_ROOT;
require(path.join(projectRoot, 'node_modules/ts-node')).register({ project: path.join(projectRoot, 'tsconfig.cli.json') });

const registry = require(path.join(projectRoot, 'src/core/downloaders/registry.ts'));
const { MavenDownloader } = require(path.join(projectRoot, 'src/core/downloaders/maven.ts'));
const originalCreate = registry.createRegisteredDownloader;
const downloader = new MavenDownloader();
downloader.repoUrl = process.env.DEPS_SMUGGLER_MAVEN_REPO_URL;
registry.createRegisteredDownloader = (type) => type === 'maven' ? downloader : originalCreate(type);

process.argv = [
  process.execPath,
  path.join(projectRoot, 'src/cli/index.ts'),
  'download',
  '--type', 'maven',
  '--package', 'com.example:missing',
  '--pkg-version', '1.0.0',
  '--output', process.env.DEPS_SMUGGLER_OUTPUT,
  '--format', 'zip',
  '--no-deps',
  '--concurrency', '1',
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

describe('download CLI failure exit status', () => {
  let tempRoot: string | undefined;

  afterEach(async () => {
    if (tempRoot) await fs.remove(tempRoot);
    tempRoot = undefined;
  });

  it('returns nonzero after real Maven HTTP failure and creates no delivery artifacts', async () => {
    const requests: string[] = [];
    const server = createServer((_request, response) => {
      requests.push(_request.url ?? '');
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('fixture not found');
    });
    const port = await listen(server);
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-issue-71-'));
    const output = path.join(tempRoot, 'output with spaces');
    const isolatedHome = path.join(tempRoot, 'isolated user directory');
    const harnessPath = path.join(tempRoot, 'download-failure-harness.cjs');
    await fs.ensureDir(output);
    await fs.ensureDir(isolatedHome);
    await fs.writeFile(harnessPath, childHarness);

    try {
      let child: { code: number; stdout: string; stderr: string };
      try {
        const result = await execFileAsync(process.execPath, [harnessPath], {
          cwd: projectRoot,
          env: {
            ...process.env,
            DEPS_SMUGGLER_PROJECT_ROOT: projectRoot,
            DEPS_SMUGGLER_MAVEN_REPO_URL: `http://127.0.0.1:${port}/maven2`,
            DEPS_SMUGGLER_OUTPUT: output,
            DEPS_SMUGGLER_TEST_USER_DIR: isolatedHome,
            NODE_OPTIONS: `--require ${JSON.stringify(isolateHomeScript)}`,
          },
          timeout: 120_000,
        });
        child = { code: 0, stdout: result.stdout, stderr: result.stderr };
      } catch (error) {
        const failure = error as typeof error & { code?: number; stdout?: string; stderr?: string };
        child = {
          code: typeof failure.code === 'number' ? failure.code : -1,
          stdout: failure.stdout ?? '',
          stderr: failure.stderr ?? '',
        };
      }

      expect(child.code).toBe(1);
      const outputText = `${child.stdout}\n${child.stderr}`;
      expect(outputText).toContain('다운로드 완료 (일부 실패)');
      expect(outputText).toContain('com.example:missing@1.0.0');
      expect(outputText).toContain('404');
      expect(requests).toContain('/maven2/com/example/missing/1.0.0/missing-1.0.0.jar');
      const deliveredArtifacts = (await fs.readdir(output)).filter((name) =>
        /^packages-.*\.(zip|tar\.gz)$/.test(name) || /^install\.(sh|ps1)$/.test(name)
      );
      expect(deliveredArtifacts).toEqual([]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 180_000);
});
