/**
 * OS 패키지 다운로더 통합 테스트
 *
 * 공개된 메타데이터 파서, 의존성 해결기, 다운로더 API를 실제 저장소에
 * 연결해 검증합니다. 네트워크 통합 테스트는 INTEGRATION_TEST=true일 때만
 * 실행됩니다.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApkMetadataParser, getApkDownloader } from './apk';
import { AptMetadataParser, getAptDownloader } from './apt';
import { OsPackageCache } from './os-shared/cache-manager';
import { getYumDownloader, YumMetadataParser } from './yum';
import { ApkDependencyResolver } from '../resolver/apk-resolver';
import { AptDependencyResolver } from '../resolver/apt-resolver';
import { YumDependencyResolver } from '../resolver/yum-resolver';
import type { BaseDownloaderOptions } from './os-shared/base-downloader';
import type {
  OSArchitecture,
  OSPackageInfo,
  OSDistribution,
  Repository,
} from './os-shared/types';

const INTEGRATION_TEST = process.env.INTEGRATION_TEST === 'true';
const describeIntegration = INTEGRATION_TEST ? describe : describe.skip;

type OsFixture = {
  distribution: OSDistribution;
  repository: Repository;
  architecture: OSArchitecture;
};

const rockyLinux9: OsFixture = {
  distribution: {
    id: 'rocky-9',
    name: 'Rocky Linux 9',
    version: '9',
    packageManager: 'yum',
    architectures: ['x86_64'],
    defaultRepos: [],
    extendedRepos: [],
  },
  repository: {
    id: 'baseos',
    name: 'Rocky Linux 9 - BaseOS',
    baseUrl: 'https://download.rockylinux.org/pub/rocky/9/BaseOS/x86_64/os/',
    enabled: true,
    gpgCheck: false,
    isOfficial: true,
  },
  architecture: 'x86_64',
};

const ubuntu2204: OsFixture = {
  distribution: {
    id: 'ubuntu-22.04',
    name: 'Ubuntu 22.04 LTS',
    version: '22.04',
    codename: 'jammy',
    packageManager: 'apt',
    architectures: ['amd64'],
    defaultRepos: [],
    extendedRepos: [],
  },
  repository: {
    id: 'main',
    name: 'Ubuntu 22.04 Main',
    baseUrl: 'http://archive.ubuntu.com/ubuntu/dists/jammy/main',
    enabled: true,
    gpgCheck: false,
    isOfficial: true,
  },
  architecture: 'amd64',
};

const alpine319: OsFixture = {
  distribution: {
    id: 'alpine-3.19',
    name: 'Alpine Linux 3.19',
    version: '3.19',
    packageManager: 'apk',
    architectures: ['x86_64'],
    defaultRepos: [],
    extendedRepos: [],
  },
  repository: {
    id: 'main',
    name: 'Alpine 3.19 Main',
    baseUrl: 'https://dl-cdn.alpinelinux.org/alpine/v3.19/main',
    enabled: true,
    gpgCheck: false,
    isOfficial: true,
  },
  architecture: 'x86_64',
};

function downloaderOptions(
  fixture: OsFixture,
  outputDir: string,
  onProgress?: BaseDownloaderOptions['onProgress']
): BaseDownloaderOptions {
  return {
    outputDir,
    distribution: fixture.distribution,
    architecture: fixture.architecture,
    repositories: [fixture.repository],
    concurrency: 1,
    onProgress,
  };
}

function packageFromResult(result: OSPackageInfo[] | Array<{ latest: OSPackageInfo }>): OSPackageInfo {
  const first = result[0];
  if (!first) throw new Error('Expected at least one package');
  return 'latest' in first ? first.latest : first;
}

describeIntegration('OS 패키지 다운로더 통합 테스트', () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-integration-test-'));
  });

  afterAll(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('메타데이터 검색', () => {
    it('YUM exact/partial 검색은 패키지 이름을 반환한다', async () => {
      const parser = new YumMetadataParser(rockyLinux9.repository, rockyLinux9.architecture);
      const exact = await parser.searchPackages('which', 'exact');
      const partial = await parser.searchPackages('bash', 'partial');

      expect(exact.some((pkg) => pkg.name === 'which')).toBe(true);
      expect(partial.length).toBeGreaterThan(0);
      expect(partial.every((pkg) => pkg.name.includes('bash'))).toBe(true);
    }, 180000);

    it('YUM 없는 패키지 검색은 빈 배열을 반환한다', async () => {
      const parser = new YumMetadataParser(rockyLinux9.repository, rockyLinux9.architecture);
      await expect(parser.searchPackages('nonexistent-package-xyz-12345', 'exact')).resolves.toEqual([]);
    }, 180000);

    it('APT exact/partial 검색은 그룹화된 최신 패키지를 반환한다', async () => {
      const parser = new AptMetadataParser(ubuntu2204.repository, 'main', ubuntu2204.architecture);
      const exact = await parser.searchPackages('bash', 'exact');
      const partial = await parser.searchPackages('lib', 'partial');

      expect(exact.some((result) => result.name === 'bash' && result.latest.name === 'bash')).toBe(true);
      expect(partial.length).toBeGreaterThan(0);
      expect(partial.every((result) => result.name.includes('lib'))).toBe(true);
    }, 180000);

    it('APK exact/wildcard 검색은 그룹화된 최신 패키지를 반환한다', async () => {
      const parser = new ApkMetadataParser(alpine319.repository, alpine319.architecture);
      const exact = await parser.searchPackages('busybox', 'exact');
      const wildcard = await parser.searchPackages('curl*', 'wildcard');

      expect(exact.some((result) => result.name === 'busybox')).toBe(true);
      expect(wildcard.length).toBeGreaterThan(0);
      expect(wildcard.every((result) => result.name.startsWith('curl'))).toBe(true);
    }, 180000);
  });

  describe('의존성 해결', () => {
    it('YUM resolver는 검색된 패키지의 closure를 반환한다', async () => {
      const parser = new YumMetadataParser(rockyLinux9.repository, rockyLinux9.architecture);
      const pkg = packageFromResult(await parser.searchPackages('which', 'exact'));
      const resolver = new YumDependencyResolver({
        distribution: rockyLinux9.distribution,
        repositories: [rockyLinux9.repository],
        architecture: rockyLinux9.architecture,
        includeOptional: false,
        includeRecommends: false,
      });

      const result = await resolver.resolveDependencies([pkg]);
      expect(result.packages.length).toBeGreaterThanOrEqual(1);
      expect(result.packages.map((item) => item.name)).toContain(pkg.name);
    }, 300000);

    it('APT resolver는 검색된 패키지의 closure를 반환한다', async () => {
      const parser = new AptMetadataParser(ubuntu2204.repository, 'main', ubuntu2204.architecture);
      const pkg = packageFromResult(await parser.searchPackages('hostname', 'exact'));
      const resolver = new AptDependencyResolver({
        distribution: ubuntu2204.distribution,
        repositories: [ubuntu2204.repository],
        architecture: ubuntu2204.architecture,
        includeOptional: false,
        includeRecommends: false,
      });

      const result = await resolver.resolveDependencies([pkg]);
      expect(result.packages.length).toBeGreaterThanOrEqual(1);
      expect(result.packages.map((item) => item.name)).toContain(pkg.name);
    }, 300000);

    it('APK resolver는 검색된 패키지의 closure를 반환한다', async () => {
      const parser = new ApkMetadataParser(alpine319.repository, alpine319.architecture);
      const pkg = packageFromResult(await parser.searchPackages('tzdata', 'exact'));
      const resolver = new ApkDependencyResolver({
        distribution: alpine319.distribution,
        repositories: [alpine319.repository],
        architecture: alpine319.architecture,
        includeOptional: false,
        includeRecommends: false,
      });

      const result = await resolver.resolveDependencies([pkg]);
      expect(result.packages.length).toBeGreaterThanOrEqual(1);
      expect(result.packages.map((item) => item.name)).toContain(pkg.name);
    }, 300000);
  });

  describe('패키지 다운로드', () => {
    it('APK downloadPackage는 실제 파일을 저장한다', async () => {
      const outputDir = path.join(tempDir, 'apk-download');
      const parser = new ApkMetadataParser(alpine319.repository, alpine319.architecture);
      const pkg = packageFromResult(await parser.searchPackages('tzdata', 'exact'));
      const result = await getApkDownloader(downloaderOptions(alpine319, outputDir)).downloadPackage(pkg);

      expect(result.success).toBe(true);
      const filePath = result.filePath;
      expect(filePath).toBeDefined();
      if (!filePath) throw new Error('Expected an APK file path');
      expect(fs.statSync(filePath).size).toBeGreaterThan(0);
    }, 300000);

    it('APT downloadPackages는 성공 파일을 반환한다', async () => {
      const outputDir = path.join(tempDir, 'apt-download');
      const parser = new AptMetadataParser(ubuntu2204.repository, 'main', ubuntu2204.architecture);
      const pkg = packageFromResult(await parser.searchPackages('hostname', 'exact'));
      const result = await getAptDownloader(downloaderOptions(ubuntu2204, outputDir)).downloadPackages([pkg]);

      expect(result.success.map((item) => item.name)).toContain(pkg.name);
      expect(result.downloadedFiles.size).toBe(1);
    }, 300000);

    it('YUM downloader는 진행 콜백을 전달한다', async () => {
      const outputDir = path.join(tempDir, 'yum-download');
      const parser = new YumMetadataParser(rockyLinux9.repository, rockyLinux9.architecture);
      const pkg = packageFromResult(await parser.searchPackages('which', 'exact'));
      const progress: Parameters<NonNullable<BaseDownloaderOptions['onProgress']>>[0][] = [];
      const downloader = getYumDownloader(downloaderOptions(rockyLinux9, outputDir, (event) => progress.push(event)));
      const result = await downloader.downloadPackage(pkg);

      expect(result.success).toBe(true);
      expect(progress.length).toBeGreaterThan(0);
      expect(progress.at(-1)).toMatchObject({ currentPackage: pkg.name, phase: 'downloading' });
    }, 300000);
  });

  describe('캐시 공개 API', () => {
    it('캐시 통계를 조회하고 초기화할 수 있다', async () => {
      const cache = new OsPackageCache({ type: 'session', maxSize: 1024 * 1024 });
      await cache.set('fixture', { packageCount: 1 });
      expect(cache.getStats()).toMatchObject({ entryCount: 1 });
      await cache.invalidate();
      expect(cache.getStats()).toMatchObject({ entryCount: 0 });
    });

    it('캐시 설정을 업데이트할 수 있다', () => {
      const cache = new OsPackageCache({ type: 'session' });
      cache.updateConfig({ maxSize: 100 * 1024 * 1024 });
      expect(cache.getStats()).toMatchObject({ entryCount: 0 });
    });
  });
});
