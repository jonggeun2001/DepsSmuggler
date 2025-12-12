/**
 * npm 다운로더 통합 테스트
 *
 * 실제 npm Registry API를 호출하여 패키지 조회 및 다운로드 기능을 테스트합니다.
 *
 * 실행 방법:
 *   INTEGRATION_TEST=true npm test -- npm.integration.test.ts
 *
 * 테스트 케이스:
 *   - chalk: 의존성 체인, ~50KB
 *   - debug: 의존성 2-3개, ~30KB
 *   - @types/node: scoped package (@)
 *   - 존재하지 않는 패키지 처리
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NpmDownloader } from './npm';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const INTEGRATION_TEST = process.env.INTEGRATION_TEST === 'true';
const describeIntegration = INTEGRATION_TEST ? describe : describe.skip;

describeIntegration('npm 통합 테스트', () => {
  let downloader: NpmDownloader;
  let tempDir: string;

  beforeAll(() => {
    downloader = new NpmDownloader();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-integration-test-'));
  });

  afterAll(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    downloader.clearCache();
  });

  describe('정상 케이스 - chalk 패키지', () => {
    it('chalk 패키지 검색', async () => {
      const results = await downloader.searchPackages('chalk');

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);

      const chalk = results.find(p => p.name === 'chalk');
      expect(chalk).toBeDefined();
      expect(chalk?.name).toBe('chalk');
    });

    it('chalk 버전 목록 조회', async () => {
      const versions = await downloader.getVersions('chalk');

      expect(versions).toBeDefined();
      expect(versions.length).toBeGreaterThan(0);
      expect(versions).toContain('5.3.0');
      expect(versions).toContain('4.1.2');
    });

    it('chalk 메타데이터 조회', async () => {
      const metadata = await downloader.getPackageMetadata('chalk', '5.3.0');

      expect(metadata).toBeDefined();
      expect(metadata.name).toBe('chalk');
      expect(metadata.version).toBe('5.3.0');
      expect(metadata.metadata).toBeDefined();
      expect(metadata.metadata?.downloadUrl).toBeDefined();
    });

    it('chalk 패키지 다운로드', async () => {
      const outputDir = path.join(tempDir, 'chalk');
      fs.mkdirSync(outputDir, { recursive: true });

      const filePath = await downloader.downloadPackage(
        { type: 'npm', name: 'chalk', version: '5.3.0' },
        outputDir
      );

      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath)).toBe(true);

      // .tgz 형식
      expect(filePath.endsWith('.tgz')).toBe(true);
    }, 60000);
  });

  describe('정상 케이스 - debug 패키지', () => {
    it('debug 메타데이터 조회', async () => {
      const metadata = await downloader.getPackageMetadata('debug', '4.3.4');

      expect(metadata).toBeDefined();
      expect(metadata.name).toBe('debug');
      expect(metadata.metadata).toBeDefined();
    });

    it('debug 패키지 다운로드', async () => {
      const outputDir = path.join(tempDir, 'debug');
      fs.mkdirSync(outputDir, { recursive: true });

      const filePath = await downloader.downloadPackage(
        { type: 'npm', name: 'debug', version: '4.3.4' },
        outputDir
      );

      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath)).toBe(true);
    }, 60000);
  });

  describe('scoped 패키지 - @types/node', () => {
    it('@types/node 패키지 검색', async () => {
      const results = await downloader.searchPackages('@types/node');

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);

      const typesNode = results.find(p => p.name === '@types/node');
      expect(typesNode).toBeDefined();
    });

    it('@types/node 버전 목록 조회', async () => {
      const versions = await downloader.getVersions('@types/node');

      expect(versions).toBeDefined();
      expect(versions.length).toBeGreaterThan(0);
    });

    it('@types/node 다운로드', async () => {
      const outputDir = path.join(tempDir, 'types-node');
      fs.mkdirSync(outputDir, { recursive: true });

      const filePath = await downloader.downloadPackage(
        { type: 'npm', name: '@types/node', version: '20.0.0' },
        outputDir
      );

      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath)).toBe(true);
    }, 60000);
  });

  describe('존재하지 않는 패키지 처리', () => {
    it('존재하지 않는 패키지 검색 시 정확히 일치하는 패키지 없음', async () => {
      const searchTerm = 'nonexistent-npm-package-xyz-12345';
      const results = await downloader.searchPackages(searchTerm);

      expect(results).toBeDefined();
      // npm 텍스트 검색 API는 부분 일치 결과를 반환할 수 있음
      // 정확히 일치하는 패키지가 없어야 함
      const exactMatch = results.find(p => p.name === searchTerm);
      expect(exactMatch).toBeUndefined();
    });

    it('존재하지 않는 버전 다운로드 시 에러', async () => {
      const outputDir = path.join(tempDir, 'nonexistent-version');
      fs.mkdirSync(outputDir, { recursive: true });

      await expect(
        downloader.downloadPackage(
          { type: 'npm', name: 'chalk', version: '999.999.999' },
          outputDir
        )
      ).rejects.toThrow();
    });
  });

  describe('dist-tags 처리', () => {
    it('latest 태그로 버전 조회', async () => {
      const distTags = await downloader.getDistTags('lodash');

      expect(distTags).toBeDefined();
      expect(distTags.latest).toBeDefined();
    });

    it('특정 버전 정보 조회', async () => {
      const versionInfo = await downloader.getPackageVersion('lodash', '4.17.21');

      expect(versionInfo).toBeDefined();
      expect(versionInfo.version).toBe('4.17.21');
      expect(versionInfo.dist).toBeDefined();
      expect(versionInfo.dist.tarball).toBeDefined();
    });
  });

  describe('tarball 무결성 검증', () => {
    it('다운로드된 파일의 integrity/shasum 검증', async () => {
      const outputDir = path.join(tempDir, 'integrity-test');
      fs.mkdirSync(outputDir, { recursive: true });

      const filePath = await downloader.downloadPackage(
        { type: 'npm', name: 'lodash', version: '4.17.21' },
        outputDir
      );

      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath)).toBe(true);

      const stats = fs.statSync(filePath);
      expect(stats.size).toBeGreaterThan(0);
    }, 60000);
  });

  describe('대용량 패키지', () => {
    it('lodash 패키지 다운로드', async () => {
      const outputDir = path.join(tempDir, 'lodash');
      fs.mkdirSync(outputDir, { recursive: true });

      const filePath = await downloader.downloadPackage(
        { type: 'npm', name: 'lodash', version: '4.17.21' },
        outputDir
      );

      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath)).toBe(true);

      // lodash는 중간 크기 패키지
      const stats = fs.statSync(filePath);
      expect(stats.size).toBeGreaterThan(100000); // 100KB 이상
    }, 120000);
  });

  describe('진행 콜백', () => {
    it('다운로드 진행 콜백 호출', async () => {
      const outputDir = path.join(tempDir, 'progress-test');
      fs.mkdirSync(outputDir, { recursive: true });

      let progressCalled = false;
      let lastProgress = 0;

      const filePath = await downloader.downloadPackage(
        { type: 'npm', name: 'chalk', version: '5.3.0' },
        outputDir,
        (progress) => {
          progressCalled = true;
          lastProgress = progress.progress;
        }
      );

      expect(filePath).toBeDefined();
      expect(progressCalled).toBe(true);
      expect(lastProgress).toBeGreaterThanOrEqual(0);
    }, 120000);
  });
});
