/**
 * OS 패키지 다운로더 통합 테스트
 *
 * 실제 리포지토리를 호출하여 통합 다운로더 기능을 테스트합니다.
 *
 * 실행 방법:
 *   INTEGRATION_TEST=true npm test -- os.integration.test.ts
 *
 * 테스트 케이스:
 *   - YUM/RPM (Rocky Linux 9)
 *   - APT/DEB (Ubuntu 22.04)
 *   - APK (Alpine 3.19)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { OSPackageDownloader } from './os/downloader';
import type { OSDistribution, OSArchitecture, Repository } from './os/types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const INTEGRATION_TEST = process.env.INTEGRATION_TEST === 'true';
const describeIntegration = INTEGRATION_TEST ? describe : describe.skip;

describeIntegration('OS 패키지 다운로더 통합 테스트', () => {
  let downloader: OSPackageDownloader;
  let tempDir: string;

  // 테스트용 배포판 설정
  const rockyLinux9: OSDistribution = {
    id: 'rocky-9',
    name: 'Rocky Linux 9',
    version: '9',
    packageManager: 'yum',
    architectures: ['x86_64'],
    defaultRepos: [
      {
        id: 'baseos',
        name: 'Rocky Linux 9 - BaseOS',
        baseUrl: 'https://download.rockylinux.org/pub/rocky/9/BaseOS/x86_64/os/',
        enabled: true,
        type: 'yum',
      },
    ],
    extendedRepos: [],
  };

  const ubuntu2204: OSDistribution = {
    id: 'ubuntu-22.04',
    name: 'Ubuntu 22.04 LTS',
    version: '22.04',
    packageManager: 'apt',
    architectures: ['amd64'],
    defaultRepos: [
      {
        id: 'main',
        name: 'Ubuntu 22.04 Main',
        baseUrl: 'http://archive.ubuntu.com/ubuntu/dists/jammy/main',
        enabled: true,
        type: 'apt',
      },
    ],
    extendedRepos: [],
  };

  const alpine319: OSDistribution = {
    id: 'alpine-3.19',
    name: 'Alpine Linux 3.19',
    version: '3.19',
    packageManager: 'apk',
    architectures: ['x86_64'],
    defaultRepos: [
      {
        id: 'main',
        name: 'Alpine 3.19 Main',
        baseUrl: 'https://dl-cdn.alpinelinux.org/alpine/v3.19/main',
        enabled: true,
        type: 'apk',
      },
    ],
    extendedRepos: [],
  };

  beforeAll(() => {
    downloader = new OSPackageDownloader();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-integration-test-'));
  });

  afterAll(async () => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    await downloader.clearCache();
  });

  describe('YUM/RPM - Rocky Linux 9', () => {
    it('패키지 검색 - which', async () => {
      const result = await downloader.search({
        query: 'which',
        distribution: rockyLinux9,
        architecture: 'x86_64',
        matchType: 'exact',
      });

      expect(result).toBeDefined();
      expect(result.packages.length).toBeGreaterThan(0);
      expect(result.totalCount).toBeGreaterThan(0);

      const which = result.packages.find(p => p.name === 'which');
      expect(which).toBeDefined();
    }, 180000);

    it('패키지 검색 - 부분 일치', async () => {
      const result = await downloader.search({
        query: 'bash',
        distribution: rockyLinux9,
        architecture: 'x86_64',
        matchType: 'partial',
      });

      expect(result).toBeDefined();
      expect(result.packages.length).toBeGreaterThan(0);

      // bash를 포함하는 패키지들
      const allPartial = result.packages.every(p => p.name.includes('bash'));
      expect(allPartial).toBe(true);
    }, 180000);

    it('존재하지 않는 패키지 검색', async () => {
      const result = await downloader.search({
        query: 'nonexistent-package-xyz-12345',
        distribution: rockyLinux9,
        architecture: 'x86_64',
        matchType: 'exact',
      });

      expect(result).toBeDefined();
      expect(result.packages.length).toBe(0);
      expect(result.totalCount).toBe(0);
    }, 180000);
  });

  describe('APT/DEB - Ubuntu 22.04', () => {
    it('패키지 검색 - bash', async () => {
      const result = await downloader.search({
        query: 'bash',
        distribution: ubuntu2204,
        architecture: 'amd64',
        matchType: 'exact',
      });

      expect(result).toBeDefined();
      expect(result.packages.length).toBeGreaterThan(0);

      const bash = result.packages.find(p => p.name === 'bash');
      expect(bash).toBeDefined();
    }, 180000);

    it('패키지 검색 - curl', async () => {
      const result = await downloader.search({
        query: 'curl',
        distribution: ubuntu2204,
        architecture: 'amd64',
        matchType: 'exact',
      });

      expect(result).toBeDefined();
      expect(result.packages.length).toBeGreaterThan(0);
    }, 180000);

    it('검색 결과 제한', async () => {
      const result = await downloader.search({
        query: 'lib',
        distribution: ubuntu2204,
        architecture: 'amd64',
        matchType: 'partial',
        limit: 10,
      });

      expect(result).toBeDefined();
      expect(result.packages.length).toBeLessThanOrEqual(10);
      expect(result.hasMore).toBe(true); // lib로 시작하는 패키지가 10개 이상
    }, 180000);
  });

  describe('APK - Alpine 3.19', () => {
    it('패키지 검색 - busybox', async () => {
      const result = await downloader.search({
        query: 'busybox',
        distribution: alpine319,
        architecture: 'x86_64',
        matchType: 'exact',
      });

      expect(result).toBeDefined();
      expect(result.packages.length).toBeGreaterThan(0);

      const busybox = result.packages.find(p => p.name === 'busybox');
      expect(busybox).toBeDefined();
    }, 180000);

    it('패키지 검색 - curl', async () => {
      const result = await downloader.search({
        query: 'curl',
        distribution: alpine319,
        architecture: 'x86_64',
        matchType: 'exact',
      });

      expect(result).toBeDefined();
      expect(result.packages.length).toBeGreaterThan(0);
    }, 180000);
  });

  describe('의존성 해결', () => {
    it('YUM 패키지 의존성 해결', async () => {
      // which 패키지 검색
      const searchResult = await downloader.search({
        query: 'which',
        distribution: rockyLinux9,
        architecture: 'x86_64',
        matchType: 'exact',
      });

      if (searchResult.packages.length === 0) {
        console.warn('which 패키지를 찾을 수 없습니다');
        return;
      }

      const whichPkg = searchResult.packages[0].latest;
      expect(whichPkg).toBeDefined();

      // 의존성 해결
      const depResult = await downloader.resolveDependencies(
        [whichPkg],
        rockyLinux9,
        'x86_64'
      );

      expect(depResult).toBeDefined();
      expect(depResult.packages.length).toBeGreaterThanOrEqual(1);
    }, 300000);

    it('APT 패키지 의존성 해결', async () => {
      // hostname 패키지 검색 (작은 패키지)
      const searchResult = await downloader.search({
        query: 'hostname',
        distribution: ubuntu2204,
        architecture: 'amd64',
        matchType: 'exact',
      });

      if (searchResult.packages.length === 0) {
        console.warn('hostname 패키지를 찾을 수 없습니다');
        return;
      }

      const hostnamePkg = searchResult.packages[0].latest;
      expect(hostnamePkg).toBeDefined();

      // 의존성 해결
      const depResult = await downloader.resolveDependencies(
        [hostnamePkg],
        ubuntu2204,
        'amd64'
      );

      expect(depResult).toBeDefined();
      expect(depResult.packages.length).toBeGreaterThanOrEqual(1);
    }, 300000);

    it('APK 패키지 의존성 해결', async () => {
      // tzdata 패키지 검색 (의존성 적음)
      const searchResult = await downloader.search({
        query: 'tzdata',
        distribution: alpine319,
        architecture: 'x86_64',
        matchType: 'exact',
      });

      if (searchResult.packages.length === 0) {
        console.warn('tzdata 패키지를 찾을 수 없습니다');
        return;
      }

      const tzdataPkg = searchResult.packages[0].latest;
      expect(tzdataPkg).toBeDefined();

      // 의존성 해결
      const depResult = await downloader.resolveDependencies(
        [tzdataPkg],
        alpine319,
        'x86_64'
      );

      expect(depResult).toBeDefined();
      expect(depResult.packages.length).toBeGreaterThanOrEqual(1);
    }, 300000);
  });

  describe('패키지 다운로드', () => {
    it('APK 패키지 다운로드', async () => {
      const outputDir = path.join(tempDir, 'apk-download');
      fs.mkdirSync(outputDir, { recursive: true });

      // tzdata 패키지 검색
      const searchResult = await downloader.search({
        query: 'tzdata',
        distribution: alpine319,
        architecture: 'x86_64',
        matchType: 'exact',
      });

      if (searchResult.packages.length === 0) {
        console.warn('tzdata 패키지를 찾을 수 없습니다');
        return;
      }

      const pkg = searchResult.packages[0].latest;

      // 다운로드
      const result = await downloader.download({
        packages: [pkg],
        outputDir,
        resolveDependencies: false,
      });

      expect(result).toBeDefined();
      expect(result.success.length).toBeGreaterThanOrEqual(1);
      expect(result.totalSize).toBeGreaterThan(0);

      // 파일 존재 확인
      const files = fs.readdirSync(outputDir);
      expect(files.length).toBeGreaterThan(0);
    }, 300000);

    it('다운로드 진행 콜백', async () => {
      const outputDir = path.join(tempDir, 'progress-test');
      fs.mkdirSync(outputDir, { recursive: true });

      const searchResult = await downloader.search({
        query: 'tzdata',
        distribution: alpine319,
        architecture: 'x86_64',
        matchType: 'exact',
      });

      if (searchResult.packages.length === 0) {
        console.warn('tzdata 패키지를 찾을 수 없습니다');
        return;
      }

      const pkg = searchResult.packages[0].latest;
      let progressCalled = false;

      const result = await downloader.download({
        packages: [pkg],
        outputDir,
        resolveDependencies: false,
        onProgress: (progress) => {
          progressCalled = true;
          expect(progress.phase).toBeDefined();
        },
      });

      expect(result).toBeDefined();
      expect(progressCalled).toBe(true);
    }, 300000);
  });

  describe('캐시 관리', () => {
    it('캐시 통계 조회', () => {
      const stats = downloader.getCacheStats();

      expect(stats).toBeDefined();
    });

    it('캐시 초기화', async () => {
      await downloader.clearCache();
      // 에러 없이 완료되면 성공
      expect(true).toBe(true);
    });

    it('캐시 설정 업데이트', () => {
      downloader.updateCacheConfig({
        maxSize: 1024 * 1024 * 100, // 100MB
      });
      // 에러 없이 완료되면 성공
      expect(true).toBe(true);
    });
  });

  describe('검색 옵션', () => {
    it('와일드카드 검색', async () => {
      const result = await downloader.search({
        query: 'curl*',
        distribution: alpine319,
        architecture: 'x86_64',
        matchType: 'wildcard',
      });

      expect(result).toBeDefined();
      expect(result.packages.length).toBeGreaterThan(0);

      // curl로 시작하는 패키지들
      const allWildcard = result.packages.every(p => p.name.startsWith('curl'));
      expect(allWildcard).toBe(true);
    }, 180000);
  });
});
