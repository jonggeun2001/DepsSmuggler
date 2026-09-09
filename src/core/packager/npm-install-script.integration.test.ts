import { execFile } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import * as fs from 'fs-extra';
import * as tar from 'tar';
import { afterEach, describe, expect, it } from 'vitest';
import { getScriptGenerator } from './script-generator';
import { PackageInfo } from '../../types';

const execFileAsync = promisify(execFile);
const FINAL_SUCCESS = '모든 설치가 완료되었습니다!';

interface NpmFixture {
  filename: string;
  manifest: Record<string, unknown>;
  files: Record<string, string>;
}

interface ChildProcessFailure {
  code?: number | string | null;
  killed?: boolean;
  stdout?: string;
  stderr?: string;
}

const createTarball = async (
  packagesDirectory: string,
  stagingDirectory: string,
  fixture: NpmFixture,
): Promise<string> => {
  const packageDirectory = path.join(stagingDirectory, fixture.filename, 'package');
  await fs.ensureDir(packageDirectory);
  await fs.writeJson(path.join(packageDirectory, 'package.json'), fixture.manifest, { spaces: 2 });
  for (const [relativePath, contents] of Object.entries(fixture.files)) {
    const filePath = path.join(packageDirectory, relativePath);
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, contents);
  }

  const archivePath = path.join(packagesDirectory, fixture.filename);
  await tar.create({ cwd: path.dirname(packageDirectory), file: archivePath, gzip: true }, ['package']);
  return archivePath;
};

const makePackageInfo = (
  name: string,
  version: string,
  filename: string,
): PackageInfo => ({
  type: 'npm',
  name,
  version,
  metadata: { filename },
});

const createIsolatedEnvironment = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler npm fixture with spaces-'));
  const bundleDirectory = path.join(root, 'bundle with spaces');
  const packagesDirectory = path.join(bundleDirectory, 'packages');
  const npmProjectDirectory = path.join(bundleDirectory, 'npm-project');
  const consumerDirectory = path.join(root, 'independent consumer cwd');
  const homeDirectory = path.join(root, 'isolated home');
  const cacheDirectory = path.join(root, 'empty npm cache');
  const globalPrefix = path.join(root, 'isolated global prefix');
  const userConfig = path.join(root, 'isolated npmrc');
  const isolateHomeScript = path.resolve(process.cwd(), 'tests/fixtures/isolate-home.cjs');
  const existingNodeOptions = process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : '';

  await Promise.all([
    fs.ensureDir(packagesDirectory),
    fs.ensureDir(consumerDirectory),
    fs.ensureDir(homeDirectory),
    fs.ensureDir(cacheDirectory),
    fs.ensureDir(globalPrefix),
  ]);
  await fs.writeFile(userConfig, '');
  const manifestPath = path.join(bundleDirectory, 'package.json');
  await fs.writeJson(manifestPath, {
    name: 'offline-consumer',
    version: '1.0.0',
    private: true,
  }, { spaces: 2 });

  const environment = {
    ...process.env,
    DEPS_SMUGGLER_TEST_USER_DIR: homeDirectory,
    NODE_OPTIONS: `${existingNodeOptions}--require ${JSON.stringify(isolateHomeScript)}`,
    NPM_CONFIG_CACHE: cacheDirectory,
    npm_config_cache: cacheDirectory,
    NPM_CONFIG_USERCONFIG: userConfig,
    npm_config_userconfig: userConfig,
    NPM_CONFIG_PREFIX: globalPrefix,
    npm_config_prefix: globalPrefix,
    NPM_CONFIG_REGISTRY: 'http://127.0.0.1:9/',
    npm_config_registry: 'http://127.0.0.1:9/',
    NPM_CONFIG_AUDIT: 'false',
    npm_config_audit: 'false',
    NPM_CONFIG_FUND: 'false',
    npm_config_fund: 'false',
    NPM_CONFIG_UPDATE_NOTIFIER: 'false',
    npm_config_update_notifier: 'false',
  };

  return {
    root,
    bundleDirectory,
    packagesDirectory,
    npmProjectDirectory,
    consumerDirectory,
    cacheDirectory,
    manifestPath,
    environment,
  };
};

const getScriptCommand = (scriptPath: string): { command: string; args: string[] } => (
  process.platform === 'win32'
    ? {
      command: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
    }
    : { command: 'bash', args: [scriptPath] }
);

describe('npm install script native integration', () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => fs.remove(root)));
  });

  it('installs all delivered npm tarballs offline from an independent cwd and runs lifecycle scripts', async () => {
    const environment = await createIsolatedEnvironment();
    temporaryRoots.push(environment.root);
    const rootInfo = makePackageInfo('offline-root', '1.0.0', 'offline-root-1.0.0.tgz');
    const dependencyInfo = makePackageInfo('@fixture/dep', '1.0.0', 'dep-1.0.0.tgz');
    const rootFixture: NpmFixture = {
      filename: 'offline-root-1.0.0.tgz',
      manifest: {
        name: 'offline-root',
        version: '1.0.0',
        main: 'index.js',
        scripts: { postinstall: 'node postinstall.js' },
        dependencies: { '@fixture/dep': '^1.0.0' },
      },
      files: {
        'index.js': "module.exports = { root: '1.0.0', dependency: require('@fixture/dep') };\n",
        'postinstall.js': "require('fs').writeFileSync('lifecycle-ran.txt', 'postinstall ran\\n');\n",
      },
    };
    const dependencyFixture: NpmFixture = {
      filename: 'dep-1.0.0.tgz',
      manifest: {
        name: '@fixture/dep',
        version: '1.0.0',
        main: 'index.js',
      },
      files: {
        'index.js': "module.exports = 'scoped dependency 1.0.0';\n",
      },
    };

    await createTarball(environment.packagesDirectory, path.join(environment.root, 'staging'), rootFixture);
    await createTarball(environment.packagesDirectory, path.join(environment.root, 'staging'), dependencyFixture);
    expect(await fs.readdir(environment.cacheDirectory)).toHaveLength(0);
    const manifestBefore = await fs.readFile(environment.manifestPath);
    const scriptPath = path.join(environment.bundleDirectory, process.platform === 'win32' ? 'install.ps1' : 'install.sh');
    const generator = getScriptGenerator();
    const packages = [rootInfo, dependencyInfo];

    if (process.platform === 'win32') {
      await generator.generatePowerShellScript(packages, scriptPath);
    } else {
      await generator.generateBashScript(packages, scriptPath);
    }
    const { command, args } = getScriptCommand(scriptPath);
    await execFileAsync(command, args, {
      cwd: environment.consumerDirectory,
      env: environment.environment,
      timeout: 45_000,
    });

    const scriptText = await fs.readFile(scriptPath, 'utf8');
    expect(scriptText).toContain('npm install');
    expect(scriptText).toContain('--offline');
    expect(scriptText).toContain('--update-notifier=false');
    expect(scriptText).toContain('--no-save');
    expect(scriptText).not.toContain('--ignore-scripts');
    expect(await fs.readFile(environment.manifestPath)).toEqual(manifestBefore);
    expect(await fs.pathExists(path.join(environment.npmProjectDirectory, 'node_modules', 'offline-root', 'package.json'))).toBe(true);
    expect(await fs.pathExists(path.join(environment.npmProjectDirectory, 'node_modules', '@fixture', 'dep', 'package.json'))).toBe(true);
    expect(await fs.pathExists(path.join(environment.bundleDirectory, 'node_modules'))).toBe(false);
    expect(await fs.pathExists(path.join(environment.consumerDirectory, 'node_modules'))).toBe(false);
    expect(await fs.readFile(path.join(environment.npmProjectDirectory, 'node_modules', 'offline-root', 'lifecycle-ran.txt'), 'utf8'))
      .toBe('postinstall ran\n');

    const consumerCheck = await execFileAsync(
      process.execPath,
      [
        '-e',
        "const root = require(process.argv[1]); if (root.root !== '1.0.0' || root.dependency !== 'scoped dependency 1.0.0') process.exit(1);",
        path.join(environment.npmProjectDirectory, 'node_modules', 'offline-root'),
      ],
      { cwd: environment.consumerDirectory, env: environment.environment, timeout: 45_000 },
    );
    expect(consumerCheck.stderr).toBe('');
  }, 120_000);

  it.each(['missing dependency', 'empty packages directory', 'empty tarball', 'corrupt tarball'])(
    'fails with a numeric nonzero exit and no success message for %s even without generated error handling',
    async (failureKind) => {
      const environment = await createIsolatedEnvironment();
      temporaryRoots.push(environment.root);
      const rootInfo = makePackageInfo('offline-root', '1.0.0', 'offline-root-1.0.0.tgz');
      const dependencyInfo = makePackageInfo('@fixture/dep', '1.0.0', 'dep-1.0.0.tgz');
      const rootFixture: NpmFixture = {
        filename: 'offline-root-1.0.0.tgz',
        manifest: {
          name: 'offline-root',
          version: '1.0.0',
          main: 'index.js',
          dependencies: { '@fixture/dep': '^1.0.0' },
        },
        files: { 'index.js': "module.exports = require('@fixture/dep');\n" },
      };
      const dependencyFixture: NpmFixture = {
        filename: 'dep-1.0.0.tgz',
        manifest: { name: '@fixture/dep', version: '1.0.0', main: 'index.js' },
        files: { 'index.js': "module.exports = 'scoped dependency 1.0.0';\n" },
      };
      const stagingDirectory = path.join(environment.root, 'staging');
      if (failureKind !== 'empty packages directory') {
        await createTarball(environment.packagesDirectory, stagingDirectory, rootFixture);
        if (failureKind !== 'missing dependency') {
          await createTarball(environment.packagesDirectory, stagingDirectory, dependencyFixture);
        }
      }

      const scriptPath = path.join(
        environment.bundleDirectory,
        process.platform === 'win32' ? 'install.ps1' : 'install.sh'
      );
      const generator = getScriptGenerator();
      const packages =
        failureKind === 'empty packages directory'
          ? [rootInfo]
          : failureKind === 'missing dependency'
            ? [rootInfo]
            : [rootInfo, dependencyInfo];
      if (process.platform === 'win32') {
        await generator.generatePowerShellScript(packages, scriptPath, {
          includeErrorHandling: false,
        });
      } else {
        await generator.generateBashScript(packages, scriptPath, { includeErrorHandling: false });
      }

      if (failureKind === 'empty tarball' || failureKind === 'corrupt tarball') {
        const dependencyPath = path.join(
          environment.packagesDirectory,
          dependencyInfo.metadata?.filename as string
        );
        await fs.writeFile(
          dependencyPath,
          failureKind === 'empty tarball' ? Buffer.alloc(0) : Buffer.from('not a tarball\n')
        );
      }

      const { command, args } = getScriptCommand(scriptPath);
      let failure: ChildProcessFailure | undefined;
      try {
        await execFileAsync(command, args, {
          cwd: environment.consumerDirectory,
          env: environment.environment,
          timeout: 45_000,
        });
      } catch (error) {
        failure = error as ChildProcessFailure;
      }

      expect(failure).toBeDefined();
      expect(typeof failure?.code).toBe('number');
      expect(failure?.code).not.toBe(0);
      expect(failure?.killed).not.toBe(true);
      expect(`${failure?.stdout ?? ''}\n${failure?.stderr ?? ''}`).not.toContain(FINAL_SUCCESS);
    },
    90_000
  );

  it.each(['highest delivered version', 'explicit resolved version'])(
    'preserves conflicting semver dependency versions for two delivered roots (%s)',
    async (rootSelection) => {
      const environment = await createIsolatedEnvironment();
      temporaryRoots.push(environment.root);
      const rootAInfo = makePackageInfo('offline-root-a', '1.0.0', 'offline-root-a-1.0.0.tgz');
      const rootBInfo = makePackageInfo('offline-root-b', '1.0.0', 'offline-root-b-1.0.0.tgz');
      const sharedV1Info = makePackageInfo('shared', '1.0.0', 'shared-1.0.0.tgz');
      const sharedV2Info = makePackageInfo('shared', '2.0.0', 'shared-2.0.0.tgz');
      const fixtures: NpmFixture[] = [
        {
          filename: 'offline-root-a-1.0.0.tgz',
          manifest: {
            name: 'offline-root-a',
            version: '1.0.0',
            main: 'index.js',
            dependencies: { shared: '^1.0.0' },
          },
          files: { 'index.js': "module.exports = require('shared');\n" },
        },
        {
          filename: 'offline-root-b-1.0.0.tgz',
          manifest: {
            name: 'offline-root-b',
            version: '1.0.0',
            main: 'index.js',
            dependencies: { shared: '^2.0.0' },
          },
          files: { 'index.js': "module.exports = require('shared');\n" },
        },
        {
          filename: 'shared-1.0.0.tgz',
          manifest: { name: 'shared', version: '1.0.0', main: 'index.js' },
          files: { 'index.js': "module.exports = 'shared-v1';\n" },
        },
        {
          filename: 'shared-2.0.0.tgz',
          manifest: { name: 'shared', version: '2.0.0', main: 'index.js' },
          files: { 'index.js': "module.exports = 'shared-v2';\n" },
        },
      ];
      for (const fixture of fixtures) {
        await createTarball(
          environment.packagesDirectory,
          path.join(environment.root, 'staging'),
          fixture
        );
      }
      const manifestBefore = await fs.readFile(environment.manifestPath);

      const scriptPath = path.join(
        environment.bundleDirectory,
        process.platform === 'win32' ? 'install.ps1' : 'install.sh'
      );
      const generator = getScriptGenerator();
      const packages = [rootAInfo, rootBInfo, sharedV1Info, sharedV2Info];
      const npmOptions =
        rootSelection === 'explicit resolved version'
          ? { npmRootPackages: [rootAInfo, rootBInfo, sharedV1Info] }
          : {};
      if (process.platform === 'win32') {
        await generator.generatePowerShellScript(packages, scriptPath, npmOptions);
      } else {
        await generator.generateBashScript(packages, scriptPath, npmOptions);
      }

      const { command, args } = getScriptCommand(scriptPath);
      await execFileAsync(command, args, {
        cwd: environment.consumerDirectory,
        env: environment.environment,
        timeout: 45_000,
      });

      expect(await fs.readFile(environment.manifestPath)).toEqual(manifestBefore);
      expect(await fs.pathExists(path.join(environment.bundleDirectory, 'node_modules'))).toBe(
        false
      );
      expect(await fs.pathExists(path.join(environment.consumerDirectory, 'node_modules'))).toBe(
        false
      );
      const directSharedManifest = (await fs.readJson(
        path.join(environment.npmProjectDirectory, 'node_modules', 'shared', 'package.json')
      )) as { version?: unknown };
      expect(directSharedManifest.version).toBe(
        rootSelection === 'explicit resolved version' ? '1.0.0' : '2.0.0'
      );
      const consumerCheck = await execFileAsync(
        process.execPath,
        [
          '-e',
          "const a = require(process.argv[1]); const b = require(process.argv[2]); if (a !== 'shared-v1' || b !== 'shared-v2') process.exit(1);",
          path.join(environment.npmProjectDirectory, 'node_modules', 'offline-root-a'),
          path.join(environment.npmProjectDirectory, 'node_modules', 'offline-root-b'),
        ],
        { cwd: environment.consumerDirectory, env: environment.environment, timeout: 45_000 }
      );
      expect(consumerCheck.stderr).toBe('');
    },
    120_000
  );

  it('refuses to overwrite an existing user-owned npm project without an ownership marker', async () => {
    const environment = await createIsolatedEnvironment();
    temporaryRoots.push(environment.root);
    const rootInfo = makePackageInfo('offline-root', '1.0.0', 'offline-root-1.0.0.tgz');
    const dependencyInfo = makePackageInfo('@fixture/dep', '1.0.0', 'dep-1.0.0.tgz');
    await createTarball(environment.packagesDirectory, path.join(environment.root, 'staging'), {
      filename: 'offline-root-1.0.0.tgz',
      manifest: {
        name: 'offline-root',
        version: '1.0.0',
        main: 'index.js',
        dependencies: { '@fixture/dep': '^1.0.0' },
      },
      files: { 'index.js': "module.exports = require('@fixture/dep');\n" },
    });
    await createTarball(environment.packagesDirectory, path.join(environment.root, 'staging'), {
      filename: 'dep-1.0.0.tgz',
      manifest: { name: '@fixture/dep', version: '1.0.0', main: 'index.js' },
      files: { 'index.js': "module.exports = 'scoped dependency 1.0.0';\n" },
    });
    const bundleManifestBefore = await fs.readFile(environment.manifestPath);

    const scriptPath = path.join(
      environment.bundleDirectory,
      process.platform === 'win32' ? 'install.ps1' : 'install.sh'
    );
    const generator = getScriptGenerator();
    const packages = [rootInfo, dependencyInfo];
    if (process.platform === 'win32') {
      await generator.generatePowerShellScript(packages, scriptPath);
    } else {
      await generator.generateBashScript(packages, scriptPath);
    }

    await fs.ensureDir(environment.npmProjectDirectory);
    const userManifestPath = path.join(environment.npmProjectDirectory, 'package.json');
    const userManifest = JSON.stringify(
      {
        name: 'user-owned-project',
        version: '9.9.9',
        private: true,
        dependencies: { keep: '1.0.0' },
      },
      null,
      2
    );
    await fs.writeFile(userManifestPath, userManifest);

    const { command, args } = getScriptCommand(scriptPath);
    let failure: ChildProcessFailure | undefined;
    try {
      await execFileAsync(command, args, {
        cwd: environment.consumerDirectory,
        env: environment.environment,
        timeout: 45_000,
      });
    } catch (error) {
      failure = error as ChildProcessFailure;
    }

    expect(failure).toBeDefined();
    expect(typeof failure?.code).toBe('number');
    expect(failure?.code).not.toBe(0);
    expect(failure?.killed).not.toBe(true);
    expect(`${failure?.stdout ?? ''}\n${failure?.stderr ?? ''}`).not.toContain(FINAL_SUCCESS);
    expect(await fs.readFile(environment.manifestPath)).toEqual(bundleManifestBefore);
    expect(await fs.readFile(userManifestPath, 'utf8')).toBe(userManifest);
    expect(await fs.pathExists(path.join(environment.npmProjectDirectory, 'node_modules'))).toBe(
      false
    );
  }, 120_000);
});
