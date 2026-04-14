import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  ipcHandle,
  createSearchOrchestratorMock,
  createDependencyResolveServiceMock,
  createOSSearchServiceMock,
  searchOrchestrator,
  dependencyResolveService,
  osSearchService,
} = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  createSearchOrchestratorMock: vi.fn(),
  createDependencyResolveServiceMock: vi.fn(),
  createOSSearchServiceMock: vi.fn(),
  searchOrchestrator: {
    prime: vi.fn(),
    searchPackages: vi.fn(),
    getVersions: vi.fn(),
    suggest: vi.fn(),
    isNativeArtifact: vi.fn(),
    getAvailableClassifiers: vi.fn(),
  },
  dependencyResolveService: {
    resolveDependencies: vi.fn(),
  },
  osSearchService: {
    getDistributions: vi.fn(),
    getAllDistributions: vi.fn(),
    getDistribution: vi.fn(),
    searchPackages: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcHandle,
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

vi.mock('./services/search-orchestrator', () => ({
  createSearchOrchestrator: createSearchOrchestratorMock,
}));

vi.mock('./services/dependency-resolve-service', () => ({
  createDependencyResolveService: createDependencyResolveServiceMock,
}));

vi.mock('./services/os-search-service', () => ({
  createOSSearchService: createOSSearchServiceMock,
}));

import { registerSearchHandlers } from './search-handlers';

describe('search handler wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSearchOrchestratorMock.mockReturnValue(searchOrchestrator);
    createDependencyResolveServiceMock.mockReturnValue(dependencyResolveService);
    createOSSearchServiceMock.mockReturnValue(osSearchService);
    searchOrchestrator.searchPackages.mockResolvedValue({ results: [] });
    searchOrchestrator.getVersions.mockResolvedValue({ versions: [] });
    searchOrchestrator.suggest.mockResolvedValue([]);
    searchOrchestrator.isNativeArtifact.mockResolvedValue(false);
    searchOrchestrator.getAvailableClassifiers.mockResolvedValue([]);
    dependencyResolveService.resolveDependencies.mockResolvedValue({
      originalPackages: [],
      allPackages: [],
      dependencyTrees: [],
      failedPackages: [],
    });
    osSearchService.getDistributions.mockResolvedValue([]);
    osSearchService.getAllDistributions.mockResolvedValue([]);
    osSearchService.getDistribution.mockResolvedValue(undefined);
    osSearchService.searchPackages.mockResolvedValue({
      packages: [],
      totalCount: 0,
    });
  });

  it('search:packages 핸들러가 search orchestrator로 위임한다', async () => {
    registerSearchHandlers();

    const searchPackagesHandler = ipcHandle.mock.calls.find(
      ([channel]) => channel === 'search:packages'
    )?.[1];

    expect(searchPackagesHandler).toBeTypeOf('function');

    const result = await searchPackagesHandler({}, 'npm', 'react', {
      registry: 'https://registry.npmjs.org',
    });

    expect(createSearchOrchestratorMock).toHaveBeenCalled();
    expect(searchOrchestrator.prime).toHaveBeenCalled();
    expect(searchOrchestrator.searchPackages).toHaveBeenCalledWith('npm', 'react', {
      registry: 'https://registry.npmjs.org',
    });
    expect(result).toEqual({ results: [] });
  });

  it('dependency:resolve 핸들러가 dependency resolve service로 진행 이벤트 sender를 전달한다', async () => {
    registerSearchHandlers();

    const dependencyResolveHandler = ipcHandle.mock.calls.find(
      ([channel]) => channel === 'dependency:resolve'
    )?.[1];

    expect(dependencyResolveHandler).toBeTypeOf('function');

    const sender = { send: vi.fn() };
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
        includeDependencies: false,
      },
    };

    await dependencyResolveHandler({ sender }, payload);

    expect(createDependencyResolveServiceMock).toHaveBeenCalled();
    expect(dependencyResolveService.resolveDependencies).toHaveBeenCalledWith(
      payload.packages,
      payload.options,
      sender
    );
  });
});
