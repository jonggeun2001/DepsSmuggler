import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApkMetadataParser } from '../downloaders/apk';
import { AptMetadataParser } from '../downloaders/apt';
import { YumMetadataParser } from '../downloaders/yum';
import { ApkDependencyResolver } from './apk-resolver';
import { AptDependencyResolver } from './apt-resolver';
import { YumDependencyResolver } from './yum-resolver';
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

  it('YUM resolver는 primary 메타데이터가 없는 저장소를 건너뛰고 라이브러리 provides를 찾는다', async () => {
    const parseRepomd = vi
      .spyOn(YumMetadataParser.prototype, 'parseRepomd')
      .mockResolvedValueOnce({
        revision: '1',
        primary: null,
        filelists: null,
        other: null,
      })
      .mockResolvedValueOnce({
        revision: '2',
        primary: {
          location: 'repodata/primary.xml.gz',
          checksum: { type: 'sha256', value: 'deadbeef' },
        },
        filelists: null,
        other: null,
      });
    const parsePrimary = vi.spyOn(YumMetadataParser.prototype, 'parsePrimary').mockResolvedValue([
      createPackage('openssl-libs', '3.0.0', 'x86_64', ['libcrypto.so.3()(64bit)']),
    ]);
    const resolver = new YumDependencyResolver({
      ...createOptions(repo),
      repositories: [
        { ...repo, id: 'empty', name: 'Empty Repo' },
        { ...repo, id: 'full', name: 'Full Repo' },
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
    const byLibrary = await testResolver.findPackagesForDependency({
      name: 'libcrypto.so.3()(64bit)',
    });

    expect(parseRepomd).toHaveBeenCalledTimes(2);
    expect(parsePrimary).toHaveBeenCalledTimes(1);
    expect(byLibrary).toHaveLength(1);
    expect(byLibrary[0].name).toBe('openssl-libs');
  });
});
