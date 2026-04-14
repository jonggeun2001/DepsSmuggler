import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  ipcHandle,
  webContentsSend,
  createDownloadOrchestratorMock,
  createOSDownloadOrchestratorMock,
  downloadOrchestrator,
  osDownloadOrchestrator,
} = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  webContentsSend: vi.fn(),
  createDownloadOrchestratorMock: vi.fn(),
  createOSDownloadOrchestratorMock: vi.fn(),
  downloadOrchestrator: {
    startDownload: vi.fn(),
    pauseDownload: vi.fn(),
    resumeDownload: vi.fn(),
    cancelDownload: vi.fn(),
    checkPath: vi.fn(),
    clearPath: vi.fn(),
  },
  osDownloadOrchestrator: {
    resolveDependencies: vi.fn(),
    startDownload: vi.fn(),
    cancelDownload: vi.fn(),
    getCacheStats: vi.fn(),
    clearCache: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcHandle,
  },
  dialog: {
    showMessageBox: vi.fn(),
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

vi.mock('./services/download-orchestrator', () => ({
  createDownloadOrchestrator: createDownloadOrchestratorMock,
}));

vi.mock('./services/os-download-orchestrator', () => ({
  createOSDownloadOrchestrator: createOSDownloadOrchestratorMock,
}));

import { registerDownloadHandlers } from './download-handlers';

describe('download handler wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createDownloadOrchestratorMock.mockReturnValue(downloadOrchestrator);
    createOSDownloadOrchestratorMock.mockReturnValue(osDownloadOrchestrator);
    downloadOrchestrator.startDownload.mockResolvedValue({ success: true, started: true });
    downloadOrchestrator.pauseDownload.mockResolvedValue({ success: true });
    downloadOrchestrator.resumeDownload.mockResolvedValue({ success: true });
    downloadOrchestrator.cancelDownload.mockResolvedValue({ success: true });
    downloadOrchestrator.checkPath.mockResolvedValue({
      exists: false,
      files: [],
      fileCount: 0,
      totalSize: 0,
    });
    downloadOrchestrator.clearPath.mockResolvedValue({ success: true, deleted: true });
    osDownloadOrchestrator.resolveDependencies.mockResolvedValue({
      packages: [],
      unresolved: [],
      conflicts: [],
    });
    osDownloadOrchestrator.startDownload.mockResolvedValue({
      success: [],
      failed: [],
      skipped: [],
      outputPath: '/tmp/os-output',
      packageManager: 'yum',
      outputOptions: {
        type: 'archive',
        archiveFormat: 'zip',
        generateScripts: true,
        scriptTypes: ['dependency-order'],
      },
      generatedOutputs: [],
      warnings: [],
      unresolved: [],
      conflicts: [],
      cancelled: false,
    });
    osDownloadOrchestrator.cancelDownload.mockResolvedValue({ success: true });
    osDownloadOrchestrator.getCacheStats.mockResolvedValue({ size: 0, count: 0, path: '' });
    osDownloadOrchestrator.clearCache.mockResolvedValue({ success: true });
  });

  it('download:start 핸들러가 regular download orchestrator로 위임한다', async () => {
    const mainWindow = {
      webContents: {
        send: webContentsSend,
      },
    };
    registerDownloadHandlers(() => mainWindow as never);

    const downloadStartHandler = ipcHandle.mock.calls.find(
      ([channel]) => channel === 'download:start'
    )?.[1];

    expect(downloadStartHandler).toBeTypeOf('function');

    const payload = {
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
        outputFormat: 'zip',
        includeScripts: false,
        concurrency: 1,
      },
    };

    const result = await downloadStartHandler({}, payload);

    expect(createDownloadOrchestratorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        getMainWindow: expect.any(Function),
      })
    );
    expect(downloadOrchestrator.startDownload).toHaveBeenCalledWith(payload);
    expect(result).toEqual({ success: true, started: true });
  });

  it('os:download:start 핸들러가 OS orchestrator 결과를 그대로 반환한다', async () => {
    registerDownloadHandlers(() => ({
      webContents: {
        send: webContentsSend,
      },
    }) as never);

    const osDownloadStartHandler = ipcHandle.mock.calls.find(
      ([channel]) => channel === 'os:download:start'
    )?.[1];

    expect(osDownloadStartHandler).toBeTypeOf('function');

    const payload = {
      packages: [],
      outputDir: '/tmp/os-output',
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
      resolveDependencies: true,
    };

    const result = await osDownloadStartHandler({}, payload);

    expect(createOSDownloadOrchestratorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        getMainWindow: expect.any(Function),
      })
    );
    expect(osDownloadOrchestrator.startDownload).toHaveBeenCalledWith(payload);
    expect(result).toEqual(
      expect.objectContaining({
        outputPath: '/tmp/os-output',
        packageManager: 'yum',
      })
    );
  });
});
