import { execFile } from 'node:child_process';
import * as http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const execute = promisify(execFile);

it('rejects an unpatched CLI command before it contacts a repository', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'depssmuggler-runtime-'));
  const preload = path.join(directory, 'unpatched-node.cjs');
  await writeFile(
    preload,
    "Object.defineProperty(process.versions, 'node', { value: '24.22.0' });\n"
  );
  let requests = 0;
  const server = http.createServer((_request, response) => {
    requests++;
    response.writeHead(500).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  try {
    await expect(
      execute(
        process.execPath,
        [
          '--require',
          path.resolve('tests/fixtures/isolate-home.cjs'),
          '--require',
          preload,
          path.resolve('scripts/cli.cjs'),
          'search',
          'example:artifact',
          '-t',
          'maven',
          '--maven-repository',
          `http://127.0.0.1:${address.port}/repo`,
        ],
        { env: { ...process.env, DEPS_SMUGGLER_TEST_USER_DIR: directory }, timeout: 20000 }
      )
    ).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('보안 패치') });
    expect(requests).toBe(0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);

it('rejects stale Electron dependencies before development startup', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'depssmuggler-electron-version-'));
  const preload = path.join(directory, 'stale-electron.cjs');
  await writeFile(
    preload,
    `const Module = require('node:module');
const load = Module._load;
Module._load = function(name, ...args) {
  if (name === 'electron/package.json') return { version: '39.8.7' };
  return load.call(this, name, ...args);
};
`
  );
  try {
    await expect(
      execute(process.execPath, [
        '--require',
        preload,
        path.resolve('scripts/check-runtime.cjs'),
        '--electron',
      ])
    ).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('npm ci') });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
