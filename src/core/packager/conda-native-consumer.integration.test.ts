import { execFile as execFileCallback, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { getScriptGenerator, type ScriptOptions } from './script-generator';
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
  const candidates = [
    process.env.CONDA ? path.join(process.env.CONDA, 'bin', 'conda') : undefined,
    '/usr/share/miniconda/bin/conda',
    'conda',
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const executable of candidates) {
    try {
      const version = await execFile(executable, ['--version'], { timeout: 15_000 });
      const root = (
        await execFile(executable, ['info', '--base'], { timeout: 15_000 })
      ).stdout.trim();
      if (!root) throw new Error(`Conda did not report a base prefix for ${executable}`);
      const python = path.join(root, 'bin', 'python');
      await execFile(python, ['--version'], { timeout: 15_000 });
      console.log(
        `native conda: ${executable} (${version.stdout.trim() || version.stderr.trim()})`
      );
      return { executable, root, python };
    } catch {
      // Probe the next runner-provided installation.
    }
  }
  throw new Error('DEPS_SMUGGLER_NATIVE_CONDA=1 requires an existing Conda installation');
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
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: undefined, PYTHONHOME: undefined },
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
    ...process.env,
    DEPS_SMUGGLER_CONDA_PREFIX: '',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONNOUSERSITE: '1',
    PYTHONPATH: undefined,
    PYTHONHOME: undefined,
    CONDA_REGISTER_ENVS: 'false',
    CONDA_NO_PLUGINS: 'true',
    CONDA_SOLVER: 'classic',
    CONDA_ENVS_PATH: envs,
    CONDA_PKGS_DIRS: cache,
    CONDARC: condarc,
    CONDA_CHANNELS: `http://127.0.0.1:${trapPort}/trap`,
  };
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
    const fixtureDir = path.join(setup.tempRoot, 'fixtures');
    await fs.promises.mkdir(fixtureDir, { recursive: true });
    const archive = await createFixture(
      setup.python,
      source,
      fixtureDir,
      'depssmuggler-native-data-1.0.0-0.conda'
    );
    const dependencyArchive = await createFixture(
      setup.python,
      dependencySource,
      fixtureDir,
      'depssmuggler-native-dependency-1.0.0-0.tar.bz2'
    );
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
    const scripts = await getScriptGenerator().generateAllScripts(
      [pkg, dependencyPkg],
      outputDir,
      condaOptions([path.basename(archive), path.basename(dependencyArchive)])
    );
    const result = await runBash(generatedScript(scripts).path, setup.env);
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

  it('installs a unique Python noarch tar.bz2 into a cloned temporary Python prefix and preserves it on repeat', async () => {
    const setup = await prepareNative();
    const basePrefix = setup.root;
    const sourceCache = path.join(setup.root, 'pkgs');
    if (!fs.existsSync(sourceCache)) {
      throw new Error(`Native Conda cache prerequisite missing: ${sourceCache}`);
    }
    const isolatedCache = setup.env.CONDA_PKGS_DIRS;
    if (!isolatedCache) throw new Error('Native Conda isolated cache was not configured');
    await fs.promises.cp(sourceCache, isolatedCache, { recursive: true });
    const source = await createPackageSource(
      setup.tempRoot,
      'depssmuggler-native-python',
      '1.0.0',
      'depssmuggler_native_fixture'
    );
    const fixtureDir = path.join(setup.tempRoot, 'fixtures');
    await fs.promises.mkdir(fixtureDir, { recursive: true });
    const archive = await createFixture(
      setup.python,
      source,
      fixtureDir,
      'depssmuggler-native-python-1.0.0-0.tar.bz2'
    );
    const outputDir = path.join(setup.tempRoot, 'bundle');
    const packageDir = path.join(outputDir, 'packages');
    await fs.promises.mkdir(packageDir, { recursive: true });
    await fs.promises.copyFile(archive, path.join(packageDir, path.basename(archive)));
    const prefix = path.join(setup.tempRoot, 'python-prefix');
    await execFile(
      setup.executable,
      [
        'create',
        '--offline',
        '--yes',
        '--no-default-packages',
        '--clone',
        basePrefix,
        '--prefix',
        prefix,
      ],
      { env: setup.env, timeout: 120_000 }
    );
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
    const env = { ...setup.env, DEPS_SMUGGLER_CONDA_PREFIX: prefix };
    const first = await runBash(generatedScript(scripts).path, env);
    expect(first.code, `${first.stdout}\n${first.stderr}`).toBe(0);
    expect(first.signal).toBeNull();
    const importResult = await execFile(
      path.join(prefix, 'bin', 'python'),
      [
        '-c',
        'import json,sys,depssmuggler_native_fixture as m; print(json.dumps({"prefix":sys.prefix,"file":m.__file__,"version":m.__version__,"payload":m.PAYLOAD}))',
      ],
      { env, timeout: 30_000 }
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
    const second = await runBash(generatedScript(scripts).path, env);
    expect(second.code, `${second.stdout}\n${second.stderr}`).toBe(0);
    expect(second.signal).toBeNull();
    expect(await fs.promises.readFile(sentinel, 'utf8')).toBe('preserve');
    expect(requests).toBe(0);
  }, 300_000);
});
