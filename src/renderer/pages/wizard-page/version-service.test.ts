import { describe, expect, it, vi } from 'vitest';
import type { PackageType } from '../../stores/cart-store';
import type { DockerRegistry, OSDistributionSetting } from '../../stores/settings-store';
import type { SearchResult } from './types';
import { createVersionService } from './version-service';

interface VersionContextFixture {
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

const baseContext: VersionContextFixture = {
  packageType: 'pip',
  condaChannel: 'conda-forge',
  dockerRegistry: 'docker.io',
  customRegistryUrl: '',
  useCustomIndex: false,
  customIndexUrl: '',
  yumDistribution: { id: 'rocky-9', architecture: 'x86_64' },
  aptDistribution: { id: 'ubuntu-24.04', architecture: 'amd64' },
  apkDistribution: { id: 'alpine-3.20', architecture: 'aarch64' },
};

describe('version-service', () => {
  it('Electron search.versions를 우선 사용하고 pip indexUrl을 기록한다', async () => {
    const electronAPI = {
      search: {
        versions: vi.fn().mockResolvedValue({ versions: ['2.32.0', '2.31.0'] }),
      },
    };
    const service = createVersionService({ electronAPI });

    const result = await service.loadVersionDetails(
      {
        ...baseContext,
        packageType: 'pip',
        useCustomIndex: true,
        customIndexUrl: 'https://download.pytorch.org/whl/cu124',
      },
      {
        name: 'requests',
        version: '2.31.0',
      }
    );

    expect(electronAPI.search.versions).toHaveBeenCalledWith('pip', 'requests', {
      indexUrl: 'https://download.pytorch.org/whl/cu124',
    });
    expect(result).toEqual({
      versions: ['2.32.0', '2.31.0'],
      selectedVersion: '2.32.0',
      usedIndexUrl: 'https://download.pytorch.org/whl/cu124',
      isNativeLibrary: false,
      availableClassifiers: [],
    });
  });

  it('Electron 버전 조회가 없으면 Maven HTTP fallback을 사용한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ versions: ['5.3.0', '5.2.9'] }),
    });
    const service = createVersionService({ fetchImpl });

    const result = await service.loadVersionDetails(
      {
        ...baseContext,
        packageType: 'maven',
      },
      {
        name: 'org.springframework:spring-core',
        version: '5.2.9',
      }
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/maven/versions?package=org.springframework%3Aspring-core'
    );
    expect(result.versions).toEqual(['5.3.0', '5.2.9']);
    expect(result.selectedVersion).toBe('5.3.0');
  });

  it('docker는 태그 fallback에서 latest를 우선 선택한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tags: ['1.0.0', 'latest', '0.9.0'] }),
    });
    const service = createVersionService({ fetchImpl });

    const result = await service.loadVersionDetails(
      {
        ...baseContext,
        packageType: 'docker',
        dockerRegistry: 'custom',
        customRegistryUrl: 'registry.example.internal',
      },
      {
        name: 'org/app',
        version: '1.0.0',
      }
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/docker/tags?image=org%2Fapp&registry=registry.example.internal'
    );
    expect(result.selectedVersion).toBe('latest');
    expect(result.versions).toEqual(['1.0.0', 'latest', '0.9.0']);
  });

  it('OS 패키지는 검색 결과의 versions를 그대로 사용한다', async () => {
    const service = createVersionService({});

    const record: SearchResult = {
      name: 'bash',
      version: '5.2.21',
      versions: ['5.2.21', '5.2.15'],
    };

    const result = await service.loadVersionDetails(
      {
        ...baseContext,
        packageType: 'apt',
      },
      record
    );

    expect(result).toEqual({
      versions: ['5.2.21', '5.2.15'],
      selectedVersion: '5.2.21',
      usedIndexUrl: undefined,
      isNativeLibrary: false,
      availableClassifiers: [],
    });
  });

  it('Maven은 classifier 부가 정보를 함께 반환한다', async () => {
    const electronAPI = {
      search: {
        versions: vi.fn().mockResolvedValue({ versions: ['1.0.0'] }),
      },
      maven: {
        isNativeArtifact: vi.fn().mockResolvedValue(true),
        getAvailableClassifiers: vi.fn().mockResolvedValue(['natives-linux', 'natives-osx']),
      },
    };
    const service = createVersionService({ electronAPI });

    const result = await service.loadVersionDetails(
      {
        ...baseContext,
        packageType: 'maven',
      },
      {
        name: 'com.example:native-lib',
        version: '1.0.0',
        groupId: 'com.example',
        artifactId: 'native-lib',
      }
    );

    expect(result.isNativeLibrary).toBe(true);
    expect(result.availableClassifiers).toEqual(['natives-linux', 'natives-osx']);
    expect(electronAPI.maven.isNativeArtifact).toHaveBeenCalledWith(
      'com.example',
      'native-lib',
      '1.0.0'
    );
  });
});
