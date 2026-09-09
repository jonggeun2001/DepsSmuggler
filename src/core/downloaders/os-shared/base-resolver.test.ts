import { describe, expect, it, vi } from 'vitest';
import { BaseOSDependencyResolver, type DependencyResolverOptions } from './base-resolver';
import logger from '../../../utils/logger';
import type { OSPackageInfo, PackageDependency, Repository } from './types';

class TestResolver extends BaseOSDependencyResolver {
  apiResponses = new Map<string, PackageDependency[] | null>();
  metadataResponses = new Map<string, PackageDependency[]>();
  dependenciesByKey = new Map<string, PackageDependency[]>();
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
    return this.dependenciesByKey.get(`${pkg.name}@${pkg.version}`)
      ?? this.metadataResponses.get(pkg.name)
      ?? pkg.dependencies;
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

    expect(result.packages.map((pkg) => pkg.name)).toEqual(['conflict-lib', 'conflict-lib', 'root']);
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

  it('비최선 대안의 nested conflict 자손과 cycle도 모두 닫는다', async () => {
    const resolver = createResolver();
    const root = createPackage('root', '1.0.0', 'x86_64', [{ name: 'libfoo' }]);
    const libfooV1 = createPackage('libfoo', '1.0.0');
    const libfooV2 = createPackage('libfoo', '2.0.0');
    const libbaseV1 = createPackage('libbase', '1.0.0');
    const libbaseV2 = createPackage('libbase', '2.0.0');
    const leafV1 = createPackage('leaf', '1.0.0');
    const leafV2 = createPackage('leaf', '2.0.0');
    const bestOnly = createPackage('best-only', '1.0.0');

    resolver.dependenciesByKey.set('libfoo@1.0.0', [{ name: 'libbase' }]);
    resolver.dependenciesByKey.set('libfoo@2.0.0', [{ name: 'best-only' }]);
    resolver.dependenciesByKey.set('libbase@1.0.0', [{ name: 'leaf' }]);
    resolver.dependenciesByKey.set('libbase@2.0.0', [{ name: 'leaf' }]);
    resolver.dependenciesByKey.set('leaf@2.0.0', [{ name: 'libbase' }]);
    resolver.candidates.set('libfoo', [libfooV1, libfooV2]);
    resolver.candidates.set('libbase', [libbaseV1, libbaseV2]);
    resolver.candidates.set('leaf', [leafV1, leafV2]);
    resolver.candidates.set('best-only', [bestOnly]);

    const result = await resolver.resolveDependencies([root]);
    const keys = new Set(result.packages.map((pkg) => `${pkg.name}@${pkg.version}`));

    expect(keys).toEqual(new Set([
      'root@1.0.0',
      'libfoo@1.0.0',
      'libfoo@2.0.0',
      'libbase@1.0.0',
      'libbase@2.0.0',
      'leaf@1.0.0',
      'leaf@2.0.0',
      'best-only@1.0.0',
    ]));
    expect(result.conflicts.map((conflict) => conflict.package)).toEqual(
      expect.arrayContaining(['libfoo', 'libbase']),
    );
  });

  it('중복 edge와 cycle은 각 package key를 한 번만 처리한다', async () => {
    const resolver = createResolver();
    const root = createPackage('root', '1.0.0', 'x86_64', [
      { name: 'loop-a' },
      { name: 'loop-a' },
    ]);
    const loopA = createPackage('loop-a', '1.0.0');
    const loopB = createPackage('loop-b', '1.0.0');
    resolver.dependenciesByKey.set('loop-a@1.0.0', [
      { name: 'loop-b' },
      { name: 'loop-b' },
    ]);
    resolver.dependenciesByKey.set('loop-b@1.0.0', [{ name: 'loop-a' }]);
    resolver.candidates.set('loop-a', [loopA]);
    resolver.candidates.set('loop-b', [loopB]);

    const result = await resolver.resolveDependencies([root]);
    const keys = result.packages.map((pkg) => `${pkg.name}@${pkg.version}`);

    expect(keys).toEqual(['root@1.0.0', 'loop-a@1.0.0', 'loop-b@1.0.0']);
    expect(new Set(keys).size).toBe(keys.length);
  });

  const createLinearChain = (resolver: TestResolver, length: number): OSPackageInfo => {
    const chain = Array.from({ length }, (_, index) => createPackage(`chain-${index}`, '1.0.0'));
    for (let index = 0; index < chain.length - 1; index++) {
      const current = chain[index];
      const next = chain[index + 1];
      resolver.dependenciesByKey.set(`${current.name}@${current.version}`, [{ name: next.name }]);
      resolver.candidates.set(next.name, [next]);
    }
    return chain[0];
  };

  const createDuplicateLinearChain = (resolver: TestResolver, length: number): OSPackageInfo => {
    const chain = Array.from({ length }, (_, index) => createPackage(`duplicate-chain-${index}`, '1.0.0'));
    for (let index = 0; index < chain.length - 1; index++) {
      const current = chain[index];
      const next = chain[index + 1];
      resolver.dependenciesByKey.set(`${current.name}@${current.version}`, [
        { name: next.name },
        { name: next.name },
      ]);
      resolver.candidates.set(next.name, [next]);
    }
    return chain[0];
  };

  it('정확히 10000개의 unique work는 경고 없이 완료한다', async () => {
    const resolver = createResolver();
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    try {
      const result = await resolver.resolveDependencies([createLinearChain(resolver, 10000)]);

      expect(result.packages).toHaveLength(10000);
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('최대 반복 횟수'));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('중복 enqueue는 unique work bound를 소모하지 않는다', async () => {
    const resolver = createResolver();
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    try {
      const result = await resolver.resolveDependencies([createDuplicateLinearChain(resolver, 6000)]);

      expect(result.packages).toHaveLength(6000);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('10000개를 넘어 남은 unique work가 있으면 부분 성공하지 않고 실패한다', async () => {
    const resolver = createResolver();

    await expect(
      resolver.resolveDependencies([createLinearChain(resolver, 10001)]),
    ).rejects.toThrow(/10000/);
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
