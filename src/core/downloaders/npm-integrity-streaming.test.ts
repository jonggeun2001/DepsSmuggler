import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { createServer } from 'http';
import * as os from 'os';
import * as path from 'path';
import { finished } from 'stream/promises';
import * as fs from 'fs-extra';
import * as ssri from 'ssri';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NpmDownloader } from './npm';
import type { PackageInfo } from '../../types';
import type { AddressInfo } from 'net';

const boundary = vi.hoisted(() => ({
  readers: [] as import('fs').ReadStream[],
  writers: [] as import('fs').WriteStream[],
  chunkSizes: [] as number[],
}));
vi.mock('fs-extra', async () => {
  const loaded = await vi.importActual<
    typeof import('fs-extra') & { default: typeof import('fs-extra') }
  >('fs-extra');
  const actual = loaded.default;
  return {
    ...actual,
    readFile: vi.fn(actual.readFile),
    createReadStream: vi.fn((...args: Parameters<typeof actual.createReadStream>) => {
      const reader = actual.createReadStream(...args);
      boundary.readers.push(reader);
      reader.on('data', (chunk) => boundary.chunkSizes.push(chunk.length));
      return reader;
    }),
    createWriteStream: vi.fn((...args: Parameters<typeof actual.createWriteStream>) => {
      const writer = actual.createWriteStream(...args);
      boundary.writers.push(writer);
      return writer;
    }),
  };
});
vi.mock('ssri', async () => {
  const actual = await vi.importActual<typeof import('ssri')>('ssri');
  return { ...actual, checkData: vi.fn(actual.checkData) };
});

const payload = Buffer.from('saved npm package fixture');
const good512 = ssri.fromData(payload, { algorithms: ['sha512'] }).toString();
const bad512 = ssri.fromData('tampered', { algorithms: ['sha512'] }).toString();
const good256 = ssri.fromData(payload, { algorithms: ['sha256'] }).toString();
const bad256 = ssri.fromData('tampered', { algorithms: ['sha256'] }).toString();
let directory: string;
let filePath: string;
let downloader: NpmDownloader;
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-length': payload.length });
  response.end(payload);
});
let url: string;
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/fixture.tgz`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
});
beforeEach(async () => {
  vi.clearAllMocks();
  boundary.readers = [];
  boundary.writers = [];
  boundary.chunkSizes = [];
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'npm-integrity-'));
  filePath = path.join(directory, 'fixture.tgz');
  await fs.writeFile(filePath, payload);
  downloader = new NpmDownloader();
});
afterEach(async () => {
  await Promise.all(
    boundary.readers.map(async (reader) => {
      const done = finished(reader, { cleanup: true }).catch(() => undefined);
      reader.destroy();
      await done;
    })
  );
  await fs.remove(directory);
  vi.restoreAllMocks();
});

describe('saved-file SRI stream verification', () => {
  it.each([
    [good512, true],
    [bad512, false],
    [`${bad256} ${good512}`, true],
    [`${good256} ${bad512}`, false],
    [`${bad512} ${good512}`, true],
    [`${good512} ${bad512}`, true],
    [good256, true],
    ['', false],
    ['not-an-integrity', false],
    ['unknownhash-YWJj', false],
  ])('preserves SRI selection and closure for %s', async (integrity, expected) => {
    await expect(downloader.verifyIntegrity(filePath, integrity)).resolves.toBe(expected);
    expect(boundary.readers).toHaveLength(1);
    expect(boundary.readers[0].closed).toBe(true);
    expect(fs.readFile).not.toHaveBeenCalled();
    expect(ssri.checkData).not.toHaveBeenCalled();
  });

  it.each([good512, 'not-an-integrity'])(
    'returns false for a missing file and observes late open errors: %s',
    async (integrity) => {
      await expect(
        downloader.verifyIntegrity(path.join(directory, 'missing'), integrity)
      ).resolves.toBe(false);
      expect(boundary.readers[0].closed).toBe(true);
    }
  );

  it('returns false for a file read error and closes the descriptor', async () => {
    await expect(downloader.verifyIntegrity(directory, good512)).resolves.toBe(false);
    expect(boundary.readers[0].closed).toBe(true);
  });

  it('returns false when reader creation throws synchronously', async () => {
    vi.mocked(fs.createReadStream).mockImplementationOnce(() => {
      throw new Error('open failure');
    });
    await expect(downloader.verifyIntegrity(filePath, good512)).resolves.toBe(false);
  });

  it('reads a multi-chunk file without full buffering or checkData', async () => {
    const content = Buffer.alloc(1024 * 1024 + 123, 0x63);
    await fs.writeFile(filePath, content);
    const expected = ssri.fromData(content).toString();
    await expect(downloader.verifyIntegrity(filePath, expected)).resolves.toBe(true);
    expect(boundary.chunkSizes.length).toBeGreaterThan(1);
    expect(Math.max(...boundary.chunkSizes)).toBeLessThanOrEqual(64 * 1024);
    expect(boundary.chunkSizes.reduce((sum, size) => sum + size, 0)).toBe(content.length);
    expect(boundary.readers[0].closed).toBe(true);
    expect(fs.readFile).not.toHaveBeenCalled();
    expect(ssri.checkData).not.toHaveBeenCalled();
  });
});

describe('actual npm HTTP download and verification failure cleanup', () => {
  const goodSha1 = createHash('sha1').update(payload).digest('hex');
  it.each([
    { integrity: good512, sha1: 'invalid', success: true, useSRI: true },
    { integrity: bad512, sha1: goodSha1, success: false, useSRI: true },
    { integrity: 'not-an-integrity', sha1: goodSha1, success: false, useSRI: true },
    { integrity: undefined, sha1: goodSha1, success: true, useSRI: false },
    { integrity: '', sha1: goodSha1, success: true, useSRI: false },
  ])(
    'preserves exclusive SRI/SHA1 selection: $integrity',
    async ({ integrity, sha1, success, useSRI }) => {
      await fs.remove(filePath);
      const info: PackageInfo = { type: 'npm', name: 'fixture', version: '1.0.0' };
      vi.spyOn(downloader, 'getPackageMetadata').mockResolvedValue({
        ...info,
        metadata: { downloadUrl: url, checksum: { sha512: integrity, sha1 } },
      });
      const verify = downloader.verifyIntegrity.bind(downloader);
      const sri = vi.spyOn(downloader, 'verifyIntegrity').mockImplementation(async (...args) => {
        expect(boundary.writers.every((writer) => writer.closed)).toBe(true);
        return verify(...args);
      });
      const sha = vi.spyOn(downloader, 'verifyShasum');
      const result = downloader.downloadPackage(info, directory);
      if (success) {
        await expect(result).resolves.toBe(filePath);
        expect(await readFile(filePath)).toEqual(payload);
      } else {
        await expect(result).rejects.toThrow('무결성 검증 실패');
        expect(await fs.pathExists(filePath)).toBe(false);
      }
      expect(sri).toHaveBeenCalledTimes(useSRI ? 1 : 0);
      expect(sha).toHaveBeenCalledTimes(useSRI ? 0 : 1);
      if (useSRI) expect(boundary.readers.every((reader) => reader.closed)).toBe(true);
    }
  );

  it('removes a direct tarball after invalid SRI, with its reader already closed', async () => {
    await fs.remove(filePath);
    await expect(downloader.downloadTarball(url, directory, 'not-an-integrity')).rejects.toThrow(
      '무결성 검증 실패'
    );
    expect(boundary.readers).toHaveLength(1);
    expect(boundary.readers[0].closed).toBe(true);
    expect(await fs.pathExists(filePath)).toBe(false);
  });
});
