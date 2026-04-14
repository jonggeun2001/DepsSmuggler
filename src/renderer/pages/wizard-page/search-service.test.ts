import { describe, expect, it, vi } from 'vitest';
import type { PackageType } from '../../stores/cart-store';
import type { DockerRegistry, OSDistributionSetting } from '../../stores/settings-store';
import { createSearchService } from './search-service';

interface SearchContextFixture {
  packageType: PackageType;
  condaChannel: string;
  dockerRegistry: DockerRegistry;
  customRegistryUrl: string;
  useCustomIndex: boolean;
  customIndexUrl: string;
  yumDistribution: OSDistributionSetting;
  aptDistribution: OSDistributionSetting;
  apkDistribution: OSDistributionSetting;
}

const baseContext: SearchContextFixture = {
  packageType: 'npm',
  condaChannel: 'conda-forge',
  dockerRegistry: 'docker.io',
  customRegistryUrl: '',
  useCustomIndex: false,
  customIndexUrl: '',
  yumDistribution: { id: 'rocky-9', architecture: 'x86_64' },
  aptDistribution: { id: 'ubuntu-24.04', architecture: 'amd64' },
  apkDistribution: { id: 'alpine-3.20', architecture: 'aarch64' },
};

describe('search-service', () => {
  it('일반 패키지는 Electron search.packages를 우선 사용한다', async () => {
    const electronAPI = {
      search: {
        packages: vi.fn().mockResolvedValue({
          results: [{ name: 'react', version: '19.2.0', description: 'ui' }],
        }),
      },
    };
    const fetchImpl = vi.fn();
    const service = createSearchService({ electronAPI, fetchImpl });

    const results = await service.searchPackages(baseContext, 'react');

    expect(electronAPI.search.packages).toHaveBeenCalledWith('npm', 'react', undefined);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(results).toEqual([{ name: 'react', version: '19.2.0', description: 'ui' }]);
  });

  it('Electron search가 없으면 npm HTTP fallback을 사용한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ name: 'vite', version: '7.2.0', description: 'build tool' }],
      }),
    });
    const service = createSearchService({ fetchImpl });

    const results = await service.searchPackages(baseContext, 'vite');

    expect(fetchImpl).toHaveBeenCalledWith('/api/npm/search?q=vite');
    expect(results).toEqual([{ name: 'vite', version: '7.2.0', description: 'build tool' }]);
  });

  it('docker 검색은 커스텀 registry를 Electron search 옵션으로 전달한다', async () => {
    const electronAPI = {
      search: {
        packages: vi.fn().mockResolvedValue({
          results: [{ name: 'org/app', version: 'latest', description: 'image' }],
        }),
      },
    };
    const service = createSearchService({ electronAPI });

    await service.searchPackages(
      {
        ...baseContext,
        packageType: 'docker',
        dockerRegistry: 'custom',
        customRegistryUrl: 'registry.example.internal',
      },
      'org/app'
    );

    expect(electronAPI.search.packages).toHaveBeenCalledWith('docker', 'org/app', {
      registry: 'registry.example.internal',
    });
  });

  it('OS 검색은 distribution payload를 포함한 os.search를 사용한다', async () => {
    const electronAPI = {
      os: {
        search: vi.fn().mockResolvedValue({
          packages: [
            {
              name: 'bash',
              version: '5.2.21',
              summary: 'GNU shell',
              description: 'GNU shell',
              architecture: 'amd64',
              location: 'pool/bash.deb',
              repository: { baseUrl: 'https://mirror.example', name: 'main' },
            },
          ],
          totalCount: 1,
        }),
      },
    };
    const service = createSearchService({ electronAPI });

    const results = await service.searchSuggestions(
      {
        ...baseContext,
        packageType: 'apt',
      },
      'bash'
    );

    expect(electronAPI.os.search).toHaveBeenCalledWith({
      query: 'bash',
      distribution: {
        id: 'ubuntu-24.04',
        name: 'ubuntu-24.04',
        osType: 'linux',
        packageManager: 'apt',
      },
      architecture: 'amd64',
      matchType: 'partial',
      limit: 20,
    });
    expect(results).toEqual([
      {
        name: 'bash',
        version: '5.2.21',
        description: 'GNU shell',
        downloadUrl: 'https://mirror.example/pool/bash.deb',
        repository: { baseUrl: 'https://mirror.example', name: 'main' },
        location: 'pool/bash.deb',
        architecture: 'amd64',
        osPackageInfo: {
          name: 'bash',
          version: '5.2.21',
          summary: 'GNU shell',
          description: 'GNU shell',
          architecture: 'amd64',
          location: 'pool/bash.deb',
          repository: { baseUrl: 'https://mirror.example', name: 'main' },
        },
      },
    ]);
  });

  it('pip 검색은 custom index 사용 시 indexUrl 옵션을 전달한다', async () => {
    const electronAPI = {
      search: {
        packages: vi.fn().mockResolvedValue({ results: [] }),
      },
    };
    const service = createSearchService({ electronAPI });

    await service.searchPackages(
      {
        ...baseContext,
        packageType: 'pip',
        useCustomIndex: true,
        customIndexUrl: 'https://download.pytorch.org/whl/cu124',
      },
      'torch'
    );

    expect(electronAPI.search.packages).toHaveBeenCalledWith('pip', 'torch', {
      indexUrl: 'https://download.pytorch.org/whl/cu124',
    });
  });
});
