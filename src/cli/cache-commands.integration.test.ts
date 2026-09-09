import { execFile } from 'node:child_process';
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
require(path.join(projectRoot, 'node_modules/ts-node')).register({
  project: path.join(projectRoot, 'tsconfig.cli.json'),
});

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

async function runChild(
  harnessPath: string,
  isolatedHome: string,
  args: string[],
): Promise<ChildResult> {
  try {
    const result = await execFileAsync(process.execPath, [harnessPath], {
      cwd: projectRoot,
      env: {
        ...process.env,
        DEPS_SMUGGLER_PROJECT_ROOT: projectRoot,
        DEPS_SMUGGLER_ARGS: JSON.stringify(args),
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
      status: failure.code,
      signal: failure.signal ?? null,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

describe('CLI cache commands integration', () => {
  let tempRoot: string | undefined;

  afterEach(async () => {
    if (tempRoot) await fs.remove(tempRoot);
    tempRoot = undefined;
  });

  it('lists valid cache directories when the root also contains a loose file', async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-cache-list-'));
    const harnessPath = path.join(tempRoot, 'cli-harness.cjs');
    const isolatedHome = path.join(tempRoot, 'isolated user');
    const cacheRoot = path.join(tempRoot, 'cache root');
    const validCache = path.join(cacheRoot, 'valid-cache');
    await fs.writeFile(harnessPath, childHarness);
    await fs.ensureDir(validCache);
    await fs.writeJson(path.join(validCache, 'manifest.json'), {
      name: 'fixture-package',
      version: '1.2.3',
      type: 'apk',
    });
    await fs.writeFile(path.join(validCache, 'payload.apk'), 'fixture payload');
    await fs.writeFile(path.join(cacheRoot, 'loose-cache-entry.json'), '{"loose":true}\n');

    const configured = await runChild(
      harnessPath,
      isolatedHome,
      ['config', 'set', 'cachePath', cacheRoot],
    );
    expect(configured.status, `${configured.stdout}\n${configured.stderr}`).toBe(0);
    expect(configured.signal).toBeNull();

    const listed = await runChild(harnessPath, isolatedHome, ['cache', 'list']);
    expect(listed.status, `${listed.stdout}\n${listed.stderr}`).toBe(0);
    expect(listed.signal).toBeNull();
    expect(listed.stderr).not.toContain('ENOTDIR');
    expect(listed.stdout.match(/fixture-package/g)).toHaveLength(1);
    expect(listed.stdout.match(/1\.2\.3/g)).toHaveLength(1);
    expect(listed.stdout).toContain('총 1개 패키지');
  }, 120_000);

  it('returns non-zero for cache commands when cachePath is a regular file', async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-cache-file-'));
    const harnessPath = path.join(tempRoot, 'cli-harness.cjs');
    const isolatedHome = path.join(tempRoot, 'isolated user');
    const cacheFile = path.join(tempRoot, 'configured cache file');
    const originalContents = 'regular cache path fixture\n';
    await fs.writeFile(harnessPath, childHarness);
    await fs.writeFile(cacheFile, originalContents);

    const configured = await runChild(
      harnessPath,
      isolatedHome,
      ['config', 'set', 'cachePath', cacheFile],
    );
    expect(configured.status, `${configured.stdout}\n${configured.stderr}`).toBe(0);
    expect(configured.signal).toBeNull();

    for (const args of [
      ['cache', 'size'],
      ['cache', 'list'],
      ['cache', 'clear', '--force'],
    ]) {
      const result = await runChild(harnessPath, isolatedHome, args);
      const output = `${result.stdout}\n${result.stderr}`;
      expect(result.status, output).toBe(1);
      expect(result.signal).toBeNull();
      expect(output).toContain('ENOTDIR');
      expect(output).not.toContain('✓');
      await expect(fs.readFile(cacheFile, 'utf8')).resolves.toBe(originalContents);
    }
  }, 180_000);

  it('keeps missing cache directories as successful empty-cache controls', async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-cache-missing-'));
    const harnessPath = path.join(tempRoot, 'cli-harness.cjs');
    const isolatedHome = path.join(tempRoot, 'isolated user');
    const missingPath = path.join(tempRoot, 'missing cache directory');
    await fs.writeFile(harnessPath, childHarness);

    const configured = await runChild(
      harnessPath,
      isolatedHome,
      ['config', 'set', 'cachePath', missingPath],
    );
    expect(configured.status, `${configured.stdout}\n${configured.stderr}`).toBe(0);
    expect(configured.signal).toBeNull();

    for (const args of [
      ['cache', 'size'],
      ['cache', 'list'],
      ['cache', 'clear', '--force'],
    ]) {
      const result = await runChild(harnessPath, isolatedHome, args);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.signal).toBeNull();
      expect(result.stdout.trim().length).toBeGreaterThan(0);
      expect(result.stderr).not.toMatch(/failure|실패|error/i);
      expect(await fs.pathExists(missingPath)).toBe(false);
    }
  }, 180_000);

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'returns non-zero for permission-denied cache roots on supported non-root POSIX runs',
    async () => {
      tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-cache-permission-'));
      const harnessPath = path.join(tempRoot, 'cli-harness.cjs');
      const isolatedHome = path.join(tempRoot, 'isolated user');
      await fs.writeFile(harnessPath, childHarness);

      for (const blockedPart of ['root', 'parent'] as const) {
        const cacheParent = path.join(tempRoot, `permission ${blockedPart} parent`);
        const cacheRoot = path.join(cacheParent, 'permission cache root');
        const blockedPath = blockedPart === 'root' ? cacheRoot : cacheParent;
        await fs.ensureDir(cacheRoot);

        try {
          await fs.chmod(blockedPath, 0o000);
          const configured = await runChild(
            harnessPath,
            isolatedHome,
            ['config', 'set', 'cachePath', cacheRoot],
          );
          expect(configured.status, `${configured.stdout}\n${configured.stderr}`).toBe(0);
          expect(configured.signal).toBeNull();

          for (const args of [
            ['cache', 'size'],
            ['cache', 'list'],
            ['cache', 'clear', '--force'],
          ]) {
            const result = await runChild(harnessPath, isolatedHome, args);
            const output = `${result.stdout}\n${result.stderr}`;
            expect(result.status, output).toBe(1);
            expect(result.signal).toBeNull();
            expect(output).toContain('EACCES');
            expect(output).not.toContain('✓');
          }
        } finally {
          await fs.chmod(blockedPath, 0o755);
        }
      }
    },
    180_000,
  );
});
