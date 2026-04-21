import { beforeEach, describe, expect, it, vi } from 'vitest';

type PackageFixture = {
  latest: string;
  versions: Record<
    string,
    {
      requiresDist?: string[];
      urls?: Array<{
        filename: string;
        size?: number;
        packagetype?: string;
      }>;
    }
  >;
};

type SimpleApiFixture = Record<
  string,
  Array<{
    filename: string;
    url: string;
    metadataHash?: string;
    yanked?: boolean;
  }>
>;

const pipCacheMock = vi.hoisted(() => ({
  fetchPackageMetadata: vi.fn(),
  clearMemoryCache: vi.fn(),
}));

const simpleApiMock = vi.hoisted(() => ({
  fetchPackageFiles: vi.fn(),
  fetchWheelMetadata: vi.fn(),
}));

vi.mock('../shared/pip-cache', () => ({
  fetchPackageMetadata: pipCacheMock.fetchPackageMetadata,
  clearMemoryCache: pipCacheMock.clearMemoryCache,
}));

vi.mock('./pip-simple-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pip-simple-api')>();

  return {
    ...actual,
    fetchPackageFiles: simpleApiMock.fetchPackageFiles,
    fetchWheelMetadata: simpleApiMock.fetchWheelMetadata,
  };
});

import { PipResolver } from './pip-resolver';

const createPyPIFixtureResponder = (packages: Record<string, PackageFixture>) =>
  async (name: string, version?: string) => {
    const fixture = packages[name];
    if (!fixture) {
      return null;
    }

    const resolvedVersion = version ?? fixture.latest;
    const versionFixture = fixture.versions[resolvedVersion];

    if (!versionFixture) {
      return null;
    }

    if (version === undefined) {
      return {
        data: {
          info: {
            name,
            version: fixture.latest,
            requires_dist: fixture.versions[fixture.latest]?.requiresDist ?? [],
          },
          releases: Object.fromEntries(
            Object.entries(fixture.versions).map(([currentVersion, currentFixture]) => [
              currentVersion,
              currentFixture.urls ?? [{ filename: `${name}-${currentVersion}.tar.gz` }],
            ])
          ),
        },
      };
    }

    return {
      data: {
        info: {
          name,
          version: resolvedVersion,
          requires_dist: versionFixture.requiresDist ?? [],
        },
        urls: versionFixture.urls ?? [],
      },
    };
  };

const simplifyResult = (result: Awaited<ReturnType<PipResolver['resolveDependencies']>>) => {
  const simplifyNode = (node: typeof result.root): Record<string, unknown> => ({
    name: node.package.name,
    version: node.package.version,
    filename: node.package.metadata?.filename ?? null,
    indexUrl: typeof node.package.metadata?.indexUrl === 'string'
      ? node.package.metadata.indexUrl
      : null,
    dependencies: [...node.dependencies]
      .sort((left, right) =>
        `${left.package.name}@${left.package.version}`.localeCompare(
          `${right.package.name}@${right.package.version}`
        )
      )
      .map(simplifyNode),
  });

  return {
    root: simplifyNode(result.root),
    flatList: [...result.flatList]
      .map((pkg) => ({
        name: pkg.name,
        version: pkg.version,
        filename: pkg.metadata?.filename ?? null,
        indexUrl: typeof pkg.metadata?.indexUrl === 'string' ? pkg.metadata.indexUrl : null,
      }))
      .sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`)),
    conflicts: result.conflicts,
  };
};

describe('PipResolver characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('simple fixture의 그래프를 고정한다', async () => {
    pipCacheMock.fetchPackageMetadata.mockImplementation(
      createPyPIFixtureResponder({
        requests: {
          latest: '2.32.0',
          versions: {
            '2.32.0': {
              requiresDist: ['urllib3>=2.1.0', 'certifi>=2024.2.2'],
            },
          },
        },
        urllib3: {
          latest: '2.1.0',
          versions: {
            '2.1.0': {},
          },
        },
        certifi: {
          latest: '2024.2.2',
          versions: {
            '2024.2.2': {},
          },
        },
      })
    );

    const resolver = new PipResolver();
    const result = await resolver.resolveDependencies('requests', '2.32.0');

    expect(simplifyResult(result)).toMatchSnapshot();
  });

  it('extras fixture의 그래프를 고정한다', async () => {
    pipCacheMock.fetchPackageMetadata.mockImplementation(
      createPyPIFixtureResponder({
        httpx: {
          latest: '0.27.0',
          versions: {
            '0.27.0': {
              requiresDist: [
                'anyio>=4.0.0',
                'httpx-auth>=0.20.0 ; extra == "auth"',
                'rich>=13.0.0 ; extra == "cli"',
              ],
            },
          },
        },
        anyio: {
          latest: '4.4.0',
          versions: {
            '4.4.0': {},
          },
        },
        httpx_auth: {
          latest: '0.20.0',
          versions: {
            '0.20.0': {},
          },
        },
      })
    );

    const resolver = new PipResolver();
    resolver.setPipTargetPlatform({
      os: 'linux',
      arch: 'x86_64',
      pythonVersion: '3.11',
    });

    const result = await resolver.resolveDependencies('httpx', '0.27.0', {
      targetPlatform: { system: 'Linux', machine: 'x86_64' },
      pythonVersion: '3.11',
      extras: ['auth'],
    });

    expect(simplifyResult(result)).toMatchSnapshot();
  });

  it('conflicts fixture의 그래프를 고정한다', async () => {
    pipCacheMock.fetchPackageMetadata.mockImplementation(
      createPyPIFixtureResponder({
        rootpkg: {
          latest: '1.0.0',
          versions: {
            '1.0.0': {
              requiresDist: ['urllib3<1.0'],
            },
          },
        },
        urllib3: {
          latest: '2.2.1',
          versions: {
            '2.1.0': {},
            '2.2.1': {},
          },
        },
      })
    );

    const resolver = new PipResolver();
    const result = await resolver.resolveDependencies('rootpkg', '1.0.0');

    expect(simplifyResult(result)).toMatchSnapshot();
  });

  it('markers fixture의 그래프를 고정한다', async () => {
    pipCacheMock.fetchPackageMetadata.mockImplementation(
      createPyPIFixtureResponder({
        uvicorn: {
          latest: '0.30.0',
          versions: {
            '0.30.0': {
              requiresDist: [
                'uvloop>=0.19.0 ; sys_platform == "linux"',
                'colorama>=0.4.6 ; sys_platform == "win32"',
                'watchfiles>=0.22.0 ; platform_machine == "x86_64"',
              ],
            },
          },
        },
        uvloop: {
          latest: '0.19.0',
          versions: {
            '0.19.0': {},
          },
        },
        watchfiles: {
          latest: '0.22.0',
          versions: {
            '0.22.0': {},
          },
        },
      })
    );

    const resolver = new PipResolver();
    const result = await resolver.resolveDependencies('uvicorn', '0.30.0', {
      targetPlatform: { system: 'Linux', machine: 'x86_64' },
      pythonVersion: '3.11',
    });

    expect(simplifyResult(result)).toMatchSnapshot();
  });

  it('wheel-tags fixture의 그래프를 고정한다', async () => {
    const filesByPackage: SimpleApiFixture = {
      numpy: [
        {
          filename: 'numpy-1.26.4-cp310-cp310-manylinux_2_17_x86_64.whl',
          url: 'https://packages.example.com/numpy-1.26.4-cp310.whl',
          metadataHash: 'sha256:cp310',
        },
        {
          filename: 'numpy-1.26.4-cp311-cp311-manylinux_2_17_x86_64.whl',
          url: 'https://packages.example.com/numpy-1.26.4-cp311.whl',
          metadataHash: 'sha256:cp311',
        },
        {
          filename: 'numpy-1.26.4.tar.gz',
          url: 'https://packages.example.com/numpy-1.26.4.tar.gz',
        },
      ],
      typing_extensions: [
        {
          filename: 'typing_extensions-4.12.2-py3-none-any.whl',
          url: 'https://packages.example.com/typing_extensions-4.12.2.whl',
          metadataHash: 'sha256:typing',
        },
      ],
    };

    simpleApiMock.fetchPackageFiles.mockImplementation(async (_indexUrl: string, name: string) => {
      return filesByPackage[name] ?? [];
    });
    simpleApiMock.fetchWheelMetadata.mockImplementation(async (file: { filename: string }) => {
      if (file.filename.includes('numpy-1.26.4-cp311')) {
        return ['typing-extensions>=4.12.2'];
      }
      return [];
    });
    pipCacheMock.fetchPackageMetadata.mockImplementation(async () => null);

    const resolver = new PipResolver();
    const result = await resolver.resolveDependencies('numpy', 'latest', {
      indexUrl: 'https://packages.example.com/simple',
      targetPlatform: { system: 'Linux', machine: 'x86_64' },
      pythonVersion: '3.11',
    });

    expect(simplifyResult(result)).toMatchSnapshot();
  });
});
