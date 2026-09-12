import { execFile as execFileCallback, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { getArchivePackager } from './archive-packager';
import { getFileSplitter } from './file-splitter';
import { getScriptGenerator, type ScriptOptions } from './script-generator';
import { createDeliveryPipeline } from '../../../electron/services/download/delivery-pipeline';
import { initializeEmailSender } from '../mailer/email-sender';
import { generateInstallScripts } from '../shared';
import type { PackageInfo } from '../../types';

const execFile = promisify(execFileCallback);
const nativeEnabled = process.env.DEPS_SMUGGLER_NATIVE_CONDA === '1';
const nativeSuite = nativeEnabled ? describe : describe.skip;

type RunResult = {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
};

function generatedScript(
  scripts: Awaited<ReturnType<ReturnType<typeof getScriptGenerator>['generateAllScripts']>>
) {
  const script = scripts.find((candidate) => candidate.type === 'bash');
  if (!script) throw new Error('Generated Bash installer is missing');
  return script;
}

function condaOptions(relativePaths: string[]): ScriptOptions {
  return { condaPackageFiles: relativePaths.map((relativePath) => ({ relativePath })) };
}

function nativeProcessEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CONDA_PREFIX;
  delete env.CONDA_DEFAULT_ENV;
  delete env.PYTHONHOME;
  delete env.PYTHONPATH;
  return {
    ...env,
    CONDA_NO_PLUGINS: 'true',
    CONDA_SOLVER: 'classic',
    CONDA_OFFLINE: 'true',
    CONDA_REGISTER_ENVS: 'false',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONNOUSERSITE: '1',
    ...overrides,
  };
}

async function nativePhase<T>(name: string, action: () => Promise<T>): Promise<T> {
  const started = Date.now();
  console.log(`native phase: ${name} start`);
  try {
    const result = await action();
    console.log(`native phase: ${name} end (${Date.now() - started}ms)`);
    return result;
  } catch (error) {
    console.error(`native phase: ${name} failed (${Date.now() - started}ms)`, error);
    throw error;
  }
}

async function runBash(
  scriptPath: string,
  env: NodeJS.ProcessEnv,
  timeout = 180_000
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [scriptPath], { cwd: path.dirname(scriptPath), env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeout);
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code, signal });
    });
  });
}

async function findConda(): Promise<{ executable: string; root: string; python: string }> {
  const candidates = [...new Set([
    process.env.CONDA ? path.join(process.env.CONDA, 'bin', 'conda') : undefined,
    '/usr/share/miniconda/bin/conda',
    'conda',
  ].filter((candidate): candidate is string => Boolean(candidate)))];
  const failures: string[] = [];
  for (const executable of candidates) {
    const started = Date.now();
    try {
      const version = await execFile(executable, ['--version'], {
        env: nativeProcessEnv({ CONDA_OFFLINE: 'true' }),
        timeout: 60_000,
      });
      const root = (
        await execFile(executable, ['info', '--base'], {
          env: nativeProcessEnv({ CONDA_OFFLINE: 'true' }),
          timeout: 60_000,
        })
      ).stdout.trim();
      if (!root) throw new Error(`Conda did not report a base prefix for ${executable}`);
      const python = path.join(root, 'bin', 'python');
      await execFile(python, ['--version'], {
        env: nativeProcessEnv({ CONDA_OFFLINE: 'true' }),
        timeout: 60_000,
      });
      console.log(
        `native conda: ${executable} (${version.stdout.trim() || version.stderr.trim()})`
      );
      return { executable, root, python };
    } catch (error) {
      const elapsed = Date.now() - started;
      const details = error as {
        message?: string;
        stderr?: string;
        code?: number | string;
        signal?: string;
      };
      const message = `${executable}: ${details.message ?? 'probe failed'}${details.code !== undefined ? ` (code ${details.code})` : ''}${details.signal ? ` (signal ${details.signal})` : ''}${details.stderr ? `: ${details.stderr.trim()}` : ''}`;
      failures.push(message);
      console.error(`native conda probe failed (${elapsed}ms): ${message}`);
    }
  }
  throw new Error(
    `DEPS_SMUGGLER_NATIVE_CONDA=1 requires an existing Conda installation; probes failed:\n${failures.join('\n')}`
  );
}

async function createFixture(
  python: string,
  source: string,
  output: string,
  filename: string
): Promise<string> {
  const script = [
    'import sys',
    'from conda_package_handling.api import create',
    'create(sys.argv[1], None, sys.argv[2], out_folder=sys.argv[3])',
  ].join('\n');
  await execFile(python, ['-c', script, source, filename, output], {
    timeout: 30_000,
    env: nativeProcessEnv(),
  });
  const archive = path.join(output, filename);
  if (!fs.existsSync(archive)) throw new Error(`conda-package-handling did not create ${filename}`);
  return archive;
}

async function createPackageSource(
  root: string,
  name: string,
  version: string,
  moduleName?: string,
  depends: string[] = []
): Promise<string> {
  const source = path.join(root, `${name}-source`);
  await fs.promises.mkdir(path.join(source, 'info'), { recursive: true });
  const index = {
    name,
    version,
    build: '0',
    build_number: 0,
    subdir: 'noarch',
    ...(moduleName ? { noarch: 'python' } : {}),
    depends: moduleName ? ['python', ...depends] : depends,
  };
  await fs.promises.writeFile(path.join(source, 'info', 'index.json'), JSON.stringify(index));
  const files: string[] = [];
  if (moduleName) {
    const modulePath = path.join(source, 'site-packages', `${moduleName}.py`);
    await fs.promises.mkdir(path.dirname(modulePath), { recursive: true });
    await fs.promises.writeFile(
      modulePath,
      `__version__ = ${JSON.stringify(version)}\nPAYLOAD = "depssmuggler-native-payload"\n`
    );
    files.push(path.relative(source, modulePath));
  } else {
    const payload = path.join(source, 'share', `${name}.txt`);
    await fs.promises.mkdir(path.dirname(payload), { recursive: true });
    await fs.promises.writeFile(payload, `${name}-${version}\n`);
    files.push(path.relative(source, payload));
  }
  await fs.promises.writeFile(path.join(source, 'info', 'files'), `${files.join('\n')}\n`);
  if (moduleName) {
    await fs.promises.writeFile(
      path.join(source, 'info', 'link.json'),
      '{"package_metadata_version": 1, "noarch": {"type": "python"}}\n'
    );
  }
  return source;
}

async function writeIsolatedEnv(root: string, trapPort: number): Promise<NodeJS.ProcessEnv> {
  const envs = path.join(root, 'envs');
  const cache = path.join(root, 'cache');
  const condarc = path.join(root, 'condarc');
  await Promise.all([
    fs.promises.mkdir(envs, { recursive: true }),
    fs.promises.mkdir(cache, { recursive: true }),
  ]);
  await fs.promises.writeFile(
    condarc,
    `channels:\n  - http://127.0.0.1:${trapPort}/trap\ncreate_default_packages:\n  - unavailable-test-default\n`
  );
  return {
    ...nativeProcessEnv(),
    DEPS_SMUGGLER_CONDA_PREFIX: '',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONNOUSERSITE: '1',
    PYTHONPATH: undefined,
    PYTHONHOME: undefined,
    CONDA_REGISTER_ENVS: 'false',
    CONDA_NO_PLUGINS: 'true',
    CONDA_SOLVER: 'classic',
    CONDA_OFFLINE: 'false',
    CONDA_ENVS_PATH: envs,
    CONDA_PKGS_DIRS: cache,
    CONDARC: condarc,
    CONDA_CHANNELS: `http://127.0.0.1:${trapPort}/trap`,
  };
}

type RuntimeArchive = { name: string; filename: string; source: string };

async function collectPythonRuntimeArchives(
  setup: { python: string; root: string; tempRoot: string; env: NodeJS.ProcessEnv }
): Promise<RuntimeArchive[]> {
  return nativePhase('python prerequisite discovery', async () => {
    const script = [
      'import glob, json, os, sys',
      'from conda.models.match_spec import MatchSpec',
      'base, cache = sys.argv[1:3]',
      'records = {}',
      'for filename in glob.glob(os.path.join(base, "conda-meta", "*.json")):',
      '  with open(filename, encoding="utf-8") as stream: record = json.load(stream)',
      '  if record.get("name"): records[record["name"]] = record',
      'queue, selected = ["python"], {}',
      'while queue:',
      '  name = queue.pop(0)',
      '  if not name or name.startswith("__") or name in selected: continue',
      '  record = records.get(name)',
      '  if record is None: raise RuntimeError(f"missing installed runtime record: {name}")',
      '  selected[name] = record',
      '  for dependency in record.get("depends", []):',
      '    dependency_name = MatchSpec(dependency).name',
      '    if dependency_name and not dependency_name.startswith("__") and dependency_name not in selected: queue.append(dependency_name)',
      'result = []',
      'for name, record in selected.items():',
      '  candidates = [record.get("fn"), record.get("name") + "-" + record.get("version") + "-" + record.get("build") + ".conda", record.get("name") + "-" + record.get("version") + "-" + record.get("build") + ".tar.bz2"]',
      '  archive = next((candidate for candidate in candidates if candidate and os.path.isfile(os.path.join(cache, candidate))), None)',
      '  if archive is None: raise RuntimeError("missing cached archive for runtime record: " + name + " (" + str(record.get("fn")) + ")")',
      '  result.append({"name": name, "filename": archive, "source": os.path.join(cache, archive)})',
      'print(json.dumps(result))',
    ].join('\n');
    const result = await execFile(
      setup.python,
      ['-c', script, setup.root, path.join(setup.root, 'pkgs')],
      { env: setup.env, timeout: 60_000, maxBuffer: 2 * 1024 * 1024 }
    );
    const archives = JSON.parse(result.stdout) as RuntimeArchive[];
    if (!archives.length) throw new Error('No installed Python runtime records were discovered');
    const runtimeDir = path.join(setup.tempRoot, 'runtime-artifacts');
    await fs.promises.mkdir(runtimeDir, { recursive: true });
    for (const archive of archives) {
      const destination = path.join(runtimeDir, archive.filename);
      await fs.promises.copyFile(archive.source, destination);
      archive.source = destination;
    }
    return archives;
  });
}

nativeSuite('native Conda offline installer consumer', () => {
  const tempDirs: string[] = [];
  let trap: http.Server | undefined;
  let requests = 0;

  afterEach(async () => {
    const activeTrap = trap;
    trap = undefined;
    if (activeTrap?.listening) {
      await new Promise<void>((resolve) => activeTrap.close(() => resolve()));
    }
    for (const directory of tempDirs.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
    requests = 0;
  });

  async function prepareNative() {
    if (process.platform !== 'linux') {
      throw new Error('DEPS_SMUGGLER_NATIVE_CONDA=1 requires Linux');
    }
    const conda = await findConda();
    const tempRoot = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'depssmuggler native conda-')
    );
    tempDirs.push(tempRoot);
    requests = 0;
    trap = http.createServer((_request, response) => {
      requests += 1;
      response.writeHead(500);
      response.end();
    });
    const activeTrap = trap;
    if (!activeTrap) throw new Error('Conda HTTP trap was not created');
    await new Promise<void>((resolve, reject) => {
      activeTrap.once('error', reject);
      activeTrap.listen(0, '127.0.0.1', () => resolve());
    });
    const address = trap.address();
    if (!address || typeof address === 'string') throw new Error('Conda HTTP trap has no port');
    const env = await writeIsolatedEnv(tempRoot, address.port);
    return {
      ...conda,
      tempRoot,
      env: { ...env, PATH: `${path.join(conda.root, 'bin')}:${process.env.PATH ?? ''}` },
    };
  }

  it('creates a fresh isolated prefix from a real .conda archive and records exact package metadata', async () => {
    const setup = await prepareNative();
    const source = await createPackageSource(
      setup.tempRoot,
      'depssmuggler-native-data',
      '1.0.0',
      undefined,
      ['depssmuggler-native-dependency']
    );
    const dependencySource = await createPackageSource(
      setup.tempRoot,
      'depssmuggler-native-dependency',
      '1.0.0'
    );
    const { archive, dependencyArchive } = await nativePhase('generic fixture', async () => {
      const fixtureDir = path.join(setup.tempRoot, 'fixtures');
      await fs.promises.mkdir(fixtureDir, { recursive: true });
      return {
        archive: await createFixture(
          setup.python,
          source,
          fixtureDir,
          'depssmuggler-native-data-1.0.0-0.conda'
        ),
        dependencyArchive: await createFixture(
          setup.python,
          dependencySource,
          fixtureDir,
          'depssmuggler-native-dependency-1.0.0-0.tar.bz2'
        ),
      };
    });
    const outputDir = path.join(setup.tempRoot, 'bundle');
    const packageDir = path.join(outputDir, 'packages');
    await fs.promises.mkdir(packageDir, { recursive: true });
    await fs.promises.copyFile(archive, path.join(packageDir, path.basename(archive)));
    await fs.promises.copyFile(
      dependencyArchive,
      path.join(packageDir, path.basename(dependencyArchive))
    );
    const pkg: PackageInfo = {
      type: 'conda',
      name: 'depssmuggler-native-data',
      version: '1.0.0',
      metadata: { filename: path.basename(archive) },
    };
    const dependencyPkg: PackageInfo = {
      type: 'conda',
      name: 'depssmuggler-native-dependency',
      version: '1.0.0',
      metadata: { filename: path.basename(dependencyArchive) },
    };
    const result = await nativePhase('generic create/install', async () => {
      const scripts = await getScriptGenerator().generateAllScripts(
        [pkg, dependencyPkg],
        outputDir,
        condaOptions([path.basename(archive), path.basename(dependencyArchive)])
      );
      return runBash(generatedScript(scripts).path, setup.env);
    });
    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.signal).toBeNull();
    const listed = JSON.parse(
      (
        await execFile(
          setup.executable,
          ['list', '--json', '--prefix', path.join(outputDir, 'conda-env')],
          {
            env: setup.env,
            timeout: 30_000,
          }
        )
      ).stdout
    ) as Array<{ name: string; version: string }>;
    expect(listed).toHaveLength(2);
    expect(listed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: pkg.name, version: pkg.version }),
        expect.objectContaining({ name: dependencyPkg.name, version: dependencyPkg.version }),
      ])
    );
    expect(
      await fs.promises.readFile(
        path.join(outputDir, 'conda-env', 'share', `${pkg.name}.txt`),
        'utf8'
      )
    ).toBe(`${pkg.name}-${pkg.version}\n`);
    expect(
      await fs.promises.readFile(
        path.join(outputDir, 'conda-env', 'share', `${dependencyPkg.name}.txt`),
        'utf8'
      )
    ).toBe(`${dependencyPkg.name}-${dependencyPkg.version}\n`);
    expect(listed.some((entry) => entry.name === 'unavailable-test-default')).toBe(false);
    expect(requests).toBe(0);
  }, 240_000);

  it('installs a unique Python noarch tar.bz2 into a temporary Python prefix and preserves it on repeat', async () => {
    const setup = await prepareNative();
    const isolatedCache = setup.env.CONDA_PKGS_DIRS;
    if (!isolatedCache) throw new Error('Native Conda isolated cache was not configured');
    const runtimeArchives = await collectPythonRuntimeArchives(setup);
    const source = await createPackageSource(
      setup.tempRoot,
      'depssmuggler-native-python',
      '1.0.0',
      'depssmuggler_native_fixture'
    );
    const archive = await nativePhase('Python fixture', async () => {
      const fixtureDir = path.join(setup.tempRoot, 'fixtures');
      await fs.promises.mkdir(fixtureDir, { recursive: true });
      return createFixture(
        setup.python,
        source,
        fixtureDir,
        'depssmuggler-native-python-1.0.0-0.tar.bz2'
      );
    });
    const outputDir = path.join(setup.tempRoot, 'bundle');
    const packageDir = path.join(outputDir, 'packages');
    await fs.promises.mkdir(packageDir, { recursive: true });
    await fs.promises.copyFile(archive, path.join(packageDir, path.basename(archive)));
    const prefix = path.join(setup.tempRoot, 'python-prefix');
    await nativePhase('Python runtime create', async () => {
      await execFile(
        setup.executable,
        [
          'create',
          '--offline',
          '--yes',
          '--no-default-packages',
          '--prefix',
          prefix,
          ...runtimeArchives.map((archive) => archive.source),
        ],
        { env: setup.env, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 }
      );
    });
    const env = { ...setup.env, DEPS_SMUGGLER_CONDA_PREFIX: prefix };
    const prefixPython = await nativePhase('temporary Python prerequisite', () =>
      execFile(path.join(prefix, 'bin', 'python'), ['-c', 'import sys; print(sys.prefix)'], {
        env,
        timeout: 60_000,
      })
    );
    expect(prefixPython.stdout.trim()).toBe(prefix);
    const before = JSON.parse(
      (
        await execFile(setup.executable, ['list', '--json', '--prefix', prefix], {
          env: setup.env,
          timeout: 30_000,
        })
      ).stdout
    ) as Array<{ name: string }>;
    expect(before.some((entry) => entry.name === 'depssmuggler-native-python')).toBe(false);
    const pkg: PackageInfo = {
      type: 'conda',
      name: 'depssmuggler-native-python',
      version: '1.0.0',
      metadata: { filename: path.basename(archive) },
    };
    const scripts = await getScriptGenerator().generateAllScripts(
      [pkg],
      outputDir,
      condaOptions([path.basename(archive)])
    );
    const first = await nativePhase('generated Python install', () =>
      runBash(generatedScript(scripts).path, env)
    );
    expect(first.code, `${first.stdout}\n${first.stderr}`).toBe(0);
    expect(first.signal).toBeNull();
    const importResult = await nativePhase('Python import', () =>
      execFile(
        path.join(prefix, 'bin', 'python'),
        [
          '-c',
          'import json,sys,depssmuggler_native_fixture as m; print(json.dumps({"prefix":sys.prefix,"file":m.__file__,"version":m.__version__,"payload":m.PAYLOAD}))',
        ],
        { env, timeout: 60_000, maxBuffer: 2 * 1024 * 1024 }
      )
    );
    const imported = JSON.parse(importResult.stdout.trim()) as {
      prefix: string;
      file: string;
      version: string;
      payload: string;
    };
    expect(imported.prefix).toBe(prefix);
    expect(imported.file.startsWith(`${prefix}${path.sep}`)).toBe(true);
    expect(imported.version).toBe('1.0.0');
    expect(imported.payload).toBe('depssmuggler-native-payload');
    const sentinel = path.join(prefix, 'sentinel');
    await fs.promises.writeFile(sentinel, 'preserve');
    const second = await nativePhase('generated Python repeat install', () =>
      runBash(generatedScript(scripts).path, env)
    );
    expect(second.code, `${second.stdout}\n${second.stderr}`).toBe(0);
    expect(second.signal).toBeNull();
    expect(await fs.promises.readFile(sentinel, 'utf8')).toBe('preserve');
    expect(requests).toBe(0);
  }, 300_000);

  it('consumes a GUI pipeline ZIP with Conda archives from an isolated fresh prefix', async () => {
    const setup = await prepareNative();
    const source = await createPackageSource(
      setup.tempRoot,
      'depssmuggler-gui-native-data',
      '1.0.0'
    );
    const fixtureDir = path.join(setup.tempRoot, 'fixtures');
    await fs.promises.mkdir(fixtureDir, { recursive: true });
    const archive = await createFixture(
      setup.python,
      source,
      fixtureDir,
      'depssmuggler-gui-native-data-1.0.0-0.conda'
    );
    const outputDir = path.join(setup.tempRoot, 'gui delivery output');
    const packageDir = path.join(outputDir, 'packages');
    await fs.promises.mkdir(packageDir, { recursive: true });
    const deliveredPath = path.join(packageDir, path.basename(archive));
    await fs.promises.copyFile(archive, deliveredPath);
    const delivered = [{
      id: 'conda-gui-native-data',
      type: 'conda',
      name: 'depssmuggler-gui-native-data',
      version: '1.0.0',
      filename: path.basename(archive),
      metadata: { filename: path.basename(archive) },
    }];
    const pipeline = createDeliveryPipeline({
      archivePackager: getArchivePackager(),
      generateInstallScripts,
      initializeEmailSender,
      getFileSplitter,
      stat: fs.promises.stat,
    });
    const completion = await pipeline.finalizeDownload({
      outputDir,
      options: { outputDir, outputFormat: 'zip', includeScripts: true, deliveryMethod: 'local' },
      deliveredPackages: delivered,
      packageInfos: delivered as PackageInfo[],
      results: [{ id: delivered[0].id, success: true, filePath: deliveredPath }],
      failedDownloadCount: 0,
      progressEmitter: { emitDownloadStatus: () => undefined } as never,
      isCancelled: () => false,
    });
    expect(completion.success, JSON.stringify(completion)).toBe(true);
    const archivePath = String(completion.outputPath);
    const bundle = path.join(setup.tempRoot, 'gui archive extracted');
    await fs.promises.mkdir(bundle, { recursive: true });
    await execFile(
      setup.python,
      ['-c', 'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', archivePath, bundle],
      { env: setup.env, timeout: 30_000 }
    );
    expect(fs.existsSync(path.join(bundle, 'install.sh'))).toBe(true);
    expect(fs.existsSync(path.join(bundle, 'install.ps1'))).toBe(true);
    await fs.promises.rm(outputDir, { recursive: true, force: true });
    const env = { ...setup.env, DEPS_SMUGGLER_CONDA_PREFIX: path.join(setup.tempRoot, 'gui conda prefix') };
    const install = await runBash(path.join(bundle, 'install.sh'), env);
    expect(install.code, `${install.stdout}\n${install.stderr}`).toBe(0);
    expect(install.signal).toBeNull();
    const listed = JSON.parse(
      (await execFile(setup.executable, ['list', '--json', '--prefix', env.DEPS_SMUGGLER_CONDA_PREFIX], { env, timeout: 30_000 })).stdout
    ) as Array<{ name: string; version: string }>;
    expect(listed).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'depssmuggler-gui-native-data', version: '1.0.0' }),
    ]));
    expect(
      await fs.promises.readFile(
        path.join(env.DEPS_SMUGGLER_CONDA_PREFIX, 'share', 'depssmuggler-gui-native-data.txt'),
        'utf8'
      )
    ).toBe('depssmuggler-gui-native-data-1.0.0\n');
    expect(requests).toBe(0);
  }, 300_000);

  it('installs a published six archive delivered through the GUI pipeline', async () => {
    const setup = await prepareNative();
    const archive = path.join(setup.tempRoot, 'six-1.16.0-pyhd3eb1b0_1.tar.bz2');
    const response = await fetch(
      'https://repo.anaconda.com/pkgs/main/noarch/six-1.16.0-pyhd3eb1b0_1.tar.bz2',
      { signal: AbortSignal.timeout(60_000) }
    );
    expect(response.ok).toBe(true);
    await fs.promises.writeFile(archive, Buffer.from(await response.arrayBuffer()));
    const outputDir = path.join(setup.tempRoot, 'published GUI output');
    const packageDir = path.join(outputDir, 'packages');
    await fs.promises.mkdir(packageDir, { recursive: true });
    const deliveredPath = path.join(packageDir, path.basename(archive));
    await fs.promises.copyFile(archive, deliveredPath);
    const delivered = [{
      id: 'conda-published-six',
      type: 'conda',
      name: 'six',
      version: '1.16.0',
      filename: path.basename(archive),
      metadata: { filename: path.basename(archive) },
    }];
    const completion = await createDeliveryPipeline({
      archivePackager: getArchivePackager(),
      generateInstallScripts,
      initializeEmailSender,
      getFileSplitter,
      stat: fs.promises.stat,
    }).finalizeDownload({
      outputDir,
      options: { outputDir, outputFormat: 'zip', includeScripts: true, deliveryMethod: 'local' },
      deliveredPackages: delivered,
      packageInfos: delivered as PackageInfo[],
      results: [{ id: delivered[0].id, success: true, filePath: deliveredPath }],
      failedDownloadCount: 0,
      progressEmitter: { emitDownloadStatus: () => undefined } as never,
      isCancelled: () => false,
    });
    expect(completion.success, JSON.stringify(completion)).toBe(true);
    const bundle = path.join(setup.tempRoot, 'published GUI extracted');
    await fs.promises.mkdir(bundle, { recursive: true });
    await execFile(
      setup.python,
      ['-c', 'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', String(completion.outputPath), bundle],
      { env: setup.env, timeout: 30_000 }
    );
    expect(fs.existsSync(path.join(bundle, 'install.sh'))).toBe(true);
    expect(fs.existsSync(path.join(bundle, 'install.ps1'))).toBe(true);
    await fs.promises.rm(outputDir, { recursive: true, force: true });
    const prefix = path.join(setup.tempRoot, 'published six prefix');
    const runtimeArchives = await collectPythonRuntimeArchives(setup);
    await execFile(
      setup.executable,
      [
        'create',
        '--offline',
        '--yes',
        '--no-default-packages',
        '--prefix',
        prefix,
        ...runtimeArchives.map((runtimeArchive) => runtimeArchive.source),
      ],
      { env: setup.env, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 }
    );
    const env = { ...setup.env, DEPS_SMUGGLER_CONDA_PREFIX: prefix };
    const before = await execFile(
      path.join(prefix, 'bin', 'python'),
      ['-c', 'import importlib.util; print(importlib.util.find_spec("six") is None)'],
      { env, timeout: 30_000 }
    );
    expect(before.stdout.trim()).toBe('True');
    const install = await runBash(path.join(bundle, 'install.sh'), env);
    expect(install.code, `${install.stdout}\n${install.stderr}`).toBe(0);
    expect(install.signal).toBeNull();
    const listed = JSON.parse(
      (await execFile(setup.executable, ['list', '--json', '--prefix', prefix], { env, timeout: 30_000 })).stdout
    ) as Array<{ name: string; version: string }>;
    expect(listed.some((entry) => entry.name === 'six' && entry.version === '1.16.0')).toBe(true);
    const imported = await execFile(
      path.join(env.DEPS_SMUGGLER_CONDA_PREFIX, 'bin', 'python'),
      ['-c', 'import json,six,sys; print(json.dumps({"version":six.__version__,"file":six.__file__,"prefix":sys.prefix}))'],
      { env, timeout: 30_000 }
    );
    const module = JSON.parse(imported.stdout.trim()) as { version: string; file: string; prefix: string };
    expect(module.version).toBe('1.16.0');
    expect(module.prefix).toBe(prefix);
    expect(module.file.startsWith(`${prefix}${path.sep}`)).toBe(true);
    const sentinel = path.join(prefix, 'sentinel');
    await fs.promises.writeFile(sentinel, 'preserve');
    const repeat = await runBash(path.join(bundle, 'install.sh'), env);
    expect(repeat.code, `${repeat.stdout}\n${repeat.stderr}`).toBe(0);
    expect(repeat.signal).toBeNull();
    expect(await fs.promises.readFile(sentinel, 'utf8')).toBe('preserve');
    expect(requests).toBe(0);
  }, 300_000);
});
