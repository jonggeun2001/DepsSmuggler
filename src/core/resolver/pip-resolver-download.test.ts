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

async function expectSelectedArtifactIsDownloaded(
  packageInfo: Awaited<
    ReturnType<PipResolver['resolveDependencies']>
  >['root']['package'],
  expectedUrl: string,
  expectedSha256: string,
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
    expectedSha256,
  );
}

describe('PipResolver에서 PipDownloader까지 선택 아티팩트 전달', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    simpleApiMock.fetchWheelMetadata.mockResolvedValue([]);
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
    simpleApiMock.fetchWheelMetadata.mockResolvedValue([]);
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
    simpleApiMock.fetchWheelMetadata.mockResolvedValue([]);
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
    simpleApiMock.fetchWheelMetadata.mockResolvedValue([]);
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
            requires_python: '!=3.12.*',
            digests: { sha256: 'python312-excluded-sha' },
            size: 100,
          },
          {
            filename:
              'demo-1.0.0-cp312-cp312-manylinux_2_17_x86_64.whl',
            url: 'https://files.example/demo-python312-included.whl',
            packagetype: 'bdist_wheel',
            python_version: 'cp312',
            requires_python: '==3.12.*',
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
        requiresPython: '!=3.12.*',
        hash: { algorithm: 'sha256', digest: 'simple-excluded-sha' },
      },
      {
        filename,
        url: 'https://index.example/demo-python312-included.whl',
        requiresPython: '==3.12.*',
        hash: { algorithm: 'sha256', digest: 'simple-included-sha' },
      },
    ]);
    simpleApiMock.fetchWheelMetadata.mockResolvedValue([]);
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
    simpleApiMock.fetchWheelMetadata.mockResolvedValue([]);
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

  it('호환 wheel과 sdist가 모두 없으면 다른 아키텍처를 선택하지 않고 실패한다', async () => {
    simpleApiMock.fetchPackageFiles.mockResolvedValue([
      {
        filename: 'demo-1.0.0-cp312-cp312-manylinux_2_17_x86_64.whl',
        url: 'https://index.example/demo-x86_64.whl',
        hash: { algorithm: 'sha256', digest: 'simple-x86-sha' },
      },
    ]);
    simpleApiMock.fetchWheelMetadata.mockResolvedValue([]);
    pipCacheMock.fetchPackageMetadata.mockResolvedValue(null);

    await expect(
      new PipResolver().resolveDependencies('demo', '1.0.0', {
        maxDepth: 0,
        indexUrl: 'https://index.example/simple',
        targetPlatform: { system: 'Linux', machine: 'aarch64' },
        pythonVersion: '3.12',
      }),
    ).rejects.toThrow('호환되는 pip 아티팩트');
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
