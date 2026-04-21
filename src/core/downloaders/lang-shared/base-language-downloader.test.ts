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
});
