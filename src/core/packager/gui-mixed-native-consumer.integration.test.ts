import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import archiver from 'archiver';
import * as tar from 'tar';
import { afterEach, describe, expect, it } from 'vitest';
import { getArchivePackager } from './archive-packager';
import { getFileSplitter } from './file-splitter';
import { createDeliveryPipeline } from '../../../electron/services/download/delivery-pipeline';
import { initializeEmailSender } from '../mailer/email-sender';
import { generateInstallScripts } from '../shared';
import type { PackageInfo } from '../../types';

const execFileAsync = promisify(execFile);
async function zipFile(output: string, files: Record<string, string>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const archive = archiver('zip');
    const stream = createWriteStream(output);
    stream.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(stream);
    for (const [name, content] of Object.entries(files)) archive.append(content, { name });
    void archive.finalize();
  });
}

async function createWheel(root: string): Promise<string> {
  const wheel = path.join(root, 'colorama-0.4.6-py2.py3-none-any.whl');
  await zipFile(wheel, {
    'colorama/__init__.py': '__version__ = "0.4.6"\n',
    'colorama-0.4.6.dist-info/METADATA': 'Metadata-Version: 2.1\nName: colorama\nVersion: 0.4.6\n',
    'colorama-0.4.6.dist-info/WHEEL': 'Wheel-Version: 1.0\nRoot-Is-Purelib: true\nTag: py2.py3-none-any\n',
    'colorama-0.4.6.dist-info/RECORD': '',
  });
  return wheel;
}

async function createNpmTarball(root: string, name: string, version: string, dependency?: string): Promise<string> {
  const source = path.join(root, `${name}-${version}-source`);
  await fs.mkdir(path.join(source, 'package'), { recursive: true });
  await fs.writeFile(path.join(source, 'package/package.json'), JSON.stringify({
    name,
    version,
    main: 'index.js',
    ...(dependency ? { dependencies: { 'is-number': dependency } } : {}),
  }));
  await fs.writeFile(path.join(source, 'package/index.js'), dependency
    ? "module.exports = { name: 'is-odd', dependency: require('is-number') };\n"
    : "module.exports = { name: 'is-number', version: '6.0.0' };\n");
  const target = path.join(root, `${name}-${version}.tgz`);
  await tar.create({ cwd: source, file: target, gzip: true }, ['package']);
  return target;
}

async function zipEntries(filePath: string): Promise<string[]> {
  const python = process.platform === 'win32' ? 'py' : 'python3';
  const args = process.platform === 'win32' ? ['-3', '-c'] : ['-c'];
  args.push('import sys, zipfile; print("\\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))', filePath);
  const output = await execFileAsync(python, args);
  return output.stdout.trim().split(/\r?\n/).filter(Boolean);
}

async function extractZip(filePath: string, destination: string): Promise<void> {
  const python = process.platform === 'win32' ? 'py' : 'python3';
  const args = process.platform === 'win32' ? ['-3', '-c'] : ['-c'];
  args.push('import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', filePath, destination);
  await execFileAsync(python, args);
}

describe('GUI mixed pip/npm native archive consumer', () => {
  let tempRoot: string | undefined;
  let registry: Server | undefined;

  afterEach(async () => {
    if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
    if (registry?.listening) await new Promise<void>((resolve) => registry?.close(() => resolve()));
    registry = undefined;
  });

  it('puts both native installers in the ZIP and consumes pip plus npm offline', async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-gui-mixed-'));
    const output = path.join(tempRoot, 'delivery output');
    const packageDir = path.join(output, 'packages');
    const pipDir = path.join(packageDir, 'pip');
    const npmDir = path.join(packageDir, 'npm');
    await fs.mkdir(pipDir, { recursive: true });
    await fs.mkdir(npmDir, { recursive: true });
    const wheel = await createWheel(tempRoot);
    const rootTgz = await createNpmTarball(tempRoot, 'is-odd', '3.0.1', '6.0.0');
    const dependencyTgz = await createNpmTarball(tempRoot, 'is-number', '6.0.0');
    await fs.copyFile(wheel, path.join(pipDir, path.basename(wheel)));
    await fs.copyFile(rootTgz, path.join(npmDir, path.basename(rootTgz)));
    await fs.copyFile(dependencyTgz, path.join(npmDir, path.basename(dependencyTgz)));
    await fs.mkdir(path.join(packageDir, 'unrelated'), { recursive: true });
    await fs.writeFile(path.join(packageDir, 'unrelated', 'not-an-npm-package.tgz'), 'unrelated archive payload');

    const packages = [
      { id: 'pip-colorama', type: 'pip', name: 'colorama', version: '0.4.6', filePath: path.join(pipDir, path.basename(wheel)) },
      { id: 'npm-is-odd', type: 'npm', name: 'is-odd', version: '3.0.1', filePath: path.join(npmDir, path.basename(rootTgz)) },
      { id: 'npm-is-number', type: 'npm', name: 'is-number', version: '6.0.0', filePath: path.join(npmDir, path.basename(dependencyTgz)) },
    ];
    const packageInfos = packages.map(({ filePath: _filePath, ...pkg }) => pkg) as PackageInfo[];
    let registryRequests = 0;
    registry = createServer((_request, response) => {
      registryRequests += 1;
      response.writeHead(503);
      response.end('network access is forbidden during offline install');
    });
    await new Promise<void>((resolve) => registry?.listen(0, '127.0.0.1', () => resolve()));
    const registryAddress = registry.address();
    if (!registryAddress || typeof registryAddress === 'string') throw new Error('registry fixture did not start');
    const registryUrl = `http://127.0.0.1:${registryAddress.port}`;

    const pipeline = createDeliveryPipeline({
      archivePackager: getArchivePackager(),
      generateInstallScripts,
      initializeEmailSender,
      getFileSplitter,
      stat: fs.stat,
    });
    const result = await pipeline.finalizeDownload({
      outputDir: output,
      options: {
        outputDir: output,
        outputFormat: 'zip',
        includeScripts: true,
        deliveryMethod: 'local',
        npmRootPackages: packageInfos.filter((pkg) => pkg.type === 'npm' && pkg.name === 'is-odd'),
      },
      deliveredPackages: packages,
      packageInfos,
      results: packages.map(({ id, filePath }) => ({ id, success: true, filePath })),
      failedDownloadCount: 0,
      progressEmitter: { emitDownloadStatus: () => undefined },
      isCancelled: () => false,
    });
    expect(result.success, JSON.stringify(result)).toBe(true);
    const archivePath = String(result.outputPath);
    const entries = await zipEntries(archivePath);
    expect(entries).toContain('install.sh');
    expect(entries).toContain('install.ps1');

    // Consume only the archive; the original generated output is unavailable.
    await fs.rm(output, { recursive: true, force: true });
    const extracted = path.join(tempRoot, 'archive extracted');
    await fs.mkdir(extracted, { recursive: true });
    await extractZip(archivePath, extracted);
    const installUser = path.join(tempRoot, 'python venv');
    const windows = process.platform === 'win32';
    await execFileAsync(windows ? 'py' : 'python3', windows ? ['-3', '-m', 'venv', installUser] : ['-m', 'venv', installUser]);
    const env = {
      ...process.env,
      PATH: `${path.join(installUser, windows ? 'Scripts' : 'bin')}${path.delimiter}${process.env.PATH ?? ''}`,
      PIP_CONFIG_FILE: path.join(tempRoot, 'empty-pip.conf'),
      npm_config_cache: path.join(tempRoot, 'npm cache'),
      npm_config_userconfig: path.join(tempRoot, 'empty-npmrc'),
      npm_config_globalconfig: path.join(tempRoot, 'empty-global-npmrc'),
      npm_config_registry: registryUrl,
      PIP_DISABLE_PIP_VERSION_CHECK: '1',
    };
    await fs.writeFile(env.PIP_CONFIG_FILE, '');
    await fs.writeFile(env.npm_config_userconfig, '');
    await fs.writeFile(env.npm_config_globalconfig, '');
    const python = path.join(installUser, windows ? 'Scripts/python.exe' : 'bin/python');
    const installCommand = windows
      ? { file: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(extracted, 'install.ps1')] }
      : { file: 'bash', args: [path.join(extracted, 'install.sh')] };
    const install = await execFileAsync(installCommand.file, installCommand.args, {
      cwd: extracted,
      env,
      timeout: 180_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    expect(install.stderr).not.toContain('ERROR');
    const pythonCheck = await execFileAsync(python, ['-c', 'import colorama; print(colorama.__version__)'], { env });
    expect(pythonCheck.stdout.trim()).toBe('0.4.6');
    const npmProject = path.join(extracted, 'npm-project');
    const npmCheck = await execFileAsync(process.execPath, ['-e', "const odd=require('./node_modules/is-odd'); if (!odd.dependency) process.exit(1); console.log(odd.name)"], { cwd: npmProject, env });
    expect(npmCheck.stdout.trim()).toBe('is-odd');
    await expect(fs.access(path.join(npmProject, 'node_modules/is-number/package.json'))).resolves.toBeUndefined();
    expect(registryRequests).toBe(0);

    const brokenBundle = path.join(tempRoot, 'archive missing root');
    await fs.mkdir(brokenBundle, { recursive: true });
    await extractZip(archivePath, brokenBundle);
    await fs.rm(path.join(brokenBundle, 'packages/npm/is-odd-3.0.1.tgz'));
    let failureOutput = '';
    try {
      await execFileAsync(
        installCommand.file,
        installCommand.args.map((arg) => arg.replace(extracted, brokenBundle)),
        { cwd: brokenBundle, env, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 },
      );
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string };
      failureOutput = `${failure.stdout ?? ''}\n${failure.stderr ?? ''}`;
    }
    expect(failureOutput).not.toContain('Installation complete!');
    await expect(fs.access(path.join(brokenBundle, 'npm-project'))).rejects.toThrow();
  }, 300_000);
});
