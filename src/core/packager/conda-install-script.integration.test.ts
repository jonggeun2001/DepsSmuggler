import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getScriptGenerator, type ScriptOptions } from './script-generator';
import type { PackageInfo } from '../../types';

const condaRoot: PackageInfo = { type: 'conda', name: 'fixture-root', version: '1.0.0' };
const condaDependency: PackageInfo = { type: 'conda', name: 'fixture-dependency', version: '2.0.0' };
const pipPackage: PackageInfo = { type: 'pip', name: 'fixture-pip', version: '3.0.0' };
const rootArchive = "nested dir/O'Reilly $root.conda";
const dependencyArchive = 'nested dir/fixture-dependency-2.0.0-0.tar.bz2';

function options(files: string[]): ScriptOptions {
  return { condaPackageFiles: files.map((relativePath) => ({ relativePath })) };
}

function generatedScript(
  scripts: Awaited<ReturnType<ReturnType<typeof getScriptGenerator>['generateAllScripts']>>,
  type: 'bash' | 'powershell'
) {
  const script = scripts.find((candidate) => candidate.type === type);
  if (!script) throw new Error('Missing generated ' + type + ' script');
  return script;
}

async function createBundle(root: string, relativePaths: string[]): Promise<{ outputDir: string; packageDir: string }> {
  const outputDir = path.join(root, 'bundle with spaces');
  const packageDir = path.join(outputDir, 'packages');
  await fs.promises.mkdir(packageDir, { recursive: true });
  for (const relativePath of relativePaths) {
    const filePath = path.join(packageDir, relativePath);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, relativePath + '\n');
  }
  return { outputDir, packageDir };
}

async function createCondaShim(root: string): Promise<{ binDir: string; logPath: string }> {
  const binDir = path.join(root, 'shim bin');
  const logPath = path.join(root, 'conda argv.jsonl');
  const nodeShim = path.join(root, 'conda argv shim.cjs');
  await fs.promises.mkdir(binDir, { recursive: true });
  await fs.promises.writeFile(
    nodeShim,
    [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const args = process.argv.slice(2);",
      "fs.appendFileSync(process.env.CONDA_SHIM_LOG, JSON.stringify(args) + '\\n');",
      "const prefixIndex = args.indexOf('--prefix');",
      "const prefix = prefixIndex >= 0 ? args[prefixIndex + 1] : undefined;",
      "const exitCode = Number(process.env.CONDA_SHIM_EXIT_CODE || '0');",
      "if (exitCode === 0 && prefix && (args[0] === 'create' || args[0] === 'install')) {",
      "  fs.mkdirSync(path.join(prefix, 'conda-meta'), { recursive: true });",
      "  fs.writeFileSync(path.join(prefix, 'conda-meta', 'history'), 'fixture\\\\n');",
      "}",
      "process.exit(exitCode);",
      "",
    ].join('\n')
  );

  if (process.platform === 'win32') {
    await fs.promises.writeFile(
      path.join(binDir, 'conda.cmd'),
      '@echo off\r\n"' + process.execPath + '" "' + nodeShim + '" %*\r\nexit /b %ERRORLEVEL%\r\n'
    );
    await fs.promises.writeFile(
      path.join(binDir, 'pip.cmd'),
      '@echo off\r\n"' + process.execPath + '" "' + nodeShim + '" pip %*\r\nexit /b %ERRORLEVEL%\r\n'
    );
  } else {
    await fs.promises.writeFile(
      path.join(binDir, 'conda'),
      '#!/bin/sh\nexec "' + process.execPath + '" "' + nodeShim + '" "$@"\n',
      { mode: 0o755 }
    );
    await fs.promises.writeFile(
      path.join(binDir, 'pip'),
      '#!/bin/sh\nexec "' + process.execPath + '" "' + nodeShim + '" pip "$@"\n',
      { mode: 0o755 }
    );
  }
  return { binDir, logPath };
}

async function runScript(
  scriptPath: string,
  env: NodeJS.ProcessEnv
): Promise<{ stdout: string; stderr: string; code: number | null; signal: NodeJS.Signals | null }> {
  const command = process.platform === 'win32'
    ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : '/bin/bash';
  const args = process.platform === 'win32'
    ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath]
    : [scriptPath];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: path.dirname(scriptPath), env });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill('SIGTERM'), 30_000);
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, code, signal });
    });
  });
}

async function readCalls(logPath: string): Promise<string[][]> {
  if (!fs.existsSync(logPath)) return [];
  const content = await fs.promises.readFile(logPath, 'utf8');
  return content.trim() === '' ? [] : content.trim().split('\n').map((line) => JSON.parse(line) as string[]);
}

function testEnvironment(
  shim: { binDir: string; logPath: string },
  extra: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: shim.binDir + path.delimiter + (process.env.PATH ?? ''),
    DEPS_SMUGGLER_CONDA_PREFIX: '',
    CONDA_SHIM_LOG: shim.logPath,
    ...extra,
  };
}

function expectCompleted(result: { code: number | null; signal: NodeJS.Signals | null }): void {
  expect(typeof result.code).toBe('number');
  expect(result.signal).toBeNull();
}

async function makeTempDir(prefix: string): Promise<string> {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
  return fs.realpathSync.native(directory);
}

function generatedArchivePath(bundle: { outputDir: string; packageDir: string }, relativePath: string): string {
  if (process.platform === 'win32') return path.join(bundle.packageDir, relativePath);
  return bundle.outputDir + path.sep + '.' + path.sep + 'packages' + path.sep + relativePath.split('/').join(path.sep);
}

describe('Conda offline installer consumer contract', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const directory of tempDirs.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
  });

  it('keeps pip separate, passes exact quoted archives, and reruns with install', async () => {
    const root = await makeTempDir('depssmuggler conda consumer-');
    tempDirs.push(root);
    const bundle = await createBundle(root, [rootArchive, dependencyArchive]);
    const shim = await createCondaShim(root);
    const scripts = await getScriptGenerator().generateAllScripts(
      [pipPackage, condaRoot, condaDependency],
      bundle.outputDir,
      options([rootArchive, dependencyArchive])
    );
    const script = generatedScript(scripts, process.platform === 'win32' ? 'powershell' : 'bash');
    const firstRun = await runScript(script.path, testEnvironment(shim));
    expectCompleted(firstRun);
    expect(firstRun.code).toBe(0);

    const prefix = path.join(bundle.outputDir, 'conda-env');
    expect(fs.existsSync(path.join(prefix, 'conda-meta', 'history'))).toBe(true);
    await fs.promises.writeFile(path.join(prefix, 'sentinel-preserved'), 'keep');
    const secondRun = await runScript(script.path, testEnvironment(shim));
    expectCompleted(secondRun);
    expect(secondRun.code).toBe(0);
    expect(await fs.promises.readFile(path.join(prefix, 'sentinel-preserved'), 'utf8')).toBe('keep');

    const expectedArchives = [
      generatedArchivePath(bundle, rootArchive),
      generatedArchivePath(bundle, dependencyArchive),
    ];
    const calls = await readCalls(shim.logPath);
    const condaCalls = calls.filter((call) => call[0] === 'create' || call[0] === 'install');
    const pipCalls = calls.filter((call) => call[0] === 'pip');
    expect(condaCalls).toEqual([
      ['create', '--offline', '--yes', '--no-default-packages', '--prefix', prefix, ...expectedArchives],
      ['install', '--offline', '--yes', '--prefix', prefix, ...expectedArchives],
    ]);
    expect(pipCalls).toHaveLength(2);
    for (const call of pipCalls) {
      expect(call).toContain('install');
      expect(call).toContain('fixture-pip==3.0.0');
      expect(call).not.toContain(rootArchive);
      expect(call).not.toContain(dependencyArchive);
    }
  }, 60_000);

  it('passes only the root archive for a no-deps bundle', async () => {
    const root = await makeTempDir('depssmuggler conda nodeps-');
    tempDirs.push(root);
    const bundle = await createBundle(root, [rootArchive]);
    const shim = await createCondaShim(root);
    const scripts = await getScriptGenerator().generateAllScripts([condaRoot], bundle.outputDir, options([rootArchive]));
    const script = generatedScript(scripts, process.platform === 'win32' ? 'powershell' : 'bash');
    const result = await runScript(script.path, testEnvironment(shim));
    expectCompleted(result);
    expect(result.code).toBe(0);
    expect((await readCalls(shim.logPath)).filter((call) => call[0] !== 'pip')).toEqual([
      ['create', '--offline', '--yes', '--no-default-packages', '--prefix', path.join(bundle.outputDir, 'conda-env'), generatedArchivePath(bundle, rootArchive)],
    ]);
  }, 60_000);

  it('uses install mode for relative and absolute existing prefixes', async () => {
    const root = await makeTempDir('depssmuggler conda prefixes-');
    tempDirs.push(root);
    const bundle = await createBundle(root, [rootArchive]);
    const shim = await createCondaShim(root);
    const relativePrefix = path.join(bundle.outputDir, 'existing relative');
    const absolutePrefix = path.join(root, 'existing absolute');
    for (const prefix of [relativePrefix, absolutePrefix]) {
      await fs.promises.mkdir(path.join(prefix, 'conda-meta'), { recursive: true });
      await fs.promises.writeFile(path.join(prefix, 'conda-meta', 'history'), 'existing\n');
    }
    const scripts = await getScriptGenerator().generateAllScripts([condaRoot], bundle.outputDir, options([rootArchive]));
    const script = generatedScript(scripts, process.platform === 'win32' ? 'powershell' : 'bash');
    const relativeResult = await runScript(script.path, testEnvironment(shim, { DEPS_SMUGGLER_CONDA_PREFIX: 'existing relative' }));
    const absoluteResult = await runScript(script.path, testEnvironment(shim, { DEPS_SMUGGLER_CONDA_PREFIX: absolutePrefix }));
    expectCompleted(relativeResult);
    expectCompleted(absoluteResult);
    expect(relativeResult.code).toBe(0);
    expect(absoluteResult.code).toBe(0);
    expect((await readCalls(shim.logPath)).filter((call) => call[0] !== 'pip')).toEqual([
      ['install', '--offline', '--yes', '--prefix', relativePrefix, generatedArchivePath(bundle, rootArchive)],
      ['install', '--offline', '--yes', '--prefix', absolutePrefix, generatedArchivePath(bundle, rootArchive)],
    ]);
  }, 60_000);

  it('fails before Conda when an archive is missing or the executable is unavailable', async () => {
    const root = await makeTempDir('depssmuggler conda missing-');
    tempDirs.push(root);
    const bundle = await createBundle(root, []);
    const shim = await createCondaShim(root);
    const missingScripts = await getScriptGenerator().generateAllScripts(
      [condaRoot],
      bundle.outputDir,
      { includeErrorHandling: false, ...options(['missing.conda']) }
    );
    const missingResult = await runScript(
      generatedScript(missingScripts, process.platform === 'win32' ? 'powershell' : 'bash').path,
      testEnvironment(shim)
    );
    expectCompleted(missingResult);
    expect(missingResult.code).not.toBe(0);
    expect(missingResult.stdout).not.toContain('모든 설치가 완료되었습니다');
    expect(missingResult.stdout + missingResult.stderr).toContain('Conda 아카이브를 찾을 수 없습니다');
    expect(await readCalls(shim.logPath)).toEqual([]);

    const executableRoot = await makeTempDir('depssmuggler conda no-exe-');
    tempDirs.push(executableRoot);
    const executableBundle = await createBundle(executableRoot, [rootArchive]);
    const executableScripts = await getScriptGenerator().generateAllScripts(
      [condaRoot],
      executableBundle.outputDir,
      { includeErrorHandling: false, ...options([rootArchive]) }
    );
    const emptyPath = path.join(executableRoot, 'empty path');
    await fs.promises.mkdir(emptyPath);
    if (process.platform !== 'win32') {
      await fs.promises.symlink('/usr/bin/dirname', path.join(emptyPath, 'dirname'));
    }
    const noExecutableResult = await runScript(
      generatedScript(executableScripts, process.platform === 'win32' ? 'powershell' : 'bash').path,
      {
        ...process.env,
        PATH: emptyPath,
        DEPS_SMUGGLER_CONDA_PREFIX: '',
        CONDA_SHIM_LOG: shim.logPath,
      }
    );
    expectCompleted(noExecutableResult);
    expect(noExecutableResult.code).not.toBe(0);
    expect(noExecutableResult.stdout).not.toContain('모든 설치가 완료되었습니다');
    expect(noExecutableResult.stdout + noExecutableResult.stderr).toContain('Conda가 설치되어 있지 않습니다');
  }, 60_000);

  it('propagates Conda failure and preserves an ordinary existing directory', async () => {
    const root = await makeTempDir('depssmuggler conda failure-');
    tempDirs.push(root);
    const bundle = await createBundle(root, [rootArchive]);
    const shim = await createCondaShim(root);
    const scripts = await getScriptGenerator().generateAllScripts(
      [condaRoot],
      bundle.outputDir,
      { includeErrorHandling: false, ...options([rootArchive]) }
    );
    const failed = await runScript(
      generatedScript(scripts, process.platform === 'win32' ? 'powershell' : 'bash').path,
      testEnvironment(shim, { CONDA_SHIM_EXIT_CODE: '23' })
    );
    expectCompleted(failed);
    expect(failed.code).not.toBe(0);
    expect(failed.stdout).not.toContain('모든 설치가 완료되었습니다');
    expect(await readCalls(shim.logPath)).toHaveLength(1);

    await fs.promises.rm(shim.logPath, { force: true });
    const ordinaryPrefix = path.join(root, 'ordinary existing');
    await fs.promises.mkdir(ordinaryPrefix, { recursive: true });
    const sentinel = path.join(ordinaryPrefix, 'sentinel');
    await fs.promises.writeFile(sentinel, 'keep');
    const ordinary = await runScript(
      generatedScript(scripts, process.platform === 'win32' ? 'powershell' : 'bash').path,
      testEnvironment(shim, { DEPS_SMUGGLER_CONDA_PREFIX: ordinaryPrefix })
    );
    expectCompleted(ordinary);
    expect(ordinary.code).not.toBe(0);
    expect(await fs.promises.readFile(sentinel, 'utf8')).toBe('keep');
    expect(await readCalls(shim.logPath)).toEqual([]);
  }, 60_000);
});
