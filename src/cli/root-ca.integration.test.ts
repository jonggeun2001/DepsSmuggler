import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import * as https from 'node:https';
import * as os from 'node:os';
import * as path from 'node:path';
import * as tls from 'node:tls';
import { promisify } from 'node:util';
import { afterAll, beforeAll, expect, it } from 'vitest';

const exec = promisify(execFile);
const project = process.cwd();
const fixture = (name: string) => path.join(project, 'tests/fixtures', name);
let home: string;
let server: https.Server;
let extraServer: https.Server;
let url: string;
let extraUrl: string;
let requests = 0;

beforeAll(async () => {
  home = mkdtempSync(path.join(os.tmpdir(), 'root-ca-cli-'));
  server = https.createServer(
    {
      key: readFileSync(path.join(project, 'electron/test-fixtures/tls-key.pem')),
      cert: readFileSync(path.join(project, 'electron/test-fixtures/tls-cert.pem')),
    },
    (_request, response) => {
      requests++;
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          objects: [{ package: { name: 'trusted-ca-fixture', version: '1.0.0', links: {} } }],
        })
      );
    }
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('TLS fixture failed to bind');
  url = `https://localhost:${address.port}`;
  extraServer = https.createServer(
    {
      key: readFileSync(path.join(project, 'electron/test-fixtures/tls-key.pem')),
      cert: readFileSync(path.join(project, 'electron/test-fixtures/extra-ca-cert.pem')),
    },
    (_request, response) => response.end('extra CA trusted')
  );
  await new Promise<void>((resolve) => extraServer.listen(0, '127.0.0.1', resolve));
  const extraAddress = extraServer.address();
  if (!extraAddress || typeof extraAddress === 'string')
    throw new Error('Extra TLS fixture failed to bind');
  extraUrl = `https://localhost:${extraAddress.port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  extraServer.closeAllConnections();
  await new Promise<void>((resolve) => extraServer.close(() => resolve()));
  rmSync(home, { recursive: true, force: true });
});

async function run(args: string[], extra: NodeJS.ProcessEnv = {}) {
  return exec(process.execPath, args, {
    cwd: project,
    timeout: 60_000,
    env: {
      ...process.env,
      NODE_TLS_REJECT_UNAUTHORIZED: '1',
      NODE_EXTRA_CA_CERTS: '',
      DEPS_SMUGGLER_TEST_USER_DIR: home,
      DEPS_TEST_CA_URL: url,
      TS_NODE_TRANSPILE_ONLY: 'true',
      NODE_OPTIONS: `--require ${JSON.stringify(fixture('isolate-home.cjs'))}`,
      ...extra,
    },
  });
}

it('persists CLI registration, trusts it in Axios/https/fetch, and rejects again after removal', async () => {
  const route = `--require ${JSON.stringify(fixture('isolate-home.cjs'))} --require ${JSON.stringify(fixture('root-ca-route.cjs'))}`;
  const search = ['scripts/cli.cjs', 'search', 'fixture', '-t', 'npm'];
  await expect(run(search, { NODE_OPTIONS: route })).rejects.toMatchObject({ code: 1 });
  expect(requests).toBe(0);
  await run(['scripts/cli.cjs', 'config', 'ca', 'set', 'electron/test-fixtures/tls-cert.pem']);
  const registered = await run(['scripts/cli.cjs', 'config', 'ca', 'get']);
  expect(registered.stdout).toContain('CN=localhost');
  expect((await run(search, { NODE_OPTIONS: route })).stdout).toContain('trusted-ca-fixture');
  expect((await run([fixture('root-ca-client.cjs')])).stdout).toContain('"success":true');
  // The startup extension preserves the existing environment bundle on all supported runtimes.
  expect(
    (
      await run([fixture('root-ca-client.cjs')], {
        NODE_EXTRA_CA_CERTS: path.join(project, 'electron/test-fixtures/extra-ca-cert.pem'),
        DEPS_TEST_CA_URL: extraUrl,
      })
    ).stdout
  ).toContain('"success":true');
  // OpenSSL's lazy trust store is not enumerable through getCACertificates('default').
  // Preserve it whether the flag came from argv or NODE_OPTIONS (Electron does not support it).
  if (!process.versions.electron)
    for (const mode of ['argv', 'environment']) {
      const args = mode === 'argv' ? ['--use-openssl-ca'] : [];
      const extra = {
        SSL_CERT_FILE: path.join(project, 'electron/test-fixtures/extra-ca-cert.pem'),
        NODE_OPTIONS: `--require ${JSON.stringify(fixture('isolate-home.cjs'))}${mode === 'environment' ? ' --use-openssl-ca' : ''}`,
      };
      for (const target of [url, extraUrl]) {
        expect(
          (
            await run([...args, fixture('root-ca-client.cjs')], {
              ...extra,
              DEPS_TEST_CA_URL: target,
            })
          ).stdout
        ).toContain('"success":true');
      }
    }
  if (typeof tls.setDefaultCACertificates === 'function') {
    const desktop = await run([fixture('root-ca-client.cjs')], { DEPS_TEST_DESKTOP_CA: '1' });
    const result = JSON.parse(desktop.stdout.trim());
    expect(result.status.restartRequired).toBe(false);
    expect(result.defaultCount).toBeGreaterThan(result.bundledCount);
    expect(
      (
        await run([fixture('root-ca-client.cjs')], {
          DEPS_TEST_DESKTOP_CA: '1',
          NODE_EXTRA_CA_CERTS: path.join(project, 'electron/test-fixtures/extra-ca-cert.pem'),
          DEPS_TEST_CA_URL: extraUrl,
        })
      ).stdout
    ).toContain('"success":true');
  }
  await expect(
    run([fixture('root-ca-client.cjs')], {
      DEPS_TEST_CA_URL: url.replace('localhost', '127.0.0.1'),
    })
  ).rejects.toMatchObject({ code: 1 });
  await run(['scripts/cli.cjs', 'config', 'ca', 'clear']);
  await expect(run(search, { NODE_OPTIONS: route })).rejects.toMatchObject({ code: 1 });
  expect((await run(['scripts/cli.cjs', 'config', 'ca', 'get'])).stdout.trim()).toBe('[]');
}, 120_000);
