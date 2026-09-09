import { execFile } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import * as fs from 'fs-extra';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const isolateHomeScript = path.join(projectRoot, 'tests/fixtures/isolate-home.cjs');
const childHarness = `
const path = require('node:path');
const projectRoot = process.env.DEPS_SMUGGLER_PROJECT_ROOT;
require(path.join(projectRoot, 'node_modules/ts-node')).register({ project: path.join(projectRoot, 'tsconfig.cli.json') });
process.argv = [
  process.execPath,
  path.join(projectRoot, 'src/cli/index.ts'),
  'download',
  '--type', process.env.DEPS_SMUGGLER_TYPE,
  '--file', process.env.DEPS_SMUGGLER_INPUT,
  '--output', process.env.DEPS_SMUGGLER_OUTPUT,
  '--format', 'zip',
  '--no-deps',
];
require(path.join(projectRoot, 'src/cli/index.ts'));
`;

describe('empty --file CLI preflight', () => {
  it.each(
    ['maven', 'npm', 'pip'].flatMap((type) => [
      [type, 'empty', ''],
      [type, 'whitespace', '\n \n\t'],
      [type, 'comments', '# comment only\n\n  # another comment\n'],
    ]),
  )('%s rejects %s input before creating delivery artifacts', async (type, _name, content) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-issue-73-'));
    const output = path.join(tempRoot, 'output with spaces');
    const isolatedHome = path.join(tempRoot, 'isolated user directory');
    const input = path.join(tempRoot, 'empty packages.txt');
    const harnessPath = path.join(tempRoot, 'empty-file-harness.cjs');
    await fs.ensureDir(isolatedHome);
    await fs.writeFile(input, content);
    await fs.writeFile(harnessPath, childHarness);

    try {
      let child: { code: number; stdout: string; stderr: string };
      try {
        const result = await execFileAsync(process.execPath, [harnessPath], {
          cwd: projectRoot,
          env: {
            ...process.env,
            DEPS_SMUGGLER_PROJECT_ROOT: projectRoot,
            DEPS_SMUGGLER_TYPE: type,
            DEPS_SMUGGLER_INPUT: input,
            DEPS_SMUGGLER_OUTPUT: output,
            DEPS_SMUGGLER_TEST_USER_DIR: isolatedHome,
            NODE_OPTIONS: `--require ${JSON.stringify(isolateHomeScript)}`,
          },
          timeout: 120_000,
        });
        child = { code: 0, stdout: result.stdout, stderr: result.stderr };
      } catch (error) {
        const failure = error as typeof error & { code?: number; stdout?: string; stderr?: string };
        child = {
          code: typeof failure.code === 'number' ? failure.code : -1,
          stdout: failure.stdout ?? '',
          stderr: failure.stderr ?? '',
        };
      }

      expect(child.code).toBe(1);
      expect(`${child.stdout}\n${child.stderr}`).toContain('다운로드할 패키지가 없습니다');
      expect(await fs.pathExists(output)).toBe(false);
    } finally {
      await fs.remove(tempRoot);
    }
  }, 180_000);
});
