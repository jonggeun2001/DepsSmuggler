import axios from 'axios';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getPipDownloader, PipDownloader } from './pip';
import type { PackageInfo } from '../../types';

type PipArtifactDownloader = {
  downloadArtifactFile: PipDownloader['downloadArtifactFile'];
};

const asPipArtifactDownloader = (downloader: PipDownloader): PipArtifactDownloader =>
  downloader as unknown as PipArtifactDownloader;

// axios 모킹
vi.mock('axios', () => {
  const mockAxiosInstance = {
    get: vi.fn(),
    defaults: { baseURL: 'https://pypi.org/pypi' },
  };
  return {
    default: {
      create: vi.fn(() => mockAxiosInstance),
      isAxiosError: vi.fn((error: Error & { isAxiosError?: boolean }) => error?.isAxiosError === true),
    },
  };
});

// Simple API 모킹
vi.mock('../shared/pip-simple-api-client', () => ({
  fetchPackageFiles: vi.fn(),
  extractVersionFromFilename: vi.fn(),
  findLatestVersion: vi.fn(),
  compareVersions: vi.fn((a: string, b: string) => {
    // 간단한 버전 비교 구현
    return a.localeCompare(b, undefined, { numeric: true });
  }),
}));

describe('pip downloader', () => {
  let downloader: ReturnType<typeof getPipDownloader>;

  beforeEach(() => {
    vi.clearAllMocks();
    downloader = getPipDownloader();
  });

  describe('getPipDownloader', () => {
    it('싱글톤 인스턴스 반환', () => {
      const instance1 = getPipDownloader();
      const instance2 = getPipDownloader();
      expect(instance1).toBe(instance2);
    });

    it('type이 pip', () => {
      expect(downloader.type).toBe('pip');
    });
  });

});

describe('PipDownloader 클래스 메서드 테스트 (모킹)', () => {
  let downloader: PipDownloader;
  let mockClient: { get: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    downloader = new PipDownloader();
    // axios.create가 반환한 mock instance 가져오기
    mockClient = axios.create() as unknown as { get: ReturnType<typeof vi.fn> };
  });

  describe('searchPackages', () => {
    it('패키지 검색 성공', async () => {
      mockClient.get.mockResolvedValueOnce({
        data: {
          info: {
            name: 'requests',
            version: '2.28.0',
            summary: 'HTTP library',
            author: 'Kenneth Reitz',
            license: 'Apache 2.0',
            home_page: 'https://requests.readthedocs.io',
          },
          releases: {},
        },
      });

      const results = await downloader.searchPackages('requests');

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        type: 'pip',
        name: 'requests',
        version: '2.28.0',
        metadata: {
          description: 'HTTP library',
          author: 'Kenneth Reitz',
          license: 'Apache 2.0',
          homepage: 'https://requests.readthedocs.io',
        },
      });
    });

    it('존재하지 않는 패키지 검색 시 빈 배열 반환', async () => {
      const notFoundError = new Error('Not Found') as Error & {
        isAxiosError: boolean;
        response: { status: number };
      };
      notFoundError.isAxiosError = true;
      notFoundError.response = { status: 404 };
      mockClient.get.mockRejectedValueOnce(notFoundError);

      const results = await downloader.searchPackages('nonexistent-package-12345');

      expect(results).toEqual([]);
    });

    it('네트워크 오류 시 예외 발생', async () => {
      const networkError = new Error('Network Error');
      mockClient.get.mockRejectedValueOnce(networkError);

      await expect(downloader.searchPackages('test')).rejects.toThrow('Network Error');
    });
  });

  describe('getVersions', () => {
    it('JSON API로 버전 목록 조회 성공', async () => {
      mockClient.get.mockResolvedValueOnce({
        data: {
          releases: {
            '2.1.0': [{ filename: 'requests-2.1.0.tar.gz' }],
            '2.0.0': [{ filename: 'requests-2.0.0.tar.gz' }],
            '1.0.0': [{ filename: 'requests-1.0.0.tar.gz' }],
          },
        },
      });

      const versions = await downloader.getVersions('requests');

      expect(versions).toContain('2.1.0');
      expect(versions).toContain('2.0.0');
      expect(versions).toContain('1.0.0');
    });

    it('Simple API로 버전 목록 조회 성공 (indexUrl 지정)', async () => {
      const { fetchPackageFiles, extractVersionFromFilename } = await import('../shared/pip-simple-api-client');

      vi.mocked(fetchPackageFiles).mockResolvedValueOnce([
        { filename: 'requests-3.0.0.tar.gz', url: 'http://example.com/requests-3.0.0.tar.gz', yanked: false },
        { filename: 'requests-2.9.0.tar.gz', url: 'http://example.com/requests-2.9.0.tar.gz', yanked: false },
        { filename: 'requests-2.8.0.tar.gz', url: 'http://example.com/requests-2.8.0.tar.gz', yanked: false },
      ]);

      vi.mocked(extractVersionFromFilename)
        .mockReturnValueOnce('3.0.0')
        .mockReturnValueOnce('2.9.0')
        .mockReturnValueOnce('2.8.0');

      const versions = await downloader.getVersions('requests', 'https://pypi.org/simple');

      expect(versions.length).toBeGreaterThan(0);
    });

    it('버전 조회 실패 시 예외 발생', async () => {

      const error = new Error('API Error');
      mockClient.get.mockRejectedValueOnce(error);

      await expect(downloader.getVersions('test')).rejects.toThrow('API Error');
    });
  });

  describe('getPackageMetadata', () => {
    it('패키지 메타데이터 조회 성공', async () => {
      mockClient.get.mockResolvedValueOnce({
        data: {
          info: {
            name: 'requests',
            version: '2.28.0',
            summary: 'HTTP library',
            author: 'Kenneth Reitz',
            license: 'Apache 2.0',
            home_page: 'https://requests.readthedocs.io',
            requires_python: '>=3.7',
          },
          // getPackageMetadata uses `urls` not `releases`
          urls: [
            {
              filename: 'requests-2.28.0-py3-none-any.whl',
              packagetype: 'bdist_wheel',
              size: 62500,
              url: 'https://pypi.org/packages/requests-2.28.0-py3-none-any.whl',
              digests: { sha256: 'abc123' },
              md5_digest: 'md5hash',
            },
          ],
        },
      });

      const metadata = await downloader.getPackageMetadata('requests', '2.28.0');

      expect(metadata.name).toBe('requests');
      expect(metadata.version).toBe('2.28.0');
      expect(metadata.type).toBe('pip');
      expect(metadata.metadata).toHaveProperty('description');
      expect(metadata.metadata?.downloadUrl).toBe('https://pypi.org/packages/requests-2.28.0-py3-none-any.whl');
    });

    it('버전 지정시 URL 형태가 다름', async () => {
      mockClient.get.mockResolvedValueOnce({
        data: {
          info: {
            name: 'requests',
            version: '2.31.0',
            summary: 'HTTP library',
          },
          urls: [
            {
              filename: 'requests-2.31.0-py3-none-any.whl',
              packagetype: 'bdist_wheel',
              size: 63000,
              url: 'https://pypi.org/packages/requests-2.31.0-py3-none-any.whl',
              digests: { sha256: 'def456' },
              md5_digest: 'md5hash2',
            },
          ],
        },
      });

      const metadata = await downloader.getPackageMetadata('requests', '2.31.0');

      expect(metadata.version).toBe('2.31.0');
      expect(metadata.metadata?.size).toBe(63000);
    });

    it('대상 Python보다 높은 info.requires_python 패키지는 선택하지 않는다', async () => {
      downloader.setPipTargetPlatform({
        os: 'linux',
        arch: 'x86_64',
        pythonVersion: '3.12',
      });
      mockClient.get.mockResolvedValueOnce({
        data: {
          info: {
            name: 'future',
            version: '1.0.0',
            requires_python: '>=3.13',
          },
          urls: [
            {
              filename: 'future-1.0.0-py3-none-any.whl',
              packagetype: 'bdist_wheel',
              size: 100,
              url: 'https://pypi.org/packages/future-1.0.0.whl',
              digests: { sha256: 'abc123' },
              md5_digest: 'md5hash',
            },
          ],
        },
      });

      await expect(downloader.getPackageMetadata('future', '1.0.0')).rejects.toThrow(
        '호환되는 패키지를 찾을 수 없습니다: future@1.0.0'
      );
    });

    it('메타데이터 조회 실패 시 예외 발생', async () => {
      const error = new Error('API Error');
      mockClient.get.mockRejectedValueOnce(error);

      await expect(downloader.getPackageMetadata('test', '1.0.0')).rejects.toThrow('API Error');
    });
  });

  describe('getReleasesForArch', () => {
    const mockReleases = [
      { filename: 'pkg-1.0.0-py3-none-any.whl', packagetype: 'bdist_wheel', python_version: 'py3' },
      { filename: 'pkg-1.0.0-cp311-cp311-manylinux_2_17_x86_64.whl', packagetype: 'bdist_wheel', python_version: 'cp311' },
      { filename: 'pkg-1.0.0-cp311-cp311-win_amd64.whl', packagetype: 'bdist_wheel', python_version: 'cp311' },
      { filename: 'pkg-1.0.0-cp311-cp311-macosx_10_9_arm64.whl', packagetype: 'bdist_wheel', python_version: 'cp311' },
      { filename: 'pkg-1.0.0.tar.gz', packagetype: 'sdist', python_version: 'source' },
    ];

    it('전체 릴리스 반환 (필터 없음)', async () => {
      mockClient.get.mockResolvedValueOnce({
        data: { urls: mockReleases },
      });

      const releases = await downloader.getReleasesForArch('pkg', '1.0.0');

      expect(releases).toHaveLength(5);
    });

    it('Linux OS 필터링', async () => {
      mockClient.get.mockResolvedValueOnce({
        data: { urls: mockReleases },
      });

      const releases = await downloader.getReleasesForArch('pkg', '1.0.0', undefined, undefined, 'linux');

      // sdist + none-any + linux용 wheel만 반환
      expect(releases.some(r => r.filename.includes('manylinux'))).toBe(true);
      expect(releases.some(r => r.filename.includes('none-any'))).toBe(true);
      expect(releases.some(r => r.filename.includes('sdist') || r.filename.includes('.tar.gz'))).toBe(true);
    });

    it('Windows OS 필터링', async () => {
      mockClient.get.mockResolvedValueOnce({
        data: { urls: mockReleases },
      });

      const releases = await downloader.getReleasesForArch('pkg', '1.0.0', undefined, undefined, 'windows');

      expect(releases.some(r => r.filename.includes('win_amd64'))).toBe(true);
      expect(releases.some(r => r.filename.includes('none-any'))).toBe(true);
    });

    it('macOS OS 필터링', async () => {
      mockClient.get.mockResolvedValueOnce({
        data: { urls: mockReleases },
      });

      const releases = await downloader.getReleasesForArch('pkg', '1.0.0', undefined, undefined, 'macos');

      expect(releases.some(r => r.filename.includes('macosx'))).toBe(true);
    });

    it('x86_64 아키텍처 필터링', async () => {
      mockClient.get.mockResolvedValueOnce({
        data: { urls: mockReleases },
      });

      const releases = await downloader.getReleasesForArch('pkg', '1.0.0', 'x86_64');

      expect(releases.some(r => r.filename.includes('x86_64'))).toBe(true);
      expect(releases.some(r => r.filename.includes('win_amd64'))).toBe(true);
      expect(releases.some(r => r.filename.includes('none-any'))).toBe(true);
    });

    it('arm64 아키텍처 필터링', async () => {
      mockClient.get.mockResolvedValueOnce({
        data: { urls: mockReleases },
      });

      const releases = await downloader.getReleasesForArch('pkg', '1.0.0', 'arm64');

      expect(releases.some(r => r.filename.includes('arm64'))).toBe(true);
      expect(releases.some(r => r.filename.includes('none-any'))).toBe(true);
    });

    it('Python 버전 필터링', async () => {
      mockClient.get.mockResolvedValueOnce({
        data: { urls: mockReleases },
      });

      const releases = await downloader.getReleasesForArch('pkg', '1.0.0', undefined, '311');

      // py3 또는 cp311 포함된 것만
      expect(releases.every(r =>
        r.packagetype === 'sdist' ||
        r.python_version === 'py3' ||
        r.python_version.includes('311')
      )).toBe(true);
    });

    it('패키지 requires_python이 대상보다 높으면 빈 릴리스 목록을 반환한다', async () => {
      mockClient.get.mockResolvedValueOnce({
        data: {
          info: { requires_python: '>=3.13' },
          urls: mockReleases,
        },
      });

      await expect(
        downloader.getReleasesForArch('pkg', '1.0.0', undefined, '3.12')
      ).resolves.toEqual([]);
    });

    it('복합 필터링 (OS + arch)', async () => {
      mockClient.get.mockResolvedValueOnce({
        data: { urls: mockReleases },
      });

      const releases = await downloader.getReleasesForArch('pkg', '1.0.0', 'x86_64', undefined, 'linux');

      // Linux x86_64에 맞는 것만
      const hasCorrectWheel = releases.some(r =>
        r.filename.includes('manylinux') && r.filename.includes('x86_64')
      );
      expect(hasCorrectWheel).toBe(true);
    });
  });

  describe('selectBestRelease', () => {
    it('빈 릴리스 배열 처리', async () => {
      mockClient.get.mockResolvedValueOnce({
        data: {
          info: { name: 'test', version: '1.0.0', summary: '' },
          urls: [],
        },
      });

      const metadata = await downloader.getPackageMetadata('test', '1.0.0');

      // downloadUrl이 없어야 함
      expect(metadata.metadata?.downloadUrl).toBeUndefined();
    });

    it('범용 wheel 우선 선택', async () => {
      mockClient.get.mockResolvedValueOnce({
        data: {
          info: { name: 'test', version: '1.0.0', summary: '' },
          urls: [
            { filename: 'test-1.0.0-cp311-cp311-linux_x86_64.whl', packagetype: 'bdist_wheel', url: 'url1', digests: { sha256: 'abc' } },
            { filename: 'test-1.0.0-py3-none-any.whl', packagetype: 'bdist_wheel', url: 'url2', digests: { sha256: 'def' } },
            { filename: 'test-1.0.0.tar.gz', packagetype: 'sdist', url: 'url3', digests: { sha256: 'ghi' } },
          ],
        },
      });

      const metadata = await downloader.getPackageMetadata('test', '1.0.0');

      expect(metadata.metadata?.downloadUrl).toBe('url2');
    });

    it('py2.py3 범용 wheel 선택', async () => {
      mockClient.get.mockResolvedValueOnce({
        data: {
          info: { name: 'test', version: '1.0.0', summary: '' },
          urls: [
            { filename: 'test-1.0.0-cp311-cp311-linux_x86_64.whl', packagetype: 'bdist_wheel', url: 'url1', digests: { sha256: 'abc' } },
            { filename: 'test-1.0.0-py2.py3-none-any.whl', packagetype: 'bdist_wheel', url: 'url2', digests: { sha256: 'def' } },
          ],
        },
      });

      const metadata = await downloader.getPackageMetadata('test', '1.0.0');

      expect(metadata.metadata?.downloadUrl).toBe('url2');
    });

    it('wheel 없으면 sdist 선택', async () => {
      mockClient.get.mockResolvedValueOnce({
        data: {
          info: { name: 'test', version: '1.0.0', summary: '' },
          urls: [
            { filename: 'test-1.0.0.tar.gz', packagetype: 'sdist', url: 'url1', digests: { sha256: 'abc' } },
          ],
        },
      });

      const metadata = await downloader.getPackageMetadata('test', '1.0.0');

      expect(metadata.metadata?.downloadUrl).toBe('url1');
    });

    it('범용 wheel 없으면 첫 번째 wheel 선택', async () => {
      mockClient.get.mockResolvedValueOnce({
        data: {
          info: { name: 'test', version: '1.0.0', summary: '' },
          urls: [
            { filename: 'test-1.0.0.tar.gz', packagetype: 'sdist', url: 'url3', digests: { sha256: 'ghi' } },
            { filename: 'test-1.0.0-cp311-cp311-linux_x86_64.whl', packagetype: 'bdist_wheel', url: 'url1', digests: { sha256: 'abc' } },
            { filename: 'test-1.0.0-cp311-cp311-win_amd64.whl', packagetype: 'bdist_wheel', url: 'url2', digests: { sha256: 'def' } },
          ],
        },
      });

      const metadata = await downloader.getPackageMetadata('test', '1.0.0');

      // 범용 wheel이 없으면 첫 번째 wheel (url1) 선택
      expect(metadata.metadata?.downloadUrl).toBe('url1');
    });

    it('sdist만 있으면 sdist 선택', async () => {
      mockClient.get.mockResolvedValueOnce({
        data: {
          info: { name: 'test', version: '1.0.0', summary: '' },
          urls: [
            { filename: 'test-1.0.0.tar.gz', packagetype: 'sdist', url: 'url1', digests: { sha256: 'abc' } },
            { filename: 'test-1.0.0.zip', packagetype: 'sdist', url: 'url2', digests: { sha256: 'def' } },
          ],
        },
      });

      const metadata = await downloader.getPackageMetadata('test', '1.0.0');

      expect(metadata.metadata?.downloadUrl).toBe('url1');
    });

    it('wheel/sdist 없으면 첫 번째 항목 선택', async () => {
      mockClient.get.mockResolvedValueOnce({
        data: {
          info: { name: 'test', version: '1.0.0', summary: '' },
          urls: [
            { filename: 'test-1.0.0.egg', packagetype: 'bdist_egg', url: 'url1', digests: { sha256: 'abc' } },
          ],
        },
      });

      const metadata = await downloader.getPackageMetadata('test', '1.0.0');

      expect(metadata.metadata?.downloadUrl).toBe('url1');
    });
  });
});

// downloadPackage 테스트
describe('PipDownloader downloadPackage', () => {
  let downloader: PipDownloader;
  let mockClient: { get: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    downloader = new PipDownloader();
    mockClient = axios.create() as unknown as { get: ReturnType<typeof vi.fn> };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolver가 제공한 URL을 메타데이터 재조회 없이 다운로드한다', async () => {
    const getMetadata = vi
      .spyOn(downloader, 'getPackageMetadata')
      .mockResolvedValue({
        type: 'pip',
        name: 'demo',
        version: '1.0.0',
        metadata: {
          downloadUrl: 'https://files.example/unexpected.whl',
        },
      });
    const verifyChecksum = vi
      .spyOn(downloader, 'verifyChecksum')
      .mockResolvedValue(true);
    const downloadArtifactFile = vi
      .spyOn(asPipArtifactDownloader(downloader), 'downloadArtifactFile')
      .mockResolvedValue('/tmp/test/demo-cp312.whl');

    await downloader.downloadPackage(
      {
        type: 'pip',
        name: 'demo',
        version: '1.0.0',
        metadata: {
          downloadUrl: 'https://files.example/demo-cp312.whl',
          checksum: { sha256: 'resolved-sha' },
        },
      },
      '/tmp/test',
    );

    expect(getMetadata).not.toHaveBeenCalled();
    expect(downloadArtifactFile).toHaveBeenCalledWith(
      '/tmp/test',
      expect.objectContaining({
        downloadUrl: 'https://files.example/demo-cp312.whl',
      }),
      undefined,
    );

    const artifactOptions = downloadArtifactFile.mock.calls[0]?.[1];
    if (typeof artifactOptions?.verifyFile !== 'function') {
      throw new Error('downloadArtifactFile 호출에 검증 옵션이 없습니다');
    }
    await artifactOptions.verifyFile('/tmp/test/demo-cp312.whl');
    expect(verifyChecksum).toHaveBeenCalledWith(
      '/tmp/test/demo-cp312.whl',
      'resolved-sha',
      'sha256',
    );
  });

  it('resolver가 MD5 체크섬만 제공해도 해당 알고리즘으로 검증한다', async () => {
    const verifyChecksum = vi
      .spyOn(downloader, 'verifyChecksum')
      .mockResolvedValue(true);
    const downloadArtifactFile = vi
      .spyOn(asPipArtifactDownloader(downloader), 'downloadArtifactFile')
      .mockResolvedValue('/tmp/test/demo.whl');

    await downloader.downloadPackage(
      {
        type: 'pip',
        name: 'demo',
        version: '1.0.0',
        metadata: {
          downloadUrl: 'https://files.example/demo.whl',
          checksum: { md5: 'resolved-md5' },
        },
      },
      '/tmp/test',
    );

    const artifactOptions = downloadArtifactFile.mock.calls[0]?.[1];
    if (typeof artifactOptions?.verifyFile !== 'function') {
      throw new Error('downloadArtifactFile 호출에 검증 옵션이 없습니다');
    }
    await artifactOptions.verifyFile('/tmp/test/demo.whl');
    expect(verifyChecksum).toHaveBeenCalledWith(
      '/tmp/test/demo.whl',
      'resolved-md5',
      'md5',
    );
  });

  it('여러 체크섬이 있으면 지원 가능한 가장 강한 알고리즘을 사용한다', async () => {
    const verifyChecksum = vi
      .spyOn(downloader, 'verifyChecksum')
      .mockResolvedValue(true);
    const downloadArtifactFile = vi
      .spyOn(asPipArtifactDownloader(downloader), 'downloadArtifactFile')
      .mockResolvedValue('/tmp/test/demo.whl');

    await downloader.downloadPackage(
      {
        type: 'pip',
        name: 'demo',
        version: '1.0.0',
        metadata: {
          downloadUrl: 'https://files.example/demo.whl',
          checksum: {
            md5: 'resolved-md5',
            sha256: 'resolved-sha256',
            sha512: 'resolved-sha512',
          },
        },
      },
      '/tmp/test',
    );

    const artifactOptions = downloadArtifactFile.mock.calls[0]?.[1];
    if (typeof artifactOptions?.verifyFile !== 'function') {
      throw new Error('downloadArtifactFile 호출에 검증 옵션이 없습니다');
    }
    await artifactOptions.verifyFile('/tmp/test/demo.whl');
    expect(verifyChecksum).toHaveBeenCalledWith(
      '/tmp/test/demo.whl',
      'resolved-sha512',
      'sha512',
    );
  });

  it('같은 파일명의 서로 다른 저장소 아티팩트를 별도 상대 경로에 저장한다', async () => {
    const downloadArtifactFile = vi
      .spyOn(asPipArtifactDownloader(downloader), 'downloadArtifactFile')
      .mockResolvedValue('/tmp/test/demo.whl');
    const packageInfo = (
      indexUrl: string,
      downloadUrl: string,
      checksum: string,
    ): PackageInfo => ({
      type: 'pip',
      name: 'demo',
      version: '1.0.0',
      metadata: {
        filename: 'demo-1.0.0-py3-none-any.whl',
        downloadUrl,
        indexUrl,
        checksum: { sha256: checksum },
      },
    });

    await downloader.downloadPackage(
      packageInfo(
        'https://first.example/simple',
        'https://files.example/demo.whl',
        'first-sha',
      ),
      '/tmp/test',
    );
    await downloader.downloadPackage(
      packageInfo(
        'https://second.example/simple',
        'https://files.example/demo.whl',
        'second-sha',
      ),
      '/tmp/test',
    );

    const relativePaths = downloadArtifactFile.mock.calls.map((call) => {
      const relativeFilePath = call[1].relativeFilePath;
      if (typeof relativeFilePath !== 'string') {
        throw new Error('downloadArtifactFile 호출에 상대 경로가 없습니다');
      }
      return relativeFilePath;
    });
    expect(new Set(relativePaths).size).toBe(2);
    for (const relativePath of relativePaths) {
      expect(relativePath).toMatch(
        /^pip\/[a-f0-9]{16}\/demo-1\.0\.0-py3-none-any\.whl$/,
      );
    }
  });

  it('제공된 체크섬 알고리즘을 지원하지 않으면 다운로드 전에 실패한다', async () => {
    const downloadArtifactFile = vi
      .spyOn(asPipArtifactDownloader(downloader), 'downloadArtifactFile')
      .mockResolvedValue('/tmp/test/demo.whl');

    await expect(
      downloader.downloadPackage(
        {
          type: 'pip',
          name: 'demo',
          version: '1.0.0',
          metadata: {
            downloadUrl: 'https://files.example/demo.whl',
            checksum: {
              blake2b: 'unsupported-checksum',
            } as any,
          },
        },
        '/tmp/test',
      ),
    ).rejects.toThrow('지원하지 않는 체크섬 알고리즘');
    expect(downloadArtifactFile).not.toHaveBeenCalled();
  });

  it('다운로드 URL이 없으면 에러 발생', async () => {
    // getPackageMetadata가 downloadUrl 없이 반환하도록 모킹
    mockClient.get.mockResolvedValueOnce({
      data: {
        info: { name: 'test', version: '1.0.0', summary: '' },
        urls: [], // 빈 배열 - downloadUrl 없음
      },
    });

    const packageInfo: PackageInfo = {
      type: 'pip',
      name: 'test',
      version: '1.0.0',
    };

    await expect(
      downloader.downloadPackage(packageInfo, '/tmp/test')
    ).rejects.toThrow('다운로드 URL을 찾을 수 없습니다');
  });


});
