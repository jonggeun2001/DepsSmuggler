import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import { PassThrough } from 'stream';
import archiver from 'archiver';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTarGzArchive, createZipArchive, downloadFile } from './file-utils';

vi.mock('fs', () => ({ createWriteStream: vi.fn(), unlink: vi.fn(), unlinkSync: vi.fn() }));
vi.mock('http', () => ({ get: vi.fn() }));
vi.mock('https', () => ({ get: vi.fn() }));
vi.mock('archiver', () => ({ default: vi.fn() }));
vi.mock('../../utils/logger', () => ({ default: { debug: vi.fn() } }));

function transfer(headers: Record<string, string> = { 'content-length': '6' }, statusCode = 200) {
  const file = Object.assign(new PassThrough(), { close: vi.fn((callback?: () => void) => {
    file.destroy();
    callback?.();
  }) });
  const response = Object.assign(new PassThrough(), { headers, statusCode, complete: true });
  const request = Object.assign(new EventEmitter(), { destroy: vi.fn() });
  const chunks: Buffer[] = [];
  file.on('data', (chunk: Buffer) => chunks.push(chunk));
  vi.mocked(fs.createWriteStream).mockReturnValueOnce(file as never);
  return { file, response, request, chunks };
}

describe('공유 파일 전송', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fs.unlink).mockImplementation((_file, callback) => callback(null));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(['http', 'https'] as const)(
    '%s 스트림의 모든 바이트와 누적 진행률을 전달한다',
    async (protocol) => {
      const { file, response, request, chunks } = transfer();
      vi.mocked((protocol === 'http' ? http : https).get).mockImplementationOnce(((
        _url: unknown,
        _options: unknown,
        callback: (response: unknown) => void
      ) => {
        callback(response);
        return request;
      }) as never);
      const progress = vi.fn();
      const pending = downloadFile(
        `${protocol}://registry.example/package`,
        'package.bin',
        progress
      );
      response.write(Buffer.from('abc'));
      response.end(Buffer.from('def'));
      await pending;
      expect(Buffer.concat(chunks).toString()).toBe('abcdef');
      expect(progress.mock.calls).toEqual([
        [3, 6],
        [6, 6],
      ]);
      expect(file.close).toHaveBeenCalledOnce();
      expect(fs.unlink).not.toHaveBeenCalled();
    }
  );

  it('길이 헤더가 없는 빈 파일도 완료한다', async () => {
    const { response, request, chunks } = transfer({});
    vi.mocked(https.get).mockImplementationOnce(((
      _url: unknown,
      _options: unknown,
      callback: (response: unknown) => void
    ) => {
      callback(response);
      return request;
    }) as never);
    const progress = vi.fn();
    const pending = downloadFile('https://registry.example/empty', 'empty.bin', progress);
    response.end();
    await pending;
    expect(Buffer.concat(chunks)).toHaveLength(0);
    expect(progress).not.toHaveBeenCalled();
  });

  it('전체 크기를 모르는 스트림은 진행률의 total을 0으로 전달한다', async () => {
    const { response, request } = transfer({});
    vi.mocked(http.get).mockImplementationOnce(((
      _url: unknown,
      _options: unknown,
      callback: (response: unknown) => void
    ) => {
      callback(response);
      return request;
    }) as never);
    const progress = vi.fn();
    const pending = downloadFile('http://registry.example/package', 'package.bin', progress);
    response.end(Buffer.from('abc'));
    await pending;
    expect(progress).toHaveBeenCalledExactlyOnceWith(3, 0);
  });

  it('네트워크 오류는 원본 오류로 거절하고 부분 파일을 정리한다', async () => {
    const { file, request } = transfer();
    vi.mocked(https.get).mockReturnValueOnce(request as never);
    const failure = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
    const pending = downloadFile('https://registry.example/package', 'partial.bin', vi.fn());
    const rejected = expect(pending).rejects.toBe(failure);
    request.emit('error', failure);
    await rejected;
    expect(file.close).toHaveBeenCalledOnce();
    expect(fs.unlink).toHaveBeenCalledWith('partial.bin', expect.any(Function));
  });

  it('잘못된 URL을 transport가 거부하면 오류를 전달한다', async () => {
    const failure = new TypeError('Invalid URL');
    transfer();
    vi.mocked(http.get).mockImplementationOnce(() => {
      throw failure;
    });
    await expect(downloadFile('', 'invalid.bin', vi.fn())).rejects.toBe(failure);
  });

  it('일시정지 후 재개하고 완료 시 감시 타이머를 제거한다', async () => {
    vi.useFakeTimers();
    const { file, response, request } = transfer();
    vi.mocked(https.get).mockImplementationOnce(((
      _url: unknown,
      _options: unknown,
      callback: (response: unknown) => void
    ) => {
      callback(response);
      return request;
    }) as never);
    let paused = true;
    const progress = vi.fn();
    const pending = downloadFile('https://registry.example/package', 'package.bin', progress, {
      shouldPause: () => paused,
    });
    response.write(Buffer.from('abc'));
    response.write(Buffer.from('def'));
    expect(response.isPaused()).toBe(true);
    expect(progress).toHaveBeenCalledTimes(1);
    paused = false;
    await vi.advanceTimersByTimeAsync(100);
    response.end();
    await pending;
    expect(progress.mock.calls).toEqual([
      [3, 6],
      [6, 6],
    ]);
    expect(file.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('일시정지 중 취소하면 요청과 부분 파일 및 타이머를 정리한다', async () => {
    vi.useFakeTimers();
    const { file, response, request } = transfer();
    vi.mocked(https.get).mockImplementationOnce(((
      _url: unknown,
      _options: unknown,
      callback: (response: unknown) => void
    ) => {
      callback(response);
      return request;
    }) as never);
    const controller = new AbortController();
    const pending = downloadFile('https://registry.example/package', 'partial.bin', vi.fn(), {
      signal: controller.signal,
      shouldPause: () => true,
    });
    const rejected = expect(pending).rejects.toThrow('Download aborted');
    response.write(Buffer.from('abc'));
    controller.abort();
    await rejected;
    expect(request.destroy).toHaveBeenCalledOnce();
    expect(file.close).toHaveBeenCalledOnce();
    expect(fs.unlink).toHaveBeenCalledWith('partial.bin', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    response.destroy();
    file.destroy();
  });

  it.each([301, 302])('%s 리다이렉트는 기존 파일을 정리하고 새 주소에서 받는다', async (status) => {
    const first = transfer({ location: 'https://cdn.example/package' }, status);
    const second = transfer();
    const pendingResponses = [first, second];
    vi.mocked(https.get).mockImplementation(((
      _url: unknown,
      _options: unknown,
      callback: (response: unknown) => void
    ) => {
      const next = pendingResponses.shift()!;
      callback(next.response);
      return next.request;
    }) as never);
    const pending = downloadFile('https://registry.example/package', 'package.bin', vi.fn());
    second.response.end(Buffer.from('abcdef'));
    await pending;
    expect(first.file.close).toHaveBeenCalledOnce();
    expect(fs.unlink).toHaveBeenCalledWith('package.bin', expect.any(Function));
    expect(https.get).toHaveBeenNthCalledWith(
      2,
      'https://cdn.example/package',
      expect.any(Object),
      expect.any(Function)
    );
    expect(Buffer.concat(second.chunks).toString()).toBe('abcdef');
  });
});

describe('공유 압축 유틸리티', () => {
  beforeEach(() => vi.resetAllMocks());

  it.each([
    [createZipArchive, 'zip', { zlib: { level: 9 } }],
    [createTarGzArchive, 'tar', { gzip: true, gzipOptions: { level: 9 } }],
  ] as const)(
    '압축 형식에 맞게 설정하고 출력 close까지 기다린다 (%s)',
    async (create, format, options) => {
      const output = new EventEmitter();
      const archive = Object.assign(new EventEmitter(), {
        pipe: vi.fn(),
        directory: vi.fn(),
        finalize: vi.fn(),
      });
      vi.mocked(fs.createWriteStream).mockReturnValue(output as never);
      vi.mocked(archiver).mockReturnValue(archive as never);
      const pending = create('packages', 'archive');
      const completed = vi.fn();
      void pending.then(completed);
      await Promise.resolve();
      expect(completed).not.toHaveBeenCalled();
      expect(archiver).toHaveBeenCalledWith(format, options);
      expect(archive.directory).toHaveBeenCalledWith('packages', false);
      expect(archive.pipe).toHaveBeenCalledWith(output);
      expect(archive.finalize).toHaveBeenCalledOnce();
      output.emit('close');
      await pending;
    }
  );

  it.each([createZipArchive, createTarGzArchive])(
    '압축기의 권한 오류를 호출자에게 전달한다 (%s)',
    async (create) => {
      vi.mocked(fs.createWriteStream).mockReturnValue(new EventEmitter() as never);
      const archive = Object.assign(new EventEmitter(), {
        pipe: vi.fn(),
        directory: vi.fn(),
        finalize: vi.fn(),
      });
      vi.mocked(archiver).mockReturnValue(archive as never);
      const failure = Object.assign(new Error('EACCES'), { code: 'EACCES' });
      const pending = create('restricted', 'archive');
      const rejected = expect(pending).rejects.toBe(failure);
      archive.emit('error', failure);
      await rejected;
    }
  );
});
