import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSearchHandlers } from './search-handlers';
import { resolveAllDependencies } from '../src/core/shared';

const { ipcHandle, senderSend } = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  senderSend: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcHandle,
  },
}));

vi.mock('axios', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: { projects: [] } }),
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
  resolveAllDependencies: vi.fn(),
  sortByRelevance: vi.fn((results) => results),
}));

vi.mock('../src/core', () => ({
  getPipDownloader: vi.fn(() => ({ searchPackages: vi.fn(), getVersions: vi.fn() })),
  getMavenDownloader: vi.fn(() => ({ searchPackages: vi.fn(), getVersions: vi.fn() })),
  getCondaDownloader: vi.fn(() => ({ searchPackages: vi.fn(), getVersions: vi.fn() })),
  getDockerDownloader: vi.fn(() => ({ searchPackages: vi.fn(), getVersions: vi.fn() })),
  getYumDownloader: vi.fn(() => ({ searchPackages: vi.fn(), getVersions: vi.fn() })),
  getAptDownloader: vi.fn(() => ({ searchPackages: vi.fn(), getVersions: vi.fn() })),
  getApkDownloader: vi.fn(() => ({ searchPackages: vi.fn(), getVersions: vi.fn() })),
  getNpmDownloader: vi.fn(() => ({ searchPackages: vi.fn(), getVersions: vi.fn() })),
  getYumResolver: vi.fn(),
  getAptResolver: vi.fn(),
  getApkResolver: vi.fn(),
  PipDownloader: class {},
  MavenDownloader: class {},
  CondaDownloader: class {},
  DockerDownloader: class {},
  YumDownloader: class {},
  AptDownloader: class {},
  ApkDownloader: class {},
  NpmDownloader: class {},
}));

vi.mock('../src/core/downloaders/os-shared/repositories', () => ({
  OS_DISTRIBUTIONS: [],
  getDistributionsByPackageManager: vi.fn(),
  getDistributionById: vi.fn(),
}));

vi.mock('../src/core/downloaders/os-shared/distribution-fetcher', () => ({
  getSimplifiedDistributions: vi.fn(),
  invalidateDistributionCache: vi.fn(),
}));

vi.mock('../src/core/shared/maven-utils', () => ({
  isNativeArtifactFromApi: vi.fn(),
  getAvailableClassifiersAsync: vi.fn(),
}));

describe('registerSearchHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveAllDependencies).mockResolvedValue({
      originalPackages: [],
      allPackages: [],
      dependencyTrees: [],
      failedPackages: [],
    });
  });

  it('dependency:resolve에서 includeDependencies 옵션을 공통 리졸버로 전달한다', async () => {
    registerSearchHandlers();

    const dependencyResolveHandler = ipcHandle.mock.calls.find(
      ([channel]) => channel === 'dependency:resolve'
    )?.[1];

    expect(dependencyResolveHandler).toBeTypeOf('function');

    await dependencyResolveHandler(
      { sender: { send: senderSend } },
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
          includeDependencies: false,
          architecture: 'x86_64',
        },
      }
    );

    expect(resolveAllDependencies).toHaveBeenCalledWith(
      [
        {
          id: 'pip-requests-2.28.0',
          type: 'pip',
          name: 'requests',
          version: '2.28.0',
        },
      ],
      expect.objectContaining({
        includeDependencies: false,
        architecture: 'x86_64',
      })
    );
  });
});
