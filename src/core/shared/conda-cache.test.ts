import * as os from 'os';
import * as path from 'path';
import axios from 'axios';
import * as fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRepodata, queryRepodata, closeRepodataWorker } from './conda-cache';
import type { RepoData } from './conda-types';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    isAxiosError: vi.fn(),
  },
}));

const mockedAxiosGet = vi.mocked(axios.get);
const mockedIsAxiosError = vi.mocked(axios.isAxiosError);

function getCachePaths(
  cacheDir: string,
  channel: string,
  subdir: string
): {
  dataPath: string;
  metaPath: string;
} {
  const channelDir = path.join(cacheDir, channel, subdir);
  return {
    dataPath: path.join(channelDir, 'repodata.json'),
    metaPath: path.join(channelDir, 'repodata.meta.json'),
  };
}

async function writeCachedRepodata(
  cacheDir: string,
  channel: string,
  subdir: string,
  data: RepoData,
  metaOverrides: Partial<{
    url: string;
    maxAge: number;
    cachedAt: number;
    packageCount: number;
    compressed: boolean;
  }> = {}
): Promise<void> {
  const { dataPath, metaPath } = getCachePaths(cacheDir, channel, subdir);
  await fs.ensureDir(path.dirname(dataPath));
  await fs.writeJson(dataPath, data);
  await fs.writeJson(metaPath, {
    url:
      metaOverrides.url ?? `https://conda.anaconda.org/${channel}/${subdir}/current_repodata.json`,
    maxAge: metaOverrides.maxAge ?? 86400,
    cachedAt: metaOverrides.cachedAt ?? Date.now(),
    fileSize: JSON.stringify(data).length,
    packageCount:
      metaOverrides.packageCount ??
      Object.keys(data.packages || {}).length + Object.keys(data['packages.conda'] || {}).length,
    compressed: metaOverrides.compressed ?? false,
  });
}

describe('conda-cache', () => {
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-conda-cache-'));
    vi.clearAllMocks();
    mockedIsAxiosError.mockReturnValue(false);
  });

  afterEach(async () => {
    await closeRepodataWorker();
    await fs.remove(cacheDir);
  });

  it('TTL이 유효한 디스크 캐시가 있으면 네트워크 요청 없이 반환해야 함', async () => {
    const data: RepoData = {
      info: { subdir: 'linux-64' },
      packages: { 'python-3.12.0-0.tar.bz2': { name: 'python' } as never },
      'packages.conda': {},
    };
    await writeCachedRepodata(cacheDir, 'conda-forge', 'linux-64', data);

    const result = await fetchRepodata('conda-forge', 'linux-64', { cacheDir });

    expect(result?.fromCache).toBe(true);
    expect(result?.data.info?.subdir).toBe('linux-64');
    expect(mockedAxiosGet).not.toHaveBeenCalled();
  });

  it('304 Not Modified 응답이면 기존 디스크 캐시를 재사용하고 cachedAt을 갱신해야 함', async () => {
    const channel = 'conda-forge';
    const subdir = 'linux-64';
    const cachedAt = Date.now() - 10_000;
    const data: RepoData = {
      info: { subdir },
      packages: { 'python-3.12.0-0.tar.bz2': { name: 'python' } as never },
      'packages.conda': {},
    };
    await writeCachedRepodata(cacheDir, channel, subdir, data, {
      cachedAt,
      maxAge: 1,
      url: `https://conda.anaconda.org/${channel}/${subdir}/current_repodata.json`,
    });

    mockedAxiosGet.mockImplementation(async (url: string) => {
      if (url.endsWith('repodata.json.zst')) {
        throw new Error('missing compressed metadata');
      }
      return {
        status: 304,
        headers: {
          'cache-control': 'max-age=60',
        },
      } as never;
    });

    const result = await fetchRepodata(channel, subdir, { cacheDir });
    const { metaPath } = getCachePaths(cacheDir, channel, subdir);
    const updatedMeta = await fs.readJson(metaPath);

    expect(result?.fromCache).toBe(true);
    expect(result?.data.info?.subdir).toBe(subdir);
    expect(updatedMeta.cachedAt).toBeGreaterThan(cachedAt);
    expect(mockedAxiosGet).toHaveBeenCalledTimes(2);
  });

  it('동시에 같은 repodata를 요청하면 네트워크 요청을 한 번만 수행해야 함', async () => {
    const channel = 'conda-forge';
    const subdir = 'linux-64';
    const data: RepoData = {
      info: { subdir },
      packages: { 'python-3.12.0-0.tar.bz2': { name: 'python' } as never },
      'packages.conda': {},
    };

    mockedAxiosGet.mockImplementation(async (url: string) => {
      if (url.endsWith('repodata.json.zst')) {
        throw new Error('missing compressed metadata');
      }

      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            status: 200,
            data: Buffer.from(JSON.stringify(data)),
            headers: {},
          } as never);
        }, 50);
      });
    });

    const [first, second] = await Promise.all([
      fetchRepodata(channel, subdir, { cacheDir }),
      fetchRepodata(channel, subdir, { cacheDir }),
    ]);

    expect(first?.fromCache).toBe(false);
    expect(second?.fromCache).toBe(false);
    expect(first?.data.info?.subdir).toBe(subdir);
    expect(second?.data.info?.subdir).toBe(subdir);
    expect(mockedAxiosGet).toHaveBeenCalledTimes(2);
  });

  it('defaults는 공식 repository URL을 사용하면서 논리 채널 캐시 경로를 유지해야 함', async () => {
    const data: RepoData = {
      info: { subdir: 'noarch' },
      packages: { 'defaults-package-1.0-0.tar.bz2': { name: 'defaults-package' } as never },
      'packages.conda': {},
    };
    mockedAxiosGet.mockImplementation(async (url: string) => {
      if (url.endsWith('repodata.json.zst')) throw new Error('zstd unavailable');
      return { status: 200, data: Buffer.from(JSON.stringify(data)), headers: {} } as never;
    });

    const result = await fetchRepodata('defaults', 'noarch', { cacheDir });
    const { metaPath } = getCachePaths(cacheDir, 'defaults', 'noarch');
    const meta = await fs.readJson(metaPath);

    expect(await queryRepodata(result!.data, 'defaults-package')).toEqual(data);
    expect(meta.url).toBe('https://repo.anaconda.com/pkgs/main/noarch/current_repodata.json');
    expect(mockedAxiosGet.mock.calls.map(([url]) => url)).toEqual([
      'https://repo.anaconda.com/pkgs/main/noarch/repodata.json.zst',
      'https://repo.anaconda.com/pkgs/main/noarch/current_repodata.json',
    ]);
  });
  it('returns only the requested name and reloads references after worker retirement or disk replacement', async () => {
    const data: RepoData = {
      info: { subdir: 'noarch' },
      packages: {
        'demo.tar.bz2': {
          name: 'demo',
          version: '1',
          build: '0',
          build_number: 0,
          depends: [],
          subdir: 'noarch',
        },
        'other.tar.bz2': {
          name: 'other',
          version: '1',
          build: '0',
          build_number: 0,
          depends: [],
          subdir: 'noarch',
        },
      },
    };
    await writeCachedRepodata(cacheDir, 'fixture', 'noarch', data);
    const loaded = await fetchRepodata('fixture', 'noarch', { cacheDir });
    expect(loaded!.data).not.toHaveProperty('packages');
    expect(Object.keys((await queryRepodata(loaded!.data, 'DEMO')).packages)).toEqual([
      'demo.tar.bz2',
    ]);
    expect((await queryRepodata(loaded!.data, 'missing')).packages).toEqual({});
    await closeRepodataWorker();
    expect((await queryRepodata(loaded!.data, 'demo')).packages['demo.tar.bz2'].version).toBe('1');
    data.packages['demo.tar.bz2'].version = 'longer-version-2';
    await writeCachedRepodata(cacheDir, 'fixture', 'noarch', data);
    expect((await queryRepodata(loaded!.data, 'demo')).packages['demo.tar.bz2'].version).toBe(
      'longer-version-2'
    );
  });

  it('refresh replaces the index and corrupt disk data falls back to HTTP bytes', async () => {
    const paths = getCachePaths(cacheDir, 'fixture', 'noarch');
    const data: RepoData = {
      packages: {
        'demo.conda': {
          name: 'demo',
          version: '1',
          build: '0',
          build_number: 0,
          depends: [],
          subdir: 'noarch',
        },
      },
    };
    await writeCachedRepodata(cacheDir, 'fixture', 'noarch', data);
    const first = await fetchRepodata('fixture', 'noarch', { cacheDir });
    const original = first!.data;
    data.packages['demo.conda'].version = '2';
    mockedAxiosGet.mockImplementation(async (url: string) => {
      if (url.endsWith('.zst')) throw new Error('no zstd');
      return { status: 200, data: Buffer.from(JSON.stringify(data)), headers: {} } as never;
    });
    const refreshed = await fetchRepodata('fixture', 'noarch', { cacheDir, forceRefresh: true });
    expect(refreshed!.fromCache).toBe(false);
    expect((await queryRepodata(original, 'demo')).packages['demo.conda'].version).toBe('2');
    await fs.writeFile(paths.dataPath, 'invalid json');
    const recovered = await fetchRepodata('fixture', 'noarch', { cacheDir });
    expect(recovered!.fromCache).toBe(false);
    expect((await queryRepodata(recovered!.data, 'demo')).packages['demo.conda'].version).toBe('2');
    expect(mockedAxiosGet).toHaveBeenCalledTimes(4);
  });

  it('keeps no-cache queries usable without creating disk payloads', async () => {
    const data: RepoData = {
      packages: {
        'demo.conda': {
          name: 'demo',
          version: '1',
          build: '0',
          build_number: 0,
          depends: [],
          subdir: 'noarch',
        },
      },
    };
    mockedAxiosGet.mockImplementation(async (url: string) => {
      if (url.endsWith('.zst')) throw new Error('no zstd');
      return { status: 200, data: Buffer.from(JSON.stringify(data)), headers: {} } as never;
    });
    const loaded = await fetchRepodata('fixture', 'noarch', { cacheDir, useCache: false });
    expect((await queryRepodata(loaded!.data, 'demo')).packages['demo.conda'].version).toBe('1');
    expect(await fs.pathExists(getCachePaths(cacheDir, 'fixture', 'noarch').dataPath)).toBe(false);
    expect(mockedAxiosGet).toHaveBeenCalledTimes(2);
  });
  it('keeps successful network data usable when disk persistence fails', async () => {
    await fs.remove(cacheDir);
    await fs.writeFile(cacheDir, 'a file cannot hold a channel directory');
    const data: RepoData = {
      packages: {
        'demo.conda': {
          name: 'demo',
          version: 'fresh',
          build: '0',
          build_number: 0,
          depends: [],
          subdir: 'noarch',
        },
      },
    };
    mockedAxiosGet.mockImplementation(async (url: string) => {
      if (url.endsWith('.zst')) throw new Error('no zstd');
      return { status: 200, data: Buffer.from(JSON.stringify(data)), headers: {} } as never;
    });
    const loaded = await fetchRepodata('fixture', 'noarch', { cacheDir });
    expect(loaded!.data.options.useCache).toBe(false);
    expect((await queryRepodata(loaded!.data, 'demo')).packages['demo.conda'].version).toBe(
      'fresh'
    );
    expect(mockedAxiosGet).toHaveBeenCalledTimes(2);
    await closeRepodataWorker();
    expect((await queryRepodata(loaded!.data, 'demo')).packages['demo.conda'].version).toBe(
      'fresh'
    );
    expect(mockedAxiosGet).toHaveBeenCalledTimes(4);
  });
});
