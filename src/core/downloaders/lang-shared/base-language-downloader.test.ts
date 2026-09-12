import * as os from 'os';
import * as path from 'path';
import { PassThrough } from 'stream';
import axios from 'axios';
import * as fs from 'fs-extra';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BaseLanguageDownloader,
  type LanguageArtifactDownloadPlan,
} from './base-language-downloader';
import type { DownloadProgressEvent } from '../../../types';

vi.mock('axios', () => ({
  default: vi.fn(),
}));

class TestLanguageDownloader extends BaseLanguageDownloader {
  async downloadFromPlan(
    destPath: string,
    plan: LanguageArtifactDownloadPlan,
    onProgress?: (progress: DownloadProgressEvent) => void
  ): Promise<string> {
    return this.downloadArtifactFile(destPath, plan, onProgress);
  }
}

describe('BaseLanguageDownloader', () => {
  const downloader = new TestLanguageDownloader();
  const tempPaths: string[] = [];

  afterEach(async () => {
    vi.clearAllMocks();
    await Promise.all(tempPaths.splice(0).map((target) => fs.remove(target)));
  });

  it('다운로드 파일을 저장하고 progress 이벤트를 전달해야 함', async () => {
    const stream = new PassThrough();
    vi.mocked(axios).mockResolvedValue({
      headers: { 'content-length': '4' },
      data: stream,
    } as never);

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-lang-base-'));
    tempPaths.push(tempDir);
    const onProgress = vi.fn();

    const downloadPromise = downloader.downloadFromPlan(
      tempDir,
      {
        downloadUrl: 'https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz',
        itemId: 'pkg@1.0.0',
        timeoutMs: 1000,
      },
      onProgress
    );

    stream.write(Buffer.from('test'));
    stream.end();

    const filePath = await downloadPromise;
    expect(await fs.readFile(filePath, 'utf8')).toBe('test');
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: 'pkg@1.0.0',
        downloadedBytes: 4,
        totalBytes: 4,
        progress: 100,
      })
    );
  });

  it('검증 실패 시 파일을 삭제하고 예외를 던져야 함', async () => {
    const stream = new PassThrough();
    vi.mocked(axios).mockResolvedValue({
      headers: { 'content-length': '3' },
      data: stream,
    } as never);

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-lang-base-'));
    tempPaths.push(tempDir);

    const downloadPromise = downloader.downloadFromPlan(tempDir, {
      downloadUrl: 'https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz',
      itemId: 'pkg@1.0.0',
      timeoutMs: 1000,
      verifyFile: vi.fn().mockResolvedValue(false),
      verificationFailureMessage: '검증 실패',
    });

    stream.write(Buffer.from('bad'));
    stream.end();

    await expect(downloadPromise).rejects.toThrow('검증 실패');
    const files = await fs.readdir(tempDir);
    expect(files).toHaveLength(0);
  });

  it('relativeFilePath가 주어지면 중첩 디렉토리 구조로 저장해야 함', async () => {
    const stream = new PassThrough();
    vi.mocked(axios).mockResolvedValue({
      headers: { 'content-length': '4' },
      data: stream,
    } as never);

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-lang-base-'));
    tempPaths.push(tempDir);

    const downloadPromise = downloader.downloadFromPlan(tempDir, {
      downloadUrl: 'https://repo1.maven.org/maven2/com/example/demo/demo-1.0.0.jar',
      itemId: 'com.example:demo@1.0.0',
      timeoutMs: 1000,
      relativeFilePath: 'com/example/demo/1.0.0/demo-1.0.0.jar',
    });

    stream.write(Buffer.from('test'));
    stream.end();

    const filePath = await downloadPromise;
    expect(filePath).toBe(
      path.join(tempDir, 'com', 'example', 'demo', '1.0.0', 'demo-1.0.0.jar')
    );
    expect(await fs.readFile(filePath, 'utf8')).toBe('test');
  });

  it('일시정지 중 source 오류가 발생하면 빠르게 거부하고 부분 파일과 polling을 정리해야 함', async () => {
    const stream = new PassThrough();
    vi.mocked(axios).mockResolvedValue({
      headers: { 'content-length': '1024' },
      data: stream,
    } as never);

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-lang-base-'));
    tempPaths.push(tempDir);
    let paused = false;
    const controller = new AbortController();
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const downloadPromise = downloader.downloadFromPlan(tempDir, {
      downloadUrl: 'https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz',
      itemId: 'pkg@1.0.0',
      timeoutMs: 1000,
      signal: controller.signal,
      shouldPause: () => paused,
    });

    await vi.waitFor(() => expect(axios).toHaveBeenCalled());
    paused = true;
    stream.write(Buffer.alloc(16));
    const clearCallsBeforeFailure = clearIntervalSpy.mock.calls.length;
    stream.destroy(new Error('source stream failed'));

    let timeout: NodeJS.Timeout | undefined;
    try {
      const outcome = await Promise.race([
        downloadPromise.then(
          () => ({ kind: 'resolved' as const }),
          (error: unknown) => ({ kind: 'rejected' as const, error }),
        ),
        new Promise<{ kind: 'timeout' }>((resolve) => {
          timeout = setTimeout(() => resolve({ kind: 'timeout' }), 1000);
        }),
      ]);
      expect(outcome.kind).toBe('rejected');
      if (outcome.kind === 'rejected') expect(outcome.error).toBeInstanceOf(Error);
      expect(clearIntervalSpy.mock.calls.length).toBeGreaterThan(clearCallsBeforeFailure);
      expect(fs.existsSync(path.join(tempDir, 'pkg-1.0.0.tgz'))).toBe(false);
    } finally {
      if (timeout) clearTimeout(timeout);
      controller.abort();
      await downloadPromise.catch(() => undefined);
      clearIntervalSpy.mockRestore();
    }
  }, 5000);

  it('응답 헤더 단계에서 실패하면 같은 경로의 기존 파일을 보존해야 함', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-lang-base-'));
    tempPaths.push(tempDir);
    const destination = path.join(tempDir, 'pkg-1.0.0.tgz');
    await fs.writeFile(destination, 'previous artifact');
    vi.mocked(axios).mockRejectedValueOnce(new Error('response headers failed'));

    await expect(downloader.downloadFromPlan(tempDir, {
      downloadUrl: 'https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz',
      itemId: 'pkg@1.0.0',
      timeoutMs: 1000,
    })).rejects.toThrow('response headers failed');
    expect(await fs.readFile(destination, 'utf8')).toBe('previous artifact');
  });

  it('출력 파일 열기가 실패하면 기존 디렉터리와 그 내용을 보존해야 함', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-lang-open-'));
    tempPaths.push(tempDir);
    const destination = path.join(tempDir, 'artifact.jar');
    await fs.ensureDir(destination);
    await fs.writeFile(path.join(destination, 'keep.txt'), 'existing data');
    const stream = new PassThrough();
    stream.end('new data');
    vi.mocked(axios).mockResolvedValueOnce({ headers: {}, data: stream } as never);

    await expect(downloader.downloadFromPlan(tempDir, {
      downloadUrl: 'http://fixture/artifact.jar', itemId: 'fixture', timeoutMs: 1000,
    })).rejects.toThrow();
    expect(await fs.readFile(path.join(destination, 'keep.txt'), 'utf8')).toBe('existing data');
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    '쓰기 권한이 없어 파일을 열지 못해도 기존 읽기 전용 파일을 삭제하지 않아야 함', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-lang-readonly-'));
      tempPaths.push(tempDir);
      const destination = path.join(tempDir, 'artifact.jar');
      await fs.writeFile(destination, 'previous artifact', { mode: 0o444 });
      const stream = new PassThrough();
      stream.end('new data');
      vi.mocked(axios).mockResolvedValueOnce({ headers: {}, data: stream } as never);

      await expect(downloader.downloadFromPlan(tempDir, {
        downloadUrl: 'http://fixture/artifact.jar', itemId: 'fixture', timeoutMs: 1000,
      })).rejects.toMatchObject({ code: 'EACCES' });
      expect(await fs.readFile(destination, 'utf8')).toBe('previous artifact');
    }
  );
});
