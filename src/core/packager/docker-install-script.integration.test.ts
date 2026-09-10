import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { realpathSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import * as fs from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';
import { getScriptGenerator } from './script-generator';
import type { PackageInfo } from '../../types';

const execFileAsync = promisify(execFile);
const generator = getScriptGenerator();
const createdRoots: string[] = [];

async function createDockerFixture(pkg: PackageInfo, expectedBasename: string) {
  const root = path.join(
    os.tmpdir(),
    `deps smuggler docker archive-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const packagesDir = path.join(root, 'packages');
  const externalCwd = path.join(root, 'caller cwd with spaces');
  const shimDir = path.join(root, 'docker shim');
  const recordPath = path.join(root, 'docker argv.txt');
  const bashPath = path.join(root, 'install.sh');
  const powershellPath = path.join(root, 'install.ps1');
  const recorderPath = path.join(shimDir, 'docker-recorder.cjs');

  createdRoots.push(root);
  await fs.ensureDir(packagesDir);
  await fs.ensureDir(externalCwd);
  await fs.ensureDir(shimDir);
  await fs.writeFile(path.join(packagesDir, expectedBasename), 'docker archive fixture');

  const dockerRecorder = `const fs = require('fs');
const args = process.argv.slice(2);
const record = { args, cwd: process.cwd() };
fs.writeFileSync(process.env.DOCKER_ARGV_RECORD, JSON.stringify(record));
if (args.length !== 3 || args[0] !== 'load' || args[1] !== '-i' || !fs.existsSync(args[2])) process.exit(17);
`;
  const dockerShim = `#!/bin/sh
exec node "$DOCKER_RECORDER_SCRIPT" "$@"
`;
  await fs.writeFile(recorderPath, dockerRecorder);
  await fs.writeFile(path.join(shimDir, 'docker'), dockerShim, { mode: 0o755 });

  await generator.generateBashScript([pkg], bashPath);
  await generator.generatePowerShellScript([pkg], powershellPath);

  return { root, packagesDir, externalCwd, shimDir, recordPath, recorderPath, bashPath, powershellPath };
}

async function runScript(
  fixture: Awaited<ReturnType<typeof createDockerFixture>>,
  command: string,
  args: string[],
) {
  await execFileAsync(command, args, {
    cwd: fixture.externalCwd,
    env: {
      ...process.env,
      PATH: `${fixture.shimDir}${path.delimiter}${process.env.PATH || ''}`,
      DOCKER_ARGV_RECORD: fixture.recordPath,
      DOCKER_RECORDER_SCRIPT: fixture.recorderPath,
    },
    timeout: 45_000,
  });
  return JSON.parse(await fs.readFile(fixture.recordPath, 'utf8')) as { args: string[]; cwd: string };
}

async function runPowerShellIfAvailable(fixture: Awaited<ReturnType<typeof createDockerFixture>>) {
  if (process.platform !== 'win32') return undefined;

  await fs.writeFile(
    path.join(fixture.shimDir, 'docker.cmd'),
    '@echo off\r\nnode "%DOCKER_RECORDER_SCRIPT%" %*\r\nexit /b %ERRORLEVEL%\r\n',
  );
  return runScript(fixture, 'powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    fixture.powershellPath,
  ]);
}

afterEach(async () => {
  await Promise.all(createdRoots.splice(0).map((root) => fs.remove(root)));
});

describe('Docker install scripts use downloader archive names', () => {
  it.each([
    ['busybox', '1.36', 'busybox-1.36.tar', 'x86_64'],
    ['busybox', '1.36', 'busybox-1.36.tar', 'arm64'],
    ['library/busybox', '1.36', 'busybox-1.36.tar', 'x86_64'],
    ['ghcr.io/acme/web-app', 'release:v1', 'web-app-release_v1.tar', 'x86_64'],
  ] as const)(
    'loads the existing archive for %s:%s (%s) from an external cwd',
    async (name, version, expectedBasename, arch) => {
      const pkg: PackageInfo = { type: 'docker', name, version, arch };
      const fixture = await createDockerFixture(pkg, expectedBasename);

      const bashContent = await fs.readFile(fixture.bashPath, 'utf8');
      const powershellContent = await fs.readFile(fixture.powershellPath, 'utf8');
      expect(bashContent).toContain(expectedBasename);
      expect(powershellContent).toContain(`'${expectedBasename}'`);

      const expectedArtifact = realpathSync.native(path.join(fixture.packagesDir, expectedBasename));
      const command = process.platform === 'win32' ? 'powershell.exe' : 'bash';
      const commandArgs = process.platform === 'win32'
        ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fixture.powershellPath]
        : [fixture.bashPath];
      const recorded = process.platform === 'win32'
        ? await runPowerShellIfAvailable(fixture)
        : await runScript(fixture, command, commandArgs);
      if (!recorded) throw new Error('Docker recording shim did not capture argv');
      expect(recorded.args).toHaveLength(3);
      expect(recorded.args.slice(0, 2)).toEqual(['load', '-i']);
      expect(realpathSync.native(path.resolve(recorded.cwd, recorded.args[2]))).toBe(expectedArtifact);

    },
    90_000,
  );

  it.skipIf(process.env.DEPS_SMUGGLER_NATIVE_DOCKER !== '1')(
    'loads a fixture archive with native Docker',
    async () => {
      const dockerVersion = await execFileAsync('docker', ['version', '--format', '{{.Server.Version}}'], { timeout: 10_000 });
      expect(dockerVersion.stdout.trim()).not.toBe('');

      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const imageName = `depssmuggler-native-${suffix}`;
      const tag = `${imageName}:1.0`;
      const pkg: PackageInfo = { type: 'docker', name: imageName, version: '1.0', arch: 'x86_64' };
      const fixture = await createDockerFixture(pkg, `${imageName}-1.0.tar`);
      const saveRoot = path.join(fixture.root, 'docker-save');
      const rootfs = path.join(saveRoot, 'rootfs');
      const layerPath = path.join(saveRoot, 'layer.tar');
      const configPath = path.join(saveRoot, 'config.json');
      const manifestPath = path.join(saveRoot, 'manifest.json');
      const archivePath = path.join(fixture.packagesDir, `${imageName}-1.0.tar`);

      await expect(execFileAsync('docker', ['image', 'inspect', tag], { timeout: 10_000 })).rejects.toThrow();

      try {
        await fs.ensureDir(rootfs);
        await fs.writeFile(path.join(rootfs, 'depssmuggler.txt'), 'native fixture');
        await execFileAsync('tar', ['-cf', layerPath, '-C', rootfs, 'depssmuggler.txt']);
        const layerDigest = createHash('sha256').update(await fs.readFile(layerPath)).digest('hex');
        await fs.writeJson(configPath, {
          architecture: 'amd64',
          os: 'linux',
          config: { Cmd: ['/bin/sh'], Labels: { 'com.depssmuggler.test': suffix } },
          rootfs: { type: 'layers', diff_ids: [`sha256:${layerDigest}`] },
        });
        const configDigest = createHash('sha256').update(await fs.readFile(configPath)).digest('hex');
        await fs.writeJson(manifestPath, [{ Config: 'config.json', RepoTags: [tag], Layers: ['layer.tar'] }]);
        await execFileAsync('tar', ['-cf', archivePath, '-C', saveRoot, 'config.json', 'manifest.json', 'layer.tar']);

        const scriptCommand = process.platform === 'win32' ? 'powershell.exe' : 'bash';
        const scriptArgs = process.platform === 'win32'
          ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fixture.powershellPath]
          : [fixture.bashPath];
        await execFileAsync(scriptCommand, scriptArgs, { cwd: fixture.externalCwd, timeout: 120_000 });
        const inspected = await execFileAsync('docker', ['image', 'inspect', tag], { timeout: 10_000 });
        const image = JSON.parse(inspected.stdout)[0] as { Id: string; RepoTags: string[]; Config: { Labels: Record<string, string> } };
        expect(image.Id).toBe(`sha256:${configDigest}`);
        expect(image.RepoTags).toContain(tag);
        expect(image.Config.Labels['com.depssmuggler.test']).toBe(suffix);
      } finally {
        await execFileAsync('docker', ['image', 'rm', tag], { timeout: 10_000 }).catch(() => undefined);
      }
    },
    180_000,
  );
});
