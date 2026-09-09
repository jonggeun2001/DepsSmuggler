import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getScriptGenerator, type ScriptOptions } from './script-generator';
import { buildDockerArchiveFilename } from '../downloaders/docker-utils';
import type { PackageInfo } from '../../types';

const FINAL_SUCCESS = '모든 설치가 완료되었습니다!';
const bashSuite = process.platform === 'win32' ? describe.skip : describe;
const powershellSuite = process.platform === 'win32' ? describe : describe.skip;

type ChildResult = {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
};

type Fixture = {
  root: string;
  bundle: string;
  packageDir: string;
  minimalBin: string;
  logPath: string;
  environment: NodeJS.ProcessEnv;
};

function packageInfo(type: PackageInfo['type'], name: string, version: string): PackageInfo {
  return { type, name, version };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function runChild(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeout?: number }
): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, options.timeout ?? 60_000);
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`child timed out: ${command} ${args.join(' ')}`));
        return;
      }
      resolve({ stdout, stderr, code, signal });
    });
  });
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'depssmuggler script aggregation with spaces-'));
  const bundle = path.join(root, 'bundle with spaces');
  const packageDir = path.join(bundle, 'packages');
  const shimDir = path.join(root, 'command shims');
  const minimalBin = path.join(root, 'minimal bin');
  const logPath = path.join(root, 'argv records.jsonl');
  const shimPath = path.join(shimDir, 'command-shim.cjs');
  await mkdirs([packageDir, shimDir, minimalBin]);
  if (process.platform !== 'win32') {
    await symlink('/usr/bin/find', path.join(minimalBin, 'find'));
    await symlink('/usr/bin/dirname', path.join(minimalBin, 'dirname'));
  }
  await writeFile(
    shimPath,
    [
      "const fs = require('node:fs');",
      'const command = process.argv[2];',
      'const args = process.argv.slice(3);',
      'const recordPath = process.env.DEPS_SMUGGLER_STUB_LOG;',
      "fs.appendFileSync(recordPath, JSON.stringify({ command, args }) + '\\n');",
      'const failures = new Map((process.env.DEPS_SMUGGLER_PIP_FAILURES || "").split(",").filter(Boolean).map((entry) => { const [name, code] = entry.split(":"); return [name, Number(code)]; }));',
      'if (command === "pip") { const requested = args.find((arg) => failures.has(arg.split("==")[0])); if (requested) process.exit(failures.get(requested.split("==")[0])); }',
      'if (command === "conda") process.exit(Number(process.env.DEPS_SMUGGLER_CONDA_EXIT || 0));',
      'if (command === "docker") process.exit(Number(process.env.DEPS_SMUGGLER_DOCKER_EXIT || 0));',
      'if (command === "rpm") { const sequence = (process.env.DEPS_SMUGGLER_RPM_SEQUENCE || "0").split(",").map(Number); const count = fs.existsSync(recordPath) ? fs.readFileSync(recordPath, "utf8").split("\\n").filter(Boolean).filter((line) => JSON.parse(line).command === "rpm").length : 0; process.exit(sequence[Math.min(count - 1, sequence.length - 1)] || 0); }',
    ].join('\n') + '\n'
  );
  const wrapper = `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(shimPath)} "$@"\n`;
  for (const command of ['pip', 'conda', 'docker', 'find', 'rpm', 'sudo']) {
    const commandPath = path.join(shimDir, command);
    if (process.platform === 'win32') {
      await writeFile(
        `${commandPath}.cmd`,
        `@echo off\r\n"${process.execPath}" "${shimPath}" "${command}" %*\r\nexit /b %ERRORLEVEL%\r\n`
      );
    } else if (command === 'find') {
      await writeFile(
        commandPath,
        '#!/bin/sh\nif [ "$DEPS_SMUGGLER_FAIL_FIND" = "1" ]; then exit 42; fi\nexec /usr/bin/find "$@"\n'
      );
    } else if (command === 'sudo') {
      await writeFile(commandPath, `#!/bin/sh\n[ "$1" = rpm ] || exit 97\nshift\nexec ${shellQuote(path.join(shimDir, 'rpm'))} "$@"\n`);
    } else {
      await writeFile(commandPath, wrapper.replace('"$@"', `${shellQuote(command)} "$@"`));
    }
    if (process.platform !== 'win32') await chmod(commandPath, 0o755);
  }
  return {
    root,
    bundle,
    packageDir,
    minimalBin,
    logPath,
    environment: {
      ...process.env,
      PATH: `${shimDir}${path.delimiter}${process.env.PATH ?? ''}`,
      DEPS_SMUGGLER_CONDA_PREFIX: '',
      DEPS_SMUGGLER_STUB_LOG: logPath,
      DEPS_SMUGGLER_PIP_FAILURES: '',
      DEPS_SMUGGLER_CONDA_EXIT: '0',
      DEPS_SMUGGLER_DOCKER_EXIT: '0',
      DEPS_SMUGGLER_RPM_SEQUENCE: '0',
    },
  };
}

async function mkdirs(paths: string[]): Promise<void> {
  await Promise.all(paths.map((directory) => mkdir(directory, { recursive: true })));
}

async function recordedCommands(fixture: Fixture): Promise<Array<{ command: string; args: string[] }>> {
  let content: string;
  try {
    content = await readFile(fixture.logPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return content
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { command: string; args: string[] });
}

function assertNumericExit(result: ChildResult, expectedZero: boolean): void {
  expect(typeof result.code).toBe('number');
  expect(result.signal).toBeNull();
  if (expectedZero) expect(result.code).toBe(0);
  else expect(result.code).not.toBe(0);
}

function assertFailureSummary(
  output: string,
  failures: Array<{ name: string; version: string }>
): void {
  const headings = [...output.matchAll(/실패한 패키지/g)];
  expect(headings).toHaveLength(1);
  const summary = output.slice(headings[0].index ?? 0);
  for (const failure of failures) {
    expect(summary).toContain(failure.name);
    expect(summary).toContain(failure.version);
  }
}

function failureSummaryBlock(output: string): string {
  const headings = [...output.matchAll(/실패한 패키지/g)];
  expect(headings).toHaveLength(1);
  return output.slice(headings[0].index ?? 0);
}

function expectSuccessOnce(output: string): void {
  expect(output.match(new RegExp(FINAL_SUCCESS, 'g')) ?? []).toHaveLength(1);
}

async function generateBash(
  fixture: Fixture,
  packages: PackageInfo[],
  options: ScriptOptions = {}
): Promise<string> {
  const scriptPath = path.join(fixture.bundle, 'install.sh');
  await getScriptGenerator().generateBashScript(packages, scriptPath, options);
  return scriptPath;
}

async function runBash(fixture: Fixture, scriptPath: string): Promise<ChildResult> {
  return runChild('/bin/bash', [scriptPath], {
    cwd: fixture.root,
    env: fixture.environment,
    timeout: 60_000,
  });
}

function powershellCommand(scriptPath: string): { command: string; args: string[] } {
  const powershell = path.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );
  return {
    command: powershell,
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
  };
}

function powershellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function runPowerShell(
  fixture: Fixture,
  packages: PackageInfo[],
  options: ScriptOptions = {}
): Promise<ChildResult> {
  const scriptPath = path.join(fixture.bundle, 'install.ps1');
  await getScriptGenerator().generatePowerShellScript(packages, scriptPath, options);
  const command = powershellCommand(scriptPath);
  return runChild(command.command, command.args, {
    cwd: fixture.root,
    env: fixture.environment,
    timeout: 60_000,
  });
}

bashSuite('ScriptGenerator Bash failure aggregation', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('attempts two failed pip packages and a successful third package, then returns the final summary', async () => {
    const fixture = await createFixture();
    roots.push(fixture.root);
    await mkdirs([path.join(fixture.packageDir, 'quoted dir\nsegment')]);
    fixture.environment.DEPS_SMUGGLER_PIP_FAILURES = 'alpha:17,beta:23';
    const packages = [
      packageInfo('pip', 'alpha', '1.0.0'),
      packageInfo('pip', 'beta', '2.0.0'),
      packageInfo('pip', 'gamma', '3.0.0'),
    ];
    const result = await runBash(fixture, await generateBash(fixture, packages));
    assertNumericExit(result, false);
    const commands = await recordedCommands(fixture);
    expect(commands.filter(({ command }) => command === 'pip').map(({ args }) => args.at(-1))).toEqual([
      'alpha==1.0.0',
      'beta==2.0.0',
      'gamma==3.0.0',
    ]);
    expect(
      commands
        .flatMap(({ args }) => args)
        .some((arg) => arg.includes(`quoted dir${'\n'}segment`))
    ).toBe(true);
    assertFailureSummary(`${result.stdout}\n${result.stderr}`, [
      { name: 'alpha', version: '1.0.0' },
      { name: 'beta', version: '2.0.0' },
    ]);
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(FINAL_SUCCESS);
  });

  it('continues after pip and Conda failures and records a later successful Docker group', async () => {
    const fixture = await createFixture();
    roots.push(fixture.root);
    fixture.environment.DEPS_SMUGGLER_PIP_FAILURES = 'alpha:17';
    fixture.environment.DEPS_SMUGGLER_CONDA_EXIT = '23';
    const docker = packageInfo('docker', 'fixture/image', '1.0.0');
    await writeFile(
      path.join(fixture.packageDir, buildDockerArchiveFilename(docker.name, docker.version)),
      'fixture archive'
    );
    await writeFile(path.join(fixture.packageDir, 'fixture.conda'), 'fixture archive');
    const packages = [
      packageInfo('pip', 'alpha', '1.0.0'),
      { ...packageInfo('conda', 'conda-alpha', '1.0.0'), metadata: { filename: 'fixture.conda' } },
      docker,
    ];
    const result = await runBash(
      fixture,
      await generateBash(fixture, packages, {
        condaPackageFiles: [{ relativePath: 'fixture.conda' }],
      })
    );
    assertNumericExit(result, false);
    const commands = await recordedCommands(fixture);
    expect(commands.map(({ command }) => command)).toEqual(['pip', 'conda', 'docker']);
    assertFailureSummary(`${result.stdout}\n${result.stderr}`, [
      { name: 'alpha', version: '1.0.0' },
      { name: 'conda-alpha', version: '1.0.0' },
    ]);
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(FINAL_SUCCESS);
  });

  it('keeps aggregation active when generated error handling is disabled', async () => {
    const fixture = await createFixture();
    roots.push(fixture.root);
    fixture.environment.DEPS_SMUGGLER_PIP_FAILURES = 'alpha:17,beta:23';
    const result = await runBash(
      fixture,
      await generateBash(
        fixture,
        [packageInfo('pip', 'alpha', '1.0.0'), packageInfo('pip', 'beta', '2.0.0')],
        { includeErrorHandling: false }
      )
    );
    assertNumericExit(result, false);
    assertFailureSummary(`${result.stdout}\n${result.stderr}`, [
      { name: 'alpha', version: '1.0.0' },
      { name: 'beta', version: '2.0.0' },
    ]);
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(FINAL_SUCCESS);
  });

  it('returns success only when every pip package succeeds', async () => {
    const fixture = await createFixture();
    roots.push(fixture.root);
    const result = await runBash(
      fixture,
      await generateBash(fixture, [
        packageInfo('pip', 'alpha', '1.0.0'),
        packageInfo('pip', 'beta', '2.0.0'),
        packageInfo('pip', 'gamma', '3.0.0'),
      ])
    );
    assertNumericExit(result, true);
    expectSuccessOnce(`${result.stdout}\n${result.stderr}`);
    expect(`${result.stdout}\n${result.stderr}`).not.toMatch(/실패/);
  });

  it('reports a Docker native failure instead of printing success', async () => {
    const fixture = await createFixture();
    roots.push(fixture.root);
    fixture.environment.DEPS_SMUGGLER_DOCKER_EXIT = '31';
    const docker = packageInfo('docker', 'fixture/image', '1.0.0');
    await writeFile(
      path.join(fixture.packageDir, buildDockerArchiveFilename(docker.name, docker.version)),
      'fixture archive'
    );
    const result = await runBash(fixture, await generateBash(fixture, [docker]));
    assertNumericExit(result, false);
    assertFailureSummary(`${result.stdout}\n${result.stderr}`, [
      { name: 'fixture/image', version: '1.0.0' },
    ]);
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(FINAL_SUCCESS);
  });

  it('propagates a Bash find traversal failure', async () => {
    const fixture = await createFixture();
    roots.push(fixture.root);
    fixture.environment.DEPS_SMUGGLER_FAIL_FIND = '1';
    const result = await runBash(
      fixture,
      await generateBash(fixture, [packageInfo('pip', 'alpha', '1.0.0')])
    );
    assertNumericExit(result, false);
    expect((await recordedCommands(fixture)).filter(({ command }) => command === 'pip')).toHaveLength(0);
    expect(failureSummaryBlock(`${result.stdout}\n${result.stderr}`)).toMatch(/Python|pip|find/);
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(FINAL_SUCCESS);
  });

  it.each(['pip', 'docker'])('fails when the %s executable is missing', async (missingCommand) => {
    const fixture = await createFixture();
    roots.push(fixture.root);
    const packages =
      missingCommand === 'pip'
        ? [packageInfo('pip', 'alpha', '1.0.0')]
        : [packageInfo('docker', 'fixture/image', '1.0.0')];
    if (missingCommand === 'docker') {
      const docker = packages[0];
      await writeFile(
        path.join(fixture.packageDir, buildDockerArchiveFilename(docker.name, docker.version)),
        'fixture archive'
      );
    }
    fixture.environment.PATH = fixture.minimalBin;
    const result = await runBash(fixture, await generateBash(fixture, packages));
    assertNumericExit(result, false);
    expect(await recordedCommands(fixture)).toHaveLength(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(
      new RegExp(missingCommand === 'pip' ? 'pip.*설치' : 'Docker.*설치')
    );
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(FINAL_SUCCESS);
  });

  it.each([
    ['falls back from rpm install to a successful upgrade', '17,0', true],
    ['aggregates two failed rpm attempts', '17,23', false],
  ])('%s', async (_label, rpmSequence, succeeds) => {
    const fixture = await createFixture();
    roots.push(fixture.root);
    fixture.environment.DEPS_SMUGGLER_RPM_SEQUENCE = rpmSequence;
    const yum = { ...packageInfo('yum', 'fixture-yum', '1.0.0'), arch: 'x86_64' as const };
    await writeFile(path.join(fixture.packageDir, 'fixture-yum-1.0.0.x86_64.rpm'), 'fixture rpm');
    const result = await runBash(fixture, await generateBash(fixture, [yum]));
    assertNumericExit(result, succeeds);
    const rpmCalls = (await recordedCommands(fixture)).filter(({ command }) => command === 'rpm');
    expect(rpmCalls).toHaveLength(2);
    if (succeeds) {
      expectSuccessOnce(`${result.stdout}\n${result.stderr}`);
    } else {
      assertFailureSummary(`${result.stdout}\n${result.stderr}`, [
        { name: 'fixture-yum', version: '1.0.0' },
      ]);
      expect(`${result.stdout}\n${result.stderr}`).not.toContain(FINAL_SUCCESS);
    }
  });
});

powershellSuite('ScriptGenerator PowerShell failure aggregation', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('executes native PowerShell and aggregates two pip failures before a successful third package', async () => {
    const fixture = await createFixture();
    roots.push(fixture.root);
    fixture.environment.DEPS_SMUGGLER_PIP_FAILURES = 'alpha:17,beta:23';
    const scriptPath = path.join(fixture.bundle, 'install.ps1');
    await getScriptGenerator().generatePowerShellScript(
      [
        packageInfo('pip', 'alpha', '1.0.0'),
        packageInfo('pip', 'beta', '2.0.0'),
        packageInfo('pip', 'gamma', '3.0.0'),
      ],
      scriptPath
    );
    const command = powershellCommand(scriptPath);
    const result = await runChild(command.command, command.args, {
      cwd: fixture.root,
      env: fixture.environment,
      timeout: 60_000,
    });
    assertNumericExit(result, false);
    const commands = await recordedCommands(fixture);
    expect(commands.filter(({ command: name }) => name === 'pip').map(({ args }) => args.at(-1))).toEqual([
      'alpha==1.0.0',
      'beta==2.0.0',
      'gamma==3.0.0',
    ]);
    assertFailureSummary(`${result.stdout}\n${result.stderr}`, [
      { name: 'alpha', version: '1.0.0' },
      { name: 'beta', version: '2.0.0' },
    ]);
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(FINAL_SUCCESS);
  });

  it('keeps PowerShell aggregation active with generated error handling disabled', async () => {
    const fixture = await createFixture();
    roots.push(fixture.root);
    fixture.environment.DEPS_SMUGGLER_PIP_FAILURES = 'alpha:17,beta:23';
    const scriptPath = path.join(fixture.bundle, 'install.ps1');
    await getScriptGenerator().generatePowerShellScript(
      [packageInfo('pip', 'alpha', '1.0.0'), packageInfo('pip', 'beta', '2.0.0')],
      scriptPath,
      { includeErrorHandling: false }
    );
    const command = powershellCommand(scriptPath);
    const result = await runChild(command.command, command.args, {
      cwd: fixture.root,
      env: fixture.environment,
      timeout: 60_000,
    });
    assertNumericExit(result, false);
    assertFailureSummary(`${result.stdout}\n${result.stderr}`, [
      { name: 'alpha', version: '1.0.0' },
      { name: 'beta', version: '2.0.0' },
    ]);
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(FINAL_SUCCESS);
  });

  it('continues through pip and Conda failures and attempts a successful Docker group', async () => {
    const fixture = await createFixture();
    roots.push(fixture.root);
    fixture.environment.DEPS_SMUGGLER_PIP_FAILURES = 'alpha:17';
    fixture.environment.DEPS_SMUGGLER_CONDA_EXIT = '23';
    const docker = packageInfo('docker', 'fixture/image', '1.0.0');
    await writeFile(
      path.join(fixture.packageDir, buildDockerArchiveFilename(docker.name, docker.version)),
      'fixture archive'
    );
    await writeFile(path.join(fixture.packageDir, 'fixture.conda'), 'fixture archive');
    const packages = [
      packageInfo('pip', 'alpha', '1.0.0'),
      { ...packageInfo('conda', 'conda-alpha', '1.0.0'), metadata: { filename: 'fixture.conda' } },
      docker,
    ];
    const result = await runPowerShell(fixture, packages, {
      condaPackageFiles: [{ relativePath: 'fixture.conda' }],
    });
    assertNumericExit(result, false);
    expect((await recordedCommands(fixture)).map(({ command }) => command)).toEqual([
      'pip',
      'conda',
      'docker',
    ]);
    assertFailureSummary(`${result.stdout}\n${result.stderr}`, [
      { name: 'alpha', version: '1.0.0' },
      { name: 'conda-alpha', version: '1.0.0' },
    ]);
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(FINAL_SUCCESS);
  });

  it('reports a native PowerShell Docker exit failure', async () => {
    const fixture = await createFixture();
    roots.push(fixture.root);
    fixture.environment.DEPS_SMUGGLER_DOCKER_EXIT = '31';
    const docker = packageInfo('docker', 'fixture/image', '1.0.0');
    await writeFile(
      path.join(fixture.packageDir, buildDockerArchiveFilename(docker.name, docker.version)),
      'fixture archive'
    );
    const result = await runPowerShell(fixture, [docker]);
    assertNumericExit(result, false);
    assertFailureSummary(`${result.stdout}\n${result.stderr}`, [
      { name: 'fixture/image', version: '1.0.0' },
    ]);
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(FINAL_SUCCESS);
  });

  it('prints the PowerShell success banner only when all commands succeed', async () => {
    const fixture = await createFixture();
    roots.push(fixture.root);
    const result = await runPowerShell(fixture, [
      packageInfo('pip', 'alpha', '1.0.0'),
      packageInfo('pip', 'beta', '2.0.0'),
      packageInfo('pip', 'gamma', '3.0.0'),
    ]);
    assertNumericExit(result, true);
    expectSuccessOnce(`${result.stdout}\n${result.stderr}`);
    expect(`${result.stdout}\n${result.stderr}`).not.toMatch(/실패/);
  });

  it.each(['pip', 'docker'])('reports a missing PowerShell %s executable', async (missingCommand) => {
    const fixture = await createFixture();
    roots.push(fixture.root);
    const packages =
      missingCommand === 'pip'
        ? [packageInfo('pip', 'alpha', '1.0.0')]
        : [packageInfo('docker', 'fixture/image', '1.0.0')];
    if (missingCommand === 'docker') {
      const docker = packages[0];
      await writeFile(
        path.join(fixture.packageDir, buildDockerArchiveFilename(docker.name, docker.version)),
        'fixture archive'
      );
    }
    fixture.environment.PATH = fixture.minimalBin;
    const result = await runPowerShell(fixture, packages);
    assertNumericExit(result, false);
    expect(await recordedCommands(fixture)).toHaveLength(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(
      new RegExp(missingCommand === 'pip' ? 'pip.*설치' : 'Docker.*설치')
    );
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(FINAL_SUCCESS);
  });

  it('aggregates a terminating Get-ChildItem traversal failure before pip runs', async () => {
    const fixture = await createFixture();
    roots.push(fixture.root);
    const scriptPath = path.join(fixture.bundle, 'install.ps1');
    await getScriptGenerator().generatePowerShellScript(
      [packageInfo('pip', 'alpha', '1.0.0')],
      scriptPath
    );
    const wrapperPath = path.join(fixture.root, 'invoke-with-traversal-failure.ps1');
    await writeFile(
      wrapperPath,
      '\uFEFF' + [
        'function Get-ChildItem {',
        '  [CmdletBinding()]',
        '  param([Alias("LiteralPath")][string]$Path, [switch]$Directory, [switch]$Recurse)',
        '  Write-Error "fixture traversal failure" -ErrorAction $ErrorActionPreference',
        '}',
        `& ${powershellLiteral(scriptPath)}`,
        'exit $LASTEXITCODE',
      ].join('\r\n') + '\r\n'
    );
    const command = powershellCommand(wrapperPath);
    const result = await runChild(command.command, command.args, {
      cwd: fixture.root,
      env: fixture.environment,
      timeout: 60_000,
    });
    assertNumericExit(result, false);
    expect(await recordedCommands(fixture)).toHaveLength(0);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(failureSummaryBlock(output)).toContain('Python');
    expect(output).toContain('fixture traversal failure');
    expect(output).not.toContain(FINAL_SUCCESS);
  });
});
