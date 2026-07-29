import { describe, expect, it, vi } from 'vitest';
import { CondaResolver } from './conda-resolver';

describe('CondaResolver 대상 아티팩트 선택', () => {
  it('의존성이 없는 대상 subdir 빌드를 noarch보다 우선한다', async () => {
    const resolver = new CondaResolver();
    const processor = (
      resolver as unknown as {
        repoDataProcessor: {
          getRepoData: (
            channel: string,
            subdir: string,
          ) => Promise<Record<string, unknown>>;
          findPackageCandidates: () => unknown[];
        };
      }
    ).repoDataProcessor;

    vi.spyOn(processor, 'getRepoData').mockResolvedValue({
      packages: {},
      'packages.conda': {},
      info: {},
    });
    const findCandidates = vi
      .spyOn(processor, 'findPackageCandidates')
      .mockReturnValue([
        {
          filename: 'demo-1.0.0-linux-aarch64.conda',
          name: 'demo',
          version: '1.0.0',
          build: 'linux_aarch64_0',
          buildNumber: 0,
          depends: [],
          subdir: 'linux-aarch64',
          size: 100,
          isPythonMatch: true,
        },
      ]);

    const result = await resolver.resolveDependencies('demo', '1.0.0', {
      maxDepth: 0,
      targetPlatform: {
        system: 'Linux',
        machine: 'aarch64',
      },
      pythonVersion: '3.12',
    });

    expect(findCandidates).toHaveBeenCalledTimes(1);
    expect(result.root.package.metadata).toMatchObject({
      subdir: 'linux-aarch64',
      filename: 'demo-1.0.0-linux-aarch64.conda',
      downloadUrl:
        'https://conda.anaconda.org/conda-forge/linux-aarch64/demo-1.0.0-linux-aarch64.conda',
    });
  });

  it('대상 subdir과 noarch에 호환 빌드가 없으면 실패한다', async () => {
    const resolver = new CondaResolver();
    const processor = (
      resolver as unknown as {
        repoDataProcessor: {
          getRepoData: (
            channel: string,
            subdir: string,
          ) => Promise<Record<string, unknown>>;
          findPackageCandidates: () => unknown[];
        };
      }
    ).repoDataProcessor;

    vi.spyOn(processor, 'getRepoData').mockResolvedValue({
      packages: {},
      'packages.conda': {},
      info: {},
    });
    vi.spyOn(processor, 'findPackageCandidates').mockReturnValue([]);

    await expect(
      resolver.resolveDependencies('demo', '1.0.0', {
        maxDepth: 0,
        targetPlatform: {
          system: 'Linux',
          machine: 'aarch64',
        },
        pythonVersion: '3.12',
      }),
    ).rejects.toThrow(
      '대상 환경과 호환되는 Conda 아티팩트를 찾을 수 없습니다',
    );
  });
});
