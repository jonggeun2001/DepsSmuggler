import { describe, expect, it, vi } from 'vitest';
import { createDeliveryPipeline } from './delivery-pipeline';
import { createEmailSenderMock } from '../../../src/core/mailer/__mocks__/email-sender-mock';

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const createBaseParams = () => ({
  outputDir: '/tmp/out',
  options: {
    outputDir: '/tmp/out',
    outputFormat: 'tar.gz' as const,
    includeScripts: false,
    deliveryMethod: 'local' as const,
  },
  deliveredPackages: [
    {
      id: 'pip-requests-2.32.0',
      type: 'pip' as const,
      name: 'requests',
      version: '2.32.0',
    },
  ],
  packageInfos: [
    {
      type: 'pip' as const,
      name: 'requests',
      version: '2.32.0',
    },
  ],
  results: [
    {
      id: 'pip-requests-2.32.0',
      success: true,
    },
  ],
  failedDownloadCount: 0,
});

describe('createDeliveryPipeline', () => {
  it('설치 스크립트 준비를 기다리고 비동기 실패 시 압축하지 않는다', async () => {
    const scriptDeferred = createDeferred<void>();
    const createArchiveFromDirectory = vi.fn();
    const generateInstallScripts = vi.fn(() => scriptDeferred.promise);
    const pipeline = createDeliveryPipeline({
      archivePackager: { createArchiveFromDirectory } as never,
      generateInstallScripts,
      initializeEmailSender: vi.fn() as never,
      getFileSplitter: vi.fn() as never,
      stat: vi.fn() as never,
    });
    const base = createBaseParams();
    const result = pipeline.finalizeDownload({
      ...base,
      options: { ...base.options, includeScripts: true },
      progressEmitter: { emitDownloadStatus: vi.fn() } as never,
      isCancelled: () => false,
    });
    await Promise.resolve();
    expect(createArchiveFromDirectory).not.toHaveBeenCalled();
    scriptDeferred.reject(new Error('missing npm tarball'));
    expect(await result).toMatchObject({ success: false, error: 'missing npm tarball' });
    expect(createArchiveFromDirectory).not.toHaveBeenCalled();
  });

  it('npm 결과 파일 경로와 다운로드 전 루트 선택을 스크립트 생성기로 전달한다', async () => {
    const generateInstallScripts = vi.fn().mockResolvedValue(undefined);
    const pipeline = createDeliveryPipeline({
      archivePackager: { createArchiveFromDirectory: vi.fn().mockResolvedValue('/tmp/out.zip') } as never,
      generateInstallScripts,
      initializeEmailSender: vi.fn() as never,
      getFileSplitter: vi.fn() as never,
      stat: vi.fn() as never,
    });
    const base = createBaseParams();
    const npm = { id: 'npm-is-number', type: 'npm', name: 'is-number', version: '6.0.0' };
    const roots = [{ type: 'npm' as const, name: 'is-odd', version: '3.0.1' }];
    await pipeline.finalizeDownload({
      ...base,
      deliveredPackages: [...base.deliveredPackages, npm],
      results: [...base.results, { id: npm.id, success: true, filePath: '/tmp/out/packages/npm/custom-name.tgz' }],
      options: { ...base.options, includeScripts: true, npmRootPackages: roots },
      progressEmitter: { emitDownloadStatus: vi.fn() } as never,
      isCancelled: () => false,
    });
    expect(generateInstallScripts).toHaveBeenCalledWith('/tmp/out', [...base.deliveredPackages, npm], {
      npmRootPackages: roots,
      npmPackageFiles: [{ filePath: '/tmp/out/packages/npm/custom-name.tgz', relativePath: 'npm/custom-name.tgz' }],
      condaPackageFiles: [],
    });
  });

  it('Conda 결과의 실제 파일 경로를 packages 기준 상대 경로로 스크립트 생성기에 전달한다', async () => {
    const generateInstallScripts = vi.fn().mockResolvedValue(undefined);
    const pipeline = createDeliveryPipeline({
      archivePackager: { createArchiveFromDirectory: vi.fn().mockResolvedValue('/tmp/out.zip') } as never,
      generateInstallScripts,
      initializeEmailSender: vi.fn() as never,
      getFileSplitter: vi.fn() as never,
      stat: vi.fn() as never,
    });
    const base = createBaseParams();
    const conda = { id: 'conda-six', type: 'conda', name: 'six', version: '1.16.0' };
    await pipeline.finalizeDownload({
      ...base,
      deliveredPackages: [...base.deliveredPackages, conda],
      results: [...base.results, { id: conda.id, success: true, filePath: '/tmp/out/packages/conda/six-1.16.0-0.tar.bz2' }],
      options: { ...base.options, includeScripts: true },
      progressEmitter: { emitDownloadStatus: vi.fn() } as never,
      isCancelled: () => false,
    });

    expect(generateInstallScripts).toHaveBeenCalledWith('/tmp/out', [...base.deliveredPackages, conda], {
      npmPackageFiles: [],
      npmRootPackages: undefined,
      condaPackageFiles: [{ relativePath: 'conda/six-1.16.0-0.tar.bz2' }],
    });
  });

  it('Conda 성공 결과에 실제 파일 경로가 없으면 스크립트와 아카이브를 만들지 않는다', async () => {
    const generateInstallScripts = vi.fn().mockResolvedValue(undefined);
    const createArchiveFromDirectory = vi.fn().mockResolvedValue('/tmp/out.zip');
    const pipeline = createDeliveryPipeline({
      archivePackager: { createArchiveFromDirectory } as never,
      generateInstallScripts,
      initializeEmailSender: vi.fn() as never,
      getFileSplitter: vi.fn() as never,
      stat: vi.fn() as never,
    });
    const base = createBaseParams();
    const conda = { id: 'conda-six', type: 'conda', name: 'six', version: '1.16.0' };
    const result = await pipeline.finalizeDownload({
      ...base,
      deliveredPackages: [...base.deliveredPackages, conda],
      results: [...base.results, { id: conda.id, success: true }],
      options: { ...base.options, includeScripts: true },
      progressEmitter: { emitDownloadStatus: vi.fn() } as never,
      isCancelled: () => false,
    });

    expect(result).toMatchObject({ success: false, error: 'Conda 패키지 파일 경로가 없습니다: six@1.16.0' });
    expect(generateInstallScripts).not.toHaveBeenCalled();
    expect(createArchiveFromDirectory).not.toHaveBeenCalled();
  });

  it('지원하지 않는 출력 형식이면 실패 payload를 반환해야 함', async () => {
    const archivePackager = {
      createArchiveFromDirectory: vi.fn(),
    };
    const pipeline = createDeliveryPipeline({
      archivePackager: archivePackager as never,
      generateInstallScripts: vi.fn(),
      initializeEmailSender: vi.fn() as never,
      getFileSplitter: vi.fn() as never,
      stat: vi.fn() as never,
    });

    const completionPayload = await pipeline.finalizeDownload({
      ...createBaseParams(),
      options: {
        outputDir: '/tmp/out',
        outputFormat: 'raw' as never,
        includeScripts: false,
        deliveryMethod: 'local',
      },
      progressEmitter: {
        emitDownloadStatus: vi.fn(),
      } as never,
      isCancelled: () => false,
    });

    expect(completionPayload).toEqual(
      expect.objectContaining({
        success: false,
        outputPath: '/tmp/out',
        error: '지원하지 않는 출력 형식입니다: raw',
      })
    );
    expect(archivePackager.createArchiveFromDirectory).not.toHaveBeenCalled();
  });

  it('이메일 전달 준비 중 취소되면 sendEmail 없이 cancelled payload를 반환해야 함', async () => {
    const statDeferred = createDeferred<{ size: number }>();
    const sendEmail = vi.fn();
    const progressEmitter = {
      emitDownloadStatus: vi.fn(),
    };
    let cancelled = false;

    const pipeline = createDeliveryPipeline({
      archivePackager: {
        createArchiveFromDirectory: vi.fn().mockResolvedValue('/tmp/out.tar.gz'),
      } as never,
      generateInstallScripts: vi.fn(),
      initializeEmailSender: vi.fn(() => createEmailSenderMock({ sendEmail })) as never,
      getFileSplitter: vi.fn() as never,
      stat: vi.fn().mockImplementation(async () => statDeferred.promise as never),
    });

    const completionPromise = pipeline.finalizeDownload({
      ...createBaseParams(),
      options: {
        outputDir: '/tmp/out',
        outputFormat: 'tar.gz',
        includeScripts: false,
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
      progressEmitter: progressEmitter as never,
      isCancelled: () => cancelled,
    });

    await vi.waitFor(() => {
      expect(progressEmitter.emitDownloadStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: 'packaging',
          message: '이메일 전달 준비 중...',
        })
      );
    });

    cancelled = true;
    statDeferred.resolve({ size: 1024 });

    const completionPayload = await completionPromise;

    expect(progressEmitter.emitDownloadStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'packaging',
        message: '이메일 전달 준비 중...',
      })
    );
    expect(sendEmail).not.toHaveBeenCalled();
    expect(completionPayload).toEqual(
      expect.objectContaining({
        success: false,
        cancelled: true,
        outputPath: '/tmp/out.tar.gz',
        artifactPaths: ['/tmp/out.tar.gz'],
        deliveryMethod: 'email',
      })
    );
  });

  it('분할 후 이메일 전달에 성공하면 분할 산출물과 deliveryResult를 반환해야 함', async () => {
    const sendEmail = vi.fn().mockResolvedValue({
      success: true,
      emailsSent: 1,
      attachmentsSent: 4,
      splitApplied: true,
    });
    const splitArtifacts = [
      '/tmp/out.tar.gz.001',
      '/tmp/out.tar.gz.002',
      '/tmp/out.tar.gz.metadata.json',
      '/tmp/out.merge.sh',
    ];
    const pipeline = createDeliveryPipeline({
      archivePackager: {
        createArchiveFromDirectory: vi.fn().mockResolvedValue('/tmp/out.tar.gz'),
      } as never,
      generateInstallScripts: vi.fn(),
      initializeEmailSender: vi.fn(() => createEmailSenderMock({ sendEmail })) as never,
      getFileSplitter: vi.fn(() => ({
        splitFile: vi.fn().mockResolvedValue({
          parts: splitArtifacts.slice(0, 2),
          metadataPath: splitArtifacts[2],
          mergeScripts: {
            bash: splitArtifacts[3],
          },
        }),
      })) as never,
      stat: vi.fn().mockResolvedValue({ size: 20 * 1024 * 1024 } as never),
    });

    const completionPayload = await pipeline.finalizeDownload({
      ...createBaseParams(),
      options: {
        outputDir: '/tmp/out',
        outputFormat: 'tar.gz',
        includeScripts: false,
        deliveryMethod: 'email',
        email: {
          to: 'offline@example.com',
          subject: 'offline bundle',
        },
        fileSplit: {
          enabled: true,
          maxSizeMB: 10,
        },
        smtp: {
          host: 'smtp.example.com',
          port: 587,
          user: 'sender@example.com',
        },
      },
      progressEmitter: {
        emitDownloadStatus: vi.fn(),
      } as never,
      isCancelled: () => false,
    });

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: splitArtifacts,
        subject: 'offline bundle',
      })
    );
    expect(completionPayload).toEqual(
      expect.objectContaining({
        success: true,
        outputPath: '/tmp/out.tar.gz.001',
        artifactPaths: splitArtifacts,
        deliveryMethod: 'email',
        deliveryResult: expect.objectContaining({
          emailSent: true,
          emailsSent: 1,
          attachmentsSent: 4,
          splitApplied: true,
        }),
      })
    );
  });
});
