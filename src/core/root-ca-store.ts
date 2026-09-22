import { X509Certificate } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { writeJsonAtomically } from './shared/atomic-json-store';
import type { RootCaCertificateInfo } from '../types/root-ca';

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_CERTIFICATES = 100;

export const getRootCaStorePath = (): string =>
  path.join(os.homedir(), '.depssmuggler', 'root-ca.json');

export function parseRootCaCertificates(data: Buffer): X509Certificate[] {
  if (data.length === 0 || data.length > MAX_FILE_BYTES) {
    throw new Error('CA 인증서 파일은 비어 있지 않은 1MB 이하 파일이어야 합니다.');
  }
  const text = data
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trim();
  const pemPattern = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;
  const blocks = text.match(pemPattern);
  if (text.includes('-----') && (!blocks || text.replace(pemPattern, '').trim())) {
    throw new Error(
      '인증서만 포함된 PEM 파일을 선택하세요. 개인 키나 다른 데이터는 등록할 수 없습니다.'
    );
  }
  if (blocks && blocks.length > MAX_CERTIFICATES) {
    throw new Error('CA 인증서는 최대 100개까지 등록할 수 있습니다.');
  }
  try {
    const certificates = (blocks ?? [data]).map((value) => new X509Certificate(value));
    if (!blocks && !data.equals(certificates[0].raw)) throw new Error('Invalid DER data');
    if (certificates.some((certificate) => !certificate.ca)) {
      throw new Error('CA_NOT_ALLOWED');
    }
    return [
      ...new Map(
        certificates.map((certificate) => [certificate.fingerprint256, certificate])
      ).values(),
    ];
  } catch (error) {
    if (error instanceof Error && error.message === 'CA_NOT_ALLOWED') {
      throw new Error(
        '루트 또는 중간 CA 인증서만 등록할 수 있습니다. 서버 인증서는 사용할 수 없습니다.'
      );
    }
    throw new Error(
      '유효한 X.509 CA 인증서가 아닙니다. PEM 또는 DER 형식의 .pem, .crt, .cer 파일을 선택하세요.'
    );
  }
}

function readLimitedFile(filePath: string): Buffer {
  const stat = statSync(filePath);
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
    throw new Error('1MB 이하의 인증서 파일을 선택하세요.');
  }
  return readFileSync(filePath);
}

export function readRootCaCertificates(): X509Certificate[] {
  let data: Buffer;
  try {
    data = readLimitedFile(getRootCaStorePath());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  try {
    const stored: unknown = JSON.parse(data.toString('utf8'));
    if (
      !stored ||
      typeof stored !== 'object' ||
      !('pem' in stored) ||
      typeof stored.pem !== 'string'
    ) {
      throw new Error('Invalid CA store');
    }
    return stored.pem === '' ? [] : parseRootCaCertificates(Buffer.from(stored.pem));
  } catch {
    throw new Error(
      '등록된 CA 인증서를 읽을 수 없습니다. 인증서를 다시 등록하거나 등록 해제하세요.'
    );
  }
}

export function describeRootCaCertificates(
  certificates: X509Certificate[]
): RootCaCertificateInfo[] {
  return certificates.map((certificate) => ({
    fingerprint: certificate.fingerprint256,
    subject: certificate.subject,
    issuer: certificate.issuer,
    validTo: new Date(certificate.validTo).toISOString(),
  }));
}

export async function registerRootCaFile(filePath: string): Promise<void> {
  if (typeof filePath !== 'string' || !filePath.trim())
    throw new Error('인증서 파일 경로가 필요합니다.');
  const certificates = parseRootCaCertificates(readLimitedFile(filePath));
  const now = Date.now();
  if (
    certificates.some(
      (certificate) =>
        new Date(certificate.validFrom).getTime() > now ||
        new Date(certificate.validTo).getTime() <= now
    )
  ) {
    throw new Error('유효기간이 지나거나 아직 유효하지 않은 CA 인증서는 등록할 수 없습니다.');
  }
  await saveRootCaBundle(certificates.map((certificate) => certificate.toString()).join('\n'));
}

async function saveRootCaBundle(pem: string): Promise<void> {
  if (Buffer.byteLength(JSON.stringify({ pem }), 'utf8') > MAX_FILE_BYTES - 100) {
    throw new Error('정규화한 인증서가 너무 큽니다. 더 작은 CA 인증서 파일을 선택하세요.');
  }
  const storePath = getRootCaStorePath();
  await mkdir(path.dirname(storePath), { recursive: true });
  await writeJsonAtomically(storePath, { pem });
}

export async function clearRootCaCertificates(): Promise<void> {
  await saveRootCaBundle('');
}
