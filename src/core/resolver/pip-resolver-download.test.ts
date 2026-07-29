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
