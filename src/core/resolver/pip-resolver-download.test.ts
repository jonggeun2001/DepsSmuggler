import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { PipDownloader } from '../downloaders/pip';
import { PipResolver } from './pip-resolver';
import logger from '../../utils/logger';

async function expectSelectedArtifactIsDownloaded(
  packageInfo: Awaited<
    ReturnType<PipResolver['resolveDependencies']>
  >['root']['package'],
  expectedUrl: string,
  expectedChecksum: string,
  expectedAlgorithm = 'sha256',
): Promise<void> {
  const downloader = new PipDownloader();
  const getMetadata = vi
    .spyOn(downloader, 'getPackageMetadata')
    .mockResolvedValue({
      type: 'pip',
      name: packageInfo.name,
      version: packageInfo.version,
      metadata: {
        downloadUrl: 'https://files.example/unexpected.whl',
      },
    });
  const verifyChecksum = vi
    .spyOn(downloader, 'verifyChecksum')
    .mockResolvedValue(true);
  const downloadArtifactFile = vi
    .spyOn(downloader as any, 'downloadArtifactFile')
    .mockResolvedValue('/tmp/test/demo.whl');

  await downloader.downloadPackage(packageInfo, '/tmp/test');

  expect(getMetadata).not.toHaveBeenCalled();
  expect(downloadArtifactFile).toHaveBeenCalledWith(
    '/tmp/test',
    expect.objectContaining({ downloadUrl: expectedUrl }),
    undefined,
  );

  const artifactOptions = downloadArtifactFile.mock.calls[0][1];
  await artifactOptions.verifyFile('/tmp/test/demo.whl');
  expect(verifyChecksum).toHaveBeenCalledWith(
    '/tmp/test/demo.whl',
    expectedChecksum,
    expectedAlgorithm,
  );
}

describe('PipResolver에서 PipDownloader까지 선택 아티팩트 전달', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('PyPI latest 요청은 더 높은 프리릴리스보다 안정 릴리스를 선택한다', async () => {
    const release = (version: string) => ({
      filename: `demo-${version}-py3-none-any.whl`,
      url: `https://files.example/demo-${version}.whl`,
      packagetype: 'bdist_wheel',
      python_version: 'py3',
      digests: { sha256: `${version}-sha` },
      size: 80,
    });
    pipCacheMock.fetchPackageMetadata.mockImplementation(
      async (_name: string, version?: string) => {
        if (version === undefined) {
          return {
            data: {
              info: { name: 'demo', version: '2.0rc1' },
              releases: {
                '1.9': [release('1.9')],
                '2.0rc1': [release('2.0rc1')],
              },
            },
          };
        }
        return {
          data: {
            info: {
              name: 'demo',
              version,
              requires_dist: [],
            },
            urls: [release(version)],
          },
        };
      },
    );

    const result = await new PipResolver().resolveDependencies(
      'demo',
      'latest',
      { maxDepth: 0 },
    );

    expect(result.root.package.version).toBe('1.9');
    expect(result.root.package.metadata?.filename).toBe(
      'demo-1.9-py3-none-any.whl',
    );
  });

  it('Simple API latest 요청은 더 높은 프리릴리스보다 안정 릴리스를 선택한다', async () => {
    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      {
        filename: 'demo-1.9-py3-none-any.whl',
        url: 'https://index.example/demo-1.9.whl',
      },
      {
        filename: 'demo-2.0rc1-py3-none-any.whl',
        url: 'https://index.example/demo-2.0rc1.whl',
      },
    ]);
    simpleApiMock.fetchWheelMetadata.mockResolvedValue({
      status: 'available',
      requiresDist: [],
    });
    pipCacheMock.fetchPackageMetadata.mockResolvedValue(null);

    const result = await new PipResolver().resolveDependencies(
      'demo',
      'latest',
      {
        maxDepth: 0,
        indexUrl: 'https://index.example/simple',
      },
    );

    expect(result.root.package.version).toBe('1.9');
    expect(result.root.package.metadata?.filename).toBe(
      'demo-1.9-py3-none-any.whl',
    );
  });

  it('안정 릴리스가 없으면 Simple API latest가 프리릴리스를 선택한다', async () => {
    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      {
        filename: 'demo-2.0rc1-py3-none-any.whl',
        url: 'https://index.example/demo-2.0rc1.whl',
      },
      {
        filename: 'demo-2.0rc2-py3-none-any.whl',
        url: 'https://index.example/demo-2.0rc2.whl',
      },
    ]);
    simpleApiMock.fetchWheelMetadata.mockResolvedValue({
      status: 'available',
      requiresDist: [],
    });
    pipCacheMock.fetchPackageMetadata.mockResolvedValue(null);

    const result = await new PipResolver().resolveDependencies(
      'demo',
      'latest',
      {
        maxDepth: 0,
        indexUrl: 'https://index.example/simple',
      },
    );

    expect(result.root.package.version).toBe('2.0rc2');
  });

  it('커스텀 PEP 658 메타데이터가 비어 있으면 PyPI 의존성을 섞지 않는다', async () => {
    simpleApiMock.fetchPackageFiles.mockImplementation(
      async (_indexUrl: string, name: string) =>
        name === 'custom-root'
          ? [
              {
                filename:
                  'custom_root-1.0.0-py3-none-any.whl',
                url: 'https://index.example/custom-root.whl',
                hash: {
                  algorithm: 'sha256',
                  digest: 'custom-root-sha',
                },
                metadataHash: {
                  algorithm: 'sha256',
                  digest: 'custom-root-metadata',
                },
              },
            ]
          : [],
    );
    simpleApiMock.fetchWheelMetadata.mockResolvedValue({
      status: 'available',
      requiresDist: [],
    });
    pipCacheMock.fetchPackageMetadata.mockImplementation(
      async (name: string, version?: string) => {
        if (name === 'custom-root') {
          return {
            data: {
              info: {
                name,
                version: version ?? '1.0.0',
                requires_dist: ['public-child==1.0.0'],
              },
              urls: [],
            },
          };
        }
        if (name === 'public_child' && version === undefined) {
          return {
            data: {
              info: { name, version: '1.0.0' },
              releases: {
                '1.0.0': [
                  {
                    filename:
                      'public_child-1.0.0-py3-none-any.whl',
                    url: 'https://files.example/public-child.whl',
                    packagetype: 'bdist_wheel',
                    python_version: 'py3',
                    digests: { sha256: 'public-child-sha' },
                    size: 10,
                  },
                ],
              },
            },
          };
        }
        return null;
      },
    );

    const result = await new PipResolver().resolveDependencies(
      'custom-root',
      '1.0.0',
      { indexUrl: 'https://index.example/simple' },
    );

    expect(result.flatList.map((pkg) => pkg.name)).toEqual([
      'custom-root',
    ]);
    expect(
      pipCacheMock.fetchPackageMetadata,
    ).not.toHaveBeenCalled();
  });

  it('PEP 658 조회 실패와 PyPI 체크섬 불일치 시 의존성 해결을 실패시킨다', async () => {
    simpleApiMock.fetchPackageFiles.mockImplementation(
      async (_indexUrl: string, name: string) =>
        name === 'custom-root'
          ? [
              {
                filename:
                  'custom_root-1.0.0-py3-none-any.whl',
                url: 'https://index.example/custom-root.whl',
                hash: {
                  algorithm: 'sha256',
                  digest: 'custom-root-sha',
                },
                metadataHash: {
                  algorithm: 'sha256',
                  digest: 'custom-root-metadata',
                },
              },
            ]
          : [],
    );
    simpleApiMock.fetchWheelMetadata.mockResolvedValue({
      status: 'not-advertised',
    });
    pipCacheMock.fetchPackageMetadata.mockResolvedValue({
      data: {
        info: {
          name: 'custom-root',
          version: '1.0.0',
          requires_dist: ['wrong-child==1.0.0'],
        },
        urls: [
          {
            filename: 'custom_root-1.0.0-py3-none-any.whl',
            digests: { sha256: 'different-public-sha' },
          },
        ],
      },
    });

    await expect(
      new PipResolver().resolveDependencies(
        'custom-root',
        '1.0.0',
        {
          indexUrl: 'https://index.example/simple',
        },
      ),
    ).rejects.toThrow(
      '검증된 의존성 메타데이터를 찾을 수 없습니다',
    );
  });

  it('해시 없는 PEP 714 metadata는 의존성 해결에 사용하지 않는다', async () => {
    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      {
        filename: 'custom_root-1.0.0-py3-none-any.whl',
        url: 'https://index.example/custom-root.whl',
        hash: {
          algorithm: 'sha256',
          digest: 'custom-root-sha',
        },
        metadataAvailable: true,
      },
    ]);
    pipCacheMock.fetchPackageMetadata.mockResolvedValue(null);

    await expect(
      new PipResolver().resolveDependencies(
        'custom-root',
        '1.0.0',
        {
          indexUrl: 'https://index.example/simple',
        },
      ),
    ).rejects.toThrow(
      '검증된 의존성 메타데이터를 찾을 수 없습니다',
    );
    expect(simpleApiMock.fetchWheelMetadata).toHaveBeenCalledTimes(1);
  });

  it('no-deps 깊이에서도 검증된 커스텀 의존성 메타데이터를 요구한다', async () => {
    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      {
        filename: 'custom_root-1.0.0-py3-none-any.whl',
        url: 'https://index.example/custom-root.whl',
        hash: {
          algorithm: 'sha256',
          digest: 'custom-root-sha',
        },
      },
    ]);
    simpleApiMock.fetchWheelMetadata.mockResolvedValue({
      status: 'not-advertised',
    });
    pipCacheMock.fetchPackageMetadata.mockResolvedValue(null);

    await expect(
      new PipResolver().resolveDependencies('custom-root', '1.0.0', {
        maxDepth: 0,
        indexUrl: 'https://index.example/simple',
      }),
    ).rejects.toThrow('검증된 의존성 메타데이터를 찾을 수 없습니다');
  });

  it('no-deps 깊이에서는 의존성이 있는 검증된 루트만 반환한다', async () => {
    pipCacheMock.fetchPackageMetadata.mockResolvedValue({
      data: {
        info: {
          name: 'demo',
          version: '1.0.0',
          requires_dist: ['child>=1.0'],
        },
        urls: [
          {
            filename: 'demo-1.0.0-py3-none-any.whl',
            url: 'https://files.example/demo-1.0.0.whl',
            packagetype: 'bdist_wheel',
            python_version: 'py3',
            digests: { sha256: 'demo-sha' },
            size: 80,
          },
        ],
      },
    });

    const warnSpy = vi.spyOn(logger, 'warn');
    const result = await new PipResolver().resolveDependencies(
      'demo',
      '1.0.0',
      { maxDepth: 0, skipDependencyExpansion: true },
    );

    expect(result.flatList.map((pkg) => pkg.name)).toEqual(['demo']);
    expect(pipCacheMock.fetchPackageMetadata).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('최대 의존성 탐색 깊이'),
      expect.anything(),
    );
  });

  it('PEP 658 조회 실패 시 체크섬이 같은 PyPI 메타데이터만 사용한다', async () => {
    const customFile = {
      filename: 'custom_root-1.0.0-py3-none-any.whl',
      url: 'https://index.example/custom-root.whl',
      hash: {
        algorithm: 'sha256',
        digest: 'shared-artifact-sha',
      },
      metadataHash: {
        algorithm: 'sha256',
        digest: 'custom-root-metadata',
      },
    };
    simpleApiMock.fetchPackageFiles.mockImplementation(
      async (_indexUrl: string, name: string) =>
        name === 'custom-root' ? [customFile] : [],
    );
    simpleApiMock.fetchWheelMetadata.mockResolvedValue({
      status: 'not-advertised',
    });
    pipCacheMock.fetchPackageMetadata.mockImplementation(
      async (name: string, version?: string) => {
        if (name === 'custom-root') {
          return {
            data: {
              info: {
                name,
                version: '1.0.0',
                requires_dist: ['verified-child==1.0.0'],
              },
              urls: [
                {
                  filename: customFile.filename,
                  digests: {
                    sha256: 'shared-artifact-sha',
                  },
                },
              ],
            },
          };
        }
        if (name === 'verified_child' && version === undefined) {
          return {
            data: {
              info: { name, version: '1.0.0' },
              releases: {
                '1.0.0': [
                  {
                    filename:
                      'verified_child-1.0.0-py3-none-any.whl',
                    url: 'https://files.example/verified-child.whl',
                    packagetype: 'bdist_wheel',
                    python_version: 'py3',
                    digests: { sha256: 'verified-child-sha' },
                    size: 10,
                  },
                ],
              },
            },
          };
        }
        if (name === 'verified_child') {
          return {
            data: {
              info: {
                name,
                version: version ?? '1.0.0',
                requires_dist: [],
              },
              urls: [
                {
                  filename:
                    'verified_child-1.0.0-py3-none-any.whl',
                  url: 'https://files.example/verified-child.whl',
                  packagetype: 'bdist_wheel',
                  python_version: 'py3',
                  digests: { sha256: 'verified-child-sha' },
                  size: 10,
                },
              ],
            },
          };
        }
        return null;
      },
    );

    const result = await new PipResolver().resolveDependencies(
      'custom-root',
      '1.0.0',
      { indexUrl: 'https://index.example/simple' },
    );

    expect(result.flatList.map((pkg) => pkg.name).sort()).toEqual([
      'custom-root',
      'verified_child',
    ]);
  });

  it('프리릴리스가 명시된 제약에서도 같은 릴리스의 final을 우선한다', async () => {
    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      {
        filename: 'demo-3.0rc1-py3-none-any.whl',
        url: 'https://index.example/demo-3.0rc1.whl',
      },
      {
        filename: 'demo-3.0-py3-none-any.whl',
        url: 'https://index.example/demo-3.0.whl',
      },
    ]);

    const version = await (new PipResolver() as any).getLatestVersion(
      'demo',
      '>=2.0rc1',
      'https://index.example/simple',
    );

    expect(version).toBe('3.0');
  });

  it('c 프리릴리스 별칭이 명시된 제약은 더 높은 프리릴리스를 허용한다', async () => {
    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      {
        filename: 'demo-2.0-py3-none-any.whl',
        url: 'https://index.example/demo-2.0.whl',
      },
      {
        filename: 'demo-3.0rc1-py3-none-any.whl',
        url: 'https://index.example/demo-3.0rc1.whl',
      },
    ]);

    const version = await (new PipResolver() as any).getLatestVersion(
      'demo',
      '>=2.0c1',
      'https://index.example/simple',
    );

    expect(version).toBe('3.0rc1');
  });

  it('제외 제약에만 등장한 프리릴리스는 프리릴리스 허용 신호가 아니다', async () => {
    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      {
        filename: 'demo-1.9-py3-none-any.whl',
        url: 'https://index.example/demo-1.9.whl',
      },
      {
        filename: 'demo-2.0rc1-py3-none-any.whl',
        url: 'https://index.example/demo-2.0rc1.whl',
      },
      {
        filename: 'demo-2.0rc2-py3-none-any.whl',
        url: 'https://index.example/demo-2.0rc2.whl',
      },
    ]);

    const version = await (new PipResolver() as any).getLatestVersion(
      'demo',
      '!=2.0rc1',
      'https://index.example/simple',
    );

    expect(version).toBe('1.9');
  });

  it('PEP 440 === 제약으로 지정한 정확한 프리릴리스를 선택한다', async () => {
    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      {
        filename: 'demo-1.0rc1-py3-none-any.whl',
        url: 'https://index.example/demo-1.0rc1.whl',
      },
      {
        filename: 'demo-1.0-py3-none-any.whl',
        url: 'https://index.example/demo-1.0.whl',
      },
    ]);

    const version = await (new PipResolver() as any).getLatestVersion(
      'demo',
      '===1.0rc1',
      'https://index.example/simple',
    );

    expect(version).toBe('1.0rc1');
  });

  it('Simple API latest는 final보다 post release를 우선한다', async () => {
    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      {
        filename: 'demo-2.0-py3-none-any.whl',
        url: 'https://index.example/demo-2.0.whl',
      },
      {
        filename: 'demo-2.0.post1-py3-none-any.whl',
        url: 'https://index.example/demo-2.0.post1.whl',
      },
    ]);

    const version = await (new PipResolver() as any).getLatestVersion(
      'demo',
      undefined,
      'https://index.example/simple',
    );

    expect(version).toBe('2.0.post1');
  });

  it('Simple API latest는 같은 공개 버전의 최신 local version을 선택한다', async () => {
    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      {
        filename: 'demo-1.0-py3-none-any.whl',
        url: 'https://index.example/demo-1.0.whl',
      },
      {
        filename: 'demo-1.0+cpu-py3-none-any.whl',
        url: 'https://index.example/demo-1.0+cpu.whl',
      },
      {
        filename: 'demo-1.0+cu121-py3-none-any.whl',
        url: 'https://index.example/demo-1.0+cu121.whl',
      },
    ]);

    const version = await (new PipResolver() as any).getLatestVersion(
      'demo',
      undefined,
      'https://index.example/simple',
    );

    expect(version).toBe('1.0+cu121');
  });

  it('PyPI JSON에서 선택한 대상 wheel URL과 체크섬을 다운로드한다', async () => {
    pipCacheMock.fetchPackageMetadata.mockResolvedValue({
      data: {
        info: {
          name: 'demo',
          version: '1.0.0',
          requires_dist: [],
        },
        urls: [
          {
            filename:
              'demo-1.0.0-cp312-cp312-manylinux_2_17_x86_64.whl',
            url: 'https://files.example/demo-x86_64.whl',
            packagetype: 'bdist_wheel',
            python_version: 'cp312',
            digests: { sha256: 'x86-sha' },
            size: 100,
          },
          {
            filename:
              'demo-1.0.0-cp312-cp312-manylinux_2_17_aarch64.whl',
            url: 'https://files.example/demo-aarch64.whl',
            packagetype: 'bdist_wheel',
            python_version: 'cp312',
            digests: { sha256: 'arm-sha' },
            size: 120,
          },
        ],
      },
    });

    const result = await new PipResolver().resolveDependencies(
      'demo',
      '1.0.0',
      {
        maxDepth: 0,
        targetPlatform: { system: 'Linux', machine: 'aarch64' },
        pythonVersion: '3.12',
      },
    );

    expect(result.root.package.metadata).toMatchObject({
      filename: 'demo-1.0.0-cp312-cp312-manylinux_2_17_aarch64.whl',
      downloadUrl: 'https://files.example/demo-aarch64.whl',
      checksum: { sha256: 'arm-sha' },
    });
    await expectSelectedArtifactIsDownloaded(
      result.root.package,
      'https://files.example/demo-aarch64.whl',
      'arm-sha',
    );
  });

  it('대상 OS를 지정하지 않으면 Linux wheel 대신 범용 wheel을 선택한다', async () => {
    pipCacheMock.fetchPackageMetadata.mockResolvedValue({
      data: {
        info: {
          name: 'demo',
          version: '1.0.0',
          requires_dist: [],
        },
        urls: [
          {
            filename:
              'demo-1.0.0-cp312-cp312-manylinux_2_17_x86_64.whl',
            url: 'https://files.example/demo-linux.whl',
            packagetype: 'bdist_wheel',
            python_version: 'cp312',
            digests: { sha256: 'linux-sha' },
            size: 100,
          },
          {
            filename: 'demo-1.0.0-py3-none-any.whl',
            url: 'https://files.example/demo-any.whl',
            packagetype: 'bdist_wheel',
            python_version: 'py3',
            digests: { sha256: 'any-sha' },
            size: 80,
          },
        ],
      },
    });

    const result = await new PipResolver().resolveDependencies(
      'demo',
      '1.0.0',
      {
        maxDepth: 0,
        targetPlatform: { machine: 'x86_64' },
        pythonVersion: '3.12',
      },
    );

    expect(result.root.package.metadata).toMatchObject({
      filename: 'demo-1.0.0-py3-none-any.whl',
      downloadUrl: 'https://files.example/demo-any.whl',
    });
  });

  it('대상 Python을 지정하지 않으면 CPython 전용 wheel 대신 범용 wheel을 선택한다', async () => {
    pipCacheMock.fetchPackageMetadata.mockResolvedValue({
      data: {
        info: {
          name: 'demo',
          version: '1.0.0',
          requires_dist: [],
        },
        urls: [
          {
            filename:
              'demo-1.0.0-cp39-cp39-manylinux_2_17_x86_64.whl',
            url: 'https://files.example/demo-cp39.whl',
            packagetype: 'bdist_wheel',
            python_version: 'cp39',
            digests: { sha256: 'cp39-sha' },
            size: 100,
          },
          {
            filename: 'demo-1.0.0-py3-none-any.whl',
            url: 'https://files.example/demo-any.whl',
            packagetype: 'bdist_wheel',
            python_version: 'py3',
            digests: { sha256: 'any-sha' },
            size: 80,
          },
        ],
      },
    });

    const result = await new PipResolver().resolveDependencies(
      'demo',
      '1.0.0',
      {
        maxDepth: 0,
        targetPlatform: { system: 'Linux', machine: 'x86_64' },
      },
    );

    expect(result.root.package.metadata).toMatchObject({
      filename: 'demo-1.0.0-py3-none-any.whl',
      downloadUrl: 'https://files.example/demo-any.whl',
    });
  });

  it('필수 pip 하위 의존성 아티팩트를 찾지 못하면 전체 해결에 실패한다', async () => {
    pipCacheMock.fetchPackageMetadata.mockImplementation(
      async (name: string) => {
        if (name !== 'demo') {
          return null;
        }

        return {
          data: {
            info: {
              name: 'demo',
              version: '1.0.0',
              requires_dist: ['missing-dependency>=1.0'],
            },
            urls: [
              {
                filename: 'demo-1.0.0.tar.gz',
                url: 'https://files.example/demo-1.0.0.tar.gz',
                packagetype: 'sdist',
                python_version: 'source',
                digests: { sha256: 'sdist-sha' },
                size: 80,
              },
            ],
            releases: {
              '1.0.0': [],
            },
          },
        };
      },
    );

    await expect(
      new PipResolver().resolveDependencies('demo', '1.0.0', {
        targetPlatform: { system: 'Linux', machine: 'x86_64' },
        pythonVersion: '3.12',
      }),
    ).rejects.toThrow('필수 의존성 해결 실패: demo@1.0.0 -> missing_dependency');
  });

  it('선택한 필수 pip 하위 의존성 메타데이터 조회 오류를 전파한다', async () => {
    const universalRelease = (name: string) => ({
      filename: `${name}-1.0.0-py3-none-any.whl`,
      url: `https://files.example/${name}.whl`,
      packagetype: 'bdist_wheel',
      python_version: 'py3',
      digests: { sha256: `${name}-sha` },
      size: 80,
    });

    pipCacheMock.fetchPackageMetadata.mockImplementation(
      async (name: string, version?: string) => {
        if (name === 'demo') {
          return {
            data: {
              info: {
                name,
                version: '1.0.0',
                requires_dist: ['brokenchild==1.0.0'],
              },
              urls: [universalRelease(name)],
            },
          };
        }
        if (name === 'brokenchild' && version === undefined) {
          return {
            data: {
              info: { name, version: '1.0.0' },
              releases: {
                '1.0.0': [universalRelease(name)],
              },
            },
          };
        }
        if (name === 'brokenchild' && version === '1.0.0') {
          throw new Error('저장소 응답 오류');
        }
        return null;
      },
    );

    await expect(
      new PipResolver().resolveDependencies('demo', '1.0.0', {
        targetPlatform: { system: 'Linux', machine: 'x86_64' },
        pythonVersion: '3.12',
      }),
    ).rejects.toThrow('필수 의존성 해결 실패: demo@1.0.0 -> brokenchild');
  });

  it('PyPI JSON에서 버전 제약과 대상 Python을 모두 만족하는 최신 의존성을 선택한다', async () => {
    const rootRelease = {
      filename: 'demo-1.0.0-py3-none-any.whl',
      url: 'https://files.example/demo.whl',
      packagetype: 'bdist_wheel',
      python_version: 'py3',
      digests: { sha256: 'demo-sha' },
      size: 80,
    };
    const incompatibleRelease = {
      filename: 'jsonchild-2.0.0-cp313-cp313-manylinux_2_17_x86_64.whl',
      url: 'https://files.example/jsonchild-2.whl',
      packagetype: 'bdist_wheel',
      python_version: 'cp313',
      requires_python: '>=3.13',
      digests: { sha256: 'child-2-sha' },
      size: 100,
    };
    const compatibleRelease = {
      filename: 'jsonchild-1.5.0-cp312-cp312-manylinux_2_17_x86_64.whl',
      url: 'https://files.example/jsonchild-1.5.whl',
      packagetype: 'bdist_wheel',
      python_version: 'cp312',
      requires_python: '>=3.12',
      digests: { sha256: 'child-1-sha' },
      size: 90,
    };

    pipCacheMock.fetchPackageMetadata.mockImplementation(
      async (name: string, version?: string) => {
        if (name === 'demo') {
          return {
            data: {
              info: {
                name,
                version: '1.0.0',
                requires_dist: ['jsonchild<3'],
              },
              urls: [rootRelease],
            },
          };
        }
        if (name === 'jsonchild' && version === undefined) {
          return {
            data: {
              info: { name, version: '2.0.0' },
              releases: {
                '2.0.0': [incompatibleRelease],
                '1.5.0': [compatibleRelease],
              },
            },
          };
        }
        if (name === 'jsonchild' && version === '1.5.0') {
          return {
            data: {
              info: {
                name,
                version,
                requires_dist: [],
              },
              urls: [compatibleRelease],
            },
          };
        }
        if (name === 'jsonchild' && version === '2.0.0') {
          return {
            data: {
              info: {
                name,
                version,
                requires_dist: [],
              },
              urls: [incompatibleRelease],
            },
          };
        }
        return null;
      },
    );

    const result = await new PipResolver().resolveDependencies(
      'demo',
      '1.0.0',
      {
        targetPlatform: { system: 'Linux', machine: 'x86_64' },
        pythonVersion: '3.12',
      },
    );

    expect(
      result.flatList.map((pkg) => `${pkg.name}@${pkg.version}`),
    ).toContain('jsonchild@1.5.0');
  });

  it('PyPI 최신 릴리스의 Requires-Python을 과거 릴리스에 적용하지 않는다', async () => {
    const release = (
      name: string,
      version: string,
      pythonTag: string,
      requiresPython?: string | null,
    ) => ({
      filename:
        `${name}-${version}-${pythonTag}-${pythonTag}` +
        '-manylinux_2_17_x86_64.whl',
      url: `https://files.example/${name}-${version}.whl`,
      packagetype: 'bdist_wheel',
      python_version: pythonTag,
      requires_python: requiresPython,
      digests: { sha256: `${name}-${version}-sha` },
      size: 80,
    });
    const rootRelease = {
      filename: 'demo-1.0.0-py3-none-any.whl',
      url: 'https://files.example/demo.whl',
      packagetype: 'bdist_wheel',
      python_version: 'py3',
      digests: { sha256: 'demo-sha' },
      size: 80,
    };
    const latestRelease = release(
      'historicalchild',
      '2.0.0',
      'cp313',
      '>=3.13',
    );
    const historicalRelease = release(
      'historicalchild',
      '1.5.0',
      'cp312',
      null,
    );

    pipCacheMock.fetchPackageMetadata.mockImplementation(
      async (name: string, version?: string) => {
        if (name === 'demo') {
          return {
            data: {
              info: {
                name,
                version: '1.0.0',
                requires_dist: ['historicalchild<3'],
              },
              urls: [rootRelease],
            },
          };
        }
        if (name === 'historicalchild' && version === undefined) {
          return {
            data: {
              info: {
                name,
                version: '2.0.0',
                requires_python: '>=3.13',
              },
              releases: {
                '2.0.0': [latestRelease],
                '1.5.0': [historicalRelease],
              },
            },
          };
        }
        if (name === 'historicalchild' && version === '1.5.0') {
          return {
            data: {
              info: {
                name,
                version,
                requires_python: '>=3.12',
                requires_dist: [],
              },
              urls: [historicalRelease],
            },
          };
        }
        return null;
      },
    );

    const result = await new PipResolver().resolveDependencies(
      'demo',
      '1.0.0',
      {
        targetPlatform: { system: 'Linux', machine: 'x86_64' },
        pythonVersion: '3.12',
      },
    );

    expect(
      result.flatList.map((pkg) => `${pkg.name}@${pkg.version}`),
    ).toContain('historicalchild@1.5.0');
  });

  it('PyPI 과거 릴리스의 exact metadata 조회 오류를 전파한다', async () => {
    const rootRelease = {
      filename: 'demo-1.0.0-py3-none-any.whl',
      url: 'https://files.example/demo.whl',
      packagetype: 'bdist_wheel',
      python_version: 'py3',
      digests: { sha256: 'demo-sha' },
      size: 80,
    };
    const latestRelease = {
      filename:
        'historicalchild-2.0.0-cp313-cp313-manylinux_2_17_x86_64.whl',
      url: 'https://files.example/historicalchild-2.0.0.whl',
      packagetype: 'bdist_wheel',
      python_version: 'cp313',
      requires_python: '>=3.13',
      digests: { sha256: 'latest-sha' },
      size: 80,
    };
    const historicalRelease = {
      filename:
        'historicalchild-1.5.0-cp312-cp312-manylinux_2_17_x86_64.whl',
      url: 'https://files.example/historicalchild-1.5.0.whl',
      packagetype: 'bdist_wheel',
      python_version: 'cp312',
      requires_python: null,
      digests: { sha256: 'historical-sha' },
      size: 80,
    };

    pipCacheMock.fetchPackageMetadata.mockImplementation(
      async (name: string, version?: string) => {
        if (name === 'demo') {
          return {
            data: {
              info: {
                name,
                version: '1.0.0',
                requires_dist: ['historicalchild<3'],
              },
              urls: [rootRelease],
            },
          };
        }
        if (name === 'historicalchild' && version === undefined) {
          return {
            data: {
              info: {
                name,
                version: '2.0.0',
                requires_python: '>=3.13',
              },
              releases: {
                '2.0.0': [latestRelease],
                '1.5.0': [historicalRelease],
              },
            },
          };
        }
        if (name === 'historicalchild' && version === '1.5.0') {
          throw new Error('과거 릴리스 메타데이터 500');
        }
        return null;
      },
    );

    await expect(
      new PipResolver().resolveDependencies('demo', '1.0.0', {
        targetPlatform: { system: 'Linux', machine: 'x86_64' },
        pythonVersion: '3.12',
      }),
    ).rejects.toThrow('과거 릴리스 메타데이터 500');
  });

  it('PyPI JSON 의존성 버전 제약을 만족하는 릴리스가 없으면 실패한다', async () => {
    const universalRelease = (
      name: string,
      version: string,
    ) => ({
      filename: `${name}-${version}-py3-none-any.whl`,
      url: `https://files.example/${name}-${version}.whl`,
      packagetype: 'bdist_wheel',
      python_version: 'py3',
      digests: { sha256: `${name}-${version}-sha` },
      size: 80,
    });

    pipCacheMock.fetchPackageMetadata.mockImplementation(
      async (name: string, version?: string) => {
        if (name === 'demo') {
          return {
            data: {
              info: {
                name,
                version: '1.0.0',
                requires_dist: ['strictchild<2'],
              },
              urls: [universalRelease('demo', '1.0.0')],
            },
          };
        }
        if (name === 'strictchild' && version === undefined) {
          return {
            data: {
              info: { name, version: '2.0.0' },
              releases: {
                '2.0.0': [universalRelease(name, '2.0.0')],
              },
            },
          };
        }
        if (name === 'strictchild' && version === '2.0.0') {
          return {
            data: {
              info: { name, version, requires_dist: [] },
              urls: [universalRelease(name, version)],
            },
          };
        }
        return null;
      },
    );

    await expect(
      new PipResolver().resolveDependencies('demo', '1.0.0', {
        targetPlatform: { system: 'Linux', machine: 'x86_64' },
        pythonVersion: '3.12',
      }),
    ).rejects.toThrow('필수 의존성 해결 실패: demo@1.0.0 -> strictchild');
  });

  it('Simple API에서 버전 제약과 대상 Python을 모두 만족하는 최신 의존성을 선택한다', async () => {
    simpleApiMock.fetchPackageFiles.mockImplementation(
      async (_indexUrl: string, name: string) => {
        if (name === 'demo') {
          return [
            {
              filename: 'demo-1.0.0-py3-none-any.whl',
              url: 'https://index.example/demo.whl',
              metadataHash: {
                algorithm: 'sha256',
                digest: 'metadata-sha',
              },
            },
          ];
        }
        if (name === 'simplechild') {
          return [
            {
              filename:
                'simplechild-2.0.0-cp313-cp313-manylinux_2_17_x86_64.whl',
              url: 'https://index.example/simplechild-2.whl',
              requiresPython: '>=3.13',
              metadataHash: {
                algorithm: 'sha256',
                digest: 'simplechild-2-metadata',
              },
            },
            {
              filename:
                'simplechild-1.5.0-cp312-cp312-manylinux_2_17_x86_64.whl',
              url: 'https://index.example/simplechild-1.5.whl',
              requiresPython: '>=3.12',
              metadataHash: {
                algorithm: 'sha256',
                digest: 'simplechild-1.5-metadata',
              },
            },
          ];
        }
        return [];
      },
    );
    simpleApiMock.fetchWheelMetadata.mockImplementation(
      async (file: { filename: string }) =>
        ({
          status: 'available',
          requiresDist: file.filename.startsWith('demo-')
            ? ['simplechild<3']
            : [],
        }),
    );
    pipCacheMock.fetchPackageMetadata.mockResolvedValue(null);

    const result = await new PipResolver().resolveDependencies(
      'demo',
      '1.0.0',
      {
        targetPlatform: { system: 'Linux', machine: 'x86_64' },
        pythonVersion: '3.12',
        indexUrl: 'https://index.example/simple',
      },
    );

    expect(
      result.flatList.map((pkg) => `${pkg.name}@${pkg.version}`),
    ).toContain('simplechild@1.5.0');
  });

  it('Simple API 의존성 버전 제약을 만족하는 릴리스가 없으면 실패한다', async () => {
    simpleApiMock.fetchPackageFiles.mockImplementation(
      async (_indexUrl: string, name: string) => {
        if (name === 'demo') {
          return [
            {
              filename: 'demo-1.0.0-py3-none-any.whl',
              url: 'https://index.example/demo.whl',
              metadataHash: {
                algorithm: 'sha256',
                digest: 'metadata-sha',
              },
            },
          ];
        }
        if (name === 'strictsimplechild') {
          return [
            {
              filename:
                'strictsimplechild-2.0.0-py3-none-any.whl',
              url:
                'https://index.example/strictsimplechild-2.whl',
            },
          ];
        }
        return [];
      },
    );
    simpleApiMock.fetchWheelMetadata.mockImplementation(
      async (file: { filename: string }) =>
        ({
          status: 'available',
          requiresDist: file.filename.startsWith('demo-')
            ? ['strictsimplechild<2']
            : [],
        }),
    );
    pipCacheMock.fetchPackageMetadata.mockResolvedValue(null);

    await expect(
      new PipResolver().resolveDependencies('demo', '1.0.0', {
        targetPlatform: { system: 'Linux', machine: 'x86_64' },
        pythonVersion: '3.12',
        indexUrl: 'https://index.example/simple',
      }),
    ).rejects.toThrow('필수 의존성 해결 실패: demo@1.0.0 -> strictsimplechild');
  });

  it('major.minor Python 대상에서 참인 full-version 의존성을 포함한다', async () => {
    const dependencies: Record<string, string[]> = {
      root: [
        'fullversionchild==1.0.0; python_full_version < "3.13.0"',
      ],
      fullversionchild: [],
    };
    const universalRelease = (name: string) => ({
      filename: `${name}-1.0.0-py3-none-any.whl`,
      url: `https://files.example/${name}.whl`,
      packagetype: 'bdist_wheel',
      python_version: 'py3',
      digests: { sha256: `${name}-sha` },
      size: 80,
    });
    pipCacheMock.fetchPackageMetadata.mockImplementation(
      async (name: string, version?: string) => {
        if (!(name in dependencies)) {
          return null;
        }
        if (version === undefined) {
          return {
            data: {
              info: { name, version: '1.0.0' },
              releases: {
                '1.0.0': [universalRelease(name)],
              },
            },
          };
        }
        return {
          data: {
            info: {
              name,
              version,
              requires_dist: dependencies[name],
            },
            urls: [universalRelease(name)],
          },
        };
      },
    );

    const result = await new PipResolver().resolveDependencies(
      'root',
      '1.0.0',
      { pythonVersion: '3.12' },
    );

    expect(result.flatList.map((pkg) => pkg.name)).toContain(
      'fullversionchild',
    );
  });

  it('같은 pip 패키지에 나중에 요청된 PEP 685 동등 extra 의존성도 병합한다', async () => {
    const dependencies: Record<string, string[]> = {
      root: ['plainparent==1.0.0', 'secureparent==1.0.0'],
      plainparent: ['shared==1.0.0'],
      secureparent: ['shared[foo_bar]==1.0.0'],
      shared: ['securitychild==1.0.0; extra == "foo-bar"'],
      securitychild: [],
    };
    const universalRelease = (name: string) => ({
      filename: `${name}-1.0.0-py3-none-any.whl`,
      url: `https://files.example/${name}.whl`,
      packagetype: 'bdist_wheel',
      python_version: 'py3',
      digests: { sha256: `${name}-sha` },
      size: 80,
    });

    pipCacheMock.fetchPackageMetadata.mockImplementation(
      async (name: string, version?: string) => {
        if (!(name in dependencies)) {
          return null;
        }
        if (version === undefined) {
          return {
            data: {
              info: { name, version: '1.0.0' },
              releases: {
                '1.0.0': [universalRelease(name)],
              },
            },
          };
        }
        return {
          data: {
            info: {
              name,
              version,
              requires_dist: dependencies[name],
            },
            urls: [universalRelease(name)],
          },
        };
      },
    );

    const result = await new PipResolver().resolveDependencies(
      'root',
      '1.0.0',
      {
        targetPlatform: { system: 'Linux', machine: 'x86_64' },
        pythonVersion: '3.12',
      },
    );

    expect(result.flatList.map((pkg) => pkg.name)).toContain(
      'securitychild',
    );
  });

  it('extra 요청이 먼저 와도 pip 기본 및 extra 의존성을 모두 평가한다', async () => {
    const dependencies: Record<string, string[]> = {
      root: ['secureparent==1.0.0', 'plainparent==1.0.0'],
      secureparent: ['shared[security]==1.0.0'],
      plainparent: ['shared==1.0.0'],
      shared: [
        'basechild==1.0.0; extra == ""',
        'securitychild==1.0.0; extra == "security"',
      ],
      basechild: [],
      securitychild: [],
    };
    const universalRelease = (name: string) => ({
      filename: `${name}-1.0.0-py3-none-any.whl`,
      url: `https://files.example/${name}.whl`,
      packagetype: 'bdist_wheel',
      python_version: 'py3',
      digests: { sha256: `${name}-sha` },
      size: 80,
    });

    pipCacheMock.fetchPackageMetadata.mockImplementation(
      async (name: string, version?: string) => {
        if (!(name in dependencies)) {
          return null;
        }
        if (version === undefined) {
          return {
            data: {
              info: { name, version: '1.0.0' },
              releases: {
                '1.0.0': [universalRelease(name)],
              },
            },
          };
        }
        return {
          data: {
            info: {
              name,
              version,
              requires_dist: dependencies[name],
            },
            urls: [universalRelease(name)],
          },
        };
      },
    );

    const result = await new PipResolver().resolveDependencies(
      'root',
      '1.0.0',
      {
        targetPlatform: { system: 'Linux', machine: 'x86_64' },
        pythonVersion: '3.12',
      },
    );

    expect(result.flatList.map((pkg) => pkg.name)).toEqual(
      expect.arrayContaining(['basechild', 'securitychild']),
    );
  });

  it('같은 이름과 버전의 커스텀 인덱스·PyPI 아티팩트를 별도 노드로 보존한다', async () => {
    const indexUrl = 'https://index.example/simple';
    const simpleFiles: Record<string, Array<Record<string, unknown>>> = {
      root: [
        {
          filename: 'root-1.0.0-py3-none-any.whl',
          url: 'https://index.example/root.whl',
          metadataHash: {
            algorithm: 'sha256',
            digest: 'root-metadata',
          },
        },
      ],
      customparent: [
        {
          filename: 'customparent-1.0.0-py3-none-any.whl',
          url: 'https://index.example/customparent.whl',
          metadataHash: {
            algorithm: 'sha256',
            digest: 'customparent-metadata',
          },
        },
      ],
      shared: [
        {
          filename: 'shared-1.0.0-py3-none-any.whl',
          url: 'https://index.example/shared.whl',
          hash: {
            algorithm: 'sha256',
            digest: 'custom-shared-sha',
          },
          metadataHash: {
            algorithm: 'sha256',
            digest: 'custom-shared-metadata',
          },
        },
      ],
      publicparent: [],
    };
    simpleApiMock.fetchPackageFiles.mockImplementation(
      async (_requestedIndexUrl: string, name: string) =>
        simpleFiles[name] ?? [],
    );
    simpleApiMock.fetchWheelMetadata.mockImplementation(
      async (file: { filename: string }) => {
        if (file.filename.startsWith('root-')) {
          return {
            status: 'available',
            requiresDist: ['customparent==1.0.0', 'publicparent==1.0.0'],
          };
        }
        if (file.filename.startsWith('customparent-')) {
          return { status: 'available', requiresDist: ['shared==1.0.0'] };
        }
        return { status: 'available', requiresDist: [] };
      },
    );

    const pypiRelease = (name: string) => ({
      filename: `${name}-1.0.0-py3-none-any.whl`,
      url: `https://files.example/${name}.whl`,
      packagetype: 'bdist_wheel',
      python_version: 'py3',
      digests: { sha256: `public-${name}-sha` },
      size: 80,
    });
    pipCacheMock.fetchPackageMetadata.mockImplementation(
      async (name: string, version?: string) => {
        if (!['publicparent', 'shared'].includes(name)) {
          return null;
        }
        if (version === undefined) {
          return {
            data: {
              info: { name, version: '1.0.0' },
              releases: {
                '1.0.0': [pypiRelease(name)],
              },
            },
          };
        }
        return {
          data: {
            info: {
              name,
              version,
              requires_dist:
                name === 'publicparent'
                  ? ['shared==1.0.0']
                  : [],
            },
            urls: [pypiRelease(name)],
          },
        };
      },
    );

    const result = await new PipResolver().resolveDependencies(
      'root',
      '1.0.0',
      { indexUrl },
    );

    expect(
      result.flatList
        .filter((pkg) => pkg.name === 'shared')
        .map((pkg) => pkg.metadata?.downloadUrl)
        .sort(),
    ).toEqual([
      'https://files.example/shared.whl',
      'https://index.example/shared.whl',
    ]);
  });

  it('Simple API에서 선택한 대상 wheel URL과 체크섬을 다운로드한다', async () => {
    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      {
        filename: 'demo-1.0.0-cp312-cp312-manylinux_2_17_x86_64.whl',
        url: 'https://index.example/demo-x86_64.whl',
        hash: { algorithm: 'sha256', digest: 'simple-x86-sha' },
      },
      {
        filename: 'demo-1.0.0-cp312-cp312-manylinux_2_17_aarch64.whl',
        url: 'https://index.example/demo-aarch64.whl',
        hash: { algorithm: 'sha256', digest: 'simple-arm-sha' },
      },
    ]);
    simpleApiMock.fetchWheelMetadata.mockResolvedValue({
      status: 'available',
      requiresDist: [],
    });
    pipCacheMock.fetchPackageMetadata.mockResolvedValue(null);

    const result = await new PipResolver().resolveDependencies(
      'demo',
      '1.0.0',
      {
        maxDepth: 0,
        indexUrl: 'https://index.example/simple',
        targetPlatform: { system: 'Linux', machine: 'aarch64' },
        pythonVersion: '3.12',
      },
    );

    expect(result.root.package.metadata).toMatchObject({
      filename: 'demo-1.0.0-cp312-cp312-manylinux_2_17_aarch64.whl',
      downloadUrl: 'https://index.example/demo-aarch64.whl',
      checksum: { sha256: 'simple-arm-sha' },
    });
    await expectSelectedArtifactIsDownloaded(
      result.root.package,
      'https://index.example/demo-aarch64.whl',
      'simple-arm-sha',
    );
  });

  it('Simple API의 MD5 체크섬을 resolver부터 downloader까지 보존한다', async () => {
    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      {
        filename: 'demo-1.0.0-py3-none-any.whl',
        url: 'https://index.example/demo.whl',
        hash: { algorithm: 'md5', digest: 'simple-md5' },
      },
    ]);
    simpleApiMock.fetchWheelMetadata.mockResolvedValue({
      status: 'available',
      requiresDist: [],
    });
    pipCacheMock.fetchPackageMetadata.mockResolvedValue(null);

    const result = await new PipResolver().resolveDependencies(
      'demo',
      '1.0.0',
      {
        maxDepth: 0,
        indexUrl: 'https://index.example/simple',
      },
    );

    expect(result.root.package.metadata).toMatchObject({
      checksum: { md5: 'simple-md5' },
    });
    await expectSelectedArtifactIsDownloaded(
      result.root.package,
      'https://index.example/demo.whl',
      'simple-md5',
      'md5',
    );
  });

  it.each([
    {
      name: 'Linux arm64',
      system: 'Linux' as const,
      machine: 'arm64' as const,
      filename:
        'demo-1.0.0-cp312-cp312-manylinux_2_17_aarch64.whl',
    },
    {
      name: 'Windows aarch64',
      system: 'Windows' as const,
      machine: 'aarch64' as const,
      filename: 'demo-1.0.0-cp312-cp312-win_arm64.whl',
    },
    {
      name: 'macOS aarch64',
      system: 'Darwin' as const,
      machine: 'aarch64' as const,
      filename: 'demo-1.0.0-cp312-cp312-macosx_11_0_arm64.whl',
    },
  ])('$name 별칭으로 Simple API ARM64 wheel을 다운로드한다', async ({
    system,
    machine,
    filename,
  }) => {
    const downloadUrl = `https://index.example/${filename}`;
    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      {
        filename,
        url: downloadUrl,
        hash: { algorithm: 'sha256', digest: 'arm-alias-sha' },
      },
    ]);
    simpleApiMock.fetchWheelMetadata.mockResolvedValue({
      status: 'available',
      requiresDist: [],
    });
    pipCacheMock.fetchPackageMetadata.mockResolvedValue(null);

    const result = await new PipResolver().resolveDependencies(
      'demo',
      '1.0.0',
      {
        maxDepth: 0,
        indexUrl: 'https://index.example/simple',
        targetPlatform: { system, machine },
        pythonVersion: '3.12',
      },
    );

    expect(result.root.package.metadata).toMatchObject({
      filename,
      downloadUrl,
    });
    await expectSelectedArtifactIsDownloaded(
      result.root.package,
      downloadUrl,
      'arm-alias-sha',
    );
  });

  it.each([
    {
      name: 'build tag 포함 macOS arm64',
      machine: 'arm64' as const,
      filename:
        'demo-1.0.0-1-cp312-cp312-macosx_11_0_arm64.whl',
    },
    {
      name: 'macOS universal2 arm64 대상',
      machine: 'arm64' as const,
      filename:
        'demo-1.0.0-cp312-cp312-macosx_11_0_universal2.whl',
    },
    {
      name: 'macOS universal2 x86_64 대상',
      machine: 'x86_64' as const,
      filename:
        'demo-1.0.0-cp312-cp312-macosx_11_0_universal2.whl',
    },
  ])('$name wheel을 PyPI JSON과 Simple API에서 선택한다', async ({
    machine,
    filename,
  }) => {
    const pypiUrl = `https://files.example/${filename}`;
    pipCacheMock.fetchPackageMetadata.mockResolvedValue({
      data: {
        info: {
          name: 'demo',
          version: '1.0.0',
          requires_dist: [],
        },
        urls: [
          {
            filename,
            url: pypiUrl,
            packagetype: 'bdist_wheel',
            python_version: 'cp312',
            digests: { sha256: 'pypi-macos-sha' },
            size: 100,
          },
        ],
      },
    });

    const pypiResult = await new PipResolver().resolveDependencies(
      'demo',
      '1.0.0',
      {
        maxDepth: 0,
        targetPlatform: { system: 'Darwin', machine },
        pythonVersion: '3.12',
      },
    );

    expect(pypiResult.root.package.metadata).toMatchObject({
      filename,
      downloadUrl: pypiUrl,
    });
    await expectSelectedArtifactIsDownloaded(
      pypiResult.root.package,
      pypiUrl,
      'pypi-macos-sha',
    );

    const simpleUrl = `https://index.example/${filename}`;
    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      {
        filename,
        url: simpleUrl,
        hash: { algorithm: 'sha256', digest: 'simple-macos-sha' },
      },
    ]);
    simpleApiMock.fetchWheelMetadata.mockResolvedValue({
      status: 'available',
      requiresDist: [],
    });
    pipCacheMock.fetchPackageMetadata.mockResolvedValue(null);

    const simpleResult = await new PipResolver().resolveDependencies(
      'demo',
      '1.0.0',
      {
        maxDepth: 0,
        indexUrl: 'https://index.example/simple',
        targetPlatform: { system: 'Darwin', machine },
        pythonVersion: '3.12',
      },
    );

    expect(simpleResult.root.package.metadata).toMatchObject({
      filename,
      downloadUrl: simpleUrl,
    });
    await expectSelectedArtifactIsDownloaded(
      simpleResult.root.package,
      simpleUrl,
      'simple-macos-sha',
    );
  });

  it('PyPI JSON에서 대상 Python보다 높은 abi3 wheel을 거부한다', async () => {
    pipCacheMock.fetchPackageMetadata.mockResolvedValue({
      data: {
        info: {
          name: 'demo',
          version: '1.0.0',
          requires_dist: [],
        },
        urls: [
          {
            filename:
              'demo-1.0.0-cp313-abi3-manylinux_2_17_x86_64.whl',
            url: 'https://files.example/demo-cp313-abi3.whl',
            packagetype: 'bdist_wheel',
            python_version: 'cp313',
            digests: { sha256: 'cp313-sha' },
            size: 100,
          },
          {
            filename:
              'demo-1.0.0-cp37-abi3-manylinux_2_17_x86_64.whl',
            url: 'https://files.example/demo-cp37-abi3.whl',
            packagetype: 'bdist_wheel',
            python_version: 'cp37',
            digests: { sha256: 'cp37-sha' },
            size: 100,
          },
        ],
      },
    });

    const result = await new PipResolver().resolveDependencies(
      'demo',
      '1.0.0',
      {
        maxDepth: 0,
        targetPlatform: { system: 'Linux', machine: 'x86_64' },
        pythonVersion: '3.12',
      },
    );

    expect(result.root.package.metadata).toMatchObject({
      filename: 'demo-1.0.0-cp37-abi3-manylinux_2_17_x86_64.whl',
      downloadUrl: 'https://files.example/demo-cp37-abi3.whl',
    });
    await expectSelectedArtifactIsDownloaded(
      result.root.package,
      'https://files.example/demo-cp37-abi3.whl',
      'cp37-sha',
    );
  });

  it('Simple API에서 유효한 구버전 abi3 wheel을 선택한다', async () => {
    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      {
        filename:
          'demo-1.0.0-cp313-abi3-manylinux_2_17_x86_64.whl',
        url: 'https://index.example/demo-cp313-abi3.whl',
        hash: { algorithm: 'sha256', digest: 'simple-cp313-sha' },
      },
      {
        filename:
          'demo-1.0.0-cp37-abi3-manylinux_2_17_x86_64.whl',
        url: 'https://index.example/demo-cp37-abi3.whl',
        hash: { algorithm: 'sha256', digest: 'simple-cp37-sha' },
      },
    ]);
    simpleApiMock.fetchWheelMetadata.mockResolvedValue({
      status: 'available',
      requiresDist: [],
    });
    pipCacheMock.fetchPackageMetadata.mockResolvedValue(null);

    const result = await new PipResolver().resolveDependencies(
      'demo',
      '1.0.0',
      {
        maxDepth: 0,
        indexUrl: 'https://index.example/simple',
        targetPlatform: { system: 'Linux', machine: 'x86_64' },
        pythonVersion: '3.12',
      },
    );

    expect(result.root.package.metadata).toMatchObject({
      filename: 'demo-1.0.0-cp37-abi3-manylinux_2_17_x86_64.whl',
      downloadUrl: 'https://index.example/demo-cp37-abi3.whl',
    });
    await expectSelectedArtifactIsDownloaded(
      result.root.package,
      'https://index.example/demo-cp37-abi3.whl',
      'simple-cp37-sha',
    );
  });

  it('일반 CPython 대상에서 일치하지 않는 CPython ABI wheel을 제외한다', async () => {
    const incompatibleFilenames = [
      'demo-1.0.0-cp313-cp313t-manylinux_2_17_x86_64.whl',
      'demo-1.0.0-cp313-cp312-manylinux_2_17_x86_64.whl',
    ];
    const compatibleFilename =
      'demo-1.0.0-cp313-cp313-manylinux_2_17_x86_64.whl';

    pipCacheMock.fetchPackageMetadata.mockResolvedValue({
      data: {
        info: {
          name: 'demo',
          version: '1.0.0',
          requires_dist: [],
        },
        urls: [
          ...incompatibleFilenames.map((filename, index) => ({
            filename,
            url: `https://files.example/incompatible-${index}.whl`,
            packagetype: 'bdist_wheel',
            python_version: 'cp313',
            digests: { sha256: `incompatible-${index}-sha` },
            size: 100,
          })),
          {
            filename: compatibleFilename,
            url: 'https://files.example/demo-cp313.whl',
            packagetype: 'bdist_wheel',
            python_version: 'cp313',
            digests: { sha256: 'cp313-sha' },
            size: 100,
          },
        ],
      },
    });

    const pypiResult = await new PipResolver().resolveDependencies(
      'demo',
      '1.0.0',
      {
        maxDepth: 0,
        targetPlatform: { system: 'Linux', machine: 'x86_64' },
        pythonVersion: '3.13',
      },
    );

    expect(pypiResult.root.package.metadata).toMatchObject({
      filename: compatibleFilename,
      downloadUrl: 'https://files.example/demo-cp313.whl',
    });

    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      ...incompatibleFilenames.map((filename, index) => ({
        filename,
        url: `https://index.example/incompatible-${index}.whl`,
        hash: {
          algorithm: 'sha256',
          digest: `simple-incompatible-${index}-sha`,
        },
      })),
      {
        filename: compatibleFilename,
        url: 'https://index.example/demo-cp313.whl',
        hash: { algorithm: 'sha256', digest: 'simple-cp313-sha' },
      },
    ]);
    simpleApiMock.fetchWheelMetadata.mockResolvedValue({
      status: 'available',
      requiresDist: [],
    });
    pipCacheMock.fetchPackageMetadata.mockResolvedValue(null);

    const simpleResult = await new PipResolver().resolveDependencies(
      'demo',
      '1.0.0',
      {
        maxDepth: 0,
        indexUrl: 'https://index.example/simple',
        targetPlatform: { system: 'Linux', machine: 'x86_64' },
        pythonVersion: '3.13',
      },
    );

    expect(simpleResult.root.package.metadata).toMatchObject({
      filename: compatibleFilename,
      downloadUrl: 'https://index.example/demo-cp313.whl',
    });
  });

  it('PyPI JSON의 requires_python과 대상 Python 버전을 비교한다', async () => {
    pipCacheMock.fetchPackageMetadata.mockResolvedValue({
      data: {
        info: {
          name: 'demo',
          version: '1.0.0',
          requires_dist: [],
        },
        urls: [
          {
            filename:
              'demo-1.0.0-cp312-cp312-manylinux_2_17_x86_64.whl',
            url: 'https://files.example/demo-prerelease-upper-bound.whl',
            packagetype: 'bdist_wheel',
            python_version: 'cp312',
            requires_python: '<=3.12rc1',
            digests: { sha256: 'prerelease-upper-bound-sha' },
            size: 100,
          },
          {
            filename:
              'demo-1.0.0-cp312-cp312-manylinux_2_17_x86_64.whl',
            url: 'https://files.example/demo-python313-required.whl',
            packagetype: 'bdist_wheel',
            python_version: 'cp312',
            requires_python: '>=3.13',
            digests: { sha256: 'python313-required-sha' },
            size: 100,
          },
          {
            filename:
              'demo-1.0.0-cp312-cp312-manylinux_2_17_x86_64.whl',
            url: 'https://files.example/demo-python312-compatible.whl',
            packagetype: 'bdist_wheel',
            python_version: 'cp312',
            requires_python: '>=3.8,<3.13',
            digests: { sha256: 'python312-compatible-sha' },
            size: 100,
          },
        ],
      },
    });

    const result = await new PipResolver().resolveDependencies(
      'demo',
      '1.0.0',
      {
        maxDepth: 0,
        targetPlatform: { system: 'Linux', machine: 'x86_64' },
        pythonVersion: '3.12',
      },
    );

    expect(result.root.package.metadata).toMatchObject({
      downloadUrl: 'https://files.example/demo-python312-compatible.whl',
    });
    await expectSelectedArtifactIsDownloaded(
      result.root.package,
      'https://files.example/demo-python312-compatible.whl',
      'python312-compatible-sha',
    );
  });

  it('Simple API의 requiresPython과 대상 Python 버전을 비교한다', async () => {
    const filename =
      'demo-1.0.0-cp312-cp312-manylinux_2_17_x86_64.whl';
    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      {
        filename,
        url: 'https://index.example/demo-prerelease-upper-bound.whl',
        requiresPython: '<=3.12rc1',
        hash: {
          algorithm: 'sha256',
          digest: 'simple-prerelease-upper-bound-sha',
        },
      },
      {
        filename,
        url: 'https://index.example/demo-python313-required.whl',
        requiresPython: '>=3.13',
        hash: { algorithm: 'sha256', digest: 'simple-python313-sha' },
      },
      {
        filename,
        url: 'https://index.example/demo-python312-compatible.whl',
        requiresPython: '>=3.8,<3.13',
        hash: { algorithm: 'sha256', digest: 'simple-python312-sha' },
      },
    ]);
    simpleApiMock.fetchWheelMetadata.mockResolvedValue({
      status: 'available',
      requiresDist: [],
    });
    pipCacheMock.fetchPackageMetadata.mockResolvedValue(null);

    const result = await new PipResolver().resolveDependencies(
      'demo',
      '1.0.0',
      {
        maxDepth: 0,
        indexUrl: 'https://index.example/simple',
        targetPlatform: { system: 'Linux', machine: 'x86_64' },
        pythonVersion: '3.12',
      },
    );

    expect(result.root.package.metadata).toMatchObject({
      downloadUrl:
        'https://index.example/demo-python312-compatible.whl',
    });
    await expectSelectedArtifactIsDownloaded(
      result.root.package,
      'https://index.example/demo-python312-compatible.whl',
      'simple-python312-sha',
    );
  });

  it('PyPI JSON과 Simple API의 Requires-Python exact version을 정규화한다', async () => {
    const filename =
      'demo-1.0.0-cp312-cp312-manylinux_2_17_x86_64.whl';
    pipCacheMock.fetchPackageMetadata.mockResolvedValue({
      data: {
        info: {
          name: 'demo',
          version: '1.0.0',
          requires_dist: [],
        },
        urls: [
          {
            filename,
            url: 'https://files.example/demo-python312-prerelease-exact.whl',
            packagetype: 'bdist_wheel',
            python_version: 'cp312',
            requires_python: '==3.12.0rc1',
            digests: { sha256: 'python312-prerelease-exact-sha' },
            size: 100,
          },
          {
            filename,
            url: 'https://files.example/demo-python312-excluded-exact.whl',
            packagetype: 'bdist_wheel',
            python_version: 'cp312',
            requires_python: '!=3.12.0',
            digests: { sha256: 'python312-excluded-exact-sha' },
            size: 100,
          },
          {
            filename,
            url: 'https://files.example/demo-python312-included-exact.whl',
            packagetype: 'bdist_wheel',
            python_version: 'cp312',
            requires_python: '==3.12.0',
            digests: { sha256: 'python312-included-exact-sha' },
            size: 100,
          },
        ],
      },
    });

    const pypiResult = await new PipResolver().resolveDependencies(
      'demo',
      '1.0.0',
      {
        maxDepth: 0,
        targetPlatform: { system: 'Linux', machine: 'x86_64' },
        pythonVersion: '3.12',
      },
    );

    expect(pypiResult.root.package.metadata).toMatchObject({
      downloadUrl:
        'https://files.example/demo-python312-included-exact.whl',
    });

    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      {
        filename,
        url: 'https://index.example/demo-python312-prerelease-exact.whl',
        requiresPython: '==3.12.0rc1',
        hash: {
          algorithm: 'sha256',
          digest: 'simple-prerelease-exact-sha',
        },
      },
      {
        filename,
        url: 'https://index.example/demo-python312-excluded-exact.whl',
        requiresPython: '!=3.12.0',
        hash: { algorithm: 'sha256', digest: 'simple-excluded-exact-sha' },
      },
      {
        filename,
        url: 'https://index.example/demo-python312-included-exact.whl',
        requiresPython: '==3.12.0',
        hash: { algorithm: 'sha256', digest: 'simple-included-exact-sha' },
      },
    ]);
    simpleApiMock.fetchWheelMetadata.mockResolvedValue({
      status: 'available',
      requiresDist: [],
    });
    pipCacheMock.fetchPackageMetadata.mockResolvedValue(null);

    const simpleResult = await new PipResolver().resolveDependencies(
      'demo',
      '1.0.0',
      {
        maxDepth: 0,
        indexUrl: 'https://index.example/simple',
        targetPlatform: { system: 'Linux', machine: 'x86_64' },
        pythonVersion: '3.12',
      },
    );

    expect(simpleResult.root.package.metadata).toMatchObject({
      downloadUrl:
        'https://index.example/demo-python312-included-exact.whl',
    });
  });

  it('PyPI JSON의 Requires-Python wildcard를 평가한다', async () => {
    pipCacheMock.fetchPackageMetadata.mockResolvedValue({
      data: {
        info: {
          name: 'demo',
          version: '1.0.0',
          requires_dist: [],
        },
        urls: [
          {
            filename:
              'demo-1.0.0-cp312-cp312-manylinux_2_17_x86_64.whl',
            url: 'https://files.example/demo-python312-excluded.whl',
            packagetype: 'bdist_wheel',
            python_version: 'cp312',
            requires_python: '!=3.12.0.*',
            digests: { sha256: 'python312-excluded-sha' },
            size: 100,
          },
          {
            filename:
              'demo-1.0.0-cp312-cp312-manylinux_2_17_x86_64.whl',
            url: 'https://files.example/demo-python312-included.whl',
            packagetype: 'bdist_wheel',
            python_version: 'cp312',
            requires_python: '==3.12.0.*',
            digests: { sha256: 'python312-included-sha' },
            size: 100,
          },
        ],
      },
    });

    const result = await new PipResolver().resolveDependencies(
      'demo',
      '1.0.0',
      {
        maxDepth: 0,
        targetPlatform: { system: 'Linux', machine: 'x86_64' },
        pythonVersion: '3.12',
      },
    );

    expect(result.root.package.metadata).toMatchObject({
      downloadUrl: 'https://files.example/demo-python312-included.whl',
    });
  });

  it('Simple API의 Requires-Python wildcard를 평가한다', async () => {
    const filename =
      'demo-1.0.0-cp312-cp312-manylinux_2_17_x86_64.whl';
    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      {
        filename,
        url: 'https://index.example/demo-python312-excluded.whl',
        requiresPython: '!=3.12.0.*',
        hash: { algorithm: 'sha256', digest: 'simple-excluded-sha' },
      },
      {
        filename,
        url: 'https://index.example/demo-python312-included.whl',
        requiresPython: '==3.12.0.*',
        hash: { algorithm: 'sha256', digest: 'simple-included-sha' },
      },
    ]);
    simpleApiMock.fetchWheelMetadata.mockResolvedValue({
      status: 'available',
      requiresDist: [],
    });
    pipCacheMock.fetchPackageMetadata.mockResolvedValue(null);

    const result = await new PipResolver().resolveDependencies(
      'demo',
      '1.0.0',
      {
        maxDepth: 0,
        indexUrl: 'https://index.example/simple',
        targetPlatform: { system: 'Linux', machine: 'x86_64' },
        pythonVersion: '3.12',
      },
    );

    expect(result.root.package.metadata).toMatchObject({
      downloadUrl:
        'https://index.example/demo-python312-included.whl',
    });
  });

  it('Simple API에 호환 wheel이 없으면 다른 아키텍처 wheel 대신 sdist를 선택한다', async () => {
    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      {
        filename: 'demo-1.0.0-cp312-cp312-manylinux_2_17_x86_64.whl',
        url: 'https://index.example/demo-x86_64.whl',
        hash: { algorithm: 'sha256', digest: 'simple-x86-sha' },
      },
      {
        filename: 'demo-1.0.0.tar.gz',
        url: 'https://index.example/demo-1.0.0.tar.gz',
        hash: { algorithm: 'sha256', digest: 'simple-sdist-sha' },
      },
    ]);
    simpleApiMock.fetchWheelMetadata.mockResolvedValue({
      status: 'available',
      requiresDist: [],
    });
    pipCacheMock.fetchPackageMetadata.mockResolvedValue(null);

    const result = await new PipResolver().resolveDependencies(
      'demo',
      '1.0.0',
      {
        maxDepth: 0,
        indexUrl: 'https://index.example/simple',
        targetPlatform: { system: 'Linux', machine: 'aarch64' },
        pythonVersion: '3.12',
      },
    );

    expect(result.root.package.metadata).toMatchObject({
      filename: 'demo-1.0.0.tar.gz',
      downloadUrl: 'https://index.example/demo-1.0.0.tar.gz',
      checksum: { sha256: 'simple-sdist-sha' },
    });
  });

  it('Simple API에 호환 wheel이 없으면 ZIP sdist를 선택한다', async () => {
    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      {
        filename: 'demo-1.0.0-cp312-cp312-manylinux_2_17_x86_64.whl',
        url: 'https://index.example/demo-x86_64.whl',
        hash: { algorithm: 'sha256', digest: 'simple-x86-sha' },
      },
      {
        filename: 'demo-1.0.0.zip',
        url: 'https://index.example/demo-1.0.0.zip',
        hash: { algorithm: 'sha256', digest: 'simple-zip-sha' },
        requiresPython: '>=3.12',
      },
    ]);
    simpleApiMock.fetchWheelMetadata.mockResolvedValue({
      status: 'available',
      requiresDist: [],
    });
    pipCacheMock.fetchPackageMetadata.mockResolvedValue(null);

    const result = await new PipResolver().resolveDependencies(
      'demo',
      '1.0.0',
      {
        maxDepth: 0,
        indexUrl: 'https://index.example/simple',
        targetPlatform: { system: 'Linux', machine: 'aarch64' },
        pythonVersion: '3.12',
      },
    );

    expect(result.root.package.metadata).toMatchObject({
      filename: 'demo-1.0.0.zip',
      downloadUrl: 'https://index.example/demo-1.0.0.zip',
      checksum: { sha256: 'simple-zip-sha' },
    });
  });

  it.each([
    {
      extension: 'tar.bz2',
      digest: 'simple-bz2-sha',
    },
    {
      extension: 'tar.xz',
      digest: 'simple-xz-sha',
    },
  ])(
    'Simple API의 $extension sdist와 Requires-Python을 처리한다',
    async ({ extension, digest }) => {
      simpleApiMock.fetchPackageFiles.mockResolvedValue([
        {
          filename: `demo-1.0.0.${extension}`,
          url: `https://index.example/demo-1.0.0.${extension}`,
          hash: { algorithm: 'sha256', digest },
          requiresPython: '>=3.12,<3.13',
        },
      ]);
      simpleApiMock.fetchWheelMetadata.mockResolvedValue({
        status: 'available',
        requiresDist: [],
      });
      pipCacheMock.fetchPackageMetadata.mockResolvedValue(null);

      const result = await new PipResolver().resolveDependencies(
        'demo',
        '1.0.0',
        {
          maxDepth: 0,
          indexUrl: 'https://index.example/simple',
          targetPlatform: { system: 'Linux', machine: 'aarch64' },
          pythonVersion: '3.12',
        },
      );

      expect(result.root.package.metadata).toMatchObject({
        filename: `demo-1.0.0.${extension}`,
        downloadUrl: `https://index.example/demo-1.0.0.${extension}`,
        checksum: { sha256: digest },
      });
    },
  );

  it('Simple API의 알 수 없는 파일은 무시하고 유효한 sdist를 선택한다', async () => {
    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      {
        filename: 'demo-1.0.0.exe',
        url: 'https://index.example/demo-1.0.0.exe',
      },
      {
        filename: 'demo-1.0.0.tar.xz',
        url: 'https://index.example/demo-1.0.0.tar.xz',
        requiresPython: '>=3.12',
      },
    ]);
    simpleApiMock.fetchWheelMetadata.mockResolvedValue({
      status: 'available',
      requiresDist: [],
    });
    pipCacheMock.fetchPackageMetadata.mockResolvedValue(null);

    const result = await new PipResolver().resolveDependencies(
      'demo',
      '1.0.0',
      {
        maxDepth: 0,
        indexUrl: 'https://index.example/simple',
        targetPlatform: { system: 'Linux', machine: 'aarch64' },
        pythonVersion: '3.12',
      },
    );

    expect(result.root.package.metadata).toMatchObject({
      filename: 'demo-1.0.0.tar.xz',
      downloadUrl: 'https://index.example/demo-1.0.0.tar.xz',
    });
  });

  it('호환 wheel과 sdist가 모두 없으면 다른 아키텍처를 선택하지 않고 실패한다', async () => {
    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      {
        filename: 'demo-1.0.0-cp312-cp312-manylinux_2_17_x86_64.whl',
        url: 'https://index.example/demo-x86_64.whl',
        hash: { algorithm: 'sha256', digest: 'simple-x86-sha' },
      },
    ]);
    simpleApiMock.fetchWheelMetadata.mockResolvedValue({
      status: 'available',
      requiresDist: [],
    });
    pipCacheMock.fetchPackageMetadata.mockResolvedValue(null);

    await expect(
      new PipResolver().resolveDependencies('demo', '1.0.0', {
        maxDepth: 0,
        indexUrl: 'https://index.example/simple',
        targetPlatform: { system: 'Linux', machine: 'aarch64' },
        pythonVersion: '3.12',
      }),
    ).rejects.toThrow(
      '대상 환경과 호환되는 pip wheel 또는 source distribution을 찾을 수 없습니다',
    );
  });

  it('PyPI JSON 정확 버전에서 대상 artifact가 없으면 대상과 sdist 부재를 진단한다', async () => {
    pipCacheMock.fetchPackageMetadata.mockResolvedValue({
      data: {
        info: { name: 'native-only', version: '1.0.0', requires_dist: [] },
        urls: [
          {
            filename:
              'native_only-1.0.0-cp312-cp312-manylinux_2_17_x86_64.whl',
            url: 'https://files.example/native-only-cp312.whl',
            packagetype: 'bdist_wheel',
            python_version: 'cp312',
            digests: { sha256: 'native-only-sha' },
            size: 80,
          },
        ],
      },
    });

    await expect(
      new PipResolver().resolveDependencies('native-only', '1.0.0', {
        maxDepth: 0,
        targetPlatform: { system: 'Linux', machine: 'x86_64' },
        pythonVersion: '3.13',
      }),
    ).rejects.toThrow(
      '대상 환경과 호환되는 pip wheel 또는 source distribution을 찾을 수 없습니다: native-only@1.0.0 (대상: Python 3.13, linux x86_64; 호환 wheel 없음; 호환 source distribution 없음)',
    );
  });

  it.each(['latest', '>=1,<2'])(
    'PyPI JSON %s 요청에서 대상 artifact가 없으면 요청 spec을 보존해 진단한다',
    async (requestedSpec) => {
      const foreignWheel = {
        filename:
          'native_only-1.0.0-cp312-cp312-manylinux_2_17_x86_64.whl',
        url: 'https://files.example/native-only-cp312.whl',
        packagetype: 'bdist_wheel',
        python_version: 'cp312',
        digests: { sha256: 'native-only-sha' },
        size: 80,
      };
      pipCacheMock.fetchPackageMetadata.mockImplementation(
        async (_name: string, version?: string) => ({
          data: {
            info: { name: 'native-only', version: version ?? '1.0.0' },
            ...(version === undefined
              ? { releases: { '1.0.0': [foreignWheel] } }
              : { urls: [foreignWheel] }),
          },
        }),
      );

      await expect(
        new PipResolver().resolveDependencies('native-only', requestedSpec, {
          maxDepth: 0,
          targetPlatform: { system: 'Linux', machine: 'x86_64' },
          pythonVersion: '3.13',
        }),
      ).rejects.toThrow(
        `대상 환경과 호환되는 pip wheel 또는 source distribution을 찾을 수 없습니다: native-only@${requestedSpec}`,
      );
    },
  );

  it('Simple API 정확 버전에서 대상 artifact가 없으면 source distribution 부재를 진단한다', async () => {
    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      {
        filename:
          'native_only-1.0.0-cp312-cp312-manylinux_2_17_x86_64.whl',
        url: 'https://index.example/native-only-cp312.whl',
      },
    ]);
    pipCacheMock.fetchPackageMetadata.mockResolvedValue(null);

    await expect(
      new PipResolver().resolveDependencies('native-only', '1.0.0', {
        maxDepth: 0,
        indexUrl: 'https://index.example/simple',
        targetPlatform: { system: 'Linux', machine: 'x86_64' },
        pythonVersion: '3.13',
      }),
    ).rejects.toThrow(
      '대상 환경과 호환되는 pip wheel 또는 source distribution을 찾을 수 없습니다: native-only@1.0.0',
    );
  });

  it.each(['latest', '>=1,<2'])(
    'Simple API %s 요청에서 대상 artifact가 없으면 요청 spec을 보존해 진단한다',
    async (requestedSpec) => {
      simpleApiMock.fetchPackageFiles.mockResolvedValue([
        {
          filename:
            'native_only-1.0.0-cp312-cp312-manylinux_2_17_x86_64.whl',
          url: 'https://index.example/native-only-cp312.whl',
        },
      ]);
      pipCacheMock.fetchPackageMetadata.mockResolvedValue(null);

      await expect(
        new PipResolver().resolveDependencies('native-only', requestedSpec, {
          maxDepth: 0,
          indexUrl: 'https://index.example/simple',
          targetPlatform: { system: 'Linux', machine: 'x86_64' },
          pythonVersion: '3.13',
        }),
      ).rejects.toThrow(
        `대상 환경과 호환되는 pip wheel 또는 source distribution을 찾을 수 없습니다: native-only@${requestedSpec}`,
      );
    },
  );

  it.each([
    { api: 'PyPI JSON', indexUrl: undefined },
    { api: 'Simple API', indexUrl: 'https://index.example/simple' },
  ])(
    '$api direct-root 범위 요청은 호환 artifact가 있는 가장 높은 release를 선택한다',
    async ({ indexUrl }) => {
      const release = (version: string) => ({
        filename: `demo-${version}-py3-none-any.whl`,
        url: `https://files.example/demo-${version}.whl`,
        packagetype: 'bdist_wheel',
        python_version: 'py3',
        digests: { sha256: `${version}-sha` },
        size: 80,
      });

      if (indexUrl) {
        simpleApiMock.fetchPackageFiles.mockResolvedValue([
          {
            filename: 'demo-1.0.0-py3-none-any.whl',
            url: 'https://index.example/demo-1.0.0.whl',
            hash: { algorithm: 'sha256', digest: '1.0.0-sha' },
          },
          {
            filename: 'demo-1.9.0-py3-none-any.whl',
            url: 'https://index.example/demo-1.9.0.whl',
            hash: { algorithm: 'sha256', digest: '1.9.0-sha' },
          },
        ]);
        simpleApiMock.fetchWheelMetadata.mockResolvedValue({
          status: 'available',
          requiresDist: [],
        });
      } else {
        pipCacheMock.fetchPackageMetadata.mockImplementation(
          async (_name: string, version?: string) => ({
            data: {
              info: { name: 'demo', version: version ?? '1.9.0', requires_dist: [] },
              ...(version === undefined
                ? { releases: { '1.0.0': [release('1.0.0')], '1.9.0': [release('1.9.0')] } }
                : { urls: [release(version)] }),
            },
          }),
        );
      }

      const result = await new PipResolver().resolveDependencies(
        'demo',
        '>=1,<2',
        {
          maxDepth: 0,
          ...(indexUrl ? { indexUrl } : {}),
          targetPlatform: { system: 'Linux', machine: 'x86_64' },
          pythonVersion: '3.13',
        },
      );

      expect(result.root.package).toMatchObject({
        version: '1.9.0',
        metadata: {
          filename: 'demo-1.9.0-py3-none-any.whl',
        },
      });
    },
  );

  it('Simple API의 Core Metadata가 없는 sdist는 --no-deps에서 checksum으로 반입한다', async () => {
    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      {
        filename: 'demo-1.0.0.tar.gz',
        url: 'https://index.example/demo-1.0.0.tar.gz',
        hash: { algorithm: 'sha256', digest: 'simple-sdist-sha' },
      },
    ]);
    simpleApiMock.fetchWheelMetadata.mockResolvedValue({
      status: 'not-advertised',
    });
    pipCacheMock.fetchPackageMetadata.mockResolvedValue(null);

    const result = await new PipResolver().resolveDependencies('demo', '1.0.0', {
      maxDepth: 0,
      skipDependencyExpansion: true,
      indexUrl: 'https://index.example/simple',
      targetPlatform: { system: 'Linux', machine: 'x86_64' },
      pythonVersion: '3.13',
    });

    expect(result.root.package.metadata).toMatchObject({
      filename: 'demo-1.0.0.tar.gz',
      downloadUrl: 'https://index.example/demo-1.0.0.tar.gz',
      checksum: { sha256: 'simple-sdist-sha' },
    });
    await expectSelectedArtifactIsDownloaded(
      result.root.package,
      'https://index.example/demo-1.0.0.tar.gz',
      'simple-sdist-sha',
    );
  });

  it('Simple API의 Core Metadata와 hash가 모두 없는 sdist는 --no-deps에서도 실패한다', async () => {
    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      {
        filename: 'demo-1.0.0.tar.gz',
        url: 'https://index.example/demo-1.0.0.tar.gz',
      },
    ]);
    simpleApiMock.fetchWheelMetadata.mockResolvedValue({
      status: 'not-advertised',
    });
    pipCacheMock.fetchPackageMetadata.mockResolvedValue(null);

    await expect(
      new PipResolver().resolveDependencies('demo', '1.0.0', {
        maxDepth: 0,
        skipDependencyExpansion: true,
        indexUrl: 'https://index.example/simple',
        targetPlatform: { system: 'Linux', machine: 'x86_64' },
        pythonVersion: '3.13',
      }),
    ).rejects.toThrow('검증된 의존성 메타데이터를 찾을 수 없습니다: demo@1.0.0');
  });

  it.each(['tar.gz', 'zip', 'tar.bz2', 'tar.xz'])(
    'PyPI JSON %s sdist의 artifact metadata를 downloader까지 보존한다',
    async (extension) => {
      const filename = `demo-1.0.0.${extension}`;
      const downloadUrl = `https://files.example/${filename}`;
      pipCacheMock.fetchPackageMetadata.mockResolvedValue({
        data: {
          info: { name: 'demo', version: '1.0.0', requires_dist: [] },
          urls: [
            {
              filename,
              url: downloadUrl,
              packagetype: 'sdist',
              python_version: 'source',
              digests: { sha256: `pypi-${extension}-sha` },
              size: 80,
            },
          ],
        },
      });

      const result = await new PipResolver().resolveDependencies('demo', '1.0.0', {
        maxDepth: 0,
        targetPlatform: { system: 'Linux', machine: 'x86_64' },
        pythonVersion: '3.13',
      });

      expect(result.root.package.metadata).toMatchObject({
        filename,
        downloadUrl,
        checksum: { sha256: `pypi-${extension}-sha` },
      });
      await expectSelectedArtifactIsDownloaded(
        result.root.package,
        downloadUrl,
        `pypi-${extension}-sha`,
      );
    },
  );

  it.each(['tar.gz', 'zip', 'tar.bz2', 'tar.xz'])(
    'Simple API %s sdist의 artifact metadata를 downloader까지 보존한다',
    async (extension) => {
      const filename = `demo-1.0.0.${extension}`;
      const downloadUrl = `https://index.example/${filename}`;
      simpleApiMock.fetchPackageFiles.mockResolvedValue([
        {
          filename,
          url: downloadUrl,
          hash: { algorithm: 'sha256', digest: `simple-${extension}-sha` },
        },
      ]);
      simpleApiMock.fetchWheelMetadata.mockResolvedValue({
        status: 'available',
        requiresDist: [],
      });
      pipCacheMock.fetchPackageMetadata.mockResolvedValue(null);

      const result = await new PipResolver().resolveDependencies('demo', '1.0.0', {
        maxDepth: 0,
        indexUrl: 'https://index.example/simple',
        targetPlatform: { system: 'Linux', machine: 'x86_64' },
        pythonVersion: '3.13',
      });

      expect(result.root.package.metadata).toMatchObject({
        filename,
        downloadUrl,
        checksum: { sha256: `simple-${extension}-sha` },
      });
      await expectSelectedArtifactIsDownloaded(
        result.root.package,
        downloadUrl,
        `simple-${extension}-sha`,
      );
    },
  );

  it('Simple API의 Core Metadata가 없는 sdist는 의존성 확장 모드에서 실패한다', async () => {
    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      {
        filename: 'demo-1.0.0.tar.gz',
        url: 'https://index.example/demo-1.0.0.tar.gz',
        hash: { algorithm: 'sha256', digest: 'simple-sdist-sha' },
      },
    ]);
    simpleApiMock.fetchWheelMetadata.mockResolvedValue({
      status: 'not-advertised',
    });
    pipCacheMock.fetchPackageMetadata.mockResolvedValue(null);

    await expect(
      new PipResolver().resolveDependencies('demo', '1.0.0', {
        maxDepth: 0,
        indexUrl: 'https://index.example/simple',
        targetPlatform: { system: 'Linux', machine: 'x86_64' },
        pythonVersion: '3.13',
      }),
    ).rejects.toThrow('검증된 의존성 메타데이터를 찾을 수 없습니다: demo@1.0.0');
  });

  it('Simple API의 Core Metadata가 없는 wheel은 --no-deps에서도 실패한다', async () => {
    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      {
        filename: 'demo-1.0.0-py3-none-any.whl',
        url: 'https://index.example/demo-1.0.0.whl',
        hash: { algorithm: 'sha256', digest: 'simple-wheel-sha' },
      },
    ]);
    simpleApiMock.fetchWheelMetadata.mockResolvedValue({
      status: 'not-advertised',
    });
    pipCacheMock.fetchPackageMetadata.mockResolvedValue(null);

    await expect(
      new PipResolver().resolveDependencies('demo', '1.0.0', {
        maxDepth: 0,
        skipDependencyExpansion: true,
        indexUrl: 'https://index.example/simple',
        targetPlatform: { system: 'Linux', machine: 'x86_64' },
        pythonVersion: '3.13',
      }),
    ).rejects.toThrow('검증된 의존성 메타데이터를 찾을 수 없습니다: demo@1.0.0');
  });

  it('다음 resolve 호출에 이전 대상 환경을 재사용하지 않는다', async () => {
    pipCacheMock.fetchPackageMetadata.mockResolvedValue({
      data: {
        info: {
          name: 'demo',
          version: '1.0.0',
          requires_dist: [],
        },
        urls: [
          {
            filename:
              'demo-1.0.0-cp312-cp312-manylinux_2_17_x86_64.whl',
            url: 'https://files.example/demo-x86_64.whl',
            packagetype: 'bdist_wheel',
            python_version: 'cp312',
            digests: { sha256: 'x86-sha' },
            size: 100,
          },
          {
            filename:
              'demo-1.0.0-cp312-cp312-manylinux_2_17_aarch64.whl',
            url: 'https://files.example/demo-aarch64.whl',
            packagetype: 'bdist_wheel',
            python_version: 'cp312',
            digests: { sha256: 'arm-sha' },
            size: 120,
          },
        ],
      },
    });
    const resolver = new PipResolver();

    await resolver.resolveDependencies('demo', '1.0.0', {
      maxDepth: 0,
      targetPlatform: { system: 'Linux', machine: 'aarch64' },
      pythonVersion: '3.12',
    });
    const untargeted = await resolver.resolveDependencies(
      'demo',
      '1.0.0',
      { maxDepth: 0 },
    );

    expect(untargeted.root.package.metadata).toMatchObject({
      filename: 'demo-1.0.0-cp312-cp312-manylinux_2_17_x86_64.whl',
      downloadUrl: 'https://files.example/demo-x86_64.whl',
    });
  });
});
