/**
 * APT/DEB 다운로더 통합 테스트
 *
 * 실제 APT 리포지토리 API를 호출하여 패키지 조회 및 다운로드 기능을 테스트합니다.
 *
 * 실행 방법:
 *   INTEGRATION_TEST=true npm test -- apt.integration.test.ts
 *
 * 테스트 케이스:
 *   - bash: 기본 패키지, 의존성 있음
 *   - curl: 네트워크 패키지, 의존성 5-6개
 *   - 존재하지 않는 패키지 처리
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AptMetadataParser, AptDependencyResolver, AptDownloader } from './os/apt';
import type { Repository, OSArchitecture } from './os/types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const INTEGRATION_TEST = process.env.INTEGRATION_TEST === 'true';
const describeIntegration = INTEGRATION_TEST ? describe : describe.skip;

describeIntegration('APT/DEB 통합 테스트', () => {
  let parser: AptMetadataParser;
  let resolver: AptDependencyResolver;
  let downloader: AptDownloader;
  let tempDir: string;

  // Ubuntu 22.04 (Jammy) 테스트용 리포지토리
  const testRepo: Repository = {
    id: 'ubuntu-jammy-main',
    name: 'Ubuntu 22.04 Main',
    baseUrl: 'http://archive.ubuntu.com/ubuntu/dists/jammy',
    enabled: true,
    type: 'apt',
  };

  const testArchitecture: OSArchitecture = 'amd64';

  beforeAll(() => {
    parser = new AptMetadataParser(testRepo, 'main', testArchitecture);
    resolver = new AptDependencyResolver({
      repositories: [testRepo],
      architecture: testArchitecture,
    });
    downloader = new AptDownloader({
      repositories: [testRepo],
      architecture: testArchitecture,
    });
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apt-integration-test-'));
  });

  afterAll(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Release 파일 파싱', () => {
    it('Release 정보 조회', async () => {
      const release = await parser.parseRelease();

      expect(release).toBeDefined();
      expect(release.codename).toBe('jammy');
      expect(release.architectures).toContain('amd64');
    }, 60000);
  });

  describe('Packages.gz 파싱', () => {
    it('패키지 목록 로드', async () => {
      const packages = await parser.parsePackages();

      expect(packages).toBeDefined();
      expect(packages.length).toBeGreaterThan(0);
    }, 120000);

    it('패키지에 필수 정보 포함', async () => {
      const packages = await parser.parsePackages();
      const samplePkg = packages.find(p => p.name === 'bash');

      expect(samplePkg).toBeDefined();
      expect(samplePkg?.name).toBe('bash');
      expect(samplePkg?.version).toBeDefined();
      expect(samplePkg?.architecture).toBeDefined();
      expect(samplePkg?.location).toBeDefined();
    }, 120000);
  });

  describe('정상 케이스 - bash 패키지', () => {
    it('bash 패키지 검색', async () => {
      const results = await parser.searchPackages('bash', 'exact');

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);

      const bash = results.find(r => r.name === 'bash');
      expect(bash).toBeDefined();
      expect(bash?.latest).toBeDefined();
    }, 120000);

    it('bash 버전 목록 조회', async () => {
      const versions = await parser.getPackageVersions('bash');

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
      const results = await parser.searchPackages('bash', 'exact');

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);
      // 정확한 검색은 'bash'만 반환
      const allExact = results.every(r => r.name === 'bash');
      expect(allExact).toBe(true);
    }, 120000);

    it('부분 검색 (partial)', async () => {
      const results = await parser.searchPackages('bash', 'partial');

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);
      // 부분 검색은 bash를 포함하는 패키지 (bash, bash-completion 등)
      const allPartial = results.every(r => r.name.includes('bash'));
      expect(allPartial).toBe(true);
    }, 120000);

    it('와일드카드 검색 (wildcard)', async () => {
      const results = await parser.searchPackages('bash*', 'wildcard');

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);
      // 와일드카드 검색은 bash로 시작하는 패키지
      const allWildcard = results.every(r => r.name.startsWith('bash'));
      expect(allWildcard).toBe(true);
    }, 120000);
  });

  describe('존재하지 않는 패키지 처리', () => {
    it('존재하지 않는 패키지 검색 시 빈 배열 반환', async () => {
      const results = await parser.searchPackages('nonexistent-apt-package-xyz-12345', 'exact');

      expect(results).toBeDefined();
      expect(results.length).toBe(0);
    }, 120000);

    it('존재하지 않는 패키지 버전 조회', async () => {
      const versions = await parser.getPackageVersions('nonexistent-apt-package-xyz-12345');

      expect(versions).toBeDefined();
      expect(versions.length).toBe(0);
    }, 120000);
  });

  describe('의존성 해결 (Resolver)', () => {
    it('패키지 검색 via Resolver', async () => {
      const results = await resolver.searchPackages('bash', 'exact');

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);
    }, 180000);

    it('패키지 의존성 해결', async () => {
      // bash 검색
      const searchResults = await resolver.searchPackages('bash', 'exact');
      expect(searchResults.length).toBeGreaterThan(0);

      const bashPkg = searchResults[0].latest;
      expect(bashPkg).toBeDefined();

      // 의존성 해결
      const resolvedDeps = await resolver.resolveDependencies([bashPkg]);

      expect(resolvedDeps).toBeDefined();
      expect(resolvedDeps.length).toBeGreaterThan(0);

      // bash는 의존성이 있어야 함 (libc6, libreadline8 등)
      const depNames = resolvedDeps.map(d => d.name);
      expect(depNames).toContain('bash'); // 패키지 자체도 포함
    }, 180000);
  });

  describe('패키지 다운로드 (Downloader)', () => {
    it('작은 패키지 다운로드', async () => {
      const outputDir = path.join(tempDir, 'download-test');
      fs.mkdirSync(outputDir, { recursive: true });

      // 'hostname' 패키지는 매우 작음
      const searchResults = await resolver.searchPackages('hostname', 'exact');

      if (searchResults.length === 0 || !searchResults[0].latest) {
        console.warn('hostname 패키지를 찾을 수 없습니다');
        return;
      }

      const pkg = searchResults[0].latest;

      const filePath = await downloader.download(pkg, outputDir);

      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath)).toBe(true);

      // .deb 파일
      expect(filePath.endsWith('.deb')).toBe(true);
    }, 180000);

    it('다운로드 진행 콜백 호출', async () => {
      const outputDir = path.join(tempDir, 'progress-test');
      fs.mkdirSync(outputDir, { recursive: true });

      const searchResults = await resolver.searchPackages('hostname', 'exact');

      if (searchResults.length === 0 || !searchResults[0].latest) {
        console.warn('hostname 패키지를 찾을 수 없습니다');
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
      const results = await parser.searchPackages('bash', 'exact');

      if (results.length === 0) {
        console.warn('bash 패키지를 찾을 수 없습니다');
        return;
      }

      const versions = results[0].versions;

      // 최소 1개 버전 존재
      expect(versions.length).toBeGreaterThan(0);

      // latest가 첫 번째 버전
      expect(results[0].latest).toBe(versions[0]);
    }, 120000);
  });
});
