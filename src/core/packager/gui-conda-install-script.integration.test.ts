import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { generateInstallScripts } from '../shared';

describe('GUI Conda installer script consumer', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const directory of tempDirs.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
  });

  it.skipIf(process.platform === 'win32')('실제 생성 스크립트가 fake conda 경계에서 create와 install을 구분한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'depssmuggler-gui-conda-'));
    tempDirs.push(root);
    const outputDir = path.join(root, 'bundle with spaces');
    const archive = 'conda/fixture-1.0-0.tar.bz2';
    const archivePath = path.join(outputDir, 'packages', archive);
    const binDir = path.join(root, 'bin');
    const logPath = path.join(root, 'conda-argv.jsonl');
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(archivePath, 'fixture archive');
    fs.writeFileSync(path.join(binDir, 'conda'), `#!/bin/sh
printf '%s\\n' "$*" >> "${logPath}"
command="$1"
prefix=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = '--prefix' ]; then prefix="$2"; fi
  shift
done
if [ "\${DEPS_TEST_CONDA_FAIL:-}" = "1" ]; then exit 23; fi
if [ "$command" = "create" ] || [ "$command" = "install" ]; then
  mkdir -p "$prefix/conda-meta"
  touch "$prefix/conda-meta/history"
fi
`, { mode: 0o755 });

    await generateInstallScripts(outputDir, [{ id: 'conda-fixture', type: 'conda', name: 'fixture', version: '1.0' }], {
      condaPackageFiles: [{ relativePath: archive }],
    });
    const scriptPath = path.join(outputDir, 'install.sh');
    const run = (env: NodeJS.ProcessEnv) => new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn('/bin/bash', [scriptPath], { cwd: outputDir, env });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.once('error', reject);
      child.once('close', (code) => resolve({ code, stdout, stderr }));
    });
    const env = { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`, DEPS_SMUGGLER_CONDA_PREFIX: '' };
    expect((await run(env)).code).toBe(0);
    fs.writeFileSync(path.join(outputDir, 'conda-env', 'sentinel'), 'keep');
    expect((await run(env)).code).toBe(0);
    expect(fs.readFileSync(path.join(outputDir, 'conda-env', 'sentinel'), 'utf8')).toBe('keep');
    const calls = fs.readFileSync(logPath, 'utf8').trim().split('\n');
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('create --offline --yes --no-default-packages');
    expect(calls[1]).toContain('install --offline --yes');
    expect(calls[0]).toContain('bundle with spaces');
    expect(calls[0]).toContain(`${outputDir}/./packages/${archive}`);
    expect(calls[1]).toContain(`${outputDir}/./packages/${archive}`);

    const failed = await run({ ...env, DEPS_TEST_CONDA_FAIL: '1' });
    expect(failed.code).toBe(1);
    expect(failed.stdout).not.toContain('Installation complete!');
  }, 30_000);
});
