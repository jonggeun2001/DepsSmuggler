import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApkDependencyResolver } from './apk-resolver';
import { AptDependencyResolver } from './apt-resolver';
import { YumDependencyResolver } from './yum-resolver';
import { ApkMetadataParser } from '../shared/apk-metadata-parser';
import { AptMetadataParser } from '../shared/apt-metadata-parser';
import { YumMetadataParser } from '../shared/yum-metadata-parser';
import type { OSPackageInfo, Repository } from '../downloaders/os-shared/types';

type ResolverTestAccess = {
  loadMetadata(): Promise<void>;
  findPackagesForDependency(dependency: { name: string }): Promise<OSPackageInfo[]>;
};

function accessResolverForTest<T>(resolver: T): T & ResolverTestAccess {
  return resolver as T & ResolverTestAccess;
}

describe('OS dependency resolvers', () => {
  const repo: Repository = {
    id: 'repo',
    name: 'Main Repo',
    baseUrl: 'https://example.test/repo',
    enabled: true,
    gpgCheck: false,
    isOfficial: true,
  };

  const createPackage = (
    name: string,
    version: string,
    architecture: OSPackageInfo['architecture'] = 'x86_64',
    provides?: string[]
  ): OSPackageInfo => ({
    name,
    version,
    architecture,
    size: 1,
    checksum: { type: 'sha256', value: '' },
    location: `${name}.pkg`,
    repository: repo,
    dependencies: [],
    provides,
  });

  const createOptions = (repository: Repository) => ({
    distribution: {
      id: 'test',
      name: 'Test',
      version: '1',
      packageManager: 'yum' as const,
      architectures: ['x86_64'],
      defaultRepos: [],
      extendedRepos: [],
    },
    repositories: [repository],
    architecture: 'x86_64' as const,
    includeOptional: false,
    includeRecommends: false,
    cacheManager: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    },
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['APT', AptDependencyResolver], ['APK', ApkDependencyResolver], ['YUM', YumDependencyResolver],
  ] as const)(
    '%s 후보 병합은 원본 순서·중복을 유지하고 키를 선형 횟수로 계산한다',
    async (_name, Resolver) => {
      const resolver = accessResolverForTest(new Resolver(createOptions(repo)));
      const internals = resolver as unknown as {
        metadataCache: { packages: Map<string, OSPackageInfo[]> };
        providesMap: Map<string, OSPackageInfo[]>;
        getPackageKey(pkg: OSPackageInfo): string;
      };
      const byName = createPackage('virtual', '1');
      const providers = Array.from({ length: 100 }, (_, index) => createPackage(`provider-${index}`, '1'));
      internals.metadataCache.packages.set('virtual', [byName, byName]);
      internals.providesMap.set('virtual', [byName, ...providers, ...providers]);
      const keySpy = vi.spyOn(internals, 'getPackageKey');

      const result = await resolver.findPackagesForDependency({ name: 'virtual' });

      expect(result).toEqual([byName, byName, ...providers]);
      expect(result[2]).toBe(providers[0]);
      expect(keySpy.mock.calls.length).toBeLessThanOrEqual(203);
    }
  );

  it('APT resolver는 컴포넌트 URL, provides, 아키텍처 접미사 검색을 모두 처리한다', async () => {
    const aptRepo = {
      ...repo,
      id: 'ubuntu-main',
      baseUrl: 'https://archive.ubuntu.test/ubuntu/dists/jammy/main',
    };
    vi.spyOn(AptMetadataParser.prototype, 'parsePackages').mockResolvedValue([
      createPackage('libc6', '2.35', 'amd64'),
      createPackage('postfix', '3.7.0', 'amd64', ['mail-transport-agent']),
      createPackage('libc6', '2.35', 'i386'),
    ]);
    const resolver = new AptDependencyResolver({
      ...createOptions(aptRepo),
      distribution: {
        id: 'ubuntu-22.04',
        name: 'Ubuntu 22.04',
        version: '22.04',
        packageManager: 'apt',
        architectures: ['amd64'],
        defaultRepos: [],
        extendedRepos: [],
      },
      architecture: 'amd64',
    });
    const testResolver = accessResolverForTest(resolver);

    await testResolver.loadMetadata();
    const byProvides = await testResolver.findPackagesForDependency({ name: 'mail-transport-agent' });
    const byArchSuffix = await testResolver.findPackagesForDependency({ name: 'libc6:amd64' });

    expect(byProvides).toHaveLength(1);
    expect(byProvides[0].name).toBe('postfix');
    expect(byArchSuffix).toHaveLength(1);
    expect(byArchSuffix[0].architecture).toBe('amd64');
  });

  it('APK resolver는 provides 기반 so/cmd 의존성을 해석한다', async () => {
    vi.spyOn(ApkMetadataParser.prototype, 'parseIndex').mockResolvedValue([
      createPackage('busybox', '1.36.1-r0', 'x86_64', ['cmd:sh', 'so:libcrypto.so.3=3.0.0']),
      createPackage('busybox', '1.36.1-r0', 'x86'),
    ]);
    const resolver = new ApkDependencyResolver({
      ...createOptions(repo),
      distribution: {
        id: 'alpine-3.21',
        name: 'Alpine 3.21',
        version: '3.21',
        packageManager: 'apk',
        architectures: ['x86_64'],
        defaultRepos: [],
        extendedRepos: [],
      },
    });
    const testResolver = accessResolverForTest(resolver);

    await testResolver.loadMetadata();
    const bySo = await testResolver.findPackagesForDependency({ name: 'so:libcrypto.so.3' });
    const byCmd = await testResolver.findPackagesForDependency({ name: 'cmd:sh' });

    expect(bySo).toHaveLength(1);
    expect(byCmd).toHaveLength(1);
    expect(byCmd[0].architecture).toBe('x86_64');
  });

  it('YUM resolver는 primary 메타데이터가 없으면 명시적으로 실패한다', async () => {
    const parseRepomd = vi.spyOn(YumMetadataParser.prototype, 'parseRepomd').mockResolvedValue({
      revision: '1',
      primary: null,
      filelists: null,
      other: null,
    });
    const parsePrimary = vi.spyOn(YumMetadataParser.prototype, 'parsePrimary');
    const resolver = new YumDependencyResolver({
      ...createOptions(repo),
      repositories: [{ ...repo, id: 'empty', name: 'Empty Repo' }],
      distribution: {
        id: 'rocky-9',
        name: 'Rocky Linux 9',
        version: '9',
        packageManager: 'yum',
        architectures: ['x86_64'],
        defaultRepos: [],
        extendedRepos: [],
      },
    });
    const testResolver = accessResolverForTest(resolver);

    await expect(testResolver.loadMetadata()).rejects.toThrow(/primary.*Empty Repo|primary metadata/i);

    expect(parseRepomd).toHaveBeenCalledOnce();
    expect(parsePrimary).not.toHaveBeenCalled();
  });

  it('YUM resolver는 저장소 AbortError identity를 보존한다', async () => {
    const abortError = new Error('metadata load cancelled');
    abortError.name = 'AbortError';
    vi.spyOn(YumMetadataParser.prototype, 'parseRepomd').mockRejectedValue(abortError);
    const resolver = new YumDependencyResolver({
      ...createOptions(repo),
      repositories: [{ ...repo, id: 'cancelled', name: 'Cancelled Repo' }],
      distribution: {
        id: 'rocky-9',
        name: 'Rocky Linux 9',
        version: '9',
        packageManager: 'yum',
        architectures: ['x86_64'],
        defaultRepos: [],
        extendedRepos: [],
      },
    });
    const testResolver = accessResolverForTest(resolver);

    await expect(testResolver.loadMetadata()).rejects.toBe(abortError);
  });

  it('YUM resolver는 모든 저장소 성공 후 provides를 게시한다', async () => {
    vi.spyOn(YumMetadataParser.prototype, 'parseRepomd').mockResolvedValue({
      revision: '2',
      primary: {
        location: 'repodata/primary.xml.gz',
        checksum: { type: 'sha256', value: 'deadbeef' },
      },
      filelists: null,
      other: null,
    });
    vi.spyOn(YumMetadataParser.prototype, 'parsePrimary').mockResolvedValue([
      createPackage('openssl-libs', '3.0.0', 'x86_64', ['libcrypto.so.3()(64bit)']),
    ]);
    const resolver = new YumDependencyResolver({
      ...createOptions(repo),
      distribution: {
        id: 'rocky-9',
        name: 'Rocky Linux 9',
        version: '9',
        packageManager: 'yum',
        architectures: ['x86_64'],
        defaultRepos: [],
        extendedRepos: [],
      },
    });
    const testResolver = accessResolverForTest(resolver);

    await testResolver.loadMetadata();
    const byLibrary = await testResolver.findPackagesForDependency({
      name: 'libcrypto.so.3()(64bit)',
    });

    expect(byLibrary).toHaveLength(1);
    expect(byLibrary[0].name).toBe('openssl-libs');
  });

  it('YUM resolver는 실패한 저장소의 부분 상태를 게시하지 않고 같은 resolver 재시도를 허용한다', async () => {
    const firstRepo = { ...repo, id: 'first', name: 'First Repo' };
    const secondRepo = { ...repo, id: 'second', name: 'Second Repo' };
    let repomdCalls = 0;
    let primaryCalls = 0;
    const parseRepomd = vi.spyOn(YumMetadataParser.prototype, 'parseRepomd').mockImplementation(async () => {
      repomdCalls += 1;
      if (repomdCalls === 2) {
        throw new Error('second repository malformed');
      }
      return {
        revision: String(repomdCalls),
        primary: {
          location: 'repodata/primary.xml.gz',
          checksum: { type: 'sha256', value: 'deadbeef' },
        },
        filelists: null,
        other: null,
      };
    });
    const parsePrimary = vi.spyOn(YumMetadataParser.prototype, 'parsePrimary').mockImplementation(async () => {
      primaryCalls += 1;
      return [
        createPackage(primaryCalls <= 2 ? 'first-repo-package' : 'second-repo-package', '1.0.0', 'x86_64', [
          primaryCalls <= 2 ? 'first-capability' : 'second-capability',
        ]),
      ];
    });
    const resolver = new YumDependencyResolver({
      ...createOptions(repo),
      repositories: [firstRepo, secondRepo],
      distribution: {
        id: 'rocky-9',
        name: 'Rocky Linux 9',
        version: '9',
        packageManager: 'yum',
        architectures: ['x86_64'],
        defaultRepos: [],
        extendedRepos: [],
      },
    });
    const testResolver = accessResolverForTest(resolver);
    const internals = resolver as unknown as {
      allPackages: OSPackageInfo[];
      providesMap: Map<string, OSPackageInfo[]>;
      metadataCache: { packages: Map<string, OSPackageInfo[]>; provides: Map<string, OSPackageInfo[]> };
    };

    await expect(testResolver.loadMetadata()).rejects.toThrow(/second repository malformed/);
    expect(internals.allPackages).toHaveLength(0);
    expect(internals.metadataCache.packages.size).toBe(0);
    expect(internals.metadataCache.provides.size).toBe(0);
    expect(internals.providesMap.size).toBe(0);

    await testResolver.loadMetadata();

    expect(parseRepomd).toHaveBeenCalledTimes(4);
    expect(parsePrimary).toHaveBeenCalledTimes(3);
    expect(internals.allPackages.map((pkg) => pkg.name)).toEqual([
      'first-repo-package',
      'second-repo-package',
    ]);
    expect(internals.metadataCache.packages.get('first-repo-package')).toHaveLength(1);
    expect(internals.metadataCache.packages.get('second-repo-package')).toHaveLength(1);
    expect(internals.providesMap.get('first-capability')).toHaveLength(1);
    expect(internals.providesMap.get('second-capability')).toHaveLength(1);
  });

  it('YUM resolver는 disabled 저장소를 로드하지 않는다', async () => {
    const parseRepomd = vi.spyOn(YumMetadataParser.prototype, 'parseRepomd').mockResolvedValue({
      revision: '1',
      primary: {
        location: 'repodata/primary.xml.gz',
        checksum: { type: 'sha256', value: 'deadbeef' },
      },
      filelists: null,
      other: null,
    });
    vi.spyOn(YumMetadataParser.prototype, 'parsePrimary').mockResolvedValue([
      createPackage('enabled-package', '1.0.0'),
    ]);
    const resolver = new YumDependencyResolver({
      ...createOptions(repo),
      repositories: [
        { ...repo, id: 'enabled', name: 'Enabled Repo', enabled: true },
        { ...repo, id: 'disabled', name: 'Disabled Repo', enabled: false },
      ],
      distribution: {
        id: 'rocky-9',
        name: 'Rocky Linux 9',
        version: '9',
        packageManager: 'yum',
        architectures: ['x86_64'],
        defaultRepos: [],
        extendedRepos: [],
      },
    });
    const testResolver = accessResolverForTest(resolver);

    await testResolver.loadMetadata();

    expect(parseRepomd).toHaveBeenCalledOnce();
    expect(await testResolver.findPackagesForDependency({ name: 'enabled-package' })).toHaveLength(1);
  });
});
