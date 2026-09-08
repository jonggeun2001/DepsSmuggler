import * as path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { createDownloadSessionRunner } from './download-session';

const logError = vi.hoisted(() => vi.fn());
vi.mock('../../utils/logger', () => ({ createScopedLogger: () => ({ error: logError }) }));

describe('createDownloadSessionRunner', () => {
  it('초기 limiter 생성 실패도 실패 완료 이벤트와 로그를 남긴다', async () => {
    const emitAllComplete = vi.fn();
    const ensureDir = vi.fn();
    const runner = createDownloadSessionRunner({
      ensureDir,
      createLimiter: () => { throw new Error('limiter failed'); },
      packageRouter: { downloadPackage: vi.fn() },
      deliveryPipeline: { finalizeDownload: vi.fn() },
    });
    await expect(runner.run({
      packages: [{ id: 'p', type: 'pip', name: 'requests', version: '1' }],
      options: { outputDir: '/tmp/out', outputFormat: 'zip', includeScripts: false },
    }, { emitAllComplete } as never, {
      isCancelled: () => false, isPaused: () => false, waitWhilePaused: async () => undefined,
    })).resolves.toBeUndefined();
    expect(emitAllComplete).toHaveBeenCalledWith({ success: false, outputPath: '/tmp/out', error: 'limiter failed' });
    expect(logError).toHaveBeenCalled();
    expect(ensureDir).not.toHaveBeenCalled();
  });

  it('성공한 패키지만 DeliveryPipeline으로 넘기고 completion payload를 emit해야 함', async () => {
    const ensureDir = vi.fn().mockResolvedValue(undefined);
    const limit = vi.fn(async (task: () => Promise<unknown>) => task());
    const createLimiter = vi.fn(() => limit);
    const packageRouter = {
      downloadPackage: vi
        .fn()
        .mockResolvedValueOnce({ id: 'pip-requests-2.32.0', success: true })
        .mockResolvedValueOnce({ id: 'pip-urllib3-2.1.0', success: false, error: 'network failed' }),
    };
    const deliveryPipeline = {
      finalizeDownload: vi.fn().mockResolvedValue({
        success: true,
        outputPath: '/tmp/out.tar.gz',
        artifactPaths: ['/tmp/out.tar.gz'],
      }),
    };
    const progressEmitter = {
      emitAllComplete: vi.fn(),
    };

    const runner = createDownloadSessionRunner({
      ensureDir,
      createLimiter,
      packageRouter: packageRouter as never,
      deliveryPipeline: deliveryPipeline as never,
    });

    await runner.run(
      {
        packages: [
          {
            id: 'pip-requests-2.32.0',
            type: 'pip',
            name: 'requests',
            version: '2.32.0',
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
          includeScripts: false,
          concurrency: 4,
        },
      },
      progressEmitter as never,
      {
        isCancelled: () => false,
        isPaused: () => false,
        waitWhilePaused: async () => undefined,
      }
    );

    expect(ensureDir).toHaveBeenCalledWith(path.join('/tmp/out', 'packages'));
    expect(createLimiter).toHaveBeenCalledWith(4);
    expect(limit).toHaveBeenCalledTimes(2);
    expect(deliveryPipeline.finalizeDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        outputDir: '/tmp/out',
        deliveredPackages: [
          expect.objectContaining({
            id: 'pip-requests-2.32.0',
          }),
        ],
        failedDownloadCount: 1,
      })
    );
    expect(progressEmitter.emitAllComplete).toHaveBeenCalledWith({
      success: true,
      outputPath: '/tmp/out.tar.gz',
      artifactPaths: ['/tmp/out.tar.gz'],
    });
  });

  it('다운로드 이후 세션이 취소되면 DeliveryPipeline 없이 cancelled 완료 이벤트를 emit해야 함', async () => {
    let cancelled = false;
    const deliveryPipeline = {
      finalizeDownload: vi.fn(),
    };
    const progressEmitter = {
      emitAllComplete: vi.fn(),
    };

    const runner = createDownloadSessionRunner({
      ensureDir: vi.fn().mockResolvedValue(undefined),
      createLimiter: () => (async (task: () => Promise<unknown>) => task()) as never,
      packageRouter: {
        downloadPackage: vi.fn().mockImplementation(async () => {
          cancelled = true;
          return { id: 'pip-requests-2.32.0', success: true };
        }),
      } as never,
      deliveryPipeline: deliveryPipeline as never,
    });

    await runner.run(
      {
        packages: [
          {
            id: 'pip-requests-2.32.0',
            type: 'pip',
            name: 'requests',
            version: '2.32.0',
          },
        ],
        options: {
          outputDir: '/tmp/out',
          outputFormat: 'tar.gz',
          includeScripts: false,
          concurrency: 1,
        },
      },
      progressEmitter as never,
      {
        isCancelled: () => cancelled,
        isPaused: () => false,
        waitWhilePaused: async () => undefined,
      }
    );

    expect(deliveryPipeline.finalizeDownload).not.toHaveBeenCalled();
    expect(progressEmitter.emitAllComplete).toHaveBeenCalledWith({
      success: false,
      cancelled: true,
      outputPath: '/tmp/out',
      artifactPaths: undefined,
    });
  });
});
