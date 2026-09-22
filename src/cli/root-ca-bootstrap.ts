import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { readRootCaCertificates } from '../core/root-ca-store';

/** Return false when the command has completed in a child with its extra CAs loaded at startup. */
export async function initializeCliRootCa(): Promise<boolean> {
  const certificates = readRootCaCertificates();
  if (certificates.length === 0) return true;
  if (
    process.env.DEPSSMUGGLER_CA_BOOTSTRAP === process.env.NODE_EXTRA_CA_CERTS &&
    process.env.DEPSSMUGGLER_CA_BOOTSTRAP
  )
    return true;

  // Use startup extension on every CLI runtime: getCACertificates('default') does not
  // enumerate OpenSSL's lazy CA store, so replacing it would lose --use-openssl-ca trust.
  // This also supports Node 22.13 without a runtime setter or parsing Node's own flags.
  const existing = process.env.NODE_EXTRA_CA_CERTS
    ? await readFile(process.env.NODE_EXTRA_CA_CERTS, 'utf8')
    : '';
  const temporaryDir = await mkdtemp(path.join(os.tmpdir(), 'depssmuggler-ca-'));
  const signalHandlers: Array<[NodeJS.Signals, () => void]> = [];
  try {
    const bundlePath = path.join(temporaryDir, 'extra-ca.pem');
    await writeFile(
      bundlePath,
      [existing, ...certificates.map((cert) => cert.toString())].join('\n'),
      { mode: 0o600 }
    );
    const code = await new Promise<number>((resolve, reject) => {
      const child = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
        stdio: 'inherit',
        env: {
          ...process.env,
          NODE_EXTRA_CA_CERTS: bundlePath,
          DEPSSMUGGLER_CA_BOOTSTRAP: bundlePath,
        },
      });
      for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
        const forward = () => {
          child.kill(signal);
        };
        signalHandlers.push([signal, forward]);
        process.on(signal, forward);
      }
      child.once('error', reject);
      child.once('close', (exitCode, signal) =>
        resolve(exitCode ?? (signal ? 128 + os.constants.signals[signal] : 1))
      );
    });
    process.exitCode = code;
    return false;
  } finally {
    try {
      await rm(temporaryDir, { recursive: true, force: true });
    } finally {
      for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
    }
  }
}
