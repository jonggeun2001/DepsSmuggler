import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  calculateFileChecksum,
  verifyFileChecksum,
  type ChecksumAlgorithm,
} from './checksum';

const FIXTURE_CONTENT = 'deps-smuggler checksum fixture\n';
const FIXTURE_CHECKSUMS: Record<ChecksumAlgorithm, string> = {
  md5: '16e6f9310fa69758a96f5dd05778fa19',
  sha1: '348bd352241058a79755b0f417b257e6e38044df',
  sha256: '4ec14962517fa49187d107ff8c257417112e55d844fe89b82a5d5e94a639c62e',
  sha512:
    'e28ed65313ceb650cc4366bda1e3814430d5cf88487b5ae9ea382db8a96426725a23debd58dd650d31cf12eacf504cd054a1b676628a3a0009565787c687e8c3',
};

const tempDirs: string[] = [];

async function createFixtureFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'depssmuggler-checksum-'));
  const filePath = join(dir, 'fixture.txt');

  tempDirs.push(dir);
  await writeFile(filePath, FIXTURE_CONTENT, 'utf8');

  return filePath;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('checksum', () => {
  it('기본값으로 sha256 체크섬을 계산한다', async () => {
    const filePath = await createFixtureFile();

    await expect(calculateFileChecksum(filePath)).resolves.toBe(FIXTURE_CHECKSUMS.sha256);
  });

  it.each([
    ['md5', FIXTURE_CHECKSUMS.md5],
    ['sha1', FIXTURE_CHECKSUMS.sha1],
    ['sha256', FIXTURE_CHECKSUMS.sha256],
    ['sha512', FIXTURE_CHECKSUMS.sha512],
  ] as const)('%s 알고리즘 계산을 지원한다', async (algorithm, expected) => {
    const filePath = await createFixtureFile();

    await expect(calculateFileChecksum(filePath, algorithm)).resolves.toBe(expected);
  });

  it('대소문자와 sha256: 프리픽스를 무시하고 체크섬을 검증한다', async () => {
    const filePath = await createFixtureFile();

    await expect(
      verifyFileChecksum(filePath, `sha256:${FIXTURE_CHECKSUMS.sha256.toUpperCase()}`)
    ).resolves.toBe(true);
  });

  it('체크섬이 다르면 false를 반환한다', async () => {
    const filePath = await createFixtureFile();

    await expect(verifyFileChecksum(filePath, 'sha256:deadbeef')).resolves.toBe(false);
  });

  it('파일 스트림 close 이후에만 체크섬 계산을 완료한다', async () => {
    vi.resetModules();

    const stream = new EventEmitter();
    const createReadStream = vi.fn(() => stream);

    vi.doMock('fs-extra', () => ({
      createReadStream,
    }));

    try {
      const { calculateFileChecksum: mockedCalculateFileChecksum } = await import('./checksum');
      const checksumPromise = mockedCalculateFileChecksum('/tmp/mock-fixture.txt');
      let settled = false;

      void checksumPromise.then(() => {
        settled = true;
      });

      stream.emit('data', Buffer.from('checksum-fixture'));
      stream.emit('end');
      await Promise.resolve();

      expect(settled).toBe(false);

      stream.emit('close');

      await expect(checksumPromise).resolves.toBe(
        createHash('sha256').update('checksum-fixture').digest('hex')
      );
    } finally {
      vi.doUnmock('fs-extra');
      vi.resetModules();
    }
  });
});
