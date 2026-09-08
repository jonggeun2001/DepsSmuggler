import axios from 'axios';
import { PassThrough, Readable, Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DockerAuthClient } from './docker-auth-client';
import { DockerBlobDownloader } from './docker-blob-downloader';

const io = vi.hoisted(() => ({
  createWriteStream: vi.fn(),
  remove: vi.fn(),
  readdir: vi.fn(),
  createTar: vi.fn(),
  checksum: vi.fn(),
}));
vi.mock('axios', () => ({ default: vi.fn() }));
vi.mock('fs', () => ({ createWriteStream: io.createWriteStream }));
vi.mock('fs-extra', () => ({ remove: io.remove, readdir: io.readdir }));
vi.mock('tar', () => ({ create: io.createTar }));
vi.mock('./docker-utils', async () => ({
  ...(await vi.importActual<typeof import('./docker-utils')>('./docker-utils')),
  calculateSha256: io.checksum,
}));
vi.mock('../../utils/logger', () => ({ default: { error: vi.fn(), debug: vi.fn() } }));

describe('DockerBlobDownloader', () => {
  let downloader: DockerBlobDownloader;
  const streams: Array<Readable | Writable> = [];
  const request = vi.mocked(axios);

  beforeEach(() => {
    vi.resetAllMocks();
    downloader = new DockerBlobDownloader(new DockerAuthClient());
    io.checksum.mockResolvedValue('abc123');
    io.remove.mockResolvedValue(undefined);
    io.createTar.mockResolvedValue(undefined);
    io.createWriteStream.mockImplementation(() => {
      const writer = new PassThrough();
      streams.push(writer);
      return writer;
    });
  });
  afterEach(() => {
    for (const stream of streams.splice(0)) stream.destroy();
    vi.restoreAllMocks();
  });

  function response(chunks = [Buffer.from('abc'), Buffer.from('12345')]) {
    const source = Readable.from(chunks);
    streams.push(source);
    request.mockResolvedValue({ data: source });
    return source;
  }

  it('streams an authenticated blob, reports byte deltas, and verifies the completed file', async () => {
    response();
    const progress = vi.fn();
    await downloader.downloadBlob(
      'team/image',
      'sha256:abc123',
      '/download/layer.tar',
      'pull-token',
      'ghcr.io',
      progress
    );

    expect(request).toHaveBeenCalledExactlyOnceWith({
      method: 'GET',
      url: 'https://ghcr.io/v2/team/image/blobs/sha256:abc123',
      responseType: 'stream',
      headers: { Authorization: 'Bearer pull-token' },
    });
    expect(io.createWriteStream).toHaveBeenCalledExactlyOnceWith('/download/layer.tar');
    expect(progress.mock.calls).toEqual([[3], [5]]);
    expect(io.checksum).toHaveBeenCalledExactlyOnceWith('/download/layer.tar');
    expect(io.remove).not.toHaveBeenCalled();
  });

  it('allows anonymous downloads without a progress callback', async () => {
    response([Buffer.from('layer')]);
    await downloader.downloadBlob('library/nginx', 'sha256:abc123', '/download/layer.tar', '');
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://registry-1.docker.io/v2/library/nginx/blobs/sha256:abc123',
        headers: {},
      })
    );
  });

  it('completes and verifies an empty blob without reporting nonexistent bytes', async () => {
    response([]);
    const progress = vi.fn();
    await downloader.downloadBlob(
      'team/image',
      'sha256:abc123',
      '/download/empty',
      '',
      'ghcr.io',
      progress
    );
    expect(progress).not.toHaveBeenCalled();
    expect(io.checksum).toHaveBeenCalledWith('/download/empty');
  });

  it('removes a corrupt blob before rejecting its checksum', async () => {
    response();
    io.checksum.mockResolvedValue('different-hash');
    await expect(
      downloader.downloadBlob('team/image', 'sha256:abc123', '/download/corrupt', '', 'ghcr.io')
    ).rejects.toThrow('Blob 체크섬 검증 실패: sha256:abc123');
    expect(io.remove).toHaveBeenCalledExactlyOnceWith('/download/corrupt');
  });

  it('propagates network/auth failure before opening a destination file', async () => {
    const denied = Object.assign(new Error('Forbidden'), { response: { status: 403 } });
    request.mockRejectedValue(denied);
    await expect(
      downloader.downloadBlob('team/private', 'sha256:abc123', '/download/file', 'bad-token')
    ).rejects.toBe(denied);
    expect(io.createWriteStream).not.toHaveBeenCalled();
    expect(io.checksum).not.toHaveBeenCalled();
  });

  it('propagates destination permission failure without attempting checksum verification', async () => {
    response();
    const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const writer = new Writable({
      write(_chunk, _encoding, callback) {
        callback(denied);
      },
    });
    streams.push(writer);
    io.createWriteStream.mockReturnValue(writer);

    await expect(
      downloader.downloadBlob('team/image', 'sha256:abc123', '/restricted/file', '')
    ).rejects.toBe(denied);
    expect(io.checksum).not.toHaveBeenCalled();
    expect(io.remove).not.toHaveBeenCalled();
  });

  it('propagates checksum file-reading errors', async () => {
    response();
    const failure = Object.assign(new Error('file disappeared'), { code: 'ENOENT' });
    io.checksum.mockRejectedValue(failure);
    await expect(
      downloader.downloadBlob('team/image', 'sha256:abc123', '/download/file', '')
    ).rejects.toBe(failure);
    expect(io.remove).not.toHaveBeenCalled();
  });

  it.each([
    { actual: 'ABC123', expected: 'abc123', valid: true },
    { actual: 'abc123', expected: 'ABC123', valid: true },
    { actual: 'abc123', expected: 'def456', valid: false },
  ])(
    'compares checksum strings case-insensitively: $actual / $expected',
    async ({ actual, expected, valid }) => {
      io.checksum.mockResolvedValue(actual);
      await expect(downloader.verifyChecksum('/download/file', expected)).resolves.toBe(valid);
    }
  );

  it('archives all image entries relative to the source directory', async () => {
    io.readdir.mockResolvedValue(['manifest.json', 'config.json', 'layer']);
    await downloader.createImageTar('/download/image', '/download/image.tar');
    expect(io.readdir).toHaveBeenCalledExactlyOnceWith('/download/image');
    expect(io.createTar).toHaveBeenCalledExactlyOnceWith(
      { file: '/download/image.tar', cwd: '/download/image' },
      ['manifest.json', 'config.json', 'layer']
    );
  });

  it('propagates archive directory access errors without creating a tar', async () => {
    const denied = Object.assign(new Error('directory forbidden'), { code: 'EACCES' });
    io.readdir.mockRejectedValue(denied);
    await expect(
      downloader.createImageTar('/restricted/image', '/download/image.tar')
    ).rejects.toBe(denied);
    expect(io.createTar).not.toHaveBeenCalled();
  });

  it('propagates archive writing errors', async () => {
    io.readdir.mockResolvedValue([]);
    const failure = Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    io.createTar.mockRejectedValue(failure);
    await expect(downloader.createImageTar('/download/image', '/download/image.tar')).rejects.toBe(
      failure
    );
  });

  it('downloads blobs sequentially and forwards progress for each blob', async () => {
    let completeFirst!: () => void;
    const firstDone = new Promise<void>((resolve) => {
      completeFirst = resolve;
    });
    const download = vi
      .spyOn(downloader, 'downloadBlob')
      .mockImplementationOnce(async (_repo, _digest, _dest, _token, _registry, onChunk) => {
        onChunk?.(4);
        await firstDone;
      })
      .mockImplementationOnce(async (_repo, _digest, _dest, _token, _registry, onChunk) => {
        onChunk?.(6);
      });
    const progress = vi.fn();
    const result = downloader.downloadBlobs(
      'team/image',
      [
        { digest: 'sha256:first', fileName: 'first.tar' },
        { digest: 'sha256:second', fileName: 'second.tar' },
      ],
      '/download',
      'token',
      'quay.io',
      progress
    );

    expect(download).toHaveBeenCalledTimes(1);
    completeFirst();
    await expect(result).resolves.toEqual(['/download/first.tar', '/download/second.tar']);
    expect(download.mock.calls.map((args) => args.slice(0, 5))).toEqual([
      ['team/image', 'sha256:first', '/download/first.tar', 'token', 'quay.io'],
      ['team/image', 'sha256:second', '/download/second.tar', 'token', 'quay.io'],
    ]);
    expect(progress.mock.calls).toEqual([
      [4, 0],
      [6, 0],
    ]);
  });

  it('returns no paths for empty input and stops remaining downloads after a failure', async () => {
    const failure = new Error('first layer unavailable');
    const download = vi.spyOn(downloader, 'downloadBlob').mockRejectedValue(failure);
    await expect(
      downloader.downloadBlobs('team/image', [], '/download', '', 'ghcr.io')
    ).resolves.toEqual([]);
    expect(download).not.toHaveBeenCalled();
    await expect(
      downloader.downloadBlobs(
        'team/image',
        [
          { digest: 'sha256:first', fileName: 'first.tar' },
          { digest: 'sha256:second', fileName: 'second.tar' },
        ],
        '/download',
        '',
        'ghcr.io'
      )
    ).rejects.toBe(failure);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('downloads a blob list without requiring a progress observer', async () => {
    vi.spyOn(downloader, 'downloadBlob').mockImplementation(
      async (_repo, _digest, _dest, _token, _registry, onChunk) => {
        onChunk?.(5);
      }
    );
    await expect(
      downloader.downloadBlobs(
        'team/image',
        [{ digest: 'sha256:abc123', fileName: 'layer.tar' }],
        '/download',
        '',
        'ghcr.io'
      )
    ).resolves.toEqual(['/download/layer.tar']);
  });
});
