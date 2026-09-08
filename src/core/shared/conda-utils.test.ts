import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnacondaFileInfo, RepoData, RepoDataPackage } from './conda-types';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  decompress: vi.fn(),
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('axios', () => ({ default: { get: mocks.get } }));
vi.mock('fzstd', () => ({ decompress: mocks.decompress }));
vi.mock('../../utils/logger', () => ({ default: mocks.logger }));

let getCondaDownloadUrl: typeof import('./conda-utils').getCondaDownloadUrl;
let getCondaSubdir: typeof import('./conda-utils').getCondaSubdir;
const baseUrl = 'https://conda.anaconda.org';

function pkg(overrides: Partial<RepoDataPackage> = {}): RepoDataPackage {
  return {
    name: 'numpy',
    version: '2.0.0',
    build: 'py312_0',
    build_number: 0,
    depends: ['python >=3.12'],
    subdir: 'linux-64',
    size: 4096,
    ...overrides,
  };
}

function apiFile(overrides: Partial<AnacondaFileInfo> = {}): AnacondaFileInfo {
  return {
    basename: 'linux-64/numpy-2.0.0-py312_0.conda',
    version: '2.0.0',
    size: 8192,
    attrs: { subdir: 'linux-64', build: 'py312_0', build_number: 0 },
    download_url:
      '//api.anaconda.org/download/conda-forge/numpy/2.0.0/linux-64/numpy-2.0.0-py312_0.conda',
    ...overrides,
  };
}

function serveIndexes(indexes: Record<string, RepoData>, files: AnacondaFileInfo[] = []) {
  mocks.get.mockImplementation(async (url: string) => {
    if (url.endsWith('/files')) return { data: files };
    if (url.endsWith('/current_repodata.json')) {
      const subdir = url.split('/').at(-2)!;
      return { data: indexes[subdir] ?? { packages: {} } };
    }
    throw new Error(`mock index unavailable: ${url}`);
  });
}

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.get.mockRejectedValue(new Error('mock network unavailable'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  ({ getCondaDownloadUrl, getCondaSubdir } = await import('./conda-utils'));
});
afterEach(() => vi.restoreAllMocks());

describe('getCondaSubdir', () => {
  it.each([
    [undefined, undefined, 'linux-64'],
    ['linux', 'x86_64', 'linux-64'],
    ['LINUX', 'ARM64', 'linux-aarch64'],
    ['linux', 'aarch64', 'linux-aarch64'],
    ['macos', 'x86_64', 'osx-64'],
    ['darwin', 'arm64', 'osx-arm64'],
    ['macos', 'aarch64', 'osx-arm64'],
    ['windows', 'amd64', 'win-64'],
    ['windows', 'arm64', 'win-arm64'],
    ['windows', 'aarch64', 'win-arm64'],
    ['unknown', 'arm64', 'linux-64'],
    ['', '', 'linux-64'],
  ])('maps OS %s and architecture %s to %s', (os, arch, subdir) => {
    expect(getCondaSubdir(os, arch)).toBe(subdir);
    expect(mocks.get).not.toHaveBeenCalled();
  });
});

describe('Conda repodata retrieval and caching', () => {
  it('decodes a zstd index and returns the exact package URL, filename and size', async () => {
    const compressed = Uint8Array.from([1, 2, 3, 4]);
    const repodata: RepoData = {
      packages: {},
      'packages.conda': { 'numpy-2.0.0-py312_0.conda': pkg() },
    };
    mocks.get.mockResolvedValueOnce({ data: compressed.buffer });
    mocks.decompress.mockReturnValueOnce(new TextEncoder().encode(JSON.stringify(repodata)));
    await expect(
      getCondaDownloadUrl('numpy', '2.0.0', 'x86_64', 'linux', 'conda-forge', '3.12')
    ).resolves.toEqual({
      url: `${baseUrl}/conda-forge/linux-64/numpy-2.0.0-py312_0.conda`,
      filename: 'numpy-2.0.0-py312_0.conda',
      size: 4096,
    });
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith(
      `${baseUrl}/conda-forge/linux-64/repodata.json.zst`,
      {
        responseType: 'arraybuffer',
        headers: { 'User-Agent': 'DepsSmuggler/1.0' },
        timeout: 120000,
      }
    );
    expect(mocks.decompress).toHaveBeenCalledExactlyOnceWith(compressed);
  });

  it.each(['download', 'decompression', 'invalid-json'] as const)(
    'falls back to current repodata after a compressed %s failure',
    async (failure) => {
      if (failure === 'download') mocks.get.mockRejectedValueOnce(new Error('404'));
      else {
        mocks.get.mockResolvedValueOnce({ data: new Uint8Array([0]).buffer });
        if (failure === 'decompression')
          mocks.decompress.mockImplementationOnce(() => {
            throw new Error('invalid zstd frame');
          });
        else mocks.decompress.mockReturnValueOnce(new TextEncoder().encode('not json'));
      }
      mocks.get.mockResolvedValueOnce({ data: { packages: { 'numpy.tar.bz2': pkg() } } });
      await expect(getCondaDownloadUrl('numpy', '2.0.0')).resolves.toEqual({
        url: `${baseUrl}/conda-forge/linux-64/numpy.tar.bz2`,
        filename: 'numpy.tar.bz2',
        size: 4096,
      });
      expect(mocks.get.mock.calls.map(([url]) => url)).toEqual([
        `${baseUrl}/conda-forge/linux-64/repodata.json.zst`,
        `${baseUrl}/conda-forge/linux-64/current_repodata.json`,
      ]);
    }
  );

  it('tries full repodata when both compressed and current indexes fail', async () => {
    mocks.get
      .mockRejectedValueOnce(new Error('zstd unsupported'))
      .mockRejectedValueOnce(new Error('current index unavailable'))
      .mockResolvedValueOnce({ data: { packages: { 'numpy.tar.bz2': pkg() } } });
    const result = await getCondaDownloadUrl('numpy', '2.0.0');
    expect(result?.filename).toBe('numpy.tar.bz2');
    expect(mocks.get.mock.calls.map(([url]) => url)).toEqual([
      `${baseUrl}/conda-forge/linux-64/repodata.json.zst`,
      `${baseUrl}/conda-forge/linux-64/current_repodata.json`,
      `${baseUrl}/conda-forge/linux-64/repodata.json`,
    ]);
  });

  it('reuses the index across package lookups but separates channel and platform caches', async () => {
    serveIndexes({
      'linux-64': {
        packages: { 'numpy-linux.conda': pkg(), 'scipy-linux.conda': pkg({ name: 'scipy' }) },
      },
      'osx-arm64': { packages: { 'numpy-mac.conda': pkg({ subdir: 'osx-arm64' }) } },
    });
    expect((await getCondaDownloadUrl('numpy', '2.0.0'))?.filename).toBe('numpy-linux.conda');
    expect((await getCondaDownloadUrl('scipy', '2.0.0'))?.filename).toBe('scipy-linux.conda');
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect((await getCondaDownloadUrl('numpy', '2.0.0', 'arm64', 'macos'))?.filename).toBe(
      'numpy-mac.conda'
    );
    expect(
      (await getCondaDownloadUrl('numpy', '2.0.0', 'x86_64', 'linux', 'custom-channel'))?.url
    ).toContain('/custom-channel/linux-64/');
    expect(mocks.get).toHaveBeenCalledTimes(6);
    expect(mocks.get.mock.calls.map(([url]) => url)).toContain(
      `${baseUrl}/custom-channel/linux-64/current_repodata.json`
    );
  });

  it('does not cache failed index requests, allowing a later retry to recover', async () => {
    await expect(getCondaDownloadUrl('numpy', '2.0.0')).resolves.toBeNull();
    expect(mocks.get).toHaveBeenCalledTimes(7);
    serveIndexes({ 'linux-64': { packages: { 'numpy.conda': pkg() } } });
    expect((await getCondaDownloadUrl('numpy', '2.0.0'))?.filename).toBe('numpy.conda');
    expect(mocks.get).toHaveBeenCalledTimes(9);
  });
});

describe('Conda package and Python build selection', () => {
  it('uses the highest compatible Python build before newer incompatible builds', async () => {
    serveIndexes({
      'linux-64': {
        packages: {
          'wrong-package.conda': pkg({ name: 'other', build_number: 99 }),
          'wrong-version.conda': pkg({ version: '3.0.0', build_number: 99 }),
          'numpy-py311.conda': pkg({ build: 'py311_50', build_number: 50 }),
          'numpy-py312-older.conda': pkg({ build: 'py312_1', build_number: 1 }),
          'numpy-cp312-newer.conda': pkg({ build: 'cp312_4', build_number: 4 }),
        },
      },
    });
    await expect(
      getCondaDownloadUrl('numpy', '2.0.0', undefined, undefined, undefined, '3.12.4')
    ).resolves.toEqual({
      url: `${baseUrl}/conda-forge/linux-64/numpy-cp312-newer.conda`,
      filename: 'numpy-cp312-newer.conda',
      size: 4096,
    });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('accepts native libraries without a Python build tag for a specified Python version', async () => {
    serveIndexes({
      'linux-64': {
        packages: {
          'libblas.conda': pkg({
            name: 'libblas',
            build: 'openblas_h123_7',
            build_number: 7,
            depends: [],
          }),
        },
      },
    });
    expect(
      (await getCondaDownloadUrl('libblas', '2.0.0', undefined, undefined, undefined, '3.12'))
        ?.filename
    ).toBe('libblas.conda');
    expect(console.warn).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'not-a-version'])(
    'chooses the highest build when Python version is %s',
    async (pythonVersion) => {
      serveIndexes({
        'linux-64': {
          packages: {
            'numpy-older.conda': pkg({ build: 'py312_0', build_number: 0 }),
            'numpy-newer.conda': pkg({ build: 'py311_8', build_number: 8 }),
          },
        },
      });
      expect(
        (
          await getCondaDownloadUrl(
            'numpy',
            '2.0.0',
            undefined,
            undefined,
            undefined,
            pythonVersion
          )
        )?.filename
      ).toBe('numpy-newer.conda');
    }
  );

  it('prefers a .conda artifact over a legacy archive with the same build number', async () => {
    serveIndexes({
      'linux-64': {
        packages: { 'numpy.tar.bz2': pkg() },
        'packages.conda': { 'numpy.conda': pkg() },
      },
    });
    expect((await getCondaDownloadUrl('numpy', '2.0.0'))?.filename).toBe('numpy.conda');
  });

  it('checks noarch when target-platform repodata has no matching package and defaults missing size to zero', async () => {
    serveIndexes({
      'linux-64': { packages: { 'wrong-version.conda': pkg({ version: '1.0.0' }) } },
      noarch: {
        packages: {
          'numpy-noarch.conda': pkg({ subdir: 'noarch', build: 'pyhd8ed1ab_0', size: undefined }),
        },
      },
    });
    await expect(
      getCondaDownloadUrl('numpy', '2.0.0', undefined, undefined, undefined, '3.12')
    ).resolves.toEqual({
      url: `${baseUrl}/conda-forge/noarch/numpy-noarch.conda`,
      filename: 'numpy-noarch.conda',
      size: 0,
    });
    expect(mocks.get.mock.calls.some(([url]) => String(url).endsWith('/files'))).toBe(false);
  });

  it('still checks noarch when all target-platform index requests fail', async () => {
    mocks.get.mockImplementation(async (url: string) => {
      if (url === `${baseUrl}/conda-forge/noarch/current_repodata.json`) {
        return { data: { packages: { 'numpy-noarch.conda': pkg({ subdir: 'noarch' }) } } };
      }
      throw new Error('mock 404');
    });
    expect((await getCondaDownloadUrl('numpy', '2.0.0'))?.url).toBe(
      `${baseUrl}/conda-forge/noarch/numpy-noarch.conda`
    );
    expect(mocks.get).toHaveBeenCalledTimes(5);
  });
});

describe('Conda Anaconda API fallback and errors', () => {
  it('falls back to API files and selects the highest compatible Python build in the requested subdir', async () => {
    serveIndexes({}, [
      apiFile({ basename: 'linux-64/wrong-version.conda', version: '1.0.0' }),
      apiFile({
        basename: 'win-64/wrong-platform.conda',
        attrs: { subdir: 'win-64', build: 'py312_20', build_number: 20 },
      }),
      apiFile({
        basename: 'linux-64/wrong-python.conda',
        attrs: { subdir: 'linux-64', build: 'py311_99', build_number: 99 },
      }),
      apiFile({
        basename: 'linux-64/old-build.conda',
        attrs: { subdir: 'linux-64', build: 'py312_1', build_number: 1 },
      }),
      apiFile({
        basename: 'linux-64/selected.conda',
        attrs: { subdir: 'linux-64', build: 'cp312_3', build_number: 3 },
        size: 9000,
      }),
    ]);
    await expect(
      getCondaDownloadUrl('numpy', '2.0.0', undefined, undefined, 'custom', '3.12')
    ).resolves.toEqual({
      url: `${baseUrl}/custom/linux-64/selected.conda`,
      filename: 'selected.conda',
      size: 9000,
    });
    expect(mocks.get).toHaveBeenLastCalledWith(
      'https://api.anaconda.org/package/custom/numpy/files',
      {
        headers: { 'User-Agent': 'DepsSmuggler/1.0' },
        timeout: 30000,
      }
    );
    expect(mocks.logger.warn).not.toHaveBeenCalled();
  });

  it('selects the highest API build when no Python version is requested', async () => {
    serveIndexes({}, [
      apiFile(),
      apiFile({
        basename: 'linux-64/newer.conda',
        attrs: { subdir: 'linux-64', build: 'py311_7', build_number: 7 },
      }),
    ]);
    expect((await getCondaDownloadUrl('numpy', '2.0.0'))?.filename).toBe('newer.conda');
  });

  it('uses a matching noarch API file when no requested-subdir file exists', async () => {
    serveIndexes({}, [
      apiFile({ version: '1.0.0' }),
      apiFile({
        basename: 'noarch/numpy-any.conda',
        attrs: { subdir: 'noarch', build: 'pyhd8ed1ab_0', build_number: 0 },
        size: 0,
      }),
    ]);
    await expect(getCondaDownloadUrl('numpy', '2.0.0', 'arm64', 'macos')).resolves.toEqual({
      url: `${baseUrl}/conda-forge/noarch/numpy-any.conda`,
      filename: 'numpy-any.conda',
      size: 0,
    });
  });

  it.each<{ files: AnacondaFileInfo[] }>([
    { files: [] },
    { files: [apiFile({ version: '1.0.0' })] },
    { files: [apiFile({ attrs: { subdir: 'win-64', build: 'py312_0', build_number: 0 } })] },
  ])(
    'returns null when all metadata lacks matching release/platform files: %j',
    async ({ files }) => {
      serveIndexes({}, files);
      await expect(getCondaDownloadUrl('numpy', '2.0.0')).resolves.toBeNull();
      expect(mocks.get).toHaveBeenCalledTimes(5);
      expect(mocks.logger.error).not.toHaveBeenCalled();
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        '[conda-utils] API에서도 패키지를 찾을 수 없음',
        {
          packageName: 'numpy',
          version: '2.0.0',
          subdir: 'linux-64',
        }
      );
      expect(mocks.logger.warn).toHaveBeenCalledWith('[conda-utils] 패키지를 찾을 수 없음', {
        packageName: 'numpy',
        version: '2.0.0',
        channel: 'conda-forge',
        subdir: 'linux-64',
      });
    }
  );

  it.each(['ECONNRESET', 'ETIMEDOUT', 'HTTP 403'])(
    'returns null after %s failures exhaust all index and API fallbacks',
    async (reason) => {
      const error = new Error(reason);
      mocks.get.mockRejectedValue(error);
      await expect(getCondaDownloadUrl('numpy', '2.0.0')).resolves.toBeNull();
      expect(mocks.get.mock.calls.map(([url]) => url)).toEqual([
        `${baseUrl}/conda-forge/linux-64/repodata.json.zst`,
        `${baseUrl}/conda-forge/linux-64/current_repodata.json`,
        `${baseUrl}/conda-forge/linux-64/repodata.json`,
        `${baseUrl}/conda-forge/noarch/repodata.json.zst`,
        `${baseUrl}/conda-forge/noarch/current_repodata.json`,
        `${baseUrl}/conda-forge/noarch/repodata.json`,
        'https://api.anaconda.org/package/conda-forge/numpy/files',
      ]);
      expect(mocks.logger.error).toHaveBeenCalledWith('[conda-utils] Anaconda API 조회 실패', {
        packageName: 'numpy',
        version: '2.0.0',
        error,
      });
    }
  );

  it('reports a malformed API response as a failed lookup instead of throwing', async () => {
    serveIndexes({});
    const getIndexes = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation(async (url: string) =>
      url.endsWith('/files') ? { data: null } : getIndexes(url)
    );
    await expect(getCondaDownloadUrl('numpy', '2.0.0')).resolves.toBeNull();
    expect(mocks.logger.error).toHaveBeenCalledWith(
      '[conda-utils] Anaconda API 조회 실패',
      expect.objectContaining({ packageName: 'numpy', error: expect.any(TypeError) })
    );
  });
});
