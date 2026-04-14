import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GPGVerifier } from './gpg-verifier';
import type { OSPackageInfo, Repository } from './types';

describe('GPGVerifier', () => {
  const fetchMock = vi.fn();
  let tempDir: string;
  let repo: Repository;
  let packageInfo: OSPackageInfo;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'depssmuggler-gpg-'));
    repo = {
      id: 'rocky-9-baseos',
      name: 'BaseOS',
      baseUrl: 'https://mirror.rockylinux.org/pub/rocky/9/BaseOS/x86_64/os',
      enabled: true,
      gpgCheck: true,
      gpgKeyUrl: 'https://example.test/RPM-GPG-KEY',
      isOfficial: true,
    };
    packageInfo = {
      name: 'bash',
      version: '5.1',
      architecture: 'x86_64',
      size: 4,
      checksum: { type: 'sha256', value: '' },
      location: 'Packages/bash.rpm',
      repository: repo,
      dependencies: [],
    };

    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('GPG 키 가져오기는 재시도 후 fingerprint와 short id로 키링에 저장한다', async () => {
    const verifier = new GPGVerifier();
    (verifier as any).retryDelay = 0;
    const fingerprint = 'A1B2C3D4E5F60123456789ABCDE0123456789ABC';

    fetchMock
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(new Response('temporary', { status: 500, statusText: 'boom' }))
      .mockResolvedValueOnce(
        new Response(
          [
            '-----BEGIN PGP PUBLIC KEY BLOCK-----',
            'Version: Test',
            '',
            `Key fingerprint = ${fingerprint.match(/.{1,4}/g)?.join(' ')}`,
            '-----END PGP PUBLIC KEY BLOCK-----',
          ].join('\n')
        )
      );

    const key = await verifier.importKey('https://example.test/key.asc', repo.id);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(key).toEqual(
      expect.objectContaining({
        fingerprint,
        keyId: fingerprint.slice(-8),
        repositoryId: repo.id,
      })
    );
    expect(verifier.getKey(fingerprint)?.fingerprint).toBe(fingerprint);
    expect(verifier.getKey(fingerprint.slice(-8))?.repositoryId).toBe(repo.id);
  });

  it('검증이 비활성화되면 서명을 바로 건너뛴다', async () => {
    const verifier = new GPGVerifier({ enabled: false });

    const result = await verifier.verifyPackage(packageInfo, '/unused/file.rpm');

    expect(result).toEqual({ verified: true, skipped: true, reason: 'gpg-disabled' });
  });

  it('공식 저장소 전용 설정이면 서드파티 저장소를 건너뛴다', async () => {
    const verifier = new GPGVerifier({ officialOnly: true });
    const thirdPartyPackage: OSPackageInfo = {
      ...packageInfo,
      repository: {
        ...repo,
        id: 'epel',
        isOfficial: false,
      },
    };

    const result = await verifier.verifyPackage(thirdPartyPackage, '/unused/file.rpm');

    expect(result).toEqual({ verified: true, skipped: true, reason: 'non-official-repo' });
  });

  it('체크섬 불일치를 검출한다', async () => {
    const verifier = new GPGVerifier();
    const filePath = path.join(tempDir, 'bash.rpm');
    fs.writeFileSync(filePath, 'actual-content');
    packageInfo.checksum = {
      type: 'sha256',
      value: crypto.createHash('sha256').update('expected-content').digest('hex'),
    };

    const result = await verifier.verifyChecksum(packageInfo, filePath);

    expect(result.verified).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.reason).toBe('checksum-mismatch');
  });

  it('체크섬이 일치하면 패키지 관리자별 서명 검증 단계로 진행한다', async () => {
    const verifier = new GPGVerifier();
    const filePath = path.join(tempDir, 'bash.rpm');
    fs.writeFileSync(filePath, 'actual-content');
    packageInfo.checksum = {
      type: 'sha256',
      value: crypto.createHash('sha256').update('actual-content').digest('hex'),
    };

    const result = await verifier.verifyPackage(packageInfo, filePath);

    expect(result).toEqual({
      verified: true,
      skipped: true,
      reason: 'gpg-disabled',
    });
  });

  it('알 수 없는 체크섬 타입은 실패 대신 건너뛴다', async () => {
    const verifier = new GPGVerifier();
    const filePath = path.join(tempDir, 'bash.rpm');
    fs.writeFileSync(filePath, 'actual-content');

    const result = await verifier.verifyChecksum(
      { ...packageInfo, checksum: { type: 'sha3' as never, value: 'unused' } },
      filePath
    );

    expect(result).toEqual({ verified: true, skipped: true });

    const verified = await verifier.verifyChecksum(
      { ...packageInfo, checksum: { type: 'sha1' as const, value: crypto.createHash('sha1').update('actual-content').digest('hex') } },
      filePath
    );
    expect(verified).toEqual({ verified: true, skipped: false });
  });
});
