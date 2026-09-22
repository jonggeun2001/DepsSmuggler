import { X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearRootCaCertificates,
  describeRootCaCertificates,
  getRootCaStorePath,
  parseRootCaCertificates,
  readRootCaCertificates,
  registerRootCaFile,
} from './root-ca-store';

vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof os>()),
  homedir: vi.fn(),
}));

const pem = readFileSync(path.resolve('electron/test-fixtures/tls-cert.pem'));
const certificate = new X509Certificate(pem);

describe('additional root CA registration', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), 'root-ca-store-'));
    vi.mocked(os.homedir).mockReturnValue(home);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(home, { recursive: true, force: true });
  });

  it('normalizes DER and PEM bundles, deduplicates certificates and copies the registration', async () => {
    expect(readRootCaCertificates()).toEqual([]);
    const file = path.join(home, 'company.cer');
    writeFileSync(file, certificate.raw);
    await registerRootCaFile(file);
    unlinkSync(file);
    expect(describeRootCaCertificates(readRootCaCertificates())).toEqual([
      {
        fingerprint: certificate.fingerprint256,
        subject: 'CN=localhost',
        issuer: 'CN=localhost',
        validTo: new Date(certificate.validTo).toISOString(),
      },
    ]);
    expect(
      parseRootCaCertificates(Buffer.from('\uFEFF' + pem.toString() + '\n' + pem.toString()))
    ).toHaveLength(1);
    await clearRootCaCertificates();
    expect(readRootCaCertificates()).toEqual([]);
  });

  it.each([
    Buffer.from('garbage'),
    Buffer.alloc(0),
    Buffer.alloc(1024 * 1024 + 1),
    Buffer.from('-----BEGIN CERTIFICATE-----bad-----END CERTIFICATE-----'),
    Buffer.concat([pem, Buffer.from('-----BEGIN PRIVATE KEY-----secret-----END PRIVATE KEY-----')]),
  ])('rejects invalid input without replacing an existing registration', async (input) => {
    const file = path.join(home, 'cert.pem');
    writeFileSync(file, pem);
    await registerRootCaFile(file);
    const before = readFileSync(getRootCaStorePath(), 'utf8');
    writeFileSync(file, input);
    await expect(registerRootCaFile(file)).rejects.toThrow();
    expect(readFileSync(getRootCaStorePath(), 'utf8')).toBe(before);
  });

  it('rejects a CA outside its validity period and preserves the existing registration', async () => {
    const file = path.join(home, 'cert.pem');
    writeFileSync(file, pem);
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2099-01-01').getTime());
    await expect(registerRootCaFile(file)).rejects.toThrow('유효기간');
    expect(readRootCaCertificates()).toEqual([]);
  });

  it('reports corrupt persistence and allows clearing it for recovery', async () => {
    await clearRootCaCertificates();
    writeFileSync(getRootCaStorePath(), '{bad');
    expect(readRootCaCertificates).toThrow('다시 등록');
    await clearRootCaCertificates();
    expect(readRootCaCertificates()).toEqual([]);
  });

  it('rejects server certificates, oversized bundles and trailing DER data', () => {
    expect(() =>
      parseRootCaCertificates(readFileSync(path.resolve('electron/test-fixtures/non-ca-cert.pem')))
    ).toThrow('서버 인증서');
    expect(() => parseRootCaCertificates(Buffer.from(pem.toString().repeat(101)))).toThrow('100개');
    expect(() =>
      parseRootCaCertificates(Buffer.concat([certificate.raw, Buffer.from('trailing')]))
    ).toThrow('X.509');
  });
});
