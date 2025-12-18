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
      };

      await resolveAllDependencies(packages, options);

      expect(mockResolver.resolveDependencies).toHaveBeenCalledWith(
        'numpy',
        '1.24.0',
        expect.objectContaining({
          maxDepth: 3,
          targetPlatform: { system: 'Linux' },
          pythonVersion: '3.11',
        })
      );
    });

    it('conda 패키지 의존성 해결', async () => {
      const mockCondaResult = {
        root: {
          package: { type: 'conda', name: 'pandas', version: '2.0.0' },
          dependencies: [],
        },
        flatList: [
          { type: 'conda', name: 'pandas', version: '2.0.0' },
          { type: 'conda', name: 'numpy', version: '1.24.0' },
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

    it('maven 패키지 의존성 해결', async () => {
      const mockMavenResult = {
        root: {
          package: { type: 'maven', name: 'spring-core', version: '5.3.0' },
          dependencies: [],
        },
        flatList: [
          { type: 'maven', name: 'spring-core', version: '5.3.0' },
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
        { id: 'test-1', type: 'maven', name: 'spring-core', version: '5.3.0' },
      ];

      const result = await resolveAllDependencies(packages);

      expect(getMavenResolver).toHaveBeenCalled();
      expect(result.allPackages).toHaveLength(2);
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
          targetPlatform: { system: 'Windows' },
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
