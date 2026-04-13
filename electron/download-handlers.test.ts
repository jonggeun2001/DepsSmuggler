import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerDownloadHandlers } from './download-handlers';
import type { OSPackageInfo, OSDistribution } from '../src/core/downloaders/os-shared/types';

const {
  ipcHandle,
  showMessageBox,
  windowSend,
  yumDownloadPackage,
  yumResolveDependencies,
  archiveCreateArchive,
  repoCreateLocalRepo,
} = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  showMessageBox: vi.fn(),
  windowSend: vi.fn(),
  yumDownloadPackage: vi.fn(),
  yumResolveDependencies: vi.fn(),
  archiveCreateArchive: vi.fn(),
  repoCreateLocalRepo: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcHandle,
  },
  dialog: {
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

vi.mock('../src/core/downloaders/os-shared/archive-packager', () => ({
  OSArchivePackager: vi.fn(() => ({
    createArchive: archiveCreateArchive,
  })),
}));

vi.mock('../src/core/downloaders/os-shared/repo-packager', () => ({
  OSRepoPackager: vi.fn(() => ({
    createLocalRepo: repoCreateLocalRepo,
  })),
}));

describe('registerDownloadHandlers', () => {
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

  beforeEach(() => {
    vi.clearAllMocks();
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
    archiveCreateArchive.mockResolvedValue('/downloads/os-packages.zip');
    repoCreateLocalRepo.mockResolvedValue({
      repoPath: '/downloads/repository',
      packageCount: 2,
      totalSize: 4321,
      metadataFiles: ['/downloads/repository/repodata/repomd.xml'],
    });
  });

  it('os:download:start에서 OS 전용 출력 옵션을 적용해 패키징 결과를 반환한다', async () => {
    const mockWindow = {
      webContents: {
        send: windowSend,
      },
    };

    registerDownloadHandlers(() => mockWindow as never);

    const osDownloadHandler = ipcHandle.mock.calls.find(
      ([channel]) => channel === 'os:download:start'
    )?.[1];

    expect(osDownloadHandler).toBeTypeOf('function');

    const result = await osDownloadHandler(
      {},
      {
        packages: [rootPackage],
        outputDir: '/downloads',
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
        outputPath: '/downloads/repository',
      })
    );
    expect(windowSend).toHaveBeenCalledWith(
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
        outputPath: '/downloads',
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
            path: '/downloads/os-packages.zip',
          }),
          expect.objectContaining({
            type: 'repository',
            path: '/downloads/repository',
          }),
        ]),
      })
    );
  });
});
