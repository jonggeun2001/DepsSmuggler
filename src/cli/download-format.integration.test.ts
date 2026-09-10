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
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const projectRoot = process.env.DEPS_SMUGGLER_PROJECT_ROOT;
const requestMarker = process.env.DEPS_SMUGGLER_REQUEST_MARKER;
let requestCount = 0;
const rejectNetwork = () => {
  requestCount += 1;
  throw new Error('Unexpected network request');
};
http.request = rejectNetwork;
http.get = rejectNetwork;
https.request = rejectNetwork;
https.get = rejectNetwork;
process.on('exit', () => {
  fs.writeFileSync(requestMarker, String(requestCount));
});

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
  markerPath: string,
  args: string[],
): Promise<ChildResult> {
  try {
    const result = await execFileAsync(process.execPath, [harnessPath], {
      cwd: projectRoot,
      env: {
        ...process.env,
        DEPS_SMUGGLER_PROJECT_ROOT: projectRoot,
        DEPS_SMUGGLER_ARGS: JSON.stringify(args),
        DEPS_SMUGGLER_REQUEST_MARKER: markerPath,
        DEPS_SMUGGLER_TEST_USER_DIR: isolatedHome,
        NODE_OPTIONS: `--require ${JSON.stringify(isolateHomeScript)}`,
      },
      maxBuffer: 2 * 1024 * 1024,
      timeout: 180_000,
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

describe('CLI archive format validation integration', () => {
  let tempRoot: string | undefined;

  afterEach(async () => {
    if (tempRoot) await fs.remove(tempRoot);
    tempRoot = undefined;
  });

  it('rejects unsupported formats before network or delivery output', async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-format-'));
    const harnessPath = path.join(tempRoot, 'cli harness.cjs');
    const isolatedHome = path.join(tempRoot, 'isolated user directory');
    const output = path.join(tempRoot, 'output directory with spaces');
    const requestMarker = path.join(tempRoot, 'request-count.txt');
    await fs.writeFile(harnessPath, childHarness);

    const child = await runChild(
      harnessPath,
      isolatedHome,
      requestMarker,
      [
        'download',
        '--type', 'pip',
        '--package', 'colorama',
        '--pkg-version', '0.4.6',
        '--no-deps',
        '--format', 'rar',
        '--output', output,
      ],
    );

    const outputText = `${child.stdout}\n${child.stderr}`;
    expect(child.status, outputText).toBe(1);
    expect(child.signal).toBeNull();
    expect(outputText).toContain('rar');
    expect(outputText).toContain('zip');
    expect(outputText).toContain('tar.gz');
    expect(await fs.readFile(requestMarker, 'utf8')).toBe('0');
    expect(await fs.pathExists(output)).toBe(false);
  }, 180_000);
});
