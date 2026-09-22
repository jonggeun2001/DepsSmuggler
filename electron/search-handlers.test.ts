import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { createRendererDataClient } from '../src/renderer/lib/renderer-data-client';
import { registerSearchHandlers } from './search-handlers';
import { resolveAllDependencies } from '../src/core/shared';

const { ipcHandle, senderSend, mavenSearchPackagesMock, parseProjectMock } = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  senderSend: vi.fn(),
  mavenSearchPackagesMock: vi.fn(),
  parseProjectMock: vi.fn(),
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
vi.mock('./services/maven-project-service', () => ({
  createMavenProjectService: () => ({ parseProject: parseProjectMock }),
}));

vi.mock('../src/core/shared', () => ({
  resolveAllDependencies: vi.fn(),
  sortByRelevance: vi.fn((results) => results),
}));

vi.mock('../src/core', () => ({
  getPipDownloader: vi.fn(() => ({ searchPackages: vi.fn(), getVersions: vi.fn() })),
  getMavenDownloader: vi.fn(() => ({
    searchPackages: mavenSearchPackagesMock,
    getVersions: vi.fn(),
  })),
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
    vi.mocked(axios.get).mockReset().mockResolvedValue({ data: { projects: [] } });
    mavenSearchPackagesMock.mockResolvedValue([]);
    vi.mocked(resolveAllDependencies).mockResolvedValue({
      originalPackages: [],
      allPackages: [],
      dependencyTrees: [],
      failedPackages: [],
    });
  });

  it('Maven 인증서 실패가 실제 IPC 어댑터와 renderer facade를 통과해 보존된다', async () => {
    mavenSearchPackagesMock.mockRejectedValue(Object.assign(new Error('self signed certificate in certificate chain'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' }));
    registerSearchHandlers();
    const handler = ipcHandle.mock.calls.find(([channel]) => channel === 'search:packages')![1];
    const client = createRendererDataClient({ electronAPI: { search: {
      packages: (type, query, options) => handler({}, type, query, options),
    } } });
    const payload = await handler({}, 'maven', 'deequ');
    expect(JSON.parse(JSON.stringify(payload))).toMatchObject({ results: [], error: { code: 'TLS_CERTIFICATE' } });
    await expect(client.searchPackages('maven', 'deequ')).rejects.toMatchObject({ failure: { code: 'TLS_CERTIFICATE' } });
    mavenSearchPackagesMock.mockResolvedValue([]);
    await expect(client.searchPackages('maven', 'absent')).resolves.toEqual([]);
  });

  it('PyPI 정확 검색의 404만 빈 결과로 처리하고 네트워크 실패는 전달한다', async () => {
    registerSearchHandlers();
    const handler = ipcHandle.mock.calls.find(([channel]) => channel === 'search:packages')![1];
    vi.mocked(axios.get).mockRejectedValue({ response: { status: 404 } });
    expect(await handler({}, 'pip', 'absent')).toEqual({ results: [] });
    vi.mocked(axios.get).mockRejectedValue({ code: 'ECONNRESET' });
    expect(await handler({}, 'pip', 'requests')).toMatchObject({ error: { code: 'NETWORK' } });
  });

  it('PyPI 캐시 후보가 모두 실패하면 정확 검색 404로 실패를 숨기지 않는다', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({ data: '<a href="/simple/requests">requests</a>' });
    registerSearchHandlers();
    await Promise.resolve();
    const handler = ipcHandle.mock.calls.find(([channel]) => channel === 'search:packages')![1];
    vi.mocked(axios.get).mockImplementation(async (url) => {
      if (url.includes('/requests/')) throw { code: 'ETIMEDOUT' };
      throw { response: { status: 404 } };
    });
    expect(await handler({}, 'pip', 'requ')).toMatchObject({ error: { code: 'TIMEOUT' } });
  });

  it('Maven 버전 metadata와 fallback 응답이 모두 잘못되면 실패를 전달한다', async () => {
    registerSearchHandlers();
    vi.mocked(axios.get).mockResolvedValue({ data: '<html>company gateway</html>' });
    const handler = ipcHandle.mock.calls.find(([channel]) => channel === 'search:versions')![1];
    expect(await handler({}, 'maven', 'g:a')).toMatchObject({ versions: [], error: { code: 'INVALID_RESPONSE' } });
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

  it('search:packages는 Maven 검색 결과의 추가 메타데이터를 유지해야 한다', async () => {
    mavenSearchPackagesMock.mockResolvedValue([
      {
        name: 'org.springframework:spring-core',
        version: '6.1.5',
        metadata: {
          popularityCount: 3210,
        },
      },
    ]);

    registerSearchHandlers();

    const searchPackagesHandler = ipcHandle.mock.calls.find(
      ([channel]) => channel === 'search:packages'
    )?.[1];

    expect(searchPackagesHandler).toBeTypeOf('function');

    const result = await searchPackagesHandler({}, 'maven', 'spring-core');

    expect(result).toEqual({
      results: [
        {
          name: 'org.springframework:spring-core',
          version: '6.1.5',
          description: 'Maven artifact: org.springframework:spring-core',
          popularityCount: 3210,
          groupId: 'org.springframework',
          artifactId: 'spring-core',
        },
      ],
    });
  });

  it('maven:parseProject는 서비스에 content와 options를 그대로 전달한다', async () => {
    parseProjectMock.mockResolvedValueOnce({ success: true, packages: [] });
    registerSearchHandlers();
    const handler = ipcHandle.mock.calls.find(([channel]) => channel === 'maven:parseProject')?.[1];
    expect(handler).toBeTypeOf('function');
    const result = await handler({}, '<project/>', { mavenVersion: '3.9.9' });
    expect(result).toEqual({ success: true, packages: [] });
    expect(parseProjectMock).toHaveBeenCalledWith('<project/>', { mavenVersion: '3.9.9' });
  });
});
