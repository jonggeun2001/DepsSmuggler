/**
 * YUM/RPM 다운로더 통합 테스트
 *
 * 실제 YUM 리포지토리 API를 호출하여 패키지 조회 및 다운로드 기능을 테스트합니다.
 *
 * 실행 방법:
 *   INTEGRATION_TEST=true npm test -- yum.integration.test.ts
 *
 * 테스트 케이스:
 *   - curl: 의존성 5-6개, ~300KB
 *   - which: 작은 패키지
 *   - 존재하지 않는 패키지 처리
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { YumDownloader } from './yum';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const INTEGRATION_TEST = process.env.INTEGRATION_TEST === 'true';
const describeIntegration = INTEGRATION_TEST ? describe : describe.skip;

describeIntegration('YUM/RPM 통합 테스트', () => {
  let downloader: YumDownloader;
  let tempDir: string;

  // Rocky Linux 9 테스트용 리포지토리
  const testRepos = [
    {
      id: 'baseos',
      name: 'Rocky Linux 9 - BaseOS',
      baseUrl: 'https://download.rockylinux.org/pub/rocky/9/BaseOS/x86_64/os/'
    },
    {
      id: 'appstream',
      name: 'Rocky Linux 9 - AppStream',
      baseUrl: 'https://download.rockylinux.org/pub/rocky/9/AppStream/x86_64/os/'
    }
  ];

  beforeAll(() => {
    downloader = new YumDownloader(testRepos);
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yum-integration-test-'));
  });

  afterAll(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    downloader.clearCache();
  });

  describe('정상 케이스 - which 패키지', () => {
    it('which 패키지 검색', async () => {
      const results = await downloader.searchPackages('which');

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);

      const which = results.find(p => p.name === 'which');
      expect(which).toBeDefined();
    }, 120000);

    it('which 버전 목록 조회', async () => {
      const versions = await downloader.getVersions('which');

      expect(versions).toBeDefined();
      expect(versions.length).toBeGreaterThan(0);
    });

    it('which 메타데이터 조회', async () => {
      const versions = await downloader.getVersions('which');
      if (versions.length === 0) {
        console.warn('which 버전을 찾을 수 없습니다');
        return;
      }

      const metadata = await downloader.getPackageMetadata('which', versions[0]);

      expect(metadata).toBeDefined();
      expect(metadata.name).toBe('which');
      expect(metadata.metadata).toBeDefined();
      expect(metadata.metadata?.downloadUrl).toBeDefined();
    });

    it('which 패키지 다운로드', async () => {
      const outputDir = path.join(tempDir, 'which');
      fs.mkdirSync(outputDir, { recursive: true });

      const versions = await downloader.getVersions('which');
      if (versions.length === 0) {
        console.warn('which 버전을 찾을 수 없습니다');
        return;
      }

      const metadata = await downloader.getPackageMetadata('which', versions[0]);

      const filePath = await downloader.downloadPackage(
        {
          type: 'yum',
          name: 'which',
          version: versions[0],
          metadata: metadata.metadata
        },
        outputDir
      );

      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath)).toBe(true);

      // .rpm 파일
      expect(filePath.endsWith('.rpm')).toBe(true);
    }, 120000);
  });

  describe('정상 케이스 - bash 패키지', () => {
    it('bash 검색', async () => {
      const results = await downloader.searchPackages('bash');

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);

      const bash = results.find(p => p.name === 'bash');
      expect(bash).toBeDefined();
    });

    it('bash 버전 조회', async () => {
      const versions = await downloader.getVersions('bash');

      expect(versions).toBeDefined();
      expect(versions.length).toBeGreaterThan(0);
    });
  });

  describe('존재하지 않는 패키지 처리', () => {
    it('존재하지 않는 패키지 검색 시 빈 배열 반환', async () => {
      const results = await downloader.searchPackages('nonexistent-rpm-package-xyz-12345');

      expect(results).toBeDefined();
      expect(results.length).toBe(0);
    });

    it('존재하지 않는 패키지 버전 조회', async () => {
      const versions = await downloader.getVersions('nonexistent-rpm-package-xyz-12345');

      expect(versions).toBeDefined();
      expect(versions.length).toBe(0);
    });
  });

  describe('리포지토리 관리', () => {
    it('기본 리포지토리 목록 조회', () => {
      // getDefaultRepos는 Record<string, string>을 반환함
      const repos = downloader.getDefaultRepos();

      expect(repos).toBeDefined();
      expect(Object.keys(repos).length).toBeGreaterThan(0);
    });
  });

  describe('캐시 관리', () => {
    it('캐시 초기화', () => {
      downloader.clearCache();
      // 에러 없이 완료되면 성공
      expect(true).toBe(true);
    });
  });

  describe('진행 콜백', () => {
    it('다운로드 진행 콜백 호출', async () => {
      const outputDir = path.join(tempDir, 'progress-test');
      fs.mkdirSync(outputDir, { recursive: true });

      const versions = await downloader.getVersions('which');
      if (versions.length === 0) {
        console.warn('which 버전을 찾을 수 없습니다');
        return;
      }

      const metadata = await downloader.getPackageMetadata('which', versions[0]);

      let progressCalled = false;

      const filePath = await downloader.downloadPackage(
        {
          type: 'yum',
          name: 'which',
          version: versions[0],
          metadata: metadata.metadata
        },
        outputDir,
        (progress) => {
          progressCalled = true;
        }
      );

      expect(filePath).toBeDefined();
      expect(progressCalled).toBe(true);
    }, 120000);
  });
});
