import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  convertToOSDistributions,
  fetchAllDistributions,
  getDistributionsByPackageManager,
  invalidateDistributionCache,
} from './distribution-fetcher';

describe('distribution-fetcher', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    invalidateDistributionCache();
    fetchMock.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    invalidateDistributionCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('원격 릴리스를 파싱하고 패키지 관리자별 결과를 캐시한다', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response('<a href="v3.14/"></a><a href="v3.18/"></a><a href="v3.21/"></a>')
      )
      .mockResolvedValueOnce(
        new Response(
          [
            'Dist: Noble',
            'Version: 24.04',
            'Supported: 1',
            '',
            'Dist: Jammy',
            'Version: 22.04',
            'Supported: 1',
            '',
            'Dist: Bionic',
            'Version: 18.04',
            'Supported: 1',
          ].join('\n')
        )
      )
      .mockResolvedValueOnce(
        new Response(
          '<a href="trixie/"></a><a href="bookworm/"></a><a href="bullseye/"></a><a href="buster/"></a>'
        )
      )
      .mockResolvedValueOnce(new Response('<a href="7/"></a><a href="8/"></a><a href="9/"></a><a href="10/"></a>'))
      .mockResolvedValueOnce(new Response('<a href="8/"></a><a href="9/"></a><a href="11/"></a>'));

    const families = await fetchAllDistributions();
    const aptFamilies = await getDistributionsByPackageManager('apt');
    const flattened = convertToOSDistributions(families);

    expect(families).toHaveLength(6);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(aptFamilies.map((family) => family.id)).toEqual(['ubuntu', 'debian']);
    expect(families.find((family) => family.id === 'centos')?.versions).toEqual([
      expect.objectContaining({ id: 'centos-stream-9', version: 'stream-9' }),
    ]);
    expect(families.find((family) => family.id === 'ubuntu')?.versions.map((version) => version.version)).toEqual([
      '24.04',
      '22.04',
    ]);
    expect(flattened).toContainEqual(
      expect.objectContaining({
        id: 'alpine-3.21',
        packageManager: 'apk',
        architectures: ['x86_64', 'aarch64', 'x86', 'armv7'],
      })
    );

    await fetchAllDistributions();
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('원격 조회 실패 시 각 배포판의 폴백 목록을 사용한다', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));

    const families = await fetchAllDistributions();

    expect(families.find((family) => family.id === 'rocky')?.versions).toEqual([
      expect.objectContaining({ version: '9', status: 'current' }),
      expect.objectContaining({ version: '8', status: 'lts' }),
    ]);
    expect(families.find((family) => family.id === 'ubuntu')?.versions).toEqual([
      expect.objectContaining({ version: '24.04', codename: 'noble' }),
      expect.objectContaining({ version: '22.04', codename: 'jammy' }),
      expect.objectContaining({ version: '20.04', codename: 'focal' }),
    ]);
    expect(families.find((family) => family.id === 'alpine')?.versions[0]).toEqual(
      expect.objectContaining({ version: '3.21', status: 'current' })
    );

    invalidateDistributionCache();
    await fetchAllDistributions();
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });
});
