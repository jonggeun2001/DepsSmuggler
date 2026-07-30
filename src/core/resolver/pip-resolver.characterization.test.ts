import { beforeEach, describe, expect, it, vi } from 'vitest';

type PackageFixture = {
  latest: string;
  versions: Record<
    string,
    {
      requiresDist?: string[];
      requiresPython?: string;
      urls?: Array<{
        filename: string;
        size?: number;
        packagetype?: string;
        requires_python?: string;
        yanked?: boolean;
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
    requiresPython?: string;
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
            requires_python: fixture.versions[fixture.latest]?.requiresPython,
          },
          releases: Object.fromEntries(
            Object.entries(fixture.versions).map(([currentVersion, currentFixture]) => [
              currentVersion,
              currentFixture.urls ?? [
                {
                  filename: `${name}-${currentVersion}.tar.gz`,
                  packagetype: 'sdist',
                },
              ],
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
          requires_python: versionFixture.requiresPython,
        },
        urls: versionFixture.urls ?? [
          {
            filename: `${name}-${resolvedVersion}.tar.gz`,
            packagetype: 'sdist',
          },
        ],
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
    simpleApiMock.fetchWheelMetadata.mockResolvedValue({ status: 'not-advertised' });
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

  it('필수 의존성의 만족 가능한 버전이 없으면 직접 루트를 실패시킨다', async () => {
    pipCacheMock.fetchPackageMetadata.mockImplementation(
      createPyPIFixtureResponder({
        root: {
          latest: '1.0.0',
          versions: {
            '1.0.0': { requiresDist: ['missing>=1.0.0'] },
          },
        },
      })
    );

    const resolver = new PipResolver();

    await expect(resolver.resolveDependencies('root', '1.0.0')).rejects.toThrow(
      '필수 의존성 해결 실패: root@1.0.0 -> missing'
    );
  });

  it('필수 의존성 메타데이터 조회가 실패하면 직접 루트를 실패시킨다', async () => {
    const respond = createPyPIFixtureResponder({
      root: {
        latest: '1.0.0',
        versions: {
          '1.0.0': { requiresDist: ['child>=1.0.0'] },
        },
      },
      child: {
        latest: '1.0.0',
        versions: {
          '1.0.0': {},
        },
      },
    });
    pipCacheMock.fetchPackageMetadata.mockImplementation(async (name: string, version?: string) => {
      if (name === 'child' && version === '1.0.0') {
        throw new Error('child metadata unavailable');
      }
      return respond(name, version);
    });

    const resolver = new PipResolver();

    await expect(resolver.resolveDependencies('root', '1.0.0')).rejects.toThrow(
      '필수 의존성 해결 실패: root@1.0.0 -> child'
    );
  });

  it('최대 깊이를 넘어 확장해야 하는 필수 의존성은 직접 루트를 실패시킨다', async () => {
    pipCacheMock.fetchPackageMetadata.mockImplementation(
      createPyPIFixtureResponder({
        root: {
          latest: '1.0.0',
          versions: {
            '1.0.0': { requiresDist: ['child>=1.0.0'] },
          },
        },
        child: {
          latest: '1.0.0',
          versions: {
            '1.0.0': { requiresDist: ['grandchild>=1.0.0'] },
          },
        },
        grandchild: {
          latest: '1.0.0',
          versions: {
            '1.0.0': {},
          },
        },
      })
    );

    const resolver = new PipResolver();

    await expect(
      resolver.resolveDependencies('root', '1.0.0', { maxDepth: 1 })
    ).rejects.toThrow('필수 의존성 해결 실패: child@1.0.0 -> grandchild');
  });

  it('필수 의존성의 호환되지 않는 버전으로 대체하지 않고 직접 루트를 실패시킨다', async () => {
    pipCacheMock.fetchPackageMetadata.mockImplementation(
      createPyPIFixtureResponder({
        root: {
          latest: '1.0.0',
          versions: {
            '1.0.0': { requiresDist: ['child>=2.0.0'] },
          },
        },
        child: {
          latest: '1.0.0',
          versions: {
            '1.0.0': {},
          },
        },
      })
    );

    const resolver = new PipResolver();

    await expect(resolver.resolveDependencies('root', '1.0.0')).rejects.toThrow(
      '필수 의존성 해결 실패: root@1.0.0 -> child'
    );
  });

  it('대상 마커로 제외된 의존성은 직접 루트를 실패시키지 않는다', async () => {
    pipCacheMock.fetchPackageMetadata.mockImplementation(
      createPyPIFixtureResponder({
        root: {
          latest: '1.0.0',
          versions: {
            '1.0.0': { requiresDist: ['missing>=1.0.0 ; sys_platform == "win32"'] },
          },
        },
      })
    );

    const resolver = new PipResolver();
    const result = await resolver.resolveDependencies('root', '1.0.0', {
      targetPlatform: { system: 'Linux', machine: 'x86_64' },
    });

    expect(result.flatList).toHaveLength(1);
    expect(result.flatList[0]).toMatchObject({ name: 'root', version: '1.0.0' });
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

  it('서로 다른 경로의 extras를 같은 패키지에 합쳐 새 extra를 재확장한다', async () => {
    pipCacheMock.fetchPackageMetadata.mockImplementation(
      createPyPIFixtureResponder({
        root: {
          latest: '1.0.0',
          versions: {
            '1.0.0': { requiresDist: ['left>=1.0.0', 'right>=1.0.0'] },
          },
        },
        left: {
          latest: '1.0.0',
          versions: {
            '1.0.0': { requiresDist: ['shared[alpha]>=1.0.0'] },
          },
        },
        right: {
          latest: '1.0.0',
          versions: {
            '1.0.0': { requiresDist: ['shared[beta]>=1.0.0'] },
          },
        },
        shared: {
          latest: '1.0.0',
          versions: {
            '1.0.0': {
              requiresDist: [
                'alpha-child>=1.0.0 ; extra == "alpha"',
                'beta-child>=1.0.0 ; extra == "beta"',
              ],
            },
          },
        },
        alpha_child: {
          latest: '1.0.0',
          versions: {
            '1.0.0': {},
          },
        },
        beta_child: {
          latest: '1.0.0',
          versions: {
            '1.0.0': {},
          },
        },
      })
    );

    const resolver = new PipResolver();
    const result = await resolver.resolveDependencies('root', '1.0.0', {
      targetPlatform: { system: 'Linux', machine: 'x86_64' },
      pythonVersion: '3.12.2',
    });

    expect(result.flatList).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'shared', version: '1.0.0' }),
        expect.objectContaining({ name: 'alpha_child', version: '1.0.0' }),
        expect.objectContaining({ name: 'beta_child', version: '1.0.0' }),
      ])
    );
  });

  it('동일 패키지에서 기본 extra와 새 extra를 모두 유지한다', async () => {
    pipCacheMock.fetchPackageMetadata.mockImplementation(
      createPyPIFixtureResponder({
        root: {
          latest: '1.0.0',
          versions: {
            '1.0.0': { requiresDist: ['first>=1.0.0', 'second>=1.0.0'] },
          },
        },
        first: {
          latest: '1.0.0',
          versions: {
            '1.0.0': { requiresDist: ['shared>=1.0.0'] },
          },
        },
        second: {
          latest: '1.0.0',
          versions: {
            '1.0.0': { requiresDist: ['shared[docs]>=1.0.0'] },
          },
        },
        shared: {
          latest: '1.0.0',
          versions: {
            '1.0.0': {
              requiresDist: [
                'base-child>=1.0.0 ; extra != "docs"',
                'docs-child>=1.0.0 ; extra == "docs"',
              ],
            },
          },
        },
        base_child: {
          latest: '1.0.0',
          versions: {
            '1.0.0': {},
          },
        },
        docs_child: {
          latest: '1.0.0',
          versions: {
            '1.0.0': {},
          },
        },
      })
    );

    const resolver = new PipResolver();
    const result = await resolver.resolveDependencies('root', '1.0.0', {
      targetPlatform: { system: 'Linux', machine: 'x86_64' },
      pythonVersion: '3.12.2',
    });

    expect(result.flatList).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'base_child', version: '1.0.0' }),
        expect.objectContaining({ name: 'docs_child', version: '1.0.0' }),
      ])
    );
  });

  it('한 직접 루트의 extras가 다음 직접 루트로 누출되지 않는다', async () => {
    pipCacheMock.fetchPackageMetadata.mockImplementation(
      createPyPIFixtureResponder({
        root_one: {
          latest: '1.0.0',
          versions: {
            '1.0.0': { requiresDist: ['shared[docs]>=1.0.0'] },
          },
        },
        root_two: {
          latest: '1.0.0',
          versions: {
            '1.0.0': { requiresDist: ['shared>=1.0.0'] },
          },
        },
        shared: {
          latest: '1.0.0',
          versions: {
            '1.0.0': {
              requiresDist: ['docs-child>=1.0.0 ; extra == "docs"'],
            },
          },
        },
        docs_child: {
          latest: '1.0.0',
          versions: {
            '1.0.0': {},
          },
        },
      })
    );

    const resolver = new PipResolver();
    const options = {
      targetPlatform: { system: 'Linux' as const, machine: 'x86_64' as const },
      pythonVersion: '3.12.2',
    };

    const first = await resolver.resolveDependencies('root_one', '1.0.0', options);
    const second = await resolver.resolveDependencies('root_two', '1.0.0', options);

    expect(first.flatList).toContainEqual(
      expect.objectContaining({ name: 'docs_child', version: '1.0.0' })
    );
    expect(second.flatList).not.toContainEqual(
      expect.objectContaining({ name: 'docs_child', version: '1.0.0' })
    );
  });

  it('만족 불가능한 필수 버전 제약은 직접 루트를 실패시킨다', async () => {
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

    await expect(resolver.resolveDependencies('rootpkg', '1.0.0')).rejects.toThrow(
      '필수 의존성 해결 실패: rootpkg@1.0.0 -> urllib3'
    );
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
        return {
          status: 'available',
          requiresDist: ['typing-extensions>=4.12.2'],
        };
      }
      return {
        status: 'available',
        requiresDist: [],
      };
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

  it('광고된 PEP 658 메타데이터를 읽지 못하고 PyPI 대체도 없으면 root를 실패시킨다', async () => {
    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      {
        filename: 'root-1.0.0-py3-none-any.whl',
        url: 'https://packages.example.com/root-1.0.0.whl',
        metadataHash: { algorithm: 'sha256', digest: 'abc123' },
      },
    ]);
    simpleApiMock.fetchWheelMetadata.mockResolvedValue({
      status: 'unavailable',
      error: 'metadata unavailable',
    });
    pipCacheMock.fetchPackageMetadata.mockResolvedValue(null);

    const resolver = new PipResolver();

    await expect(
      resolver.resolveDependencies('root', '1.0.0', {
        indexUrl: 'https://packages.example.com/simple',
        pythonVersion: '3.12',
      })
    ).rejects.toThrow('PEP 658 메타데이터를 읽을 수 없습니다');
  });

  it('메타데이터가 없는 커스텀 산출물에 PyPI 대체도 없으면 root를 실패시킨다', async () => {
    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      {
        filename: 'root-1.0.0-py3-none-any.whl',
        url: 'https://packages.example.com/root-1.0.0.whl',
      },
    ]);
    simpleApiMock.fetchWheelMetadata.mockResolvedValue({
      status: 'not-advertised',
    });
    pipCacheMock.fetchPackageMetadata.mockResolvedValue(null);

    const resolver = new PipResolver();

    await expect(
      resolver.resolveDependencies('root', '1.0.0', {
        indexUrl: 'https://packages.example.com/simple',
        pythonVersion: '3.12',
      })
    ).rejects.toThrow('의존성 메타데이터를 확인할 수 없습니다');
  });

  it('빈 PEP 658 메타데이터는 PyPI 대체 없이 의존성 없는 root로 처리한다', async () => {
    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      {
        filename: 'root-1.0.0-py3-none-any.whl',
        url: 'https://packages.example.com/root-1.0.0.whl',
        metadataHash: { algorithm: 'sha256', digest: 'abc123' },
      },
    ]);
    simpleApiMock.fetchWheelMetadata.mockResolvedValue({
      status: 'available',
      requiresDist: [],
    });
    pipCacheMock.fetchPackageMetadata.mockRejectedValue(new Error('PyPI fallback should not run'));

    const resolver = new PipResolver();
    const result = await resolver.resolveDependencies('root', '1.0.0', {
      indexUrl: 'https://packages.example.com/simple',
      pythonVersion: '3.12',
    });

    expect(result.flatList).toHaveLength(1);
    expect(pipCacheMock.fetchPackageMetadata).not.toHaveBeenCalled();
  });

  it('커스텀 인덱스에서 호환 산출물이 없는 root를 해결 실패로 처리한다', async () => {
    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      {
        filename: 'native-only-1.0.0-py310-none-any.whl',
        url: 'https://packages.example.com/native-only-1.0.0-py310.whl',
      },
      {
        filename: 'native-only-1.0.0-cp313-abi3-manylinux_2_28_x86_64.whl',
        url: 'https://packages.example.com/native-only-1.0.0-cp313.whl',
      },
    ]);
    pipCacheMock.fetchPackageMetadata.mockResolvedValue(null);

    const resolver = new PipResolver();

    await expect(
      resolver.resolveDependencies('native-only', '1.0.0', {
        indexUrl: 'https://packages.example.com/simple',
        targetPlatform: { system: 'Linux', machine: 'x86_64' },
        pythonVersion: '3.12',
      })
    ).rejects.toThrow('호환되는 패키지를 찾을 수 없습니다: native-only@1.0.0');
  });

  it('PyPI가 빈 파일 목록을 반환한 root를 해결 실패로 처리한다', async () => {
    pipCacheMock.fetchPackageMetadata.mockImplementation(
      createPyPIFixtureResponder({
        empty: {
          latest: '1.0.0',
          versions: {
            '1.0.0': { urls: [] },
          },
        },
      })
    );

    const resolver = new PipResolver();

    await expect(
      resolver.resolveDependencies('empty', '1.0.0', { pythonVersion: '3.12' })
    ).rejects.toThrow('호환되는 패키지를 찾을 수 없습니다: empty@1.0.0');
  });

  it('PyPI 파일의 requires_python이 대상보다 높으면 root를 해결 실패로 처리한다', async () => {
    pipCacheMock.fetchPackageMetadata.mockImplementation(
      createPyPIFixtureResponder({
        future: {
          latest: '1.0.0',
          versions: {
            '1.0.0': {
              urls: [
                {
                  filename: 'future-1.0.0-py3-none-any.whl',
                  packagetype: 'bdist_wheel',
                  requires_python: '>=3.13',
                },
                {
                  filename: 'future-1.0.0.tar.gz',
                  packagetype: 'sdist',
                  requires_python: '>=3.13',
                },
              ],
            },
          },
        },
      })
    );

    const resolver = new PipResolver();

    await expect(
      resolver.resolveDependencies('future', '1.0.0', { pythonVersion: '3.12' })
    ).rejects.toThrow('호환되는 패키지를 찾을 수 없습니다: future@1.0.0');
  });

  it('Simple API 파일의 requiresPython이 대상보다 높으면 root를 해결 실패로 처리한다', async () => {
    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      {
        filename: 'future-1.0.0-py3-none-any.whl',
        url: 'https://packages.example.com/future-1.0.0.whl',
        requiresPython: '>=3.13',
      },
      {
        filename: 'future-1.0.0.tar.gz',
        url: 'https://packages.example.com/future-1.0.0.tar.gz',
        requiresPython: '>=3.13',
      },
    ]);
    pipCacheMock.fetchPackageMetadata.mockResolvedValue(null);

    const resolver = new PipResolver();

    await expect(
      resolver.resolveDependencies('future', '1.0.0', {
        indexUrl: 'https://packages.example.com/simple',
        pythonVersion: '3.12',
      })
    ).rejects.toThrow('호환되는 패키지를 찾을 수 없습니다: future@1.0.0');
  });

  it('PyPI latest는 대상 Python과 호환되는 이전 릴리스를 선택한다', async () => {
    pipCacheMock.fetchPackageMetadata.mockImplementation(
      createPyPIFixtureResponder({
        future: {
          latest: '2.0.0',
          versions: {
            '1.0.0': {
              urls: [
                {
                  filename: 'future-1.0.0-py3-none-any.whl',
                  packagetype: 'bdist_wheel',
                  requires_python: '<3.13',
                },
              ],
            },
            '2.0.0': {
              requiresPython: '>=3.13',
              urls: [
                {
                  filename: 'future-2.0.0-py3-none-any.whl',
                  packagetype: 'bdist_wheel',
                  requires_python: '>=3.13',
                },
              ],
            },
          },
        },
      })
    );

    const resolver = new PipResolver();
    const result = await resolver.resolveDependencies('future', 'latest', { pythonVersion: '3.12' });

    expect(result.root.package.version).toBe('1.0.0');
  });

  it('PyPI latest는 yanked와 프리릴리스보다 안정 릴리스를 선택한다', async () => {
    pipCacheMock.fetchPackageMetadata.mockImplementation(
      createPyPIFixtureResponder({
        future: {
          latest: '2.0.0rc1',
          versions: {
            '1.0.0': {
              urls: [
                {
                  filename: 'future-1.0.0-py3-none-any.whl',
                  packagetype: 'bdist_wheel',
                },
              ],
            },
            '1.1.0': {
              urls: [
                {
                  filename: 'future-1.1.0-py3-none-any.whl',
                  packagetype: 'bdist_wheel',
                  yanked: true,
                },
              ],
            },
            '2.0.0rc1': {
              urls: [
                {
                  filename: 'future-2.0.0rc1-py3-none-any.whl',
                  packagetype: 'bdist_wheel',
                },
              ],
            },
          },
        },
      })
    );

    const resolver = new PipResolver();
    const result = await resolver.resolveDependencies('future', 'latest');

    expect(result.root.package.version).toBe('1.0.0');
  });

  it('정확히 고정한 yanked PyPI 릴리스는 선택할 수 있다', async () => {
    pipCacheMock.fetchPackageMetadata.mockImplementation(
      createPyPIFixtureResponder({
        future: {
          latest: '1.1.0',
          versions: {
            '1.1.0': {
              urls: [
                {
                  filename: 'future-1.1.0-py3-none-any.whl',
                  packagetype: 'bdist_wheel',
                  yanked: true,
                },
              ],
            },
          },
        },
      })
    );

    const resolver = new PipResolver();
    const result = await resolver.resolveDependencies('future', '1.1.0');

    expect(result.root.package.version).toBe('1.1.0');
  });

  it('PyPI의 정확 고정 yanked 전이 의존성은 포함한다', async () => {
    pipCacheMock.fetchPackageMetadata.mockImplementation(
      createPyPIFixtureResponder({
        root: {
          latest: '1.0.0',
          versions: {
            '1.0.0': { requiresDist: ['future==1.1.0'] },
          },
        },
        future: {
          latest: '1.1.0',
          versions: {
            '1.1.0': {
              urls: [
                {
                  filename: 'future-1.1.0-py3-none-any.whl',
                  packagetype: 'bdist_wheel',
                  yanked: true,
                },
              ],
            },
          },
        },
      })
    );

    const resolver = new PipResolver();
    const result = await resolver.resolveDependencies('root', '1.0.0');

    expect(result.flatList).toContainEqual(
      expect.objectContaining({ name: 'future', version: '1.1.0' })
    );
  });

  it('Simple API의 정확 고정 yanked 전이 의존성은 포함한다', async () => {
    const filesByPackage: SimpleApiFixture = {
      root: [
        {
          filename: 'root-1.0.0-py3-none-any.whl',
          url: 'https://packages.example.com/root-1.0.0.whl',
          metadataHash: 'sha256:root',
        },
      ],
      future: [
        {
          filename: 'future-1.1.0-py3-none-any.whl',
          url: 'https://packages.example.com/future-1.1.0.whl',
          metadataHash: 'sha256:future',
          yanked: true,
        },
      ],
    };
    simpleApiMock.fetchPackageFiles.mockImplementation(async (_indexUrl: string, name: string) => {
      return filesByPackage[name] ?? [];
    });
    simpleApiMock.fetchWheelMetadata.mockImplementation(async (file: { filename: string }) => {
      return file.filename.startsWith('root-')
        ? { status: 'available', requiresDist: ['future===1.1.0'] }
        : { status: 'available', requiresDist: [] };
    });
    pipCacheMock.fetchPackageMetadata.mockResolvedValue(null);

    const resolver = new PipResolver();
    const result = await resolver.resolveDependencies('root', '1.0.0', {
      indexUrl: 'https://packages.example.com/simple',
    });

    expect(result.flatList).toContainEqual(
      expect.objectContaining({ name: 'future', version: '1.1.0' })
    );
  });

  it('PyPI의 wildcard 버전 범위에서는 yanked 전이 의존성을 제외한다', async () => {
    pipCacheMock.fetchPackageMetadata.mockImplementation(
      createPyPIFixtureResponder({
        root: {
          latest: '1.0.0',
          versions: {
            '1.0.0': { requiresDist: ['future==1.*'] },
          },
        },
        future: {
          latest: '1.2.0',
          versions: {
            '1.1.0': {
              urls: [
                {
                  filename: 'future-1.1.0-py3-none-any.whl',
                  packagetype: 'bdist_wheel',
                },
              ],
            },
            '1.2.0': {
              urls: [
                {
                  filename: 'future-1.2.0-py3-none-any.whl',
                  packagetype: 'bdist_wheel',
                  yanked: true,
                },
              ],
            },
          },
        },
      })
    );

    const resolver = new PipResolver();
    const result = await resolver.resolveDependencies('root', '1.0.0');

    expect(result.flatList).toContainEqual(
      expect.objectContaining({ name: 'future', version: '1.1.0' })
    );
    expect(result.flatList).not.toContainEqual(
      expect.objectContaining({ name: 'future', version: '1.2.0' })
    );
  });

  it('Simple API의 wildcard 버전 범위에서는 yanked 전이 의존성을 제외한다', async () => {
    const filesByPackage: SimpleApiFixture = {
      root: [
        {
          filename: 'root-1.0.0-py3-none-any.whl',
          url: 'https://packages.example.com/root-1.0.0.whl',
          metadataHash: 'sha256:root',
        },
      ],
      future: [
        {
          filename: 'future-1.1.0-py3-none-any.whl',
          url: 'https://packages.example.com/future-1.1.0.whl',
          metadataHash: 'sha256:future-1.1.0',
        },
        {
          filename: 'future-1.2.0-py3-none-any.whl',
          url: 'https://packages.example.com/future-1.2.0.whl',
          metadataHash: 'sha256:future-1.2.0',
          yanked: true,
        },
      ],
    };
    simpleApiMock.fetchPackageFiles.mockImplementation(async (_indexUrl: string, name: string) => {
      return filesByPackage[name] ?? [];
    });
    simpleApiMock.fetchWheelMetadata.mockImplementation(async (file: { filename: string }) => {
      return file.filename.startsWith('root-')
        ? { status: 'available', requiresDist: ['future==1.*'] }
        : { status: 'available', requiresDist: [] };
    });
    pipCacheMock.fetchPackageMetadata.mockResolvedValue(null);

    const resolver = new PipResolver();
    const result = await resolver.resolveDependencies('root', '1.0.0', {
      indexUrl: 'https://packages.example.com/simple',
    });

    expect(result.flatList).toContainEqual(
      expect.objectContaining({ name: 'future', version: '1.1.0' })
    );
    expect(result.flatList).not.toContainEqual(
      expect.objectContaining({ name: 'future', version: '1.2.0' })
    );
  });

  it('python_version marker는 대상 Python patch 버전에서 major.minor만 사용한다', async () => {
    pipCacheMock.fetchPackageMetadata.mockImplementation(
      createPyPIFixtureResponder({
        root: {
          latest: '1.0.0',
          versions: {
            '1.0.0': {
              requiresDist: ['future==1.0.0; python_version < "3.12.1"'],
            },
          },
        },
        future: {
          latest: '1.0.0',
          versions: {
            '1.0.0': {},
          },
        },
      })
    );

    const resolver = new PipResolver();
    const result = await resolver.resolveDependencies('root', '1.0.0', {
      pythonVersion: '3.12.2',
      targetPlatform: {
        system: 'Linux',
        machine: 'x86_64',
      },
    });

    expect(result.flatList).toContainEqual(
      expect.objectContaining({ name: 'future', version: '1.0.0' })
    );
  });

  it('프리릴리스를 명시한 범위는 PEP 440 순서로 가장 높은 rc를 선택한다', async () => {
    pipCacheMock.fetchPackageMetadata.mockImplementation(
      createPyPIFixtureResponder({
        root: {
          latest: '1.0.0',
          versions: {
            '1.0.0': { requiresDist: ['future>=1.0.0rc1,<1.0.0'] },
          },
        },
        future: {
          latest: '1.0.0rc10',
          versions: {
            '1.0.0rc2': {
              urls: [
                {
                  filename: 'future-1.0.0rc2-py3-none-any.whl',
                  packagetype: 'bdist_wheel',
                },
              ],
            },
            '1.0.0rc10': {
              urls: [
                {
                  filename: 'future-1.0.0rc10-py3-none-any.whl',
                  packagetype: 'bdist_wheel',
                },
              ],
            },
          },
        },
      })
    );

    const resolver = new PipResolver();
    const result = await resolver.resolveDependencies('root', '1.0.0');

    expect(result.flatList).toContainEqual(
      expect.objectContaining({ name: 'future', version: '1.0.0rc10' })
    );
  });

  it('PyPI 범위 의존성은 대상 Python과 호환되는 이전 릴리스를 포함한다', async () => {
    pipCacheMock.fetchPackageMetadata.mockImplementation(
      createPyPIFixtureResponder({
        root: {
          latest: '1.0.0',
          versions: {
            '1.0.0': { requiresDist: ['future>=1.0.0'] },
          },
        },
        future: {
          latest: '2.0.0',
          versions: {
            '1.0.0': {
              urls: [
                {
                  filename: 'future-1.0.0-py3-none-any.whl',
                  packagetype: 'bdist_wheel',
                  requires_python: '<3.13',
                },
              ],
            },
            '2.0.0': {
              requiresPython: '>=3.13',
              urls: [
                {
                  filename: 'future-2.0.0-py3-none-any.whl',
                  packagetype: 'bdist_wheel',
                  requires_python: '>=3.13',
                },
              ],
            },
          },
        },
      })
    );

    const resolver = new PipResolver();
    const result = await resolver.resolveDependencies('root', '1.0.0', { pythonVersion: '3.12' });

    expect(result.flatList).toContainEqual(expect.objectContaining({ name: 'future', version: '1.0.0' }));
  });

  it('Simple API latest는 대상 Python과 호환되는 이전 릴리스를 선택한다', async () => {
    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      {
        filename: 'future-1.0.0-py3-none-any.whl',
        url: 'https://packages.example.com/future-1.0.0.whl',
        requiresPython: '<3.13',
      },
      {
        filename: 'future-2.0.0-py3-none-any.whl',
        url: 'https://packages.example.com/future-2.0.0.whl',
        requiresPython: '>=3.13',
      },
    ]);
    pipCacheMock.fetchPackageMetadata.mockResolvedValue({
      data: {
        info: {
          requires_dist: [],
        },
      },
    });

    const resolver = new PipResolver();
    const result = await resolver.resolveDependencies('future', 'latest', {
      indexUrl: 'https://packages.example.com/simple',
      pythonVersion: '3.12',
    });

    expect(result.root.package.version).toBe('1.0.0');
  });
});
