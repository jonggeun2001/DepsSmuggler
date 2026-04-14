import { describe, expect, it } from 'vitest';
import { BaseOSDependencyResolver, type DependencyResolverOptions } from './base-resolver';
import type { OSPackageInfo, PackageDependency, Repository } from './types';

class TestResolver extends BaseOSDependencyResolver {
  apiResponses = new Map<string, PackageDependency[] | null>();
  metadataResponses = new Map<string, PackageDependency[]>();
  candidates = new Map<string, OSPackageInfo[]>();
  metadataLoaded = false;

  protected override async loadMetadata(): Promise<void> {
    this.metadataLoaded = true;
  }

  protected override async fetchDependenciesFromAPI(
    pkg: OSPackageInfo
  ): Promise<PackageDependency[] | null> {
    return this.apiResponses.get(pkg.name) ?? null;
  }

  protected override async fetchDependenciesFromMetadata(pkg: OSPackageInfo): Promise<PackageDependency[]> {
    return this.metadataResponses.get(pkg.name) ?? pkg.dependencies;
  }

  protected override async findPackagesForDependency(dep: PackageDependency): Promise<OSPackageInfo[]> {
    return this.candidates.get(dep.name) ?? [];
  }

  async exposeFetchDependencies(pkg: OSPackageInfo): Promise<PackageDependency[]> {
    return this.fetchDependencies(pkg);
  }

  exposeCompare(pkgVersion: string, operator: PackageDependency['operator'], requiredVersion: string): boolean {
    return this.compareVersionWithOperator(pkgVersion, operator!, requiredVersion);
  }
}

describe('BaseOSDependencyResolver', () => {
  const repo: Repository = {
    id: 'baseos',
    name: 'BaseOS',
    baseUrl: 'https://example.test/repo',
    enabled: true,
    gpgCheck: false,
    isOfficial: true,
  };

  const createPackage = (
    name: string,
    version: string,
    architecture: OSPackageInfo['architecture'] = 'x86_64',
    dependencies: PackageDependency[] = []
  ): OSPackageInfo => ({
    name,
    version,
    architecture,
    size: 1,
    checksum: { type: 'sha256', value: '' },
    location: `${name}.pkg`,
    repository: repo,
    dependencies,
  });

  const createResolver = (overrides: Partial<DependencyResolverOptions> = {}): TestResolver =>
    new TestResolver({
      distribution: {
        id: 'rocky-9',
        name: 'Rocky Linux 9',
        version: '9',
        packageManager: 'yum',
        architectures: ['x86_64'],
        defaultRepos: [],
        extendedRepos: [],
      },
      repositories: [repo],
      architecture: 'x86_64',
      includeOptional: false,
      includeRecommends: false,
      ...overrides,
    });

  it('API가 null을 반환하면 메타데이터 의존성으로 폴백한다', async () => {
    const resolver = createResolver();
    const pkg = createPackage('bash', '5.1', 'x86_64', [{ name: 'glibc' }]);
    resolver.apiResponses.set('bash', null);
    resolver.metadataResponses.set('bash', [{ name: 'glibc' }]);

    await expect(resolver.exposeFetchDependencies(pkg)).resolves.toEqual([{ name: 'glibc' }]);
  });

  it('epoch와 비교 연산자를 포함한 버전 비교를 처리한다', () => {
    const resolver = createResolver();

    expect(resolver.exposeCompare('1:1.0.0', '>', '99.0.0')).toBe(true);
    expect(resolver.exposeCompare('2.0.0', '>=', '2.0.0')).toBe(true);
    expect(resolver.exposeCompare('1.9.9', '<', '2.0.0')).toBe(true);
    expect(resolver.exposeCompare('1.0.0', '=', '1.0.1')).toBe(false);
  });

  it('충돌, 누락, 선택 의존성 skip을 함께 처리하고 경고를 생성한다', async () => {
    const resolver = createResolver();
    const root = createPackage('root', '1.0.0', 'x86_64', [
      { name: 'conflict-lib' },
      { name: 'missing-lib', version: '2.0.0', operator: '>=' },
      { name: 'arm-only' },
      { name: 'optional-lib', isOptional: true },
    ]);
    const conflictV1 = createPackage('conflict-lib', '1.0.0');
    const conflictV2 = createPackage('conflict-lib', '2.0.0');
    const armOnly = createPackage('arm-only', '1.0.0', 'aarch64');

    resolver.candidates.set('conflict-lib', [conflictV1, conflictV2]);
    resolver.candidates.set('missing-lib', [createPackage('missing-lib', '1.0.0')]);
    resolver.candidates.set('arm-only', [armOnly]);
    resolver.candidates.set('optional-lib', [createPackage('optional-lib', '1.0.0')]);

    const result = await resolver.resolveDependencies([root]);

    expect(result.packages.map((pkg) => pkg.name)).toEqual(['conflict-lib', 'root']);
    expect(result.unresolved).toEqual([
      expect.objectContaining({ name: 'missing-lib' }),
      expect.objectContaining({ name: 'arm-only' }),
    ]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        package: 'conflict-lib',
        versions: [
          expect.objectContaining({ version: '1.0.0' }),
          expect.objectContaining({ version: '2.0.0' }),
        ],
      }),
    ]);
    expect(result.warnings).toEqual([
      '2 dependencies could not be resolved',
      '1 version conflicts detected (all versions will be downloaded)',
    ]);
    expect(result.packages.find((pkg) => pkg.name === 'optional-lib')).toBeUndefined();
  });

  it('취소 신호가 있으면 메타데이터 로드 전에 중단한다', async () => {
    const controller = new AbortController();
    controller.abort();
    const resolver = createResolver({ abortSignal: controller.signal });

    await expect(resolver.resolveDependencies([createPackage('root', '1.0.0')])).rejects.toMatchObject({
      name: 'AbortError',
      message: 'Dependency resolution cancelled',
    });
    expect(resolver.metadataLoaded).toBe(false);
  });
});
