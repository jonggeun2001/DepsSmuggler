import { describe, expect, it, vi } from 'vitest';
import { CondaRepoDataProcessor } from './conda-repodata-processor';
import { CondaResolver } from './conda-resolver';

describe('CondaRepoDataProcessor Python 호환성', () => {
  it('pyhd noarch 빌드의 Python 의존성 범위를 평가한다', () => {
    const processor = new CondaRepoDataProcessor({
      condaUrl: 'https://conda.example',
      targetSubdir: 'noarch',
      targetArchitecture: 'x86_64',
      pythonVersion: '3.12',
      cudaVersion: null,
    });

    const [candidate] = processor.findPackageCandidates(
      {
        info: { subdir: 'noarch' },
        packages: {},
        'packages.conda': {
          'demo-1.0.0-pyhd8ed1ab_0.conda': {
            name: 'demo',
            version: '1.0.0',
            build: 'pyhd8ed1ab_0',
            build_number: 0,
            depends: ['python >=3.11,<3.12'],
            subdir: 'noarch',
          },
        },
      },
      'demo',
      '==1.0.0',
    );

    expect(candidate).toMatchObject({
      filename: 'demo-1.0.0-pyhd8ed1ab_0.conda',
      isPythonMatch: false,
    });
  });

  it.each([
    ['python 범위', ['python >=3.12,<3.13']],
    ['python_abi 범위와 빌드', ['python_abi 3.12.* *_cp312']],
  ])('대상 Python과 일치하는 %s를 허용한다', (_name, depends) => {
    const processor = new CondaRepoDataProcessor({
      condaUrl: 'https://conda.example',
      targetSubdir: 'noarch',
      targetArchitecture: 'x86_64',
      pythonVersion: '3.12',
      cudaVersion: null,
    });

    const [candidate] = processor.findPackageCandidates(
      {
        info: { subdir: 'noarch' },
        packages: {
          'demo-1.0.0-pyhd8ed1ab_0.tar.bz2': {
            name: 'demo',
            version: '1.0.0',
            build: 'pyhd8ed1ab_0',
            build_number: 0,
            depends,
            subdir: 'noarch',
          },
        },
      },
      'demo',
      '==1.0.0',
    );

    expect(candidate.isPythonMatch).toBe(true);
  });

  it('최신 버전 조회에서도 비호환 noarch Python 빌드를 제외한다', async () => {
    const processor = new CondaRepoDataProcessor({
      condaUrl: 'https://conda.example',
      targetSubdir: 'linux-aarch64',
      targetArchitecture: 'aarch64',
      pythonVersion: '3.12',
      cudaVersion: null,
    });
    vi.spyOn(processor, 'getRepoData')
      .mockResolvedValueOnce({
        info: { subdir: 'linux-aarch64' },
        packages: {},
      })
      .mockResolvedValueOnce({
        info: { subdir: 'noarch' },
        packages: {
          'demo-1.0.0-pyhd8ed1ab_0.tar.bz2': {
            name: 'demo',
            version: '1.0.0',
            build: 'pyhd8ed1ab_0',
            build_number: 0,
            depends: ['python >=3.11,<3.12'],
            subdir: 'noarch',
          },
        },
      });

    await expect(
      processor.getLatestVersionFromRepoData('demo', 'conda-forge'),
    ).resolves.toBeNull();
  });

  it('대상 아키텍처와 다른 __archspec noarch 빌드를 제외한다', () => {
    const processor = new CondaRepoDataProcessor({
      condaUrl: 'https://conda.example',
      targetSubdir: 'noarch',
      targetArchitecture: 'aarch64',
      pythonVersion: null,
      cudaVersion: null,
    });

    const candidates = processor.findPackageCandidates(
      {
        info: { subdir: 'noarch' },
        packages: {
          'demo-1.0.0-x86_1.tar.bz2': {
            name: 'demo',
            version: '1.0.0',
            build: 'x86_1',
            build_number: 1,
            depends: ['__archspec 1 x86_64'],
            subdir: 'noarch',
          },
          'demo-1.0.0-portable_0.tar.bz2': {
            name: 'demo',
            version: '1.0.0',
            build: 'portable_0',
            build_number: 0,
            depends: [],
            subdir: 'noarch',
          },
        },
      },
      'demo',
      '==1.0.0',
    );

    expect(candidates.map((candidate) => candidate.filename)).toEqual([
      'demo-1.0.0-portable_0.tar.bz2',
    ]);
  });

  it.each([
    ['linux-aarch64', 'arm64', 'aarch64'],
    ['osx-arm64', 'aarch64', 'aarch64'],
    ['win-arm64', 'arm64', 'aarch64'],
    ['noarch', 'arm64', 'arm64'],
  ])(
    '%s 대상에서 ARM 별칭 %s를 __archspec %s와 대응한다',
    (targetSubdir, targetArchitecture, archspecBuild) => {
      const processor = new CondaRepoDataProcessor({
        condaUrl: 'https://conda.example',
        targetSubdir,
        targetArchitecture,
        pythonVersion: null,
        cudaVersion: null,
      });

      const candidates = processor.findPackageCandidates(
        {
          info: { subdir: targetSubdir },
          packages: {
            'demo-1.0.0-arm_0.tar.bz2': {
              name: 'demo',
              version: '1.0.0',
              build: 'arm_0',
              build_number: 0,
              depends: [`__archspec=1=${archspecBuild}`],
              subdir: targetSubdir,
            },
          },
        },
        'demo',
        '==1.0.0',
      );

      expect(candidates).toHaveLength(1);
    },
  );

  it('일반 ARM 대상만으로 판정할 수 없는 microarchitecture를 거부한다', () => {
    const processor = new CondaRepoDataProcessor({
      condaUrl: 'https://conda.example',
      targetSubdir: 'osx-arm64',
      targetArchitecture: 'arm64',
      pythonVersion: null,
      cudaVersion: null,
    });

    const candidates = processor.findPackageCandidates(
      {
        info: { subdir: 'osx-arm64' },
        packages: {
          'demo-1.0.0-m1_0.tar.bz2': {
            name: 'demo',
            version: '1.0.0',
            build: 'm1_0',
            build_number: 0,
            depends: ['__archspec=1=m1'],
            subdir: 'osx-arm64',
          },
        },
      },
      'demo',
      '==1.0.0',
    );

    expect(candidates).toEqual([]);
  });

  it('요청한 CUDA 버전과 일치하는 build 변형만 선택한다', () => {
    const processor = new CondaRepoDataProcessor({
      condaUrl: 'https://conda.example',
      targetSubdir: 'linux-64',
      targetArchitecture: 'x86_64',
      pythonVersion: null,
      cudaVersion: '12.4',
    });

    const candidates = processor.findPackageCandidates(
      {
        info: { subdir: 'linux-64' },
        packages: {
          'demo-1.0.0-cpu_2.tar.bz2': {
            name: 'demo',
            version: '1.0.0',
            build: 'cpu_2',
            build_number: 2,
            depends: [],
            subdir: 'linux-64',
          },
          'demo-1.0.0-cuda118_1.tar.bz2': {
            name: 'demo',
            version: '1.0.0',
            build: 'cuda118_1',
            build_number: 1,
            depends: [],
            subdir: 'linux-64',
          },
          'demo-1.0.0-cuda124_0.tar.bz2': {
            name: 'demo',
            version: '1.0.0',
            build: 'cuda124_0',
            build_number: 0,
            depends: [],
            subdir: 'linux-64',
          },
        },
      },
      'demo',
      '==1.0.0',
    );

    expect(candidates.map((candidate) => candidate.build)).toEqual([
      'cuda124_0',
    ]);
  });

  it.each([
    ['pytorch-cuda >=12.4,<12.5', true],
    ['cuda-version >=12.4,<12.5', true],
    ['cudatoolkit >=12.4,<12.5', true],
    ['pytorch-cuda >=11.8,<11.9', false],
    ['cuda-version >=12.5,<13', false],
    ['cudatoolkit >=11.8,<11.9', false],
  ])(
    'CUDA MatchSpec %s를 요청 버전과 비교한다',
    (dependency, expected) => {
      const processor = new CondaRepoDataProcessor({
        condaUrl: 'https://conda.example',
        targetSubdir: 'linux-64',
        targetArchitecture: 'x86_64',
        pythonVersion: null,
        cudaVersion: '12.4',
      });

      const candidates = processor.findPackageCandidates(
        {
          info: { subdir: 'linux-64' },
          packages: {
            'demo-1.0.0-generic_0.tar.bz2': {
              name: 'demo',
              version: '1.0.0',
              build: 'generic_0',
              build_number: 0,
              depends: [dependency],
              subdir: 'linux-64',
            },
          },
        },
        'demo',
        '==1.0.0',
      );

      expect(candidates.length > 0).toBe(expected);
    },
  );

  it.each([
    ['py36_cu92_pyt14', '9.2'],
    ['py36_cu101_pyt14', '10.1'],
    ['cuda116h4bf587c_0', '11.6'],
    ['cuda124py312h123_0', '12.4'],
  ])(
    '실제 compact CUDA build %s를 %s로 판별한다',
    (build, cudaVersion) => {
      const processor = new CondaRepoDataProcessor({
        condaUrl: 'https://conda.example',
        targetSubdir: 'linux-64',
        targetArchitecture: 'x86_64',
        pythonVersion: null,
        cudaVersion,
      });

      const candidates = processor.findPackageCandidates(
        {
          info: { subdir: 'linux-64' },
          packages: {
            [`demo-1.0.0-${build}.tar.bz2`]: {
              name: 'demo',
              version: '1.0.0',
              build,
              build_number: 0,
              depends: [],
              subdir: 'linux-64',
            },
          },
        },
        'demo',
        '==1.0.0',
      );

      expect(candidates).toHaveLength(1);
    },
  );

  it.each([
    ['py36_cu92_pyt14', '10.1'],
    ['cuda116h4bf587c_0', '12.4'],
  ])(
    'compact CUDA build %s를 잘못된 대상 %s에서 제외한다',
    (build, cudaVersion) => {
      const processor = new CondaRepoDataProcessor({
        condaUrl: 'https://conda.example',
        targetSubdir: 'linux-64',
        targetArchitecture: 'x86_64',
        pythonVersion: null,
        cudaVersion,
      });

      const candidates = processor.findPackageCandidates(
        {
          info: { subdir: 'linux-64' },
          packages: {
            [`demo-1.0.0-${build}.tar.bz2`]: {
              name: 'demo',
              version: '1.0.0',
              build,
              build_number: 0,
              depends: [],
              subdir: 'linux-64',
            },
          },
        },
        'demo',
        '==1.0.0',
      );

      expect(candidates).toEqual([]);
    },
  );
});

describe('CondaResolver 대상 아티팩트 선택', () => {
  it('대상 OS가 없으면 linux-64 대신 noarch만 조회한다', async () => {
    const resolver = new CondaResolver();
    const processor = (
      resolver as unknown as {
        repoDataProcessor: {
          getRepoData: (
            channel: string,
            subdir: string,
          ) => Promise<Record<string, unknown> | null>;
        };
      }
    ).repoDataProcessor;
    const getRepoData = vi
      .spyOn(processor, 'getRepoData')
      .mockImplementation(async (_channel, subdir) => {
        if (subdir !== 'noarch') {
          return null;
        }
        return {
          info: { subdir: 'noarch' },
          packages: {
            'demo-1.0.0-x86-only_1.tar.bz2': {
              name: 'demo',
              version: '1.0.0',
              build: 'x86_only_1',
              build_number: 1,
              depends: ['__archspec=1=x86_64'],
              subdir: 'noarch',
            },
            'demo-1.0.0-pyhd8ed1ab_0.tar.bz2': {
              name: 'demo',
              version: '1.0.0',
              build: 'pyhd8ed1ab_0',
              build_number: 0,
              depends: ['python >=3.12,<3.13'],
              subdir: 'noarch',
            },
          },
        };
      });

    const result = await resolver.resolveDependencies('demo', '1.0.0', {
      maxDepth: 0,
      targetPlatform: { machine: 'aarch64' },
      pythonVersion: '3.12',
    });

    expect(getRepoData).not.toHaveBeenCalledWith(
      'conda-forge',
      'linux-64',
    );
    expect(result.root.package.metadata).toMatchObject({
      subdir: 'noarch',
      filename: 'demo-1.0.0-pyhd8ed1ab_0.tar.bz2',
    });
  });

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

  it('대상 Python과 맞지 않는 noarch 빌드를 거부한다', async () => {
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

    vi.spyOn(processor, 'getRepoData')
      .mockResolvedValueOnce({
        packages: {},
        'packages.conda': {},
        info: { subdir: 'linux-aarch64' },
      })
      .mockResolvedValueOnce({
        packages: {},
        'packages.conda': {
          'demo-1.0.0-pyhd8ed1ab_0.conda': {
            name: 'demo',
            version: '1.0.0',
            build: 'pyhd8ed1ab_0',
            build_number: 0,
            depends: ['python >=3.11,<3.12'],
            subdir: 'noarch',
            size: 100,
          },
        },
        info: { subdir: 'noarch' },
      });

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

  it('필수 Conda 하위 의존성 후보가 없으면 전체 해결에 실패한다', async () => {
    const resolver = new CondaResolver();
    const processor = (
      resolver as unknown as {
        repoDataProcessor: {
          getRepoData: (
            channel: string,
            subdir: string,
          ) => Promise<Record<string, unknown>>;
        };
      }
    ).repoDataProcessor;

    vi.spyOn(processor, 'getRepoData').mockResolvedValue({
      info: { subdir: 'linux-aarch64' },
      packages: {
        'demo-1.0.0-linux-aarch64.conda': {
          name: 'demo',
          version: '1.0.0',
          build: 'linux_aarch64_0',
          build_number: 0,
          depends: ['missing-dependency >=1.0'],
          subdir: 'linux-aarch64',
        },
      },
    });

    await expect(
      resolver.resolveDependencies('demo', '1.0.0', {
        targetPlatform: {
          system: 'Linux',
          machine: 'aarch64',
        },
        pythonVersion: '3.12',
      }),
    ).rejects.toThrow('필수 Conda 의존성');
  });

  it('OpenSSL 같은 런타임 패키지도 오프라인 묶음에 포함한다', async () => {
    const resolver = new CondaResolver();
    const processor = (
      resolver as unknown as {
        repoDataProcessor: {
          getRepoData: (
            channel: string,
            subdir: string,
          ) => Promise<Record<string, unknown>>;
        };
      }
    ).repoDataProcessor;

    vi.spyOn(processor, 'getRepoData').mockResolvedValue({
      info: { subdir: 'linux-aarch64' },
      packages: {
        'demo-1.0.0-linux-aarch64.conda': {
          name: 'demo',
          version: '1.0.0',
          build: 'linux_aarch64_0',
          build_number: 0,
          depends: ['openssl >=3.0'],
          subdir: 'linux-aarch64',
        },
        'openssl-3.3.0-linux-aarch64.conda': {
          name: 'openssl',
          version: '3.3.0',
          build: 'linux_aarch64_0',
          build_number: 0,
          depends: [],
          subdir: 'linux-aarch64',
        },
      },
    });

    const result = await resolver.resolveDependencies('demo', '1.0.0', {
      targetPlatform: {
        system: 'Linux',
        machine: 'aarch64',
      },
      pythonVersion: '3.12',
    });

    expect(result.flatList.map((pkg) => pkg.name)).toContain('openssl');
  });

  it('하위 의존성의 Conda build MatchSpec을 실제 아티팩트 선택까지 유지한다', async () => {
    const resolver = new CondaResolver();
    const processor = (
      resolver as unknown as {
        repoDataProcessor: {
          getRepoData: (
            channel: string,
            subdir: string,
          ) => Promise<Record<string, unknown>>;
        };
      }
    ).repoDataProcessor;

    vi.spyOn(processor, 'getRepoData').mockResolvedValue({
      info: { subdir: 'linux-64' },
      packages: {
        'demo-1.0.0-linux-64.conda': {
          name: 'demo',
          version: '1.0.0',
          build: 'linux_64_0',
          build_number: 0,
          depends: ['blas 1.0 *_openblas'],
          subdir: 'linux-64',
        },
        'blas-1.0-mkl_2.conda': {
          name: 'blas',
          version: '1.0',
          build: 'mkl_2',
          build_number: 2,
          depends: [],
          subdir: 'linux-64',
        },
        'blas-1.0-h123_openblas.conda': {
          name: 'blas',
          version: '1.0',
          build: 'h123_openblas',
          build_number: 1,
          depends: [],
          subdir: 'linux-64',
        },
      },
    });

    const result = await resolver.resolveDependencies('demo', '1.0.0', {
      targetPlatform: {
        system: 'Linux',
        machine: 'x86_64',
      },
      pythonVersion: '3.12',
    });

    expect(
      result.flatList.find((pkg) => pkg.name === 'blas')?.metadata,
    ).toMatchObject({
      filename: 'blas-1.0-h123_openblas.conda',
    });
  });

  it('여러 부모가 요구한 서로 다른 Conda build 아티팩트를 모두 보존한다', async () => {
    const resolver = new CondaResolver();
    const processor = (
      resolver as unknown as {
        repoDataProcessor: {
          getRepoData: (
            channel: string,
            subdir: string,
          ) => Promise<Record<string, unknown>>;
        };
      }
    ).repoDataProcessor;

    vi.spyOn(processor, 'getRepoData').mockResolvedValue({
      info: { subdir: 'linux-64' },
      packages: {
        'demo-1.0.0-linux-64.conda': {
          name: 'demo',
          version: '1.0.0',
          build: 'linux_64_0',
          build_number: 0,
          depends: ['parent-a 1.0', 'parent-b 1.0'],
          subdir: 'linux-64',
        },
        'parent-a-1.0-linux-64.conda': {
          name: 'parent-a',
          version: '1.0',
          build: 'linux_64_0',
          build_number: 0,
          depends: ['blas 1.0 *_openblas'],
          subdir: 'linux-64',
        },
        'parent-b-1.0-linux-64.conda': {
          name: 'parent-b',
          version: '1.0',
          build: 'linux_64_0',
          build_number: 0,
          depends: ['blas 1.0 *_mkl'],
          subdir: 'linux-64',
        },
        'blas-1.0-h123_openblas.conda': {
          name: 'blas',
          version: '1.0',
          build: 'h123_openblas',
          build_number: 1,
          depends: [],
          subdir: 'linux-64',
        },
        'blas-1.0-h456_mkl.conda': {
          name: 'blas',
          version: '1.0',
          build: 'h456_mkl',
          build_number: 1,
          depends: [],
          subdir: 'linux-64',
        },
      },
    });

    const result = await resolver.resolveDependencies('demo', '1.0.0', {
      targetPlatform: {
        system: 'Linux',
        machine: 'x86_64',
      },
      pythonVersion: '3.12',
    });

    expect(
      result.flatList
        .filter((pkg) => pkg.name === 'blas')
        .map((pkg) => pkg.metadata?.filename)
        .sort(),
    ).toEqual([
      'blas-1.0-h123_openblas.conda',
      'blas-1.0-h456_mkl.conda',
    ]);
  });
});
