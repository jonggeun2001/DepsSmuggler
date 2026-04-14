import { describe, expect, it, vi } from 'vitest';

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
    expect(ensureDir).toHaveBeenCalledWith('/tmp/out/packages');
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
});
