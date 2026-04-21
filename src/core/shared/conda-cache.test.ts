import * as os from 'os';
import * as path from 'path';
import axios from 'axios';
import * as fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRepodata } from './conda-cache';
import type { RepoData } from './conda-types';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    isAxiosError: vi.fn(),
  },
}));

const mockedAxiosGet = vi.mocked(axios.get);
const mockedIsAxiosError = vi.mocked(axios.isAxiosError);

function getCachePaths(cacheDir: string, channel: string, subdir: string): {
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
    url: metaOverrides.url ?? `https://conda.anaconda.org/${channel}/${subdir}/current_repodata.json`,
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
    await fs.remove(cacheDir);
  });

  it('TTL이 유효한 디스크 캐시가 있으면 네트워크 요청 없이 반환해야 함', async () => {
    const data: RepoData = {
      info: { subdir: 'linux-64' },
      packages: { 'python-3.12.0-0.tar.bz2': {} as never },
      'packages.conda': {},
    };
    await writeCachedRepodata(cacheDir, 'conda-forge', 'linux-64', data);

    const result = await fetchRepodata('conda-forge', 'linux-64', { cacheDir });

    expect(result?.fromCache).toBe(true);
    expect(result?.data.info.subdir).toBe('linux-64');
    expect(mockedAxiosGet).not.toHaveBeenCalled();
  });

  it('304 Not Modified 응답이면 기존 디스크 캐시를 재사용하고 cachedAt을 갱신해야 함', async () => {
    const channel = 'conda-forge';
    const subdir = 'linux-64';
    const cachedAt = Date.now() - 10_000;
    const data: RepoData = {
      info: { subdir },
      packages: { 'python-3.12.0-0.tar.bz2': {} as never },
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
    expect(result?.data.info.subdir).toBe(subdir);
    expect(updatedMeta.cachedAt).toBeGreaterThan(cachedAt);
    expect(mockedAxiosGet).toHaveBeenCalledTimes(2);
  });

  it('동시에 같은 repodata를 요청하면 네트워크 요청을 한 번만 수행해야 함', async () => {
    const channel = 'conda-forge';
    const subdir = 'linux-64';
    const data: RepoData = {
      info: { subdir },
      packages: { 'python-3.12.0-0.tar.bz2': {} as never },
      'packages.conda': {},
    };

    mockedAxiosGet.mockImplementation(
      async (url: string) => {
        if (url.endsWith('repodata.json.zst')) {
          throw new Error('missing compressed metadata');
        }

        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              status: 200,
              data,
              headers: {},
            } as never);
          }, 50);
        });
      }
    );

    const [first, second] = await Promise.all([
      fetchRepodata(channel, subdir, { cacheDir }),
      fetchRepodata(channel, subdir, { cacheDir }),
    ]);

    expect(first?.fromCache).toBe(false);
    expect(second?.fromCache).toBe(false);
    expect(first?.data.info.subdir).toBe(subdir);
    expect(second?.data.info.subdir).toBe(subdir);
    expect(mockedAxiosGet).toHaveBeenCalledTimes(2);
  });
});
