import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { readRootCaCertificates } from '../core/root-ca-store';
import { initializeRootCaTrust, supportsRuntimeRootCa } from '../core/root-ca-trust';

/** Return false when an older Node runtime has executed the command in a bootstrapped child. */
export async function initializeCliRootCa(): Promise<boolean> {
  if (supportsRuntimeRootCa()) {
    initializeRootCaTrust();
    return true;
  }
  const certificates = readRootCaCertificates();
  if (certificates.length === 0) return true;
  if (
    process.env.DEPSSMUGGLER_CA_BOOTSTRAP === process.env.NODE_EXTRA_CA_CERTS &&
    process.env.DEPSSMUGGLER_CA_BOOTSTRAP
  )
    return true;

  // Node 22.13–22.18 / 24.0–24.4 only load extra CAs at process startup.
  // Keep the user's existing extra CA bundle as well as the application's registered bundle.
  const existing = process.env.NODE_EXTRA_CA_CERTS
    ? await readFile(process.env.NODE_EXTRA_CA_CERTS, 'utf8')
    : '';
  const temporaryDir = await mkdtemp(path.join(os.tmpdir(), 'depssmuggler-ca-'));
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
      child.once('error', reject);
      child.once('exit', (exitCode) => resolve(exitCode ?? 1));
    });
    process.exitCode = code;
    return false;
  } finally {
    await rm(temporaryDir, { recursive: true, force: true });
  }
}
