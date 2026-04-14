import * as path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { createEmailSenderMock } from '../../src/core/mailer/__mocks__/email-sender-mock';

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
  const createArchivePackagerMock = () => ({
    createArchiveFromDirectory: vi.fn().mockImplementation(
      async (_sourceDir: string, outputPath: string) => outputPath
    ),
  });

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
    const archivePackager = createArchivePackagerMock();
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
      sessionId: 101,
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
    expect(progressEmitter.emitDownloadStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 101,
        phase: 'downloading',
      })
    );
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
        sessionId: 101,
        success: true,
        outputPath: '/tmp/out.tar.gz',
        results: [
          { id: 'pip-requests-2.28.0', success: true },
          { id: 'pip-urllib3-2.1.0', success: false, error: 'network failed' },
        ],
      })
    );
  });

  it('zip 출력 형식도 outputDir 기반 아카이브 경로로 패키징한다', async () => {
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
    };
    const archivePackager = createArchivePackagerMock();
    const outputDir = '/tmp/out-zip';
    const expectedArchivePath = `${outputDir}.zip`;

    const orchestrator = createDownloadOrchestrator({
      getMainWindow: () => null,
      ensureDir: vi.fn().mockResolvedValue(undefined),
      scheduleTask: async (task: () => Promise<void>) => {
        await task();
      },
      createLimiter: () => ((task: () => Promise<unknown>) => task()),
      createPackageRouter: () => router,
      createProgressEmitter: () => progressEmitter as never,
      archivePackager,
      generateInstallScripts: vi.fn(),
    });

    await orchestrator.startDownload({
      sessionId: 111,
      packages: [
        {
          id: 'pip-requests-2.28.0',
          type: 'pip',
          name: 'requests',
          version: '2.28.0',
        },
      ],
      options: {
        outputDir,
        outputFormat: 'zip',
        includeScripts: false,
        concurrency: 1,
      },
    });

    expect(archivePackager.createArchiveFromDirectory).toHaveBeenCalledWith(
      outputDir,
      expectedArchivePath,
      [
        expect.objectContaining({
          type: 'pip',
          name: 'requests',
          version: '2.28.0',
        }),
      ],
      expect.objectContaining({
        format: 'zip',
      })
    );
    expect(progressEmitter.emitAllComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 111,
        success: true,
        outputPath: expectedArchivePath,
        artifactPaths: [expectedArchivePath],
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
    const archivePackager = createArchivePackagerMock();
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
      initializeEmailSender: (vi.fn(() => createEmailSenderMock({ sendEmail }))) as never,
    });

    const result = await orchestrator.startDownload({
      sessionId: 202,
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
        sessionId: 202,
        success: false,
        cancelled: true,
        outputPath: '/tmp/out.tar.gz',
        artifactPaths: ['/tmp/out.tar.gz'],
      })
    );
  });

  it('이메일 전송 중 취소되면 성공 대신 cancelled 완료 이벤트를 만든다', async () => {
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
    const sendEmailDeferred = createDeferred<{
      success: boolean;
      emailsSent: number;
      attachmentsSent: number;
      splitApplied: boolean;
    }>();
    let backgroundTask!: Promise<void>;

    const orchestrator = createDownloadOrchestrator({
      getMainWindow: () => null,
      ensureDir: vi.fn().mockResolvedValue(undefined),
      stat: vi.fn().mockResolvedValue({ size: 1024 } as never),
      scheduleTask: (task: () => Promise<void>) => {
        backgroundTask = task();
      },
      createLimiter: () => ((task: () => Promise<unknown>) => task()),
      createPackageRouter: () => router,
      createProgressEmitter: () => progressEmitter as never,
      archivePackager: createArchivePackagerMock() as never,
      generateInstallScripts: vi.fn(),
      initializeEmailSender: (vi.fn(() =>
        createEmailSenderMock({
          sendEmail: vi.fn().mockImplementation(() => sendEmailDeferred.promise),
        })
      )) as never,
    });

    const result = await orchestrator.startDownload({
      sessionId: 303,
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
      expect(progressEmitter.emitDownloadStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 303,
          message: '이메일 전달 준비 중...',
        })
      );
    });

    await orchestrator.cancelDownload();
    sendEmailDeferred.resolve({
      success: true,
      emailsSent: 1,
      attachmentsSent: 1,
      splitApplied: false,
    });
    await backgroundTask;

    expect(progressEmitter.emitAllComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 303,
        success: false,
        cancelled: true,
        outputPath: '/tmp/out.tar.gz',
        artifactPaths: ['/tmp/out.tar.gz'],
      })
    );
    expect(progressEmitter.emitAllComplete).not.toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 303,
        success: true,
      })
    );
  });

  it('새 세션이 시작돼도 이전 취소 세션은 취소 상태를 유지한다', async () => {
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
    const archiveDeferred = createDeferred<string>();
    const backgroundTasks: Promise<void>[] = [];

    const orchestrator = createDownloadOrchestrator({
      getMainWindow: () => null,
      ensureDir: vi.fn().mockResolvedValue(undefined),
      scheduleTask: (task: () => Promise<void>) => {
        backgroundTasks.push(task());
      },
      createLimiter: () => ((task: () => Promise<unknown>) => task()),
      createPackageRouter: () => router,
      createProgressEmitter: () => progressEmitter as never,
      archivePackager: {
        createArchiveFromDirectory: vi
          .fn()
          .mockImplementationOnce(async () => archiveDeferred.promise)
          .mockResolvedValueOnce('/tmp/out-2.tar.gz'),
      } as never,
      generateInstallScripts: vi.fn(),
    });

    await orchestrator.startDownload({
      sessionId: 1,
      packages: [
        {
          id: 'pip-requests-2.28.0',
          type: 'pip',
          name: 'requests',
          version: '2.28.0',
        },
      ],
      options: {
        outputDir: '/tmp/out-1',
        outputFormat: 'tar.gz',
        includeScripts: false,
        concurrency: 1,
      },
    });

    await vi.waitFor(() => {
      expect(router.downloadPackage).toHaveBeenCalledTimes(1);
    });

    await orchestrator.cancelDownload();

    await orchestrator.startDownload({
      sessionId: 2,
      packages: [
        {
          id: 'pip-requests-2.28.0',
          type: 'pip',
          name: 'requests',
          version: '2.28.0',
        },
      ],
      options: {
        outputDir: '/tmp/out-2',
        outputFormat: 'tar.gz',
        includeScripts: false,
        concurrency: 1,
      },
    });

    archiveDeferred.resolve('/tmp/out-1.tar.gz');
    await Promise.all(backgroundTasks);

    expect(progressEmitter.emitAllComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 1,
        success: false,
        cancelled: true,
        outputPath: '/tmp/out-1.tar.gz',
        artifactPaths: ['/tmp/out-1.tar.gz'],
      })
    );
    expect(progressEmitter.emitAllComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 2,
        success: true,
        outputPath: '/tmp/out-2.tar.gz',
      })
    );
  });
});
