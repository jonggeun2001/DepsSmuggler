/**
 * dependency-resolver 테스트
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resolveAllDependencies,
  resolveSinglePackageDependencies,
  DependencyResolverOptions,
  DependencyProgressCallback,
} from './dependency-resolver';
import { DownloadPackage } from './types';

// Mock all resolvers
vi.mock('../resolver/pip-resolver', () => ({
  getPipResolver: vi.fn(() => ({
    resolveDependencies: vi.fn(),
  })),
}));

vi.mock('../resolver/maven-resolver', () => ({
  getMavenResolver: vi.fn(() => ({
    resolveDependencies: vi.fn(),
  })),
}));

vi.mock('../resolver/conda-resolver', () => ({
  getCondaResolver: vi.fn(() => ({
    resolveDependencies: vi.fn(),
  })),
}));

vi.mock('../resolver/yum-resolver', () => ({
  getYumResolver: vi.fn(() => ({
    resolveDependencies: vi.fn(),
  })),
}));

vi.mock('../resolver/npm-resolver', () => ({
  getNpmResolver: vi.fn(() => ({
    resolveDependencies: vi.fn(),
  })),
}));

// Import mocked modules
import { getPipResolver } from '../resolver/pip-resolver';
import { getMavenResolver } from '../resolver/maven-resolver';
import { getCondaResolver } from '../resolver/conda-resolver';
import { getYumResolver } from '../resolver/yum-resolver';
import { getNpmResolver } from '../resolver/npm-resolver';

describe('dependency-resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('resolveAllDependencies', () => {
    it('빈 패키지 목록에 대해 빈 결과 반환', async () => {
      const result = await resolveAllDependencies([]);

      expect(result.originalPackages).toEqual([]);
      expect(result.allPackages).toEqual([]);
      expect(result.dependencyTrees).toEqual([]);
      expect(result.failedPackages).toEqual([]);
    });

    it('지원하지 않는 패키지 타입은 원본만 포함', async () => {
      const packages: DownloadPackage[] = [
        {
          id: 'test-1',
          type: 'docker',
          name: 'nginx',
          version: 'latest',
        },
      ];

      const result = await resolveAllDependencies(packages);

      expect(result.originalPackages).toEqual(packages);
      expect(result.allPackages).toHaveLength(1);
      expect(result.allPackages[0].name).toBe('nginx');
      expect(result.dependencyTrees).toEqual([]);
      expect(result.failedPackages).toEqual([]);
    });

    it('apt 타입은 리졸버 없이 원본만 포함', async () => {
      const packages: DownloadPackage[] = [
        {
          id: 'test-1',
          type: 'apt',
          name: 'curl',
          version: '7.68.0',
        },
      ];

      const result = await resolveAllDependencies(packages);

      expect(result.allPackages).toHaveLength(1);
      expect(result.allPackages[0].name).toBe('curl');
    });

    it('apk 타입은 리졸버 없이 원본만 포함', async () => {
      const packages: DownloadPackage[] = [
        {
          id: 'test-1',
          type: 'apk',
          name: 'busybox',
          version: '1.33.0',
        },
      ];

      const result = await resolveAllDependencies(packages);

      expect(result.allPackages).toHaveLength(1);
    });

    it('pip 패키지 의존성 해결', async () => {
      const mockPipResult = {
        root: {
          package: { type: 'pip', name: 'requests', version: '2.28.0' },
          dependencies: [],
        },
        flatList: [
          { type: 'pip', name: 'requests', version: '2.28.0' },
          { type: 'pip', name: 'urllib3', version: '1.26.0' },
          { type: 'pip', name: 'charset-normalizer', version: '2.1.0' },
        ],
        conflicts: [],
        totalSize: 500000,
      };

      const mockResolver = {
        resolveDependencies: vi.fn().mockResolvedValue(mockPipResult),
      };
      vi.mocked(getPipResolver).mockReturnValue(mockResolver as any);

      const packages: DownloadPackage[] = [
        {
          id: 'test-1',
          type: 'pip',
          name: 'requests',
          version: '2.28.0',
        },
      ];

      const result = await resolveAllDependencies(packages);

      expect(getPipResolver).toHaveBeenCalled();
      expect(mockResolver.resolveDependencies).toHaveBeenCalledWith(
        'requests',
        '2.28.0',
        expect.objectContaining({
          maxDepth: 5,
          includeOptionalDependencies: false,
        })
      );
      expect(result.allPackages).toHaveLength(3);
      expect(result.dependencyTrees).toHaveLength(1);
    });

    it('latest root는 해석된 실제 버전으로 교체한다', async () => {
      const mockResolver = {
        resolveDependencies: vi.fn().mockResolvedValue({
          root: {
            package: { type: 'pip', name: 'idna', version: '3.18' },
            dependencies: [],
          },
          flatList: [{ type: 'pip', name: 'idna', version: '3.18' }],
          conflicts: [],
          totalSize: 0,
        }),
      };
      vi.mocked(getPipResolver).mockReturnValue(mockResolver as any);

      const result = await resolveAllDependencies([
        { id: 'pip-idna-latest', type: 'pip', name: 'idna', version: 'latest' },
      ]);

      expect(result.allPackages).toHaveLength(1);
      expect(result.allPackages[0]).toMatchObject({ name: 'idna', version: '3.18' });
    });

    it('includeDependencies가 false면 원본 패키지만 반환', async () => {
      const mockResolver = {
        resolveDependencies: vi.fn(),
      };
      vi.mocked(getPipResolver).mockReturnValue(mockResolver as any);

      const packages: DownloadPackage[] = [
        {
          id: 'test-1',
          type: 'pip',
          name: 'requests',
          version: '2.28.0',
        },
      ];

      const result = await resolveAllDependencies(
        packages,
        { includeDependencies: false } as DependencyResolverOptions
      );

      expect(mockResolver.resolveDependencies).not.toHaveBeenCalled();
      expect(result.originalPackages).toEqual(packages);
      expect(result.allPackages).toEqual(packages);
      expect(result.dependencyTrees).toEqual([]);
      expect(result.failedPackages).toEqual([]);
    });

    it('pip 패키지에 targetOS와 pythonVersion 옵션 전달', async () => {
      const mockPipResult = {
        root: {
          package: { type: 'pip', name: 'numpy', version: '1.24.0' },
          dependencies: [],
        },
        flatList: [{ type: 'pip', name: 'numpy', version: '1.24.0' }],
        conflicts: [],
        totalSize: 10000000,
      };

      const mockResolver = {
        resolveDependencies: vi.fn().mockResolvedValue(mockPipResult),
      };
      vi.mocked(getPipResolver).mockReturnValue(mockResolver as any);

      const packages: DownloadPackage[] = [
        { id: 'test-1', type: 'pip', name: 'numpy', version: '1.24.0' },
      ];

      const options: DependencyResolverOptions = {
        targetOS: 'linux',
        pythonVersion: '3.11',
        maxDepth: 3,
        resolveRootArtifactsOnly: true,
      };

      await resolveAllDependencies(packages, options);

      expect(mockResolver.resolveDependencies).toHaveBeenCalledWith(
        'numpy',
        '1.24.0',
        expect.objectContaining({
          maxDepth: 3,
          skipDependencyExpansion: true,
          targetPlatform: expect.objectContaining({ system: 'Linux' }),
          pythonVersion: '3.11',
        })
      );
    });

    it('conda 패키지 의존성 해결', async () => {
      const mockCondaResult = {
        root: {
          package: {
            type: 'conda',
            name: 'pandas',
            version: '2.0.0',
            metadata: {
              subdir: 'osx-arm64',
              filename: 'pandas-2.0.0-py311.conda',
              downloadUrl:
                'https://conda.example/osx-arm64/pandas-2.0.0-py311.conda',
            },
          },
          dependencies: [],
        },
        flatList: [
          {
            type: 'conda',
            name: 'pandas',
            version: '2.0.0',
            metadata: {
              subdir: 'osx-arm64',
              filename: 'pandas-2.0.0-py311.conda',
              downloadUrl:
                'https://conda.example/osx-arm64/pandas-2.0.0-py311.conda',
            },
          },
          {
            type: 'conda',
            name: 'numpy',
            version: '1.24.0',
            metadata: {
              subdir: 'osx-arm64',
              filename: 'numpy-1.24.0-py311.conda',
              downloadUrl:
                'https://conda.example/osx-arm64/numpy-1.24.0-py311.conda',
            },
          },
        ],
        conflicts: [],
        totalSize: 20000000,
      };

      const mockResolver = {
        resolveDependencies: vi.fn().mockResolvedValue(mockCondaResult),
      };
      vi.mocked(getCondaResolver).mockReturnValue(mockResolver as any);

      const packages: DownloadPackage[] = [
        { id: 'test-1', type: 'conda', name: 'pandas', version: '2.0.0' },
      ];

      const options: DependencyResolverOptions = {
        condaChannel: 'defaults',
        architecture: 'aarch64',
        targetOS: 'macos',
      };

      const result = await resolveAllDependencies(packages, options);

      expect(mockResolver.resolveDependencies).toHaveBeenCalledWith(
        'pandas',
        '2.0.0',
        expect.objectContaining({
          channel: 'defaults',
          targetPlatform: {
            system: 'Darwin',
            machine: 'aarch64',
          },
        })
      );
      expect(result.allPackages).toHaveLength(2);
    });

    it('resolver가 선택한 root 메타데이터를 기존 요청 패키지에 병합한다', async () => {
      const mockCondaResult = {
        root: {
          package: {
            type: 'conda',
            name: 'pandas',
            version: '2.0.0',
            arch: 'aarch64',
            metadata: {
              repository: 'defaults/pandas',
              subdir: 'linux-aarch64',
              filename: 'pandas-2.0.0-py312.conda',
              downloadUrl:
                'https://conda.example/pandas-2.0.0-py312.conda',
              checksum: { md5: 'resolved' },
            },
          },
          dependencies: [],
        },
        flatList: [
          {
            type: 'conda',
            name: 'pandas',
            version: '2.0.0',
            arch: 'aarch64',
            metadata: {
              repository: 'defaults/pandas',
              subdir: 'linux-aarch64',
              filename: 'pandas-2.0.0-py312.conda',
              downloadUrl:
                'https://conda.example/pandas-2.0.0-py312.conda',
              checksum: { md5: 'resolved' },
            },
          },
        ],
        conflicts: [],
        totalSize: 1,
      };
      const mockResolver = {
        resolveDependencies: vi.fn().mockResolvedValue(mockCondaResult),
      };
      vi.mocked(getCondaResolver).mockReturnValue(mockResolver as any);

      const [root] = (
        await resolveAllDependencies([
          {
            id: 'request-id',
            type: 'conda',
            name: 'pandas',
            version: 'latest',
            architecture: 'x86_64',
            indexUrl: 'https://request.example/simple',
            extras: ['request-extra'],
            metadata: {
              classifier: 'request',
              checksum: { md5: 'old' },
            },
          },
        ])
      ).allPackages;

      expect(root).toMatchObject({
        id: 'request-id',
        type: 'conda',
        name: 'pandas',
        version: '2.0.0',
        architecture: 'aarch64',
        downloadUrl: 'https://conda.example/pandas-2.0.0-py312.conda',
        filename: 'pandas-2.0.0-py312.conda',
        indexUrl: 'https://request.example/simple',
        extras: ['request-extra'],
        metadata: {
          classifier: 'request',
          checksum: { md5: 'resolved' },
          repository: 'defaults/pandas',
          subdir: 'linux-aarch64',
          filename: 'pandas-2.0.0-py312.conda',
          downloadUrl: 'https://conda.example/pandas-2.0.0-py312.conda',
        },
      });
    });

    it('같은 Conda 이름과 버전의 서로 다른 build 아티팩트를 모두 보존한다', async () => {
      const rootPackage = {
        type: 'conda' as const,
        name: 'demo',
        version: '1.0.0',
        metadata: {
          subdir: 'linux-64',
          filename: 'demo-1.0.0-linux_64_0.conda',
          downloadUrl:
            'https://conda.example/demo-1.0.0-linux_64_0.conda',
        },
      };
      const openblas = {
        type: 'conda' as const,
        name: 'blas',
        version: '1.0',
        metadata: {
          subdir: 'linux-64',
          filename: 'blas-1.0-h123_openblas.conda',
          downloadUrl:
            'https://conda.example/blas-1.0-h123_openblas.conda',
        },
      };
      const mkl = {
        type: 'conda' as const,
        name: 'blas',
        version: '1.0',
        metadata: {
          subdir: 'linux-64',
          filename: 'blas-1.0-h456_mkl.conda',
          downloadUrl:
            'https://conda.example/blas-1.0-h456_mkl.conda',
        },
      };
      vi.mocked(getCondaResolver).mockReturnValue({
        resolveDependencies: vi.fn().mockResolvedValue({
          root: {
            package: rootPackage,
            dependencies: [
              { package: openblas, dependencies: [] },
              { package: mkl, dependencies: [] },
            ],
          },
          flatList: [rootPackage, openblas, mkl],
          conflicts: [],
        }),
      } as any);

      const result = await resolveAllDependencies([
        {
          id: 'request-id',
          type: 'conda',
          name: 'demo',
          version: '1.0.0',
        },
      ]);

      expect(
        result.allPackages
          .filter((pkg) => pkg.name === 'blas')
          .map((pkg) => pkg.filename)
          .sort(),
      ).toEqual([
        'blas-1.0-h123_openblas.conda',
        'blas-1.0-h456_mkl.conda',
      ]);
    });

    it('앞선 의존성과 같은 Conda root 아티팩트를 중복하지 않는다', async () => {
      const packageInfo = (
        name: string,
        filename: string,
      ) => ({
        type: 'conda' as const,
        name,
        version: '1.0',
        metadata: {
          subdir: 'linux-64',
          filename,
          downloadUrl: `https://conda.example/${filename}`,
        },
      });
      const rootA = packageInfo('a', 'a-1.0-linux_64_0.conda');
      const rootB = packageInfo('b', 'b-1.0-linux_64_0.conda');
      const resolveDependencies = vi.fn().mockImplementation(
        async (name: string) =>
          name === 'a'
            ? {
                root: {
                  package: rootA,
                  dependencies: [
                    { package: rootB, dependencies: [] },
                  ],
                },
                flatList: [rootA, rootB],
                conflicts: [],
              }
            : {
                root: { package: rootB, dependencies: [] },
                flatList: [rootB],
                conflicts: [],
              },
      );
      vi.mocked(getCondaResolver).mockReturnValue({
        resolveDependencies,
      } as any);

      const result = await resolveAllDependencies([
        {
          id: 'request-a',
          type: 'conda',
          name: 'a',
          version: '1.0',
        },
        {
          id: 'request-b',
          type: 'conda',
          name: 'b',
          version: '1.0',
        },
      ]);

      expect(result.allPackages).toHaveLength(2);
      expect(
        result.allPackages.filter(
          (pkg) => pkg.filename === 'b-1.0-linux_64_0.conda',
        ),
      ).toHaveLength(1);
      expect(
        result.allPackages.find((pkg) => pkg.name === 'b')?.id,
      ).toBe('request-b');
    });

    it('대상 Conda 아티팩트 메타데이터가 없으면 해결 실패로 기록한다', async () => {
      const mockCondaResult = {
        root: {
          package: {
            type: 'conda',
            name: 'pandas',
            version: '2.0.0',
          },
          dependencies: [],
        },
        flatList: [
          {
            type: 'conda',
            name: 'pandas',
            version: '2.0.0',
          },
        ],
        conflicts: [],
        totalSize: 0,
      };
      const mockResolver = {
        resolveDependencies: vi.fn().mockResolvedValue(mockCondaResult),
      };
      vi.mocked(getCondaResolver).mockReturnValue(mockResolver as any);

      const result = await resolveAllDependencies(
        [
          {
            id: 'request-id',
            type: 'conda',
            name: 'pandas',
            version: '2.0.0',
            architecture: 'aarch64',
          },
        ],
        {
          architecture: 'aarch64',
          targetOS: 'linux',
          pythonVersion: '3.12',
        },
      );

      expect(result.failedPackages).toEqual([
        expect.objectContaining({
          name: 'pandas',
          error: expect.stringContaining(
            '대상 환경과 호환되는 Conda 아티팩트를 찾을 수 없습니다',
          ),
        }),
      ]);
      expect(result.allPackages).toEqual([
        expect.objectContaining({
          id: 'request-id',
          name: 'pandas',
        }),
      ]);
      expect(result.allPackages[0]).not.toHaveProperty('downloadUrl');
    });

    it('maven 패키지 의존성 해결', async () => {
      const mockMavenResult = {
        root: {
          package: {
            type: 'maven',
            name: 'spring-core',
            version: '5.3.0',
            metadata: { classifier: 'natives-linux' },
          },
          dependencies: [],
        },
        flatList: [
          {
            type: 'maven',
            name: 'spring-core',
            version: '5.3.0',
            metadata: { classifier: 'natives-linux' },
          },
          { type: 'maven', name: 'spring-jcl', version: '5.3.0' },
        ],
        conflicts: [],
        totalSize: 3000000,
      };

      const mockResolver = {
        resolveDependencies: vi.fn().mockResolvedValue(mockMavenResult),
      };
      vi.mocked(getMavenResolver).mockReturnValue(mockResolver as any);

      const packages: DownloadPackage[] = [
        {
          id: 'test-1',
          type: 'maven',
          name: 'spring-core',
          version: '5.3.0',
          classifier: 'natives-linux',
          metadata: { requestSource: 'cli' },
        },
      ];

      const result = await resolveAllDependencies(packages);

      expect(getMavenResolver).toHaveBeenCalled();
      expect(mockResolver.resolveDependencies).toHaveBeenCalledWith(
        'spring-core',
        '5.3.0',
        expect.objectContaining({
          classifier: 'natives-linux',
        }),
      );
      const resolverOptions = mockResolver.resolveDependencies.mock.calls[0][2];
      expect(resolverOptions).not.toHaveProperty('targetOS');
      expect(resolverOptions).not.toHaveProperty('targetArchitecture');
      expect(result.allPackages).toHaveLength(2);
      expect(result.allPackages[0]).toMatchObject({
        id: 'test-1',
        classifier: 'natives-linux',
        metadata: {
          classifier: 'natives-linux',
          requestSource: 'cli',
        },
      });
    });

    // yum, apt, apk는 별도 IPC 핸들러(os:resolveDependencies)에서 처리되므로 스킵
    it.skip('yum 패키지 의존성 해결', async () => {
      const mockYumResult = {
        root: {
          package: { type: 'yum', name: 'httpd', version: '2.4.6' },
          dependencies: [],
        },
        flatList: [
          { type: 'yum', name: 'httpd', version: '2.4.6', metadata: { downloadUrl: 'http://example.com/httpd.rpm' } },
          { type: 'yum', name: 'apr', version: '1.4.8', metadata: { downloadUrl: 'http://example.com/apr.rpm' } },
        ],
        conflicts: [],
        totalSize: 5000000,
      };

      const mockResolver = {
        resolveDependencies: vi.fn().mockResolvedValue(mockYumResult),
      };
      vi.mocked(getYumResolver).mockReturnValue(mockResolver as any);

      const packages: DownloadPackage[] = [
        { id: 'test-1', type: 'yum', name: 'httpd', version: '2.4.6' },
      ];

      const options: DependencyResolverOptions = {
        yumRepoUrl: 'http://custom-repo.example.com',
        architecture: 'x86_64',
      };

      const result = await resolveAllDependencies(packages, options);

      expect(mockResolver.resolveDependencies).toHaveBeenCalledWith(
        'httpd',
        '2.4.6',
        expect.objectContaining({
          repoUrl: 'http://custom-repo.example.com',
          architecture: 'x86_64',
        })
      );
      expect(result.allPackages).toHaveLength(2);
      // downloadUrl이 전달되는지 확인
      const aprPkg = result.allPackages.find(p => p.name === 'apr');
      expect(aprPkg?.downloadUrl).toBe('http://example.com/apr.rpm');
    });

    it('npm 패키지 의존성 해결 (특수 반환 형식)', async () => {
      const mockNpmResult = {
        root: { name: 'express', version: '4.18.0' },
        flatList: [
          { name: 'express', version: '4.18.0', hoistedPath: 'node_modules/express', size: 100000 },
          { name: 'body-parser', version: '1.20.0', hoistedPath: 'node_modules/body-parser', size: 50000 },
          { name: 'debug', version: '4.3.0', hoistedPath: 'node_modules/debug', size: 10000 },
        ],
        conflicts: [
          { packageName: 'qs', requestedVersions: ['6.10.0', '6.11.0'] },
        ],
        totalSize: 160000,
      };

      const mockResolver = {
        resolveDependencies: vi.fn().mockResolvedValue(mockNpmResult),
      };
      vi.mocked(getNpmResolver).mockReturnValue(mockResolver as any);

      const packages: DownloadPackage[] = [
        { id: 'test-1', type: 'npm', name: 'express', version: '4.18.0' },
      ];

      const result = await resolveAllDependencies(packages);

      expect(getNpmResolver).toHaveBeenCalled();
      expect(result.allPackages).toHaveLength(3);
      expect(result.dependencyTrees).toHaveLength(1);
      expect(result.dependencyTrees[0].conflicts).toHaveLength(1);
      expect(result.dependencyTrees[0].conflicts[0].packageName).toBe('qs');
    });

    it('의존성 해결 실패 시 failedPackages에 추가', async () => {
      const mockResolver = {
        resolveDependencies: vi.fn().mockRejectedValue(new Error('Network error')),
      };
      vi.mocked(getPipResolver).mockReturnValue(mockResolver as any);

      const packages: DownloadPackage[] = [
        { id: 'test-1', type: 'pip', name: 'nonexistent', version: '1.0.0' },
      ];

      const result = await resolveAllDependencies(packages);

      expect(result.failedPackages).toHaveLength(1);
      expect(result.failedPackages[0].name).toBe('nonexistent');
      expect(result.failedPackages[0].error).toBe('Network error');
      // 원본 패키지는 여전히 포함됨
      expect(result.allPackages).toHaveLength(1);
    });

    it('선택 아티팩트가 있는 성공 루트와 실패 루트의 전이 의존성을 보존한다', async () => {
      const mockResolver = {
        resolveDependencies: vi.fn()
          .mockResolvedValueOnce({
            root: {
              package: {
                type: 'pip',
                name: 'alpha',
                version: '1.0.0',
                metadata: {
                  filename: 'alpha-1.0.0-py3-none-any.whl',
                  downloadUrl: 'https://files.example/alpha-1.0.0.whl',
                  checksum: { sha256: 'alpha-sha' },
                },
              },
              dependencies: [],
            },
            flatList: [
              {
                type: 'pip',
                name: 'alpha',
                version: '1.0.0',
                metadata: {
                  filename: 'alpha-1.0.0-py3-none-any.whl',
                  downloadUrl: 'https://files.example/alpha-1.0.0.whl',
                  checksum: { sha256: 'alpha-sha' },
                },
              },
              { type: 'pip', name: 'shared', version: '2.0.0' },
            ],
            conflicts: [],
            totalSize: 0,
          })
          .mockRejectedValueOnce(new Error('shared root resolution failed')),
      };
      vi.mocked(getPipResolver).mockReturnValue(mockResolver as any);

      const result = await resolveAllDependencies([
        { id: 'pip-alpha-1.0.0', type: 'pip', name: 'alpha', version: '1.0.0' },
        { id: 'pip-shared-2.0.0', type: 'pip', name: 'shared', version: '2.0.0' },
      ]);

      expect(result.failedPackages).toEqual([
        { name: 'shared', version: '2.0.0', error: 'shared root resolution failed' },
      ]);
      expect(result.successfulPackages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'pip',
            name: 'alpha',
            version: '1.0.0',
            metadata: expect.objectContaining({
              filename: 'alpha-1.0.0-py3-none-any.whl',
              downloadUrl: 'https://files.example/alpha-1.0.0.whl',
            }),
          }),
          expect.objectContaining({ type: 'pip', name: 'shared', version: '2.0.0' }),
        ])
      );
    });

    it('진행 상황 콜백 호출 (성공)', async () => {
      const mockPipResult = {
        root: { package: { type: 'pip', name: 'flask', version: '2.0.0' }, dependencies: [] },
        flatList: [{ type: 'pip', name: 'flask', version: '2.0.0' }],
        conflicts: [],
        totalSize: 100000,
      };

      const mockResolver = {
        resolveDependencies: vi.fn().mockResolvedValue(mockPipResult),
      };
      vi.mocked(getPipResolver).mockReturnValue(mockResolver as any);

      const onProgress = vi.fn();
      const packages: DownloadPackage[] = [
        { id: 'test-1', type: 'pip', name: 'flask', version: '2.0.0' },
      ];

      await resolveAllDependencies(packages, { onProgress });

      expect(onProgress).toHaveBeenCalledTimes(2);
      expect(onProgress).toHaveBeenNthCalledWith(1, {
        current: 1,
        total: 1,
        packageName: 'flask',
        packageType: 'pip',
        status: 'start',
      });
      expect(onProgress).toHaveBeenNthCalledWith(2, {
        current: 1,
        total: 1,
        packageName: 'flask',
        packageType: 'pip',
        status: 'success',
        dependencyCount: 1,
      });
    });

    it('진행 상황 콜백 호출 (실패)', async () => {
      const mockResolver = {
        resolveDependencies: vi.fn().mockRejectedValue(new Error('API error')),
      };
      vi.mocked(getPipResolver).mockReturnValue(mockResolver as any);

      const onProgress = vi.fn();
      const packages: DownloadPackage[] = [
        { id: 'test-1', type: 'pip', name: 'broken', version: '1.0.0' },
      ];

      await resolveAllDependencies(packages, { onProgress });

      expect(onProgress).toHaveBeenCalledTimes(2);
      expect(onProgress).toHaveBeenNthCalledWith(2, {
        current: 1,
        total: 1,
        packageName: 'broken',
        packageType: 'pip',
        status: 'error',
        error: 'API error',
      });
    });

    it('여러 패키지 동시 해결', async () => {
      const mockPipResult = {
        root: { package: { type: 'pip', name: 'requests', version: '2.28.0' }, dependencies: [] },
        flatList: [{ type: 'pip', name: 'requests', version: '2.28.0' }],
        conflicts: [],
        totalSize: 100000,
      };

      const mockMavenResult = {
        root: { package: { type: 'maven', name: 'junit', version: '4.13' }, dependencies: [] },
        flatList: [{ type: 'maven', name: 'junit', version: '4.13' }],
        conflicts: [],
        totalSize: 200000,
      };

      vi.mocked(getPipResolver).mockReturnValue({
        resolveDependencies: vi.fn().mockResolvedValue(mockPipResult),
      } as any);

      vi.mocked(getMavenResolver).mockReturnValue({
        resolveDependencies: vi.fn().mockResolvedValue(mockMavenResult),
      } as any);

      const packages: DownloadPackage[] = [
        { id: 'test-1', type: 'pip', name: 'requests', version: '2.28.0' },
        { id: 'test-2', type: 'maven', name: 'junit', version: '4.13' },
      ];

      const result = await resolveAllDependencies(packages);

      expect(result.originalPackages).toHaveLength(2);
      expect(result.allPackages).toHaveLength(2);
      expect(result.dependencyTrees).toHaveLength(2);
    });

    it('중복 의존성은 한 번만 포함', async () => {
      const mockPipResult = {
        root: { package: { type: 'pip', name: 'flask', version: '2.0.0' }, dependencies: [] },
        flatList: [
          { type: 'pip', name: 'flask', version: '2.0.0' },
          { type: 'pip', name: 'werkzeug', version: '2.0.0' },
        ],
        conflicts: [],
        totalSize: 200000,
      };

      const mockPipResult2 = {
        root: { package: { type: 'pip', name: 'django', version: '4.0.0' }, dependencies: [] },
        flatList: [
          { type: 'pip', name: 'django', version: '4.0.0' },
          { type: 'pip', name: 'werkzeug', version: '2.0.0' }, // 중복
        ],
        conflicts: [],
        totalSize: 300000,
      };

      const resolveMock = vi.fn()
        .mockResolvedValueOnce(mockPipResult)
        .mockResolvedValueOnce(mockPipResult2);

      vi.mocked(getPipResolver).mockReturnValue({
        resolveDependencies: resolveMock,
      } as any);

      const packages: DownloadPackage[] = [
        { id: 'test-1', type: 'pip', name: 'flask', version: '2.0.0' },
        { id: 'test-2', type: 'pip', name: 'django', version: '4.0.0' },
      ];

      const result = await resolveAllDependencies(packages);

      // flask, django, werkzeug (중복 제거됨)
      expect(result.allPackages).toHaveLength(3);
      const werkzeugCount = result.allPackages.filter(p => p.name === 'werkzeug').length;
      expect(werkzeugCount).toBe(1);
    });

    it('includeOptional 옵션 전달', async () => {
      const mockPipResult = {
        root: { package: { type: 'pip', name: 'test', version: '1.0.0' }, dependencies: [] },
        flatList: [{ type: 'pip', name: 'test', version: '1.0.0' }],
        conflicts: [],
        totalSize: 10000,
      };

      const mockResolver = {
        resolveDependencies: vi.fn().mockResolvedValue(mockPipResult),
      };
      vi.mocked(getPipResolver).mockReturnValue(mockResolver as any);

      const packages: DownloadPackage[] = [
        { id: 'test-1', type: 'pip', name: 'test', version: '1.0.0' },
      ];

      await resolveAllDependencies(packages, { includeOptional: true });

      expect(mockResolver.resolveDependencies).toHaveBeenCalledWith(
        'test',
        '1.0.0',
        expect.objectContaining({
          includeOptionalDependencies: true,
        })
      );
    });

    it('targetOS windows 매핑', async () => {
      const mockPipResult = {
        root: { package: { type: 'pip', name: 'test', version: '1.0.0' }, dependencies: [] },
        flatList: [{ type: 'pip', name: 'test', version: '1.0.0' }],
        conflicts: [],
        totalSize: 10000,
      };

      const mockResolver = {
        resolveDependencies: vi.fn().mockResolvedValue(mockPipResult),
      };
      vi.mocked(getPipResolver).mockReturnValue(mockResolver as any);

      await resolveAllDependencies(
        [{ id: 'test-1', type: 'pip', name: 'test', version: '1.0.0' }],
        { targetOS: 'windows' }
      );

      expect(mockResolver.resolveDependencies).toHaveBeenCalledWith(
        'test',
        '1.0.0',
        expect.objectContaining({
          targetPlatform: expect.objectContaining({ system: 'Windows' }),
        })
      );
    });

    it('알 수 없는 패키지 타입은 null 리졸버 반환', async () => {
      const packages: DownloadPackage[] = [
        { id: 'test-1', type: 'unknown' as any, name: 'test', version: '1.0.0' },
      ];

      const result = await resolveAllDependencies(packages);

      expect(result.allPackages).toHaveLength(1);
      expect(result.dependencyTrees).toHaveLength(0);
    });
  });

  describe('resolveSinglePackageDependencies', () => {
    it('단일 패키지 의존성 해결', async () => {
      const mockPipResult = {
        root: { package: { type: 'pip', name: 'flask', version: '2.0.0' }, dependencies: [] },
        flatList: [
          { type: 'pip', name: 'flask', version: '2.0.0' },
          { type: 'pip', name: 'jinja2', version: '3.0.0' },
        ],
        conflicts: [],
        totalSize: 150000,
      };

      vi.mocked(getPipResolver).mockReturnValue({
        resolveDependencies: vi.fn().mockResolvedValue(mockPipResult),
      } as any);

      const pkg: DownloadPackage = {
        id: 'test-1',
        type: 'pip',
        name: 'flask',
        version: '2.0.0',
      };

      const result = await resolveSinglePackageDependencies(pkg);

      expect(result.originalPackages).toHaveLength(1);
      expect(result.allPackages).toHaveLength(2);
    });

    it('옵션 전달', async () => {
      const mockPipResult = {
        root: { package: { type: 'pip', name: 'test', version: '1.0.0' }, dependencies: [] },
        flatList: [{ type: 'pip', name: 'test', version: '1.0.0' }],
        conflicts: [],
        totalSize: 10000,
      };

      const mockResolver = {
        resolveDependencies: vi.fn().mockResolvedValue(mockPipResult),
      };
      vi.mocked(getPipResolver).mockReturnValue(mockResolver as any);

      const pkg: DownloadPackage = {
        id: 'test-1',
        type: 'pip',
        name: 'test',
        version: '1.0.0',
      };

      await resolveSinglePackageDependencies(pkg, {
        maxDepth: 10,
        includeOptional: true,
      });

      expect(mockResolver.resolveDependencies).toHaveBeenCalledWith(
        'test',
        '1.0.0',
        expect.objectContaining({
          maxDepth: 10,
          includeOptionalDependencies: true,
        })
      );
    });
  });
});
