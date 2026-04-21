import { createHash } from 'node:crypto';
import * as fs from 'fs-extra';

export const SUPPORTED_CHECKSUM_ALGORITHMS = ['md5', 'sha1', 'sha256', 'sha512'] as const;

export type ChecksumAlgorithm = (typeof SUPPORTED_CHECKSUM_ALGORITHMS)[number];

const CHECKSUM_PREFIX_PATTERN = /^(md5|sha1|sha256|sha512):/i;

export function isChecksumAlgorithm(value: string): value is ChecksumAlgorithm {
  return (SUPPORTED_CHECKSUM_ALGORITHMS as readonly string[]).includes(value);
}

export function normalizeChecksum(checksum: string): string {
  return checksum.trim().replace(CHECKSUM_PREFIX_PATTERN, '').toLowerCase();
}

export function calculateFileChecksum(
  filePath: string,
  algorithm: ChecksumAlgorithm = 'sha256'
): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm);
    const stream = fs.createReadStream(filePath);
    let digest: string | null = null;
    let settled = false;

    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => {
      digest = hash.digest('hex');
    });
    stream.on('close', () => {
      if (settled) {
        return;
      }

      settled = true;
      if (digest === null) {
        reject(new Error('Checksum stream closed before completion'));
        return;
      }

      resolve(digest);
    });
    stream.on('error', (error) => {
      if (settled) {
        return;
      }

      settled = true;
      reject(error);
    });
  });
}

export async function verifyFileChecksum(
  filePath: string,
  expectedChecksum: string,
  algorithm: ChecksumAlgorithm = 'sha256'
): Promise<boolean> {
  const actualChecksum = await calculateFileChecksum(filePath, algorithm);
  return normalizeChecksum(actualChecksum) === normalizeChecksum(expectedChecksum);
}
