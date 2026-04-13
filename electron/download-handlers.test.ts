import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerDownloadHandlers } from './download-handlers';

const {
  ipcHandle,
  webContentsSend,
  getPyPIDownloadUrlMock,
  downloadFileMock,
  generateInstallScriptsMock,
  createZipArchiveMock,
  createArchiveFromDirectoryMock,
} = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  webContentsSend: vi.fn(),
  getPyPIDownloadUrlMock: vi.fn(),
  downloadFileMock: vi.fn(),
  generateInstallScriptsMock: vi.fn(),
  createZipArchiveMock: vi.fn(),
  createArchiveFromDirectoryMock: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcHandle,
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
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
  getYumDownloader: vi.fn(),
  getAptDownloader: vi.fn(),
  getApkDownloader: vi.fn(),
  getYumResolver: vi.fn(),
  getAptResolver: vi.fn(),
  getApkResolver: vi.fn(),
}));

vi.mock('../src/core/packager/archive-packager', () => ({
  getArchivePackager: vi.fn(() => ({
    createArchiveFromDirectory: createArchiveFromDirectoryMock,
  })),
}));

const flushDownloadWork = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('registerDownloadHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getPyPIDownloadUrlMock.mockResolvedValue({
      url: 'https://example.com/requests-2.28.0.whl',
      filename: 'requests-2.28.0.whl',
    });
    downloadFileMock.mockResolvedValue(undefined);
    generateInstallScriptsMock.mockResolvedValue(undefined);
    createZipArchiveMock.mockResolvedValue(undefined);
    createArchiveFromDirectoryMock.mockImplementation(async (_sourceDir: string, outputPath: string) => outputPath);
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

    await flushDownloadWork();

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

    expect(webContentsSend).toHaveBeenCalledWith('download:all-complete', {
      success: true,
      outputPath: expectedArchivePath,
      results: [
        {
          id: 'pip-requests-2.28.0',
          success: true,
        },
      ],
    });
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

    await flushDownloadWork();

    expect(webContentsSend).toHaveBeenCalledWith('download:all-complete', {
      success: true,
      outputPath: expectedArchivePath,
      results: [
        {
          id: 'pip-requests-2.28.0',
          success: true,
        },
      ],
    });
  });
});
