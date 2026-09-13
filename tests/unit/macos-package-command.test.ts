import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = path.resolve('scripts/package-macos.mjs');
const temporaryDirectories: string[] = [];

async function runPackageMac(args: string[]) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'depssmuggler-mac-command-'));
  temporaryDirectories.push(directory);
  const bootstrap = path.join(directory, 'bootstrap.cjs');
  await writeFile(bootstrap, `
    const { EventEmitter } = require('node:events');
    const { syncBuiltinESMExports } = require('node:module');
    const childProcess = require('node:child_process');
    childProcess.spawn = (_command, commandArgs) => {
      process.stdout.write(JSON.stringify(commandArgs));
      const child = new EventEmitter();
      process.nextTick(() => child.emit('exit', 0));
      return child;
    };
    syncBuiltinESMExports();
  `);

  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--require', bootstrap, script, ...args]);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('macOS package command wrapper', () => {
  const publishArgumentCases: Array<[string[]]> = [
    [[]],
    [['--publish', 'never']],
    [['--publish=never']],
    [['-p', 'never']],
    [['-p=never']],
  ];

  it.each(publishArgumentCases)('forwards %j with exactly one publish-never pair', async (args) => {
    const result = await runPackageMac(args);
    expect(result.code).toBe(0);
    const forwarded = JSON.parse(result.stdout) as string[];
    expect(forwarded).toEqual(expect.arrayContaining(['--mac', '--publish', 'never']));
    expect(forwarded.filter((argument) => argument === '--publish')).toHaveLength(1);
    expect(forwarded.filter((argument) => argument === 'never')).toHaveLength(1);
  });

  it('preserves unrelated electron-builder arguments', async () => {
    const result = await runPackageMac(['--dir']);
    const forwarded = JSON.parse(result.stdout) as string[];
    expect(forwarded).toEqual(expect.arrayContaining(['--mac', '--dir', '--publish', 'never']));
  });

  it('rejects publishing before spawning electron-builder', async () => {
    const result = await runPackageMac(['--publish', 'always']);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/validated before publishing/i);
  });
});
