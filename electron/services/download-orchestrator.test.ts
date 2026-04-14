import * as path from 'path';
import { describe, expect, it, vi } from 'vitest';

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('createDownloadOrchestrator', () => {
  it('성공한 패키지만 패키징 대상으로 모아 완료 이벤트를 만든다', async () => {
    const { createDownloadOrchestrator } = await import('./download-orchestrator');

    const router = {
      downloadPackage: vi
        .fn()
        .mockResolvedValueOnce({ id: 'pip-requests-2.28.0', success: true })
        .mockResolvedValueOnce({ id: 'pip-urllib3-2.1.0', success: false, error: 'network failed' }),
    };
    const progressEmitter = {
      emitDownloadStatus: vi.fn(),
      emitAllComplete: vi.fn(),
    };
    const archivePackager = {
      createArchiveFromDirectory: vi.fn().mockResolvedValue('/tmp/out.tar.gz'),
    };
    const generateInstallScripts = vi.fn();
    const ensureDir = vi.fn().mockResolvedValue(undefined);

    const orchestrator = createDownloadOrchestrator({
      getMainWindow: () => null,
      ensureDir,
      scheduleTask: async (task: () => Promise<void>) => {
        await task();
      },
      createLimiter: () => ((task: () => Promise<unknown>) => task()),
      createPackageRouter: () => router,
      createProgressEmitter: () => progressEmitter as never,
      archivePackager,
      generateInstallScripts,
    });

    const result = await orchestrator.startDownload({
      packages: [
        {
          id: 'pip-requests-2.28.0',
          type: 'pip',
          name: 'requests',
          version: '2.28.0',
        },
        {
          id: 'pip-urllib3-2.1.0',
          type: 'pip',
          name: 'urllib3',
          version: '2.1.0',
        },
      ],
      options: {
        outputDir: '/tmp/out',
        outputFormat: 'tar.gz',
        includeScripts: true,
        concurrency: 1,
      },
    });

    expect(result).toEqual({ success: true, started: true });
    expect(ensureDir).toHaveBeenCalledWith(path.join('/tmp/out', 'packages'));
    expect(generateInstallScripts).toHaveBeenCalledWith('/tmp/out', [
      expect.objectContaining({
        id: 'pip-requests-2.28.0',
        name: 'requests',
      }),
    ]);
    expect(archivePackager.createArchiveFromDirectory).toHaveBeenCalledWith(
      '/tmp/out',
      '/tmp/out.tar.gz',
      [
        expect.objectContaining({
          type: 'pip',
          name: 'requests',
          version: '2.28.0',
        }),
      ],
      expect.objectContaining({
        format: 'tar.gz',
      })
    );
    expect(progressEmitter.emitAllComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        outputPath: '/tmp/out.tar.gz',
        results: [
          { id: 'pip-requests-2.28.0', success: true },
          { id: 'pip-urllib3-2.1.0', success: false, error: 'network failed' },
        ],
      })
    );
  });

  it('이메일 전달 준비 중 취소되면 sendEmail 없이 cancelled 완료 이벤트를 만든다', async () => {
    const { createDownloadOrchestrator } = await import('./download-orchestrator');

    const router = {
      downloadPackage: vi.fn().mockResolvedValue({
        id: 'pip-requests-2.28.0',
        success: true,
      }),
    };
    const progressEmitter = {
      emitDownloadStatus: vi.fn(),
      emitAllComplete: vi.fn(),
      clearAllPackageProgress: vi.fn(),
    };
    const archivePackager = {
      createArchiveFromDirectory: vi.fn().mockResolvedValue('/tmp/out.tar.gz'),
    };
    const generateInstallScripts = vi.fn();
    const ensureDir = vi.fn().mockResolvedValue(undefined);
    const statDeferred = createDeferred<{ size: number }>();
    const sendEmail = vi.fn();
    let backgroundTask!: Promise<void>;

    const orchestrator = createDownloadOrchestrator({
      getMainWindow: () => null,
      ensureDir,
      stat: vi.fn().mockImplementation(async () => statDeferred.promise as never),
      scheduleTask: (task: () => Promise<void>) => {
        backgroundTask = task();
      },
      createLimiter: () => ((task: () => Promise<unknown>) => task()),
      createPackageRouter: () => router,
      createProgressEmitter: () => progressEmitter as never,
      archivePackager,
      generateInstallScripts,
      initializeEmailSender: vi.fn(() => ({
        sendEmail,
      })) as never,
    });

    const result = await orchestrator.startDownload({
      packages: [
        {
          id: 'pip-requests-2.28.0',
          type: 'pip',
          name: 'requests',
          version: '2.28.0',
        },
      ],
      options: {
        outputDir: '/tmp/out',
        outputFormat: 'tar.gz',
        includeScripts: false,
        concurrency: 1,
        deliveryMethod: 'email',
        email: {
          to: 'offline@example.com',
        },
        fileSplit: {
          enabled: false,
          maxSizeMB: 10,
        },
        smtp: {
          host: 'smtp.example.com',
          port: 587,
          user: 'sender@example.com',
        },
      },
    });

    expect(result).toEqual({ success: true, started: true });

    await vi.waitFor(() => {
      expect(archivePackager.createArchiveFromDirectory).toHaveBeenCalled();
    });

    await orchestrator.cancelDownload();
    statDeferred.resolve({ size: 1024 });
    await backgroundTask;

    expect(sendEmail).not.toHaveBeenCalled();
    expect(progressEmitter.emitAllComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        cancelled: true,
        outputPath: '/tmp/out.tar.gz',
        artifactPaths: ['/tmp/out.tar.gz'],
      })
    );
  });
});
