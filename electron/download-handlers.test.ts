import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { registerDownloadHandlers } from './download-handlers';
import type { OSPackageInfo, OSDistribution } from '../src/core/downloaders/os-shared/types';

const {
  ipcHandle,
  webContentsSend,
  showOpenDialog,
  showMessageBox,
  getPyPIDownloadUrlMock,
  downloadFileMock,
  generateInstallScriptsMock,
  createZipArchiveMock,
  createArchiveFromDirectoryMock,
  initializeEmailSenderMock,
  sendEmailMock,
  getFileSplitterMock,
  splitFileMock,
  yumDownloadPackage,
  yumResolveDependencies,
  archiveCreateArchive,
  repoCreateLocalRepo,
  generateDependencyOrderScriptMock,
} = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  webContentsSend: vi.fn(),
  showOpenDialog: vi.fn(),
  showMessageBox: vi.fn(),
  getPyPIDownloadUrlMock: vi.fn(),
  downloadFileMock: vi.fn(),
  generateInstallScriptsMock: vi.fn(),
  createZipArchiveMock: vi.fn(),
  createArchiveFromDirectoryMock: vi.fn(),
  initializeEmailSenderMock: vi.fn(),
  sendEmailMock: vi.fn(),
  getFileSplitterMock: vi.fn(),
  splitFileMock: vi.fn(),
  yumDownloadPackage: vi.fn(),
  yumResolveDependencies: vi.fn(),
  archiveCreateArchive: vi.fn(),
  repoCreateLocalRepo: vi.fn(),
  generateDependencyOrderScriptMock: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcHandle,
  },
  dialog: {
    showOpenDialog,
    showMessageBox,
  },
  BrowserWindow: class {},
}));

vi.mock('./utils/logger', () => ({
  createScopedLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('../src/core/shared', () => ({
  getPyPIDownloadUrl: getPyPIDownloadUrlMock,
  downloadFile: downloadFileMock,
  createZipArchive: createZipArchiveMock,
  generateInstallScripts: generateInstallScriptsMock,
}));

vi.mock('../src/core', () => ({
  getCondaDownloader: vi.fn(),
  getMavenDownloader: vi.fn(),
  getDockerDownloader: vi.fn(),
  getNpmDownloader: vi.fn(),
  getYumDownloader: vi.fn(() => ({
    downloadPackage: yumDownloadPackage,
  })),
  getAptDownloader: vi.fn(),
  getApkDownloader: vi.fn(),
  getYumResolver: vi.fn(() => ({
    resolveDependencies: yumResolveDependencies,
  })),
  getAptResolver: vi.fn(),
  getApkResolver: vi.fn(),
}));

vi.mock('../src/core/packager/archive-packager', () => ({
  getArchivePackager: vi.fn(() => ({
    createArchiveFromDirectory: createArchiveFromDirectoryMock,
  })),
}));

vi.mock('../src/core/mailer/email-sender', () => ({
  initializeEmailSender: initializeEmailSenderMock,
}));

vi.mock('../src/core/packager/file-splitter', () => ({
  getFileSplitter: getFileSplitterMock,
}));

vi.mock('../src/core/downloaders/os-shared/archive-packager', () => ({
  OSArchivePackager: vi.fn(class MockOSArchivePackager {
    createArchive = archiveCreateArchive;
  }),
}));

vi.mock('../src/core/downloaders/os-shared/repo-packager', () => ({
  OSRepoPackager: vi.fn(class MockOSRepoPackager {
    createLocalRepo = repoCreateLocalRepo;
  }),
}));

vi.mock('../src/core/downloaders/os-shared/script-generator', () => ({
  OSScriptGenerator: vi.fn(class MockOSScriptGenerator {
    generateDependencyOrderScript = generateDependencyOrderScriptMock;
    generateLocalRepoScript = vi.fn(() => ({
      bash: '#!/bin/bash\necho setup repo\n',
      powershell: 'Write-Host "setup repo"\n',
    }));
  }),
}));

const waitForExpectation = async (assertion: () => void, timeoutMs = 2000): Promise<void> => {
  const startTime = Date.now();
  let lastError: unknown;

  while (Date.now() - startTime < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  throw lastError;
};

describe('registerDownloadHandlers', () => {
  let tempDir: string;
  const distribution: OSDistribution = {
    id: 'rocky-9',
    name: 'Rocky Linux 9',
    version: '9',
    packageManager: 'yum',
    architectures: ['x86_64'],
    defaultRepos: [],
    extendedRepos: [],
  };
  const rootPackage: OSPackageInfo = {
    name: 'bash',
    version: '5.1.8',
    architecture: 'x86_64',
    size: 1234,
    checksum: { type: 'sha256', value: 'abc123' },
    location: 'Packages/bash-5.1.8.rpm',
    repository: {
      id: 'baseos',
      name: 'BaseOS',
      baseUrl: 'https://mirror.example.com/baseos',
      packageManager: 'yum',
      isOfficial: true,
      priority: 1,
      enabled: true,
      gpgCheck: true,
    },
    dependencies: [],
  };
  const dependencyPackage: OSPackageInfo = {
    ...rootPackage,
    name: 'glibc',
    version: '2.34',
    location: 'Packages/glibc-2.34.rpm',
  };
  const osOutputDir = '/tmp/depssmuggler-os-downloads';

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = path.join(os.tmpdir(), `download-handler-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.remove(osOutputDir);

    showOpenDialog.mockResolvedValue({
      canceled: true,
      filePaths: [],
    });
    showMessageBox.mockResolvedValue({
      response: 1,
    });

    getPyPIDownloadUrlMock.mockResolvedValue({
      url: 'https://example.com/requests-2.28.0.whl',
      filename: 'requests-2.28.0.whl',
    });
    downloadFileMock.mockResolvedValue(undefined);
    generateInstallScriptsMock.mockResolvedValue(undefined);
    createZipArchiveMock.mockResolvedValue(undefined);
    createArchiveFromDirectoryMock.mockImplementation(async (_sourceDir: string, outputPath: string) => {
      await fs.ensureDir(path.dirname(outputPath));
      await fs.writeFile(outputPath, Buffer.alloc(1024));
      return outputPath;
    });
    sendEmailMock.mockResolvedValue({
      success: true,
      messageId: 'mail-1',
      emailsSent: 1,
      attachmentsSent: 1,
      splitApplied: false,
    });
    initializeEmailSenderMock.mockReturnValue({
      sendEmail: sendEmailMock,
      testConnection: vi.fn(),
    });
    splitFileMock.mockResolvedValue({
      parts: [
        path.join(tempDir, 'bundle.tar.gz.part001'),
        path.join(tempDir, 'bundle.tar.gz.part002'),
      ],
      metadataPath: path.join(tempDir, 'bundle.tar.gz.meta.json'),
      metadata: {
        originalFileName: 'bundle.tar.gz',
        originalSize: 2048,
        partCount: 2,
        partSize: 1024,
        checksum: 'abc',
        createdAt: new Date().toISOString(),
      },
      mergeScripts: {
        bash: path.join(tempDir, 'merge.sh'),
        powershell: path.join(tempDir, 'merge.ps1'),
      },
    });
    getFileSplitterMock.mockReturnValue({
      splitFile: splitFileMock,
    });
    yumDownloadPackage.mockResolvedValueOnce({
      success: true,
      filePath: '/tmp/bash-5.1.8.rpm',
    });
    yumDownloadPackage.mockResolvedValueOnce({
      success: true,
      filePath: '/tmp/glibc-2.34.rpm',
    });
    yumResolveDependencies.mockResolvedValue({
      packages: [rootPackage, dependencyPackage],
      unresolved: [],
      conflicts: [],
      warnings: [],
    });
    archiveCreateArchive.mockResolvedValue(`${osOutputDir}/os-packages.zip`);
    repoCreateLocalRepo.mockImplementation(
      async (
        _packages: OSPackageInfo[],
        _downloadedFiles: Map<string, string>,
        options: { outputPath: string }
      ) => {
        await fs.ensureDir(options.outputPath);
        return {
          repoPath: options.outputPath,
          packageCount: 2,
          totalSize: 4321,
          metadataFiles: [`${options.outputPath}/repodata/repomd.xml`],
        };
      }
    );
    generateDependencyOrderScriptMock.mockReturnValue({
      bash: '#!/bin/bash\necho install\n',
      powershell: 'Write-Host "install"\n',
    });
  });

  it('tar.gz 선택 시 공통 아카이브 패키저를 사용하고 실제 산출물 경로를 완료 이벤트에 담아야 함', async () => {
    registerDownloadHandlers(() => ({
      webContents: {
        send: webContentsSend,
      },
    }) as never);

    const downloadStartHandler = ipcHandle.mock.calls.find(
      ([channel]) => channel === 'download:start'
    )?.[1];

    expect(downloadStartHandler).toBeTypeOf('function');

    const outputDir = '/tmp/depssmuggler-gui-output';
    const expectedArchivePath = `${outputDir}.tar.gz`;

    await downloadStartHandler(
      {},
      {
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
          outputFormat: 'tar.gz',
          includeScripts: true,
          concurrency: 1,
        },
      }
    );

    await waitForExpectation(() => {
      expect(createArchiveFromDirectoryMock).toHaveBeenCalledWith(
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
          format: 'tar.gz',
        })
      );
    });

    await waitForExpectation(() => {
      expect(webContentsSend).toHaveBeenCalledWith(
        'download:all-complete',
        expect.objectContaining({
          success: true,
          outputPath: expectedArchivePath,
          artifactPaths: [expectedArchivePath],
          deliveryMethod: 'local',
          results: [
            {
              id: 'pip-requests-2.28.0',
              success: true,
            },
          ],
        })
      );
    });
    expect(initializeEmailSenderMock).not.toHaveBeenCalled();
  });

  it('zip 선택 시에도 완료 이벤트가 디렉터리가 아닌 실제 아카이브 파일 경로를 반영해야 함', async () => {
    registerDownloadHandlers(() => ({
      webContents: {
        send: webContentsSend,
      },
    }) as never);

    const downloadStartHandler = ipcHandle.mock.calls.find(
      ([channel]) => channel === 'download:start'
    )?.[1];

    expect(downloadStartHandler).toBeTypeOf('function');

    const outputDir = '/tmp/depssmuggler-gui-output-zip';
    const expectedArchivePath = `${outputDir}.zip`;

    await downloadStartHandler(
      {},
      {
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
      }
    );

    await waitForExpectation(() => {
      expect(webContentsSend).toHaveBeenCalledWith(
        'download:all-complete',
        expect.objectContaining({
          success: true,
          outputPath: expectedArchivePath,
          artifactPaths: [expectedArchivePath],
          deliveryMethod: 'local',
          results: [
            {
              id: 'pip-requests-2.28.0',
              success: true,
            },
          ],
        })
      );
    });
    expect(initializeEmailSenderMock).not.toHaveBeenCalled();
  });

  it('아카이브 생성이 실패하면 성공 완료 이벤트 대신 실패 이벤트를 보내야 함', async () => {
    createArchiveFromDirectoryMock.mockRejectedValueOnce(new Error('archive failed'));

    registerDownloadHandlers(() => ({
      webContents: {
        send: webContentsSend,
      },
    }) as never);

    const downloadStartHandler = ipcHandle.mock.calls.find(
      ([channel]) => channel === 'download:start'
    )?.[1];

    expect(downloadStartHandler).toBeTypeOf('function');

    const outputDir = '/tmp/depssmuggler-gui-output-failure';

    await downloadStartHandler(
      {},
      {
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
          outputFormat: 'tar.gz',
          includeScripts: false,
          concurrency: 1,
        },
      }
    );

    await waitForExpectation(() => {
      expect(webContentsSend).toHaveBeenCalledWith('download:all-complete', {
        success: false,
        outputPath: outputDir,
        error: 'archive failed',
      });
    });
    expect(webContentsSend).not.toHaveBeenCalledWith('download:all-complete', {
      success: true,
      outputPath: `${outputDir}.tar.gz`,
      results: expect.any(Array),
    });
  });

  it('지원하지 않는 출력 형식은 조용히 성공시키지 말고 실패로 처리해야 함', async () => {
    registerDownloadHandlers(() => ({
      webContents: {
        send: webContentsSend,
      },
    }) as never);

    const downloadStartHandler = ipcHandle.mock.calls.find(
      ([channel]) => channel === 'download:start'
    )?.[1];

    expect(downloadStartHandler).toBeTypeOf('function');

    const outputDir = '/tmp/depssmuggler-gui-output-legacy';

    await downloadStartHandler(
      {},
      {
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
          outputFormat: 'archive',
          includeScripts: false,
          concurrency: 1,
        },
      }
    );

    await waitForExpectation(() => {
      expect(webContentsSend).toHaveBeenCalledWith('download:all-complete', {
        success: false,
        outputPath: outputDir,
        error: '지원하지 않는 출력 형식입니다: archive',
      });
    });
    expect(createArchiveFromDirectoryMock).not.toHaveBeenCalled();
  });

  it('email 전달 선택 시 패키징 뒤 메일을 발송하고 완료 이벤트에 전달 메타데이터를 담아야 함', async () => {
    registerDownloadHandlers(() => ({
      webContents: {
        send: webContentsSend,
      },
    }) as never);

    const downloadStartHandler = ipcHandle.mock.calls.find(
      ([channel]) => channel === 'download:start'
    )?.[1];

    expect(downloadStartHandler).toBeTypeOf('function');

    const outputDir = path.join(tempDir, 'email-output');
    const expectedArchivePath = `${outputDir}.tar.gz`;

    await downloadStartHandler(
      {},
      {
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
          outputFormat: 'tar.gz',
          includeScripts: false,
          concurrency: 1,
          deliveryMethod: 'email',
          email: {
            to: 'offline@example.com',
            from: 'sender@example.com',
          },
          fileSplit: {
            enabled: false,
            maxSizeMB: 10,
          },
          smtp: {
            host: 'smtp.example.com',
            port: 587,
            user: 'sender@example.com',
            password: 'secret',
          },
        },
      }
    );

    await waitForExpectation(() => {
      expect(initializeEmailSenderMock).toHaveBeenCalled();
      expect(sendEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'offline@example.com',
          attachments: [expectedArchivePath],
        })
      );
    });

    await waitForExpectation(() => {
      expect(webContentsSend).toHaveBeenCalledWith(
        'download:all-complete',
        expect.objectContaining({
          success: true,
          outputPath: expectedArchivePath,
          artifactPaths: [expectedArchivePath],
          deliveryMethod: 'email',
          deliveryResult: expect.objectContaining({
            emailSent: true,
            emailsSent: 1,
            splitApplied: false,
          }),
        })
      );
    });
  });

  it('부분 성공 다운로드에서는 실제 성공한 패키지만 메일 메타데이터와 스크립트에 반영해야 함', async () => {
    downloadFileMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('network failed'));

    registerDownloadHandlers(() => ({
      webContents: {
        send: webContentsSend,
      },
    }) as never);

    const downloadStartHandler = ipcHandle.mock.calls.find(
      ([channel]) => channel === 'download:start'
    )?.[1];

    expect(downloadStartHandler).toBeTypeOf('function');

    const outputDir = path.join(tempDir, 'partial-email-output');

    await downloadStartHandler(
      {},
      {
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
          outputDir,
          outputFormat: 'tar.gz',
          includeScripts: true,
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
            password: 'secret',
          },
        },
      }
    );

    await waitForExpectation(() => {
      expect(generateInstallScriptsMock).toHaveBeenCalledWith(
        outputDir,
        [
          expect.objectContaining({
            id: 'pip-requests-2.28.0',
            name: 'requests',
          }),
        ]
      );
      expect(createArchiveFromDirectoryMock).toHaveBeenCalledWith(
        outputDir,
        `${outputDir}.tar.gz`,
        [
          expect.objectContaining({
            name: 'requests',
            version: '2.28.0',
          }),
        ],
        expect.any(Object)
      );
      expect(sendEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'DepsSmuggler 패키지 전달 (1개 패키지)',
          body: expect.stringContaining('다운로드 실패한 1개 패키지는 이번 전달에서 제외되었습니다.'),
          packages: [
            expect.objectContaining({
              name: 'requests',
              version: '2.28.0',
            }),
          ],
        })
      );
    });
  });

  it('성공한 패키지가 하나도 없으면 패키징과 메일 전달 없이 실패해야 함', async () => {
    downloadFileMock.mockRejectedValue(new Error('network failed'));

    registerDownloadHandlers(() => ({
      webContents: {
        send: webContentsSend,
      },
    }) as never);

    const downloadStartHandler = ipcHandle.mock.calls.find(
      ([channel]) => channel === 'download:start'
    )?.[1];

    expect(downloadStartHandler).toBeTypeOf('function');

    const outputDir = path.join(tempDir, 'all-failed-output');

    await downloadStartHandler(
      {},
      {
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
          outputFormat: 'tar.gz',
          includeScripts: true,
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
      }
    );

    await waitForExpectation(() => {
      expect(generateInstallScriptsMock).not.toHaveBeenCalled();
      expect(createArchiveFromDirectoryMock).not.toHaveBeenCalled();
      expect(initializeEmailSenderMock).not.toHaveBeenCalled();
      expect(sendEmailMock).not.toHaveBeenCalled();
      expect(webContentsSend).toHaveBeenCalledWith(
        'download:all-complete',
        expect.objectContaining({
          success: false,
          outputPath: outputDir,
          deliveryMethod: 'email',
          error: '다운로드에 성공한 패키지가 없습니다.',
          results: [
            {
              id: 'pip-requests-2.28.0',
              success: false,
              error: 'network failed',
            },
          ],
        })
      );
    });
  });

  it('다운로드 완료 직후 취소되면 패키징과 메일 전달 없이 cancelled 완료 이벤트로 끝나야 함', async () => {
    let resolveDownload!: () => void;
    downloadFileMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveDownload = resolve;
        })
    );

    registerDownloadHandlers(() => ({
      webContents: {
        send: webContentsSend,
      },
    }) as never);

    const downloadStartHandler = ipcHandle.mock.calls.find(
      ([channel]) => channel === 'download:start'
    )?.[1];
    const downloadCancelHandler = ipcHandle.mock.calls.find(
      ([channel]) => channel === 'download:cancel'
    )?.[1];

    expect(downloadStartHandler).toBeTypeOf('function');
    expect(downloadCancelHandler).toBeTypeOf('function');

    const outputDir = path.join(tempDir, 'cancelled-before-packaging-output');

    await downloadStartHandler(
      {},
      {
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
      }
    );

    await waitForExpectation(() => {
      expect(downloadFileMock).toHaveBeenCalled();
    });

    await downloadCancelHandler({});
    resolveDownload();

    await waitForExpectation(() => {
      expect(createArchiveFromDirectoryMock).not.toHaveBeenCalled();
      expect(initializeEmailSenderMock).not.toHaveBeenCalled();
      expect(sendEmailMock).not.toHaveBeenCalled();
      expect(webContentsSend).toHaveBeenCalledWith(
        'download:all-complete',
        expect.objectContaining({
          success: false,
          cancelled: true,
          outputPath: outputDir,
        })
      );
    });
  });

  it('첨부 제한 초과이고 파일 분할이 켜져 있으면 splitFile 결과를 첨부와 완료 이벤트에 반영해야 함', async () => {
    createArchiveFromDirectoryMock.mockImplementationOnce(async (_sourceDir: string, outputPath: string) => {
      await fs.ensureDir(path.dirname(outputPath));
      await fs.writeFile(outputPath, Buffer.alloc(4 * 1024));
      return outputPath;
    });

    registerDownloadHandlers(() => ({
      webContents: {
        send: webContentsSend,
      },
    }) as never);

    const downloadStartHandler = ipcHandle.mock.calls.find(
      ([channel]) => channel === 'download:start'
    )?.[1];

    expect(downloadStartHandler).toBeTypeOf('function');

    const outputDir = path.join(tempDir, 'split-output');

    await downloadStartHandler(
      {},
      {
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
          outputFormat: 'tar.gz',
          includeScripts: false,
          concurrency: 1,
          deliveryMethod: 'email',
          email: {
            to: 'offline@example.com',
          },
          fileSplit: {
            enabled: true,
            maxSizeMB: 0.001,
          },
          smtp: {
            host: 'smtp.example.com',
            port: 587,
            user: 'sender@example.com',
            password: 'secret',
          },
        },
      }
    );

    await waitForExpectation(() => {
      expect(splitFileMock).toHaveBeenCalled();
      expect(sendEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: expect.arrayContaining([
            path.join(tempDir, 'bundle.tar.gz.part001'),
            path.join(tempDir, 'bundle.tar.gz.part002'),
            path.join(tempDir, 'bundle.tar.gz.meta.json'),
            path.join(tempDir, 'merge.sh'),
            path.join(tempDir, 'merge.ps1'),
          ]),
        })
      );
    });

    await waitForExpectation(() => {
      expect(webContentsSend).toHaveBeenCalledWith(
        'download:all-complete',
        expect.objectContaining({
          success: true,
          outputPath: path.join(tempDir, 'bundle.tar.gz.part001'),
          artifactPaths: expect.arrayContaining([
            path.join(tempDir, 'bundle.tar.gz.part001'),
            path.join(tempDir, 'bundle.tar.gz.part002'),
            path.join(tempDir, 'bundle.tar.gz.meta.json'),
            path.join(tempDir, 'merge.sh'),
            path.join(tempDir, 'merge.ps1'),
          ]),
          deliveryMethod: 'email',
          deliveryResult: expect.objectContaining({
            splitApplied: true,
          }),
        })
      );
    });
  });

  it('발신자 후보가 없으면 이메일 전달을 시작하지 않고 명시적으로 실패해야 함', async () => {
    registerDownloadHandlers(() => ({
      webContents: {
        send: webContentsSend,
      },
    }) as never);

    const downloadStartHandler = ipcHandle.mock.calls.find(
      ([channel]) => channel === 'download:start'
    )?.[1];

    expect(downloadStartHandler).toBeTypeOf('function');

    const outputDir = path.join(tempDir, 'missing-from-output');

    await downloadStartHandler(
      {},
      {
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
          },
        },
      }
    );

    await waitForExpectation(() => {
      expect(initializeEmailSenderMock).not.toHaveBeenCalled();
      expect(sendEmailMock).not.toHaveBeenCalled();
      expect(webContentsSend).toHaveBeenCalledWith(
        'download:all-complete',
        expect.objectContaining({
          success: false,
          outputPath: `${outputDir}.tar.gz`,
          deliveryMethod: 'email',
          deliveryResult: expect.objectContaining({
            emailSent: false,
            error: '이메일 전달에 필요한 발신자 설정이 없습니다. SMTP 발신자 또는 로그인 사용자를 설정하세요.',
          }),
        })
      );
    });
  });

  it('첨부 제한 초과인데 파일 분할이 꺼져 있으면 메일 전달 실패로 처리해야 함', async () => {
    createArchiveFromDirectoryMock.mockImplementationOnce(async (_sourceDir: string, outputPath: string) => {
      await fs.ensureDir(path.dirname(outputPath));
      await fs.writeFile(outputPath, Buffer.alloc(4 * 1024));
      return outputPath;
    });

    registerDownloadHandlers(() => ({
      webContents: {
        send: webContentsSend,
      },
    }) as never);

    const downloadStartHandler = ipcHandle.mock.calls.find(
      ([channel]) => channel === 'download:start'
    )?.[1];

    expect(downloadStartHandler).toBeTypeOf('function');

    const outputDir = path.join(tempDir, 'split-disabled-output');

    await downloadStartHandler(
      {},
      {
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
          outputFormat: 'tar.gz',
          includeScripts: false,
          concurrency: 1,
          deliveryMethod: 'email',
          email: {
            to: 'offline@example.com',
          },
          fileSplit: {
            enabled: false,
            maxSizeMB: 0.001,
          },
          smtp: {
            host: 'smtp.example.com',
            port: 587,
            user: 'sender@example.com',
            password: 'secret',
          },
        },
      }
    );

    await waitForExpectation(() => {
      expect(splitFileMock).not.toHaveBeenCalled();
      expect(sendEmailMock).not.toHaveBeenCalled();
      expect(webContentsSend).toHaveBeenCalledWith(
        'download:all-complete',
        expect.objectContaining({
          success: false,
          outputPath: `${outputDir}.tar.gz`,
          artifactPaths: [`${outputDir}.tar.gz`],
          deliveryMethod: 'email',
        })
      );
    });
  });

  it('os:download:start에서 OS 전용 출력 옵션을 적용해 패키징 결과를 반환한다', async () => {
    registerDownloadHandlers(() => ({
      webContents: {
        send: webContentsSend,
      },
    }) as never);

    const osDownloadHandler = ipcHandle.mock.calls.find(
      ([channel]) => channel === 'os:download:start'
    )?.[1];

    expect(osDownloadHandler).toBeTypeOf('function');

    const result = await osDownloadHandler(
      {},
      {
        packages: [rootPackage],
        outputDir: osOutputDir,
        distribution,
        architecture: 'x86_64',
        resolveDependencies: true,
        concurrency: 2,
        outputOptions: {
          type: 'both',
          archiveFormat: 'zip',
          generateScripts: true,
          scriptTypes: ['dependency-order', 'local-repo'],
        },
      }
    );

    expect(yumResolveDependencies).toHaveBeenCalledWith([rootPackage]);
    expect(yumDownloadPackage).toHaveBeenCalledTimes(2);
    expect(archiveCreateArchive).toHaveBeenCalledWith(
      [rootPackage, dependencyPackage],
      expect.any(Map),
      expect.objectContaining({
        format: 'zip',
        includeScripts: true,
        scriptTypes: ['dependency-order', 'local-repo'],
        packageManager: 'yum',
      })
    );
    expect(repoCreateLocalRepo).toHaveBeenCalledWith(
      [rootPackage, dependencyPackage],
      expect.any(Map),
      expect.objectContaining({
        packageManager: 'yum',
        outputPath: `${osOutputDir}/repository`,
      })
    );
    expect(webContentsSend).toHaveBeenCalledWith(
      'os:download:progress',
      expect.objectContaining({
        phase: 'packaging',
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        success: [rootPackage, dependencyPackage],
        failed: [],
        skipped: [],
        outputPath: osOutputDir,
        packageManager: 'yum',
        outputOptions: {
          type: 'both',
          archiveFormat: 'zip',
          generateScripts: true,
          scriptTypes: ['dependency-order', 'local-repo'],
        },
        generatedOutputs: expect.arrayContaining([
          expect.objectContaining({
            type: 'archive',
            path: `${osOutputDir}/os-packages.zip`,
          }),
          expect.objectContaining({
            type: 'repository',
            path: `${osOutputDir}/repository`,
          }),
        ]),
        warnings: [],
        unresolved: [],
        conflicts: [],
        cancelled: false,
      })
    );
  });

  it('os:download:start에서 해결되지 않은 의존성이 있으면 다운로드를 시작하지 않고 결과에 포함한다', async () => {
    registerDownloadHandlers(() => ({
      webContents: {
        send: webContentsSend,
      },
    }) as never);

    yumResolveDependencies.mockResolvedValueOnce({
      packages: [rootPackage],
      unresolved: [{ name: 'openssl-libs', operator: '>=', version: '1.1.1' }],
      conflicts: [{ package: 'glibc', versions: [dependencyPackage] }],
      warnings: ['1 dependencies could not be resolved'],
    });

    const osDownloadHandler = ipcHandle.mock.calls.find(
      ([channel]) => channel === 'os:download:start'
    )?.[1];

    const result = await osDownloadHandler(
      {},
      {
        packages: [rootPackage],
        outputDir: osOutputDir,
        distribution,
        architecture: 'x86_64',
        resolveDependencies: true,
      }
    );

    expect(yumDownloadPackage).not.toHaveBeenCalled();
    expect(archiveCreateArchive).not.toHaveBeenCalled();
    expect(repoCreateLocalRepo).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        success: [],
        failed: [],
        skipped: [],
        warnings: ['1 dependencies could not be resolved'],
        unresolved: [{ name: 'openssl-libs', operator: '>=', version: '1.1.1' }],
        conflicts: [{ package: 'glibc', versions: [dependencyPackage] }],
        cancelled: false,
        generatedOutputs: [],
      })
    );
  });

  it('os:download:start에서 건너뛴 패키지를 failed 대신 skipped로 집계한다', async () => {
    registerDownloadHandlers(() => ({
      webContents: {
        send: webContentsSend,
      },
    }) as never);

    yumDownloadPackage.mockReset();
    yumDownloadPackage.mockResolvedValueOnce({
      success: false,
      error: new Error('사용자 건너뜀'),
      skipped: true,
    });

    const osDownloadHandler = ipcHandle.mock.calls.find(
      ([channel]) => channel === 'os:download:start'
    )?.[1];

    const result = await osDownloadHandler(
      {},
      {
        packages: [rootPackage],
        outputDir: osOutputDir,
        distribution,
        architecture: 'x86_64',
        resolveDependencies: false,
      }
    );

    expect(result).toEqual(
      expect.objectContaining({
        success: [],
        failed: [],
        skipped: [rootPackage],
        warnings: [],
        unresolved: [],
        conflicts: [],
        cancelled: false,
      })
    );
  });

  it('os:download:start에서 취소되면 최종 성공 산출물 없이 cancelled 결과를 반환한다', async () => {
    registerDownloadHandlers(() => ({
      webContents: {
        send: webContentsSend,
      },
    }) as never);

    yumDownloadPackage.mockReset();

    const osDownloadHandler = ipcHandle.mock.calls.find(
      ([channel]) => channel === 'os:download:start'
    )?.[1];
    const osCancelHandler = ipcHandle.mock.calls.find(
      ([channel]) => channel === 'os:download:cancel'
    )?.[1];

    yumDownloadPackage.mockImplementationOnce(async () => {
      return {
        success: true,
        filePath: '/tmp/bash-5.1.8.rpm',
      };
    });
    yumDownloadPackage.mockImplementationOnce(async () => {
      await osCancelHandler({}, {});
      return {
        success: false,
        error: new Error('사용자 취소'),
        skipped: true,
      };
    });

    const result = await osDownloadHandler(
      {},
      {
        packages: [rootPackage, dependencyPackage],
        outputDir: osOutputDir,
        distribution,
        architecture: 'x86_64',
        resolveDependencies: false,
      }
    );

    expect(archiveCreateArchive).not.toHaveBeenCalled();
    expect(repoCreateLocalRepo).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        success: [],
        cancelled: true,
        generatedOutputs: [],
        warnings: expect.arrayContaining([
          expect.stringContaining('최종 출력물은 생성되지 않았습니다'),
        ]),
      })
    );
  });
});
