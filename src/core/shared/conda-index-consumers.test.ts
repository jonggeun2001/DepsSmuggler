import * as os from 'os';
import * as path from 'path';
import axios from 'axios';
import * as fs from 'fs-extra';
import { afterEach, expect, it, vi } from 'vitest';
import {
  closeRepodataWorker,
  fetchRepodata,
  queryRepodata,
  type RepodataReference,
} from './conda-cache';
import { CondaDownloader } from '../downloaders/conda';
import { CondaRepoDataProcessor } from '../resolver/conda-repodata-processor';
import type { RepoData, RepoDataPackage } from './conda-types';

const config = {
  condaUrl: 'https://conda.anaconda.org',
  targetSubdir: 'linux-64',
  targetArchitecture: 'x86_64',
  pythonVersion: '3.12',
  cudaVersion: null,
};
const pkg = (
  name: string,
  version: string,
  build: string,
  buildNumber: number,
  depends: string[] = []
): RepoDataPackage => ({
  name,
  version,
  build,
  build_number: buildNumber,
  depends,
  subdir: 'noarch',
});
const noarch: RepoData = {
  info: { subdir: 'noarch' },
  packages: {
    'demo-1-py311.tar.bz2': pkg('demo', '1.0', 'py311_9', 9),
    'unrelated.tar.bz2': pkg('unrelated', '9', '0', 0),
  },
  'packages.conda': {
    'demo-1-py312.conda': pkg('demo', '1.0', 'py312_3', 3),
    'demo-2-py312.conda': pkg('demo', '2.0', 'py312_4', 4),
    'demo-3-cuda.conda': pkg('demo', '3.0', 'py312_cuda_99', 99, ['__cuda >=12']),
  },
};
let cacheDir: string | undefined;
afterEach(async () => {
  await closeRepodataWorker();
  if (cacheDir) await fs.remove(cacheDir);
  cacheDir = undefined;
  vi.restoreAllMocks();
});

it('keeps unindexed raw-data fallback for both hits and misses', async () => {
  const scans = vi.fn(Reflect.ownKeys);
  const raw = {
    ...noarch,
    packages: new Proxy<Record<string, RepoDataPackage>>(noarch.packages, { ownKeys: scans }),
    'packages.conda': new Proxy<Record<string, RepoDataPackage>>(noarch['packages.conda']!, {
      ownKeys: scans,
    }),
  };
  const processor = new CondaRepoDataProcessor(config);
  const data = await queryRepodata(raw, 'demo');
  expect(data).toBe(raw);
  expect(scans).not.toHaveBeenCalled();
  expect(
    processor
      .findPackageCandidates(data, 'demo', '>=1', undefined, 'py312*')
      .map((item) => item.version)
  ).toEqual(['2.0', '1.0']);
  expect(scans).toHaveBeenCalledTimes(2);
  scans.mockClear();
  expect(processor.findPackageCandidates(await queryRepodata(raw, 'missing'), 'missing')).toEqual(
    []
  );
  expect(scans).toHaveBeenCalledTimes(2);
});

it('shares indexed subsets without changing resolver filters or downloader build selection after a platform miss', async () => {
  cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'conda-index-consumers-'));
  const network = vi
    .spyOn(axios, 'get')
    .mockRejectedValue(new Error('unexpected external request'));
  const references = new Map<string, RepodataReference>();
  for (const [subdir, data] of [
    [
      'linux-64',
      {
        info: { subdir: 'linux-64' },
        packages: {
          'unrelated.tar.bz2': { ...noarch.packages['unrelated.tar.bz2'], subdir: 'linux-64' },
        },
      },
    ],
    ['noarch', noarch],
  ] as const) {
    const folder = path.join(cacheDir, 'fixture', subdir);
    await fs.ensureDir(folder);
    await fs.writeJson(path.join(folder, 'repodata.json'), data);
    await fs.writeJson(path.join(folder, 'repodata.meta.json'), {
      cachedAt: Date.now(),
      maxAge: 86400,
      packageCount: Object.keys(data.packages).length,
      url: `https://conda.anaconda.org/fixture/${subdir}/current_repodata.json`,
      compressed: false,
    });
    references.set(subdir, (await fetchRepodata('fixture', subdir, { cacheDir }))!.data);
  }
  const processor = new CondaRepoDataProcessor(config);
  const resolverRepos = vi
    .spyOn(processor, 'getRepoData')
    .mockImplementation(async (_channel, subdir) => references.get(subdir) ?? null);
  const downloader = new CondaDownloader();
  const downloaderRepos = vi
    .spyOn(
      downloader as unknown as { getRepoData: CondaRepoDataProcessor['getRepoData'] },
      'getRepoData'
    )
    .mockImplementation(async (_channel, subdir) => references.get(subdir) ?? null);
  const api = vi
    .spyOn(
      (downloader as unknown as { client: { get: (url: string) => Promise<unknown> } }).client,
      'get'
    )
    .mockRejectedValue(new Error('unexpected API fallback'));
  for (let repeat = 0; repeat < 3; repeat++) {
    expect(
      await processor.getLatestVersionFromRepoData('DEMO', 'fixture', '>=1', undefined, 'py312*')
    ).toBe('2.0');
    const download = await downloader.getPackageMetadata('demo', '1.0', 'fixture', 'x86_64');
    expect(download.metadata).toMatchObject({ filename: 'demo-1-py311.tar.bz2', subdir: 'noarch' });
  }
  expect(resolverRepos.mock.calls.map((call) => call[1])).toEqual(
    Array(3).fill(['linux-64', 'noarch']).flat()
  );
  expect(downloaderRepos.mock.calls.map((call) => call[1])).toEqual(
    Array(3).fill(['linux-64', 'noarch']).flat()
  );
  const subset = await queryRepodata(references.get('noarch')!, 'demo');
  expect(Object.keys(subset.packages)).toEqual(['demo-1-py311.tar.bz2']);
  expect(subset['packages.conda']).toHaveProperty('demo-3-cuda.conda'); // raw candidates, no resolver filter in shared index
  expect(network).not.toHaveBeenCalled();
  expect(api).not.toHaveBeenCalled();
});
