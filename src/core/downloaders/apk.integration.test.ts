/**
 * APK 다운로더 통합 테스트
 *
 * 실제 Alpine Linux 리포지토리 API를 호출하여 패키지 조회 및 다운로드 기능을 테스트합니다.
 *
 * 실행 방법:
 *   INTEGRATION_TEST=true npm test -- apk.integration.test.ts
 *
 * 테스트 케이스:
 *   - busybox: Alpine 기본 패키지
 *   - curl: 네트워크 패키지, 의존성 있음
 *   - 존재하지 않는 패키지 처리
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ApkMetadataParser, ApkDependencyResolver, ApkDownloader } from './os/apk';
import type { Repository, OSArchitecture } from './os/types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const INTEGRATION_TEST = process.env.INTEGRATION_TEST === 'true';
const describeIntegration = INTEGRATION_TEST ? describe : describe.skip;

describeIntegration('APK 통합 테스트', () => {
  let parser: ApkMetadataParser;
  let resolver: ApkDependencyResolver;
  let downloader: ApkDownloader;
  let tempDir: string;

  // Alpine Linux 3.19 테스트용 리포지토리
  const testRepo: Repository = {
    id: 'alpine-main',
    name: 'Alpine 3.19 Main',
    baseUrl: 'https://dl-cdn.alpinelinux.org/alpine/v3.19/main',
    enabled: true,
    type: 'apk',
  };

  const testArchitecture: OSArchitecture = 'x86_64';

  beforeAll(() => {
    parser = new ApkMetadataParser(testRepo, testArchitecture);
    resolver = new ApkDependencyResolver({
      repositories: [testRepo],
      architecture: testArchitecture,
    });
    downloader = new ApkDownloader({
      repositories: [testRepo],
      architecture: testArchitecture,
    });
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apk-integration-test-'));
  });

  afterAll(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('APKINDEX 파싱', () => {
    it('패키지 목록 로드', async () => {
      const packages = await parser.parseIndex();

      expect(packages).toBeDefined();
      expect(packages.length).toBeGreaterThan(0);
    }, 120000);

    it('패키지에 필수 정보 포함', async () => {
      const packages = await parser.parseIndex();
      const samplePkg = packages.find(p => p.name === 'busybox');

      expect(samplePkg).toBeDefined();
      expect(samplePkg?.name).toBe('busybox');
      expect(samplePkg?.version).toBeDefined();
      expect(samplePkg?.architecture).toBeDefined();
      expect(samplePkg?.location).toBeDefined();
    }, 120000);
  });

  describe('정상 케이스 - busybox 패키지', () => {
    it('busybox 패키지 검색', async () => {
      const results = await parser.searchPackages('busybox', 'exact');

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);

      const busybox = results.find(r => r.name === 'busybox');
      expect(busybox).toBeDefined();
      expect(busybox?.latest).toBeDefined();
    }, 120000);

    it('busybox 버전 목록 조회', async () => {
      const versions = await parser.getPackageVersions('busybox');

      expect(versions).toBeDefined();
      expect(versions.length).toBeGreaterThan(0);
    }, 120000);
  });

  describe('정상 케이스 - curl 패키지', () => {
    it('curl 패키지 검색', async () => {
      const results = await parser.searchPackages('curl', 'exact');

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);

      const curl = results.find(r => r.name === 'curl');
      expect(curl).toBeDefined();
    }, 120000);

    it('curl 버전 목록 조회', async () => {
      const versions = await parser.getPackageVersions('curl');

      expect(versions).toBeDefined();
      expect(versions.length).toBeGreaterThan(0);
    }, 120000);
  });

  describe('패키지 검색 유형', () => {
    it('정확한 검색 (exact)', async () => {
      const results = await parser.searchPackages('curl', 'exact');

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);
      // 정확한 검색은 'curl'만 반환
      const allExact = results.every(r => r.name === 'curl');
      expect(allExact).toBe(true);
    }, 120000);

    it('부분 검색 (partial)', async () => {
      const results = await parser.searchPackages('curl', 'partial');

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);
      // 부분 검색은 curl을 포함하는 패키지 (curl, libcurl 등)
      const allPartial = results.every(r => r.name.includes('curl'));
      expect(allPartial).toBe(true);
    }, 120000);

    it('와일드카드 검색 (wildcard)', async () => {
      const results = await parser.searchPackages('curl*', 'wildcard');

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);
      // 와일드카드 검색은 curl로 시작하는 패키지
      const allWildcard = results.every(r => r.name.startsWith('curl'));
      expect(allWildcard).toBe(true);
    }, 120000);
  });

  describe('존재하지 않는 패키지 처리', () => {
    it('존재하지 않는 패키지 검색 시 빈 배열 반환', async () => {
      const results = await parser.searchPackages('nonexistent-apk-package-xyz-12345', 'exact');

      expect(results).toBeDefined();
      expect(results.length).toBe(0);
    }, 120000);

    it('존재하지 않는 패키지 버전 조회', async () => {
      const versions = await parser.getPackageVersions('nonexistent-apk-package-xyz-12345');

      expect(versions).toBeDefined();
      expect(versions.length).toBe(0);
    }, 120000);
  });

  describe('의존성 해결 (Resolver)', () => {
    it('패키지 검색 via Resolver', async () => {
      const results = await resolver.searchPackages('busybox', 'exact');

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);
    }, 180000);

    it('패키지 의존성 해결', async () => {
      // curl 검색 (의존성 있는 패키지)
      const searchResults = await resolver.searchPackages('curl', 'exact');
      expect(searchResults.length).toBeGreaterThan(0);

      const curlPkg = searchResults[0].latest;
      expect(curlPkg).toBeDefined();

      // 의존성 해결
      const resolvedDeps = await resolver.resolveDependencies([curlPkg]);

      expect(resolvedDeps).toBeDefined();
      expect(resolvedDeps.length).toBeGreaterThan(0);

      // curl은 의존성이 있어야 함 (libcurl, ca-certificates 등)
      const depNames = resolvedDeps.map(d => d.name);
      expect(depNames).toContain('curl'); // 패키지 자체도 포함
    }, 180000);
  });

  describe('패키지 다운로드 (Downloader)', () => {
    it('작은 패키지 다운로드', async () => {
      const outputDir = path.join(tempDir, 'download-test');
      fs.mkdirSync(outputDir, { recursive: true });

      // 'tzdata' 패키지는 비교적 작음
      const searchResults = await resolver.searchPackages('tzdata', 'exact');

      if (searchResults.length === 0 || !searchResults[0].latest) {
        console.warn('tzdata 패키지를 찾을 수 없습니다');
        return;
      }

      const pkg = searchResults[0].latest;

      const filePath = await downloader.download(pkg, outputDir);

      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath)).toBe(true);

      // .apk 파일
      expect(filePath.endsWith('.apk')).toBe(true);
    }, 180000);

    it('다운로드 진행 콜백 호출', async () => {
      const outputDir = path.join(tempDir, 'progress-test');
      fs.mkdirSync(outputDir, { recursive: true });

      const searchResults = await resolver.searchPackages('tzdata', 'exact');

      if (searchResults.length === 0 || !searchResults[0].latest) {
        console.warn('tzdata 패키지를 찾을 수 없습니다');
        return;
      }

      const pkg = searchResults[0].latest;
      let progressCalled = false;

      const filePath = await downloader.download(pkg, outputDir, (progress) => {
        progressCalled = true;
        expect(progress.downloadedBytes).toBeGreaterThanOrEqual(0);
      });

      expect(filePath).toBeDefined();
      expect(progressCalled).toBe(true);
    }, 180000);
  });

  describe('버전 비교', () => {
    it('패키지 버전이 정렬되어 있음', async () => {
      const results = await parser.searchPackages('busybox', 'exact');

      if (results.length === 0) {
        console.warn('busybox 패키지를 찾을 수 없습니다');
        return;
      }

      const versions = results[0].versions;

      // 최소 1개 버전 존재
      expect(versions.length).toBeGreaterThan(0);

      // latest가 첫 번째 버전
      expect(results[0].latest).toBe(versions[0]);
    }, 120000);
  });

  describe('체크섬 파싱', () => {
    it('패키지 체크섬 정보 포함', async () => {
      const packages = await parser.parseIndex();
      const busybox = packages.find(p => p.name === 'busybox');

      expect(busybox).toBeDefined();
      expect(busybox?.checksum).toBeDefined();
      expect(busybox?.checksum.type).toBeDefined();
      // APK는 SHA1 체크섬을 사용
      expect(['sha1', 'sha256']).toContain(busybox?.checksum.type);
    }, 120000);
  });
});
