import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseOSDownloader, type BaseDownloaderOptions } from './base-downloader';
import type { OSPackageInfo } from './types';

class TestDownloader extends BaseOSDownloader {
  failures: Array<Error | null> = [];

  protected getDownloadUrl(pkg: OSPackageInfo): string {
    return `https://example.test/${pkg.location}`;
  }

  protected getFilename(pkg: OSPackageInfo): string {
    return `${pkg.name}.pkg`;
  }

  protected override async downloadFile(
    _url: string,
    destPath: string,
    _pkg: OSPackageInfo
  ): Promise<void> {
    const nextFailure = this.failures.shift();
    if (nextFailure) {
      throw nextFailure;
    }

    fs.writeFileSync(destPath, 'ok');
  }

  async exposeDownloadFile(url: string, destPath: string, pkg: OSPackageInfo): Promise<void> {
    await super.downloadFile(url, destPath, pkg);
  }
}

describe('BaseOSDownloader', () => {
  const fetchMock = vi.fn();
  let tempDir: string;
  let pkg: OSPackageInfo;

  const createOptions = (overrides: Partial<BaseDownloaderOptions> = {}): BaseDownloaderOptions => ({
    outputDir: tempDir,
    distribution: {
      id: 'rocky-9',
      name: 'Rocky Linux 9',
      version: '9',
      packageManager: 'yum',
      architectures: ['x86_64'],
      defaultRepos: [],
      extendedRepos: [],
    },
    architecture: 'x86_64',
    repositories: [],
    concurrency: 2,
    ...overrides,
  });

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'depssmuggler-downloader-'));
    pkg = {
      name: 'bash',
      version: '5.1',
      architecture: 'x86_64',
      size: 5,
      checksum: { type: 'sha256', value: '' },
      location: 'Packages/bash.rpm',
      repository: {
        id: 'baseos',
        name: 'BaseOS',
        baseUrl: 'https://example.test/repo',
        enabled: true,
        gpgCheck: false,
        isOfficial: true,
      },
      dependencies: [],
    };

    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it('취소 신호가 이미 설정되면 즉시 취소 결과를 반환한다', async () => {
    const controller = new AbortController();
    controller.abort();
    const downloader = new TestDownloader(createOptions({ abortSignal: controller.signal }));

    const result = await downloader.downloadPackage(pkg);

    expect(result.success).toBe(false);
    expect(result.cancelled).toBe(true);
    expect(result.error?.name).toBe('AbortError');
  });

  it('최종 실패 후 onError가 retry를 반환하면 처음부터 다시 시도한다', async () => {
    const downloader = new TestDownloader(
      createOptions({
        onError: vi.fn().mockResolvedValue('retry'),
      })
    );
    (downloader as any).maxRetries = 1;
    (downloader as any).retryDelay = 0;
    downloader.failures = [new Error('network down'), null];

    const result = await downloader.downloadPackage(pkg);

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'bash.pkg'))).toBe(true);
  });

  it('최종 실패 후 onError가 skip을 반환하면 건너뛴 결과를 남긴다', async () => {
    const downloader = new TestDownloader(
      createOptions({
        onError: vi.fn().mockResolvedValue('skip'),
      })
    );
    (downloader as any).maxRetries = 1;
    downloader.failures = [new Error('network down')];

    const result = await downloader.downloadPackage(pkg);

    expect(result.success).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.error?.message).toBe('network down');
  });

  it('응답 본문을 읽을 수 없으면 다운로드를 실패 처리한다', async () => {
    const downloader = new TestDownloader(createOptions());
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-length': '5' }),
      body: null,
    });

    await expect(
      downloader.exposeDownloadFile('https://example.test/bash', path.join(tempDir, 'bash.pkg'), pkg)
    ).rejects.toThrow('Response body is not readable');
  });

  it('스트리밍 다운로드 중 진행률 콜백을 호출하고 파일을 저장한다', async () => {
    const onProgress = vi.fn();
    const downloader = new TestDownloader(createOptions({ onProgress }));
    const destPath = path.join(tempDir, 'streamed.pkg');
    fetchMock.mockResolvedValue(
      new Response('hello', {
        status: 200,
        headers: { 'content-length': '5' },
      })
    );

    await downloader.exposeDownloadFile('https://example.test/bash', destPath, pkg);

    expect(fs.readFileSync(destPath, 'utf-8')).toBe('hello');
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        currentPackage: 'bash',
        bytesDownloaded: 5,
        totalBytes: 5,
        phase: 'downloading',
      })
    );
  });
});
