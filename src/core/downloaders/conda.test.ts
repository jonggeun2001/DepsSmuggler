import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import { getCondaDownloader } from './conda';
import type { RepoData } from '../shared/conda-types';

type CondaDownloaderInternals = {
  getRepoData: ReturnType<typeof getCondaDownloader>['getRepoData'];
};

function repodataPackage(subdir: string): RepoData {
  return {
    packages: {
      'six-1.16.0-pyhd3eb1b0_1.conda': {
        name: 'six',
        version: '1.16.0',
        build: 'pyhd3eb1b0_1',
        build_number: 1,
        depends: [],
        subdir,
        size: 123,
        md5: 'fixture-md5',
      },
    },
    'packages.conda': {},
    info: { subdir },
  };
}

describe('conda downloader', () => {
  let downloader: ReturnType<typeof getCondaDownloader>;

  beforeEach(() => {
    downloader = getCondaDownloader();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getCondaDownloader', () => {
    it('싱글톤 인스턴스 반환', () => {
      const instance1 = getCondaDownloader();
      const instance2 = getCondaDownloader();
      expect(instance1).toBe(instance2);
    });

    it('type이 conda', () => {
      expect(downloader.type).toBe('conda');
    });
  });

  describe('clearCache', () => {
    it('캐시 클리어', () => {
      downloader.clearCache();
    });
  });

  describe('downloadPackage', () => {
    it('resolver가 제공한 URL을 메타데이터 재조회 없이 다운로드한다', async () => {
      const getMetadata = vi.spyOn(downloader, 'getPackageMetadata');
      const downloadArtifactFile = vi
        .spyOn(downloader as any, 'downloadArtifactFile')
        .mockResolvedValue('/tmp/test/numpy.conda');

      await downloader.downloadPackage(
        {
          type: 'conda',
          name: 'numpy',
          version: '2.0.0',
          arch: 'aarch64',
          metadata: {
            repository: 'defaults/numpy',
            downloadUrl: 'https://conda.example/numpy.conda',
          },
        },
        '/tmp/test',
      );

      expect(getMetadata).not.toHaveBeenCalled();
      expect(downloadArtifactFile).toHaveBeenCalledWith(
        '/tmp/test',
        expect.objectContaining({
          downloadUrl: 'https://conda.example/numpy.conda',
        }),
        undefined,
      );
    });
  });

  describe('defaults repository URLs', () => {
    it.each([
      ['x86_64', 'linux-64', 'https://repo.anaconda.com/pkgs/main/linux-64/'],
      ['noarch', 'noarch', 'https://repo.anaconda.com/pkgs/main/noarch/'],
    ] as const)('uses the canonical %s repository endpoint', async (arch, subdir, base) => {
      const getRepoData = vi
        .spyOn(downloader as unknown as CondaDownloaderInternals, 'getRepoData')
        .mockImplementation(async (_channel: string, requestedSubdir: string) =>
          requestedSubdir === subdir ? repodataPackage(subdir) : null
        );

      const result = await downloader.getPackageMetadata('six', '1.16.0', 'defaults', arch);

      expect(result.metadata).toMatchObject({
        repository: 'defaults/six',
        subdir,
        filename: 'six-1.16.0-pyhd3eb1b0_1.conda',
        downloadUrl: `${base}six-1.16.0-pyhd3eb1b0_1.conda`,
      });
      expect(result.metadata?.downloadUrl).not.toContain('conda.anaconda.org/defaults');
      expect(getRepoData).toHaveBeenCalledWith('defaults', subdir);
    });

    it('keeps explicit main on the ordinary Anaconda.org endpoint', async () => {
      vi.spyOn(downloader as any, 'getRepoData').mockResolvedValue(repodataPackage('noarch'));
      const result = await downloader.getPackageMetadata('six', '1.16.0', 'main', 'noarch');

      expect(result.metadata?.downloadUrl).toBe(
        'https://conda.anaconda.org/main/noarch/six-1.16.0-pyhd3eb1b0_1.conda'
      );
    });

    it('maps defaults to the main API owner without duplicating the subdir', async () => {
      vi.spyOn(downloader as any, 'getRepoData').mockResolvedValue(null);
      const apiGet = vi.spyOn((downloader as any).client, 'get').mockResolvedValue({
        data: {
          name: 'six',
          summary: 'six',
          description: 'six',
          owner: 'main',
          license: 'MIT',
          home: 'https://example.test/six',
          files: [
            {
              basename: 'noarch/six-1.16.0-pyhd3eb1b0_1.conda',
              version: '1.16.0',
              size: 123,
              attrs: { subdir: 'noarch', build: 'pyhd3eb1b0_1', build_number: 1 },
            },
          ],
          versions: ['1.16.0'],
        },
      });

      const result = await downloader.getPackageMetadata('six', '1.16.0', 'defaults', 'noarch');

      expect(apiGet).toHaveBeenCalledWith('https://api.anaconda.org/package/main/six');
      expect(result.metadata).toMatchObject({
        repository: 'defaults/six',
        downloadUrl: 'https://repo.anaconda.com/pkgs/main/noarch/six-1.16.0-pyhd3eb1b0_1.conda',
      });
      expect(result.metadata?.downloadUrl).not.toContain('/noarch/noarch/');
    });

    it('keeps defaults as the logical repository after API search owner mapping', async () => {
      const apiGet = vi.spyOn((downloader as any).client, 'get').mockResolvedValue({
        data: [{ owner: 'main', name: 'six', full_name: 'main/six', summary: 'six' }],
      });

      await expect(downloader.searchPackages('six', 'defaults')).resolves.toEqual([
        expect.objectContaining({
          name: 'six',
          metadata: { description: 'six', repository: 'defaults/six' },
        }),
      ]);
      expect(apiGet).toHaveBeenCalledWith(
        'https://api.anaconda.org/search',
        expect.objectContaining({ params: { name: 'six' } })
      );
    });
  });
});
