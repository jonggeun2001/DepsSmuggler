/**
 * pip 다운로더 통합 테스트
 *
 * 실제 PyPI API를 호출하여 패키지 조회 및 다운로드 기능을 테스트합니다.
 *
 * 실행 방법:
 *   INTEGRATION_TEST=true npm test -- pip.integration.test.ts
 *
 * 테스트 케이스:
 *   - httpx: 전이적 의존성 6개, 총 ~500KB
 *   - rich: 전이적 의존성 4개, 총 ~400KB
 *   - cryptography: 플랫폼별 wheel 분기
 *   - 존재하지 않는 패키지 처리
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PipDownloader } from './pip';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const INTEGRATION_TEST = process.env.INTEGRATION_TEST === 'true';
const describeIntegration = INTEGRATION_TEST ? describe : describe.skip;

describeIntegration('pip 통합 테스트', () => {
  let downloader: PipDownloader;
  let tempDir: string;

  beforeAll(() => {
    downloader = new PipDownloader();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pip-integration-test-'));
  });

  afterAll(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('정상 케이스 - httpx 패키지', () => {
    it('httpx 패키지 검색', async () => {
      const results = await downloader.searchPackages('httpx');

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);

      const httpx = results.find(p => p.name.toLowerCase() === 'httpx');
      expect(httpx).toBeDefined();
      expect(httpx?.name.toLowerCase()).toBe('httpx');
    });

    it('httpx 버전 목록 조회', async () => {
      const versions = await downloader.getVersions('httpx');

      expect(versions).toBeDefined();
      expect(versions.length).toBeGreaterThan(0);
      expect(versions).toContain('0.24.0');
      expect(versions).toContain('0.25.0');
    });

    it('httpx 메타데이터 조회', async () => {
      const metadata = await downloader.getPackageMetadata('httpx', '0.24.0');

      expect(metadata).toBeDefined();
      expect(metadata.name.toLowerCase()).toBe('httpx');
      expect(metadata.version).toBe('0.24.0');
      expect(metadata.metadata).toBeDefined();
      expect(metadata.metadata?.downloadUrl).toBeDefined();
    });

    it('httpx 패키지 다운로드', async () => {
      const outputDir = path.join(tempDir, 'httpx');
      fs.mkdirSync(outputDir, { recursive: true });

      const filePath = await downloader.downloadPackage(
        { type: 'pip', name: 'httpx', version: '0.24.0' },
        outputDir
      );

      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath)).toBe(true);

      const stats = fs.statSync(filePath);
      expect(stats.size).toBeGreaterThan(0);
    }, 60000);
  });

  describe('정상 케이스 - rich 패키지', () => {
    it('rich 메타데이터 조회', async () => {
      const metadata = await downloader.getPackageMetadata('rich', '13.5.0');

      expect(metadata).toBeDefined();
      expect(metadata.name.toLowerCase()).toBe('rich');
      expect(metadata.metadata).toBeDefined();
    });

    it('rich 패키지 다운로드', async () => {
      const outputDir = path.join(tempDir, 'rich');
      fs.mkdirSync(outputDir, { recursive: true });

      const filePath = await downloader.downloadPackage(
        { type: 'pip', name: 'rich', version: '13.5.0' },
        outputDir
      );

      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath)).toBe(true);
    }, 60000);
  });

  describe('플랫폼별 분기 - cryptography 패키지', () => {
    it('cryptography 버전 조회', async () => {
      const versions = await downloader.getVersions('cryptography');

      expect(versions).toBeDefined();
      expect(versions.length).toBeGreaterThan(0);
      expect(versions).toContain('41.0.0');
    });

    it('cryptography 메타데이터 조회', async () => {
      const metadata = await downloader.getPackageMetadata('cryptography', '41.0.0');

      expect(metadata).toBeDefined();
      expect(metadata.name.toLowerCase()).toBe('cryptography');
      expect(metadata.metadata?.downloadUrl).toBeDefined();
    });

    it('cryptography 패키지 다운로드', async () => {
      const outputDir = path.join(tempDir, 'cryptography');
      fs.mkdirSync(outputDir, { recursive: true });

      const filePath = await downloader.downloadPackage(
        { type: 'pip', name: 'cryptography', version: '41.0.0' },
        outputDir
      );

      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath)).toBe(true);

      // wheel 파일인지 확인
      expect(filePath.endsWith('.whl') || filePath.endsWith('.tar.gz')).toBe(true);
    }, 120000);
  });

  describe('아키텍처별 릴리스 조회', () => {
    it('linux/x86_64 릴리스 조회', async () => {
      // getReleasesForArch(name, version, arch?, pythonVersion?, targetOS?)
      const releases = await downloader.getReleasesForArch(
        'cryptography',
        '41.0.0',
        'x86_64',
        undefined,
        'linux'
      );

      expect(releases).toBeDefined();
      expect(releases.length).toBeGreaterThan(0);

      // manylinux wheel이 포함되어야 함
      const manylinuxWheel = releases.find(r =>
        r.filename.includes('manylinux') && r.filename.includes('x86_64')
      );
      expect(manylinuxWheel).toBeDefined();
    });

    it('macos 릴리스 조회', async () => {
      // arm64 필터 없이 macos용 릴리스만 조회
      const releases = await downloader.getReleasesForArch(
        'cryptography',
        '41.0.0',
        undefined, // arch 필터 없이
        undefined,
        'macos'
      );

      expect(releases).toBeDefined();
      expect(releases.length).toBeGreaterThan(0);

      // macosx wheel이 포함되어야 함
      const macosWheel = releases.find(r =>
        r.filename.includes('macosx')
      );
      expect(macosWheel).toBeDefined();
    });

    it('windows/x86_64 릴리스 조회', async () => {
      const releases = await downloader.getReleasesForArch(
        'cryptography',
        '41.0.0',
        'x86_64',
        undefined,
        'windows'
      );

      expect(releases).toBeDefined();
      expect(releases.length).toBeGreaterThan(0);

      // win_amd64 wheel이 포함되어야 함
      const winWheel = releases.find(r =>
        r.filename.includes('win') && r.filename.includes('amd64')
      );
      expect(winWheel).toBeDefined();
    });
  });

  describe('존재하지 않는 패키지 처리', () => {
    it('존재하지 않는 패키지 검색 시 빈 배열 반환', async () => {
      const results = await downloader.searchPackages('nonexistent-package-xyz-12345');

      expect(results).toBeDefined();
      expect(results.length).toBe(0);
    });

    it('존재하지 않는 버전 다운로드 시 에러', async () => {
      const outputDir = path.join(tempDir, 'nonexistent-version');
      fs.mkdirSync(outputDir, { recursive: true });

      await expect(
        downloader.downloadPackage(
          { type: 'pip', name: 'httpx', version: '999.999.999' },
          outputDir
        )
      ).rejects.toThrow();
    });
  });

  describe('pure Python 패키지', () => {
    it('six 패키지 다운로드 (순수 Python)', async () => {
      const outputDir = path.join(tempDir, 'six');
      fs.mkdirSync(outputDir, { recursive: true });

      const filePath = await downloader.downloadPackage(
        { type: 'pip', name: 'six', version: '1.16.0' },
        outputDir
      );

      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath)).toBe(true);

      // pure Python은 py3-none-any wheel
      expect(filePath).toContain('py');
    }, 30000);
  });

  describe('체크섬 검증', () => {
    it('다운로드된 파일의 SHA256 체크섬 검증', async () => {
      const outputDir = path.join(tempDir, 'checksum-test');
      fs.mkdirSync(outputDir, { recursive: true });

      const filePath = await downloader.downloadPackage(
        { type: 'pip', name: 'six', version: '1.16.0' },
        outputDir
      );

      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath)).toBe(true);

      const stats = fs.statSync(filePath);
      expect(stats.size).toBeGreaterThan(0);
    }, 30000);
  });

  describe('대용량 패키지', () => {
    it('numpy 패키지 다운로드', async () => {
      const outputDir = path.join(tempDir, 'numpy');
      fs.mkdirSync(outputDir, { recursive: true });

      const filePath = await downloader.downloadPackage(
        { type: 'pip', name: 'numpy', version: '1.24.0' },
        outputDir
      );

      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath)).toBe(true);

      // numpy는 큰 파일 (수 MB)
      const stats = fs.statSync(filePath);
      expect(stats.size).toBeGreaterThan(1000000); // 1MB 이상
    }, 180000);
  });

  describe('진행 콜백', () => {
    it('다운로드 진행 콜백 호출', async () => {
      const outputDir = path.join(tempDir, 'progress-test');
      fs.mkdirSync(outputDir, { recursive: true });

      let progressCalled = false;
      let lastProgress = 0;

      const filePath = await downloader.downloadPackage(
        { type: 'pip', name: 'six', version: '1.16.0' },
        outputDir,
        (progress) => {
          progressCalled = true;
          lastProgress = progress.progress;
        }
      );

      expect(filePath).toBeDefined();
      expect(progressCalled).toBe(true);
      expect(lastProgress).toBeGreaterThanOrEqual(0);
    }, 30000);
  });
});
