import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const projectRoot = resolve(__dirname, '../..');
const packageVersion = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')).version as string;
const npmExecPath = process.env.npm_execpath;
const homeIsolationScript = join(projectRoot, 'tests/fixtures/isolate-home.cjs');
const temporaryFixtures: string[] = [];

interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

function run(command: string, args: string[], options: RunOptions = {}): string {
  return execFileSync(command, args, {
    cwd: options.cwd ?? projectRoot,
    encoding: 'utf8',
    timeout: 60_000,
    env: options.env,
  }).trim();
}

function runNpm(args: string[], options: RunOptions = {}): string {
  if (npmExecPath) {
    return run(process.execPath, [npmExecPath, ...args], options);
  }

  return run(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, options);
}

function runSourceCliVersion(alias: '--version' | '-v', env: NodeJS.ProcessEnv): string {
  const output = runNpm(['run', 'cli', '--', alias], { env });
  return output.split(/\r?\n/).filter(Boolean).at(-1) ?? '';
}

function runPackedCli(args: string[], cwd: string, env: NodeJS.ProcessEnv): string {
  return run(process.execPath, args, {
    cwd,
    env: { ...env, NODE_PATH: join(projectRoot, 'node_modules') },
  });
}

describe('CLI version entrypoints', () => {
  afterAll(() => {
    for (const fixture of temporaryFixtures) {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('reports package metadata from source, built, and packed-style entrypoints', () => {
    const isolatedHome = mkdtempSync(join(tmpdir(), 'depssmuggler-cli-home-'));
    temporaryFixtures.push(isolatedHome);
    const existingNodeOptions = process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : '';
    const env = {
      ...process.env,
      DEPS_SMUGGLER_TEST_USER_DIR: isolatedHome,
      NODE_OPTIONS: `${existingNodeOptions}--require ${homeIsolationScript}`,
    };

    expect(runSourceCliVersion('--version', env)).toBe(packageVersion);
    expect(runSourceCliVersion('-v', env)).toBe(packageVersion);

    runNpm(['run', 'build:electron'], { env });
    expect(run(process.execPath, ['dist/src/cli/index.js', '--version'], { env })).toBe(packageVersion);
    expect(run(process.execPath, ['dist/src/cli/index.js', '-v'], { env })).toBe(packageVersion);

    const fixture = mkdtempSync(join(tmpdir(), 'depssmuggler-cli-version-'));
    temporaryFixtures.push(fixture);
    cpSync(join(projectRoot, 'dist'), join(fixture, 'dist'), { recursive: true });
    cpSync(join(projectRoot, 'package.json'), join(fixture, 'package.json'));

    expect(runPackedCli([join(fixture, 'dist/src/cli/index.js'), '--version'], dirname(fixture), env)).toBe(packageVersion);
  }, 60_000);
});
