/**
 * conda 다운로더 통합 테스트
 *
 * 실제 Anaconda API를 호출하여 패키지 조회 및 다운로드 기능을 테스트합니다.
 *
 * 실행 방법:
 *   INTEGRATION_TEST=true npm test -- conda.integration.test.ts
 *
 * 테스트 케이스:
 *   - requests: conda 채널 의존성 체인
 *   - flask: ~1MB, 의존성 10+
 *   - numpy: 채널별 빌드 차이
 *   - 존재하지 않는 패키지 처리
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CondaDownloader } from './conda';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const INTEGRATION_TEST = process.env.INTEGRATION_TEST === 'true';
const describeIntegration = INTEGRATION_TEST ? describe : describe.skip;

describeIntegration('conda 통합 테스트', () => {
  let downloader: CondaDownloader;
  let tempDir: string;

  beforeAll(() => {
    downloader = new CondaDownloader();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conda-integration-test-'));
  });

  afterAll(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    downloader.clearCache();
  });

  describe('정상 케이스 - requests 패키지', () => {
    it('requests 패키지 검색', async () => {
      const results = await downloader.searchPackages('requests');

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);

      const requests = results.find(p => p.name.toLowerCase() === 'requests');
      expect(requests).toBeDefined();
    });

    it('requests 버전 목록 조회', async () => {
      const versions = await downloader.getVersions('requests');

      expect(versions).toBeDefined();
      expect(versions.length).toBeGreaterThan(0);
    });

    it('requests 메타데이터 조회', async () => {
      const versions = await downloader.getVersions('requests');
      if (versions.length === 0) {
        console.warn('requests 버전을 찾을 수 없습니다');
        return;
      }

      const metadata = await downloader.getPackageMetadata('requests', versions[0]);

      expect(metadata).toBeDefined();
      expect(metadata.name.toLowerCase()).toBe('requests');
      expect(metadata.metadata).toBeDefined();
      expect(metadata.metadata?.downloadUrl).toBeDefined();
    });

    it('requests 패키지 다운로드', async () => {
      const outputDir = path.join(tempDir, 'requests');
      fs.mkdirSync(outputDir, { recursive: true });

      const versions = await downloader.getVersions('requests');
      if (versions.length === 0) {
        console.warn('requests 버전을 찾을 수 없습니다');
        return;
      }

      const filePath = await downloader.downloadPackage(
        { type: 'conda', name: 'requests', version: versions[0] },
        outputDir
      );

      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath)).toBe(true);

      // .conda 또는 .tar.bz2 형식
      expect(filePath.endsWith('.conda') || filePath.endsWith('.tar.bz2')).toBe(true);
    }, 120000);
  });

  describe('정상 케이스 - six 패키지 (noarch)', () => {
    it('six 메타데이터 조회', async () => {
      const metadata = await downloader.getPackageMetadata('six', '1.16.0');

      expect(metadata).toBeDefined();
      expect(metadata.name.toLowerCase()).toBe('six');
      expect(metadata.metadata).toBeDefined();
    });

    it('six 패키지 다운로드', async () => {
      const outputDir = path.join(tempDir, 'six');
      fs.mkdirSync(outputDir, { recursive: true });

      const filePath = await downloader.downloadPackage(
        { type: 'conda', name: 'six', version: '1.16.0' },
        outputDir
      );

      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath)).toBe(true);
    }, 60000);
  });

  describe('아키텍처별 패키지 - numpy', () => {
    it('numpy linux/x86_64 다운로드', async () => {
      const outputDir = path.join(tempDir, 'numpy-linux');
      fs.mkdirSync(outputDir, { recursive: true });

      const versions = await downloader.getVersions('numpy');
      if (versions.length === 0) {
        console.warn('numpy 버전을 찾을 수 없습니다');
        return;
      }

      const filePath = await downloader.downloadPackage(
        { type: 'conda', name: 'numpy', version: versions[0], arch: 'x86_64' },
        outputDir
      );

      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath)).toBe(true);
    }, 180000);
  });

  describe('존재하지 않는 패키지 처리', () => {
    it('존재하지 않는 패키지 검색 시 빈 배열 반환', async () => {
      const results = await downloader.searchPackages('nonexistent-conda-package-xyz-12345');

      expect(results).toBeDefined();
      expect(results.length).toBe(0);
    });

    it('존재하지 않는 패키지 버전 조회 시 에러 또는 빈 배열', async () => {
      // conda API는 존재하지 않는 패키지에 대해 404 에러를 던질 수 있음
      try {
        const versions = await downloader.getVersions('nonexistent-conda-package-xyz-12345');
        // 빈 배열을 반환하면 통과
        expect(versions).toBeDefined();
        expect(versions.length).toBe(0);
      } catch (error) {
        // 404 에러를 던지면 통과
        expect(error).toBeDefined();
      }
    });

    it('존재하지 않는 버전 다운로드 시 에러', async () => {
      const outputDir = path.join(tempDir, 'nonexistent-version');
      fs.mkdirSync(outputDir, { recursive: true });

      await expect(
        downloader.downloadPackage(
          { type: 'conda', name: 'requests', version: '999.999.999' },
          outputDir
        )
      ).rejects.toThrow();
    });
  });

  describe('채널별 빌드', () => {
    it('conda-forge 채널에서 패키지 조회', async () => {
      const metadata = await downloader.getPackageMetadata('numpy', '1.24.0', 'conda-forge');

      expect(metadata).toBeDefined();
      expect(metadata.name.toLowerCase()).toBe('numpy');
    });
  });

  describe('파일 형식 검증', () => {
    it('.conda 또는 .tar.bz2 형식 확인', async () => {
      const outputDir = path.join(tempDir, 'format-test');
      fs.mkdirSync(outputDir, { recursive: true });

      const filePath = await downloader.downloadPackage(
        { type: 'conda', name: 'six', version: '1.16.0' },
        outputDir
      );

      expect(filePath).toBeDefined();
      expect(filePath.endsWith('.conda') || filePath.endsWith('.tar.bz2')).toBe(true);
    }, 60000);
  });

  describe('진행 콜백', () => {
    it('다운로드 진행 콜백 호출', async () => {
      const outputDir = path.join(tempDir, 'progress-test');
      fs.mkdirSync(outputDir, { recursive: true });

      let progressCalled = false;

      const filePath = await downloader.downloadPackage(
        { type: 'conda', name: 'six', version: '1.16.0' },
        outputDir,
        (progress) => {
          progressCalled = true;
        }
      );

      expect(filePath).toBeDefined();
      expect(progressCalled).toBe(true);
    }, 60000);
  });
});
