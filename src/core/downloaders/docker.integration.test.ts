/**
 * Docker 다운로더 통합 테스트
 *
 * 실제 Docker Hub API를 호출하여 이미지 다운로드 기능을 테스트합니다.
 *
 * 실행 방법:
 *   INTEGRATION_TEST=true npm test -- docker.integration.test.ts
 *
 * 테스트 케이스:
 *   - alpine:3.18: ~3MB, 레이어 1개
 *   - busybox:latest: ~1.5MB
 *   - hello-world: 가장 작은 이미지
 *   - 존재하지 않는 이미지 처리
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DockerDownloader } from './docker';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const INTEGRATION_TEST = process.env.INTEGRATION_TEST === 'true';
const describeIntegration = INTEGRATION_TEST ? describe : describe.skip;

describeIntegration('Docker 통합 테스트', () => {
  let downloader: DockerDownloader;
  let tempDir: string;

  beforeAll(() => {
    downloader = new DockerDownloader();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docker-integration-test-'));
  });

  afterAll(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    downloader.clearCatalogCache();
  });

  describe('작은 이미지 - hello-world', () => {
    it('hello-world 이미지 검색', async () => {
      const results = await downloader.searchPackages('hello-world');

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);
    });

    it('hello-world 태그(버전) 목록 조회', async () => {
      const versions = await downloader.getVersions('hello-world');

      expect(versions).toBeDefined();
      expect(versions.length).toBeGreaterThan(0);
      expect(versions).toContain('latest');
    });

    it('hello-world 메타데이터 조회', async () => {
      const metadata = await downloader.getPackageMetadata('hello-world', 'latest');

      expect(metadata).toBeDefined();
      expect(metadata.name).toContain('hello-world');
      expect(metadata.version).toBe('latest');
    });

    it('hello-world 이미지 다운로드', async () => {
      const outputDir = path.join(tempDir, 'hello-world');
      fs.mkdirSync(outputDir, { recursive: true });

      const filePath = await downloader.downloadPackage(
        { type: 'docker', name: 'hello-world', version: 'latest', arch: 'x86_64' },
        outputDir
      );

      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath)).toBe(true);

      // tar 파일
      expect(filePath.endsWith('.tar')).toBe(true);
    }, 120000);
  });

  describe('작은 이미지 - alpine', () => {
    it('alpine 이미지 검색', async () => {
      const results = await downloader.searchPackages('alpine');

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);

      // Docker Hub 검색 결과에서 alpine 관련 이미지가 포함되어야 함
      const alpineRelated = results.some(p =>
        p.name.includes('alpine') || (p.description && p.description.toLowerCase().includes('alpine'))
      );
      expect(alpineRelated).toBe(true);
    });

    it('alpine 태그 목록 조회', async () => {
      const versions = await downloader.getVersions('alpine');

      expect(versions).toBeDefined();
      expect(versions.length).toBeGreaterThan(0);
      expect(versions).toContain('latest');
      expect(versions.some(v => v.startsWith('3.'))).toBe(true);
    });

    it('alpine:3.18 다운로드', async () => {
      const outputDir = path.join(tempDir, 'alpine');
      fs.mkdirSync(outputDir, { recursive: true });

      const filePath = await downloader.downloadPackage(
        { type: 'docker', name: 'alpine', version: '3.18', arch: 'x86_64' },
        outputDir
      );

      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath)).toBe(true);

      // 파일 크기 확인 (~3MB 이하)
      const stats = fs.statSync(filePath);
      expect(stats.size).toBeGreaterThan(0);
      expect(stats.size).toBeLessThan(10 * 1024 * 1024); // 10MB 미만
    }, 180000);
  });

  describe('busybox 이미지', () => {
    it('busybox latest 다운로드', async () => {
      const outputDir = path.join(tempDir, 'busybox');
      fs.mkdirSync(outputDir, { recursive: true });

      const filePath = await downloader.downloadPackage(
        { type: 'docker', name: 'busybox', version: 'latest', arch: 'x86_64' },
        outputDir
      );

      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath)).toBe(true);

      // ~1.5MB 크기
      const stats = fs.statSync(filePath);
      expect(stats.size).toBeLessThan(5 * 1024 * 1024); // 5MB 미만
    }, 120000);
  });

  describe('존재하지 않는 이미지 처리', () => {
    it('존재하지 않는 이미지 검색 결과 확인', async () => {
      // Docker Hub 검색은 일부 결과를 반환할 수 있음
      const results = await downloader.searchPackages('nonexistent-docker-image-xyz-12345');

      expect(results).toBeDefined();
      // 검색 결과가 있을 수도 없을 수도 있음 (API 특성)
      expect(Array.isArray(results)).toBe(true);
    });

    it('존재하지 않는 태그 다운로드 시 에러', async () => {
      const outputDir = path.join(tempDir, 'nonexistent-tag');
      fs.mkdirSync(outputDir, { recursive: true });

      await expect(
        downloader.downloadPackage(
          { type: 'docker', name: 'alpine', version: 'nonexistent-tag-xyz-12345', arch: 'x86_64' },
          outputDir
        )
      ).rejects.toThrow();
    });
  });

  describe('downloadImage 메서드', () => {
    it('downloadImage로 이미지 다운로드', async () => {
      const outputDir = path.join(tempDir, 'download-image');
      fs.mkdirSync(outputDir, { recursive: true });

      const filePath = await downloader.downloadImage(
        'hello-world',
        'latest',
        'amd64',
        outputDir
      );

      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath)).toBe(true);
    }, 120000);
  });

  describe('이미지 이름 파싱', () => {
    it('레지스트리 추출', () => {
      // alpine만 입력 시 registry는 null (docker.io가 아님)
      const result1 = (downloader as any).extractRegistry('alpine');
      expect(result1.registry).toBeNull();
      expect(result1.imageName).toBe('alpine');

      // gcr.io/project/image 입력 시 gcr.io 레지스트리로 추출
      const result2 = (downloader as any).extractRegistry('gcr.io/project/image');
      expect(result2.registry).toBe('gcr.io');
      expect(result2.imageName).toBe('project/image');
    });

    it('이미지 이름 파싱 (extractRegistry로 테스트)', () => {
      // extractRegistry 메서드를 사용하여 이미지 이름 파싱 테스트
      const result1 = (downloader as any).extractRegistry('alpine');
      expect(result1.imageName).toBe('alpine');

      const result2 = (downloader as any).extractRegistry('nginx');
      expect(result2.imageName).toBe('nginx');

      const result3 = (downloader as any).extractRegistry('myuser/myimage');
      expect(result3.imageName).toBe('myuser/myimage');
    });
  });

  describe('진행 콜백', () => {
    it('다운로드 진행 콜백 호출', async () => {
      const outputDir = path.join(tempDir, 'progress-test');
      fs.mkdirSync(outputDir, { recursive: true });

      let progressCalled = false;

      const filePath = await downloader.downloadPackage(
        { type: 'docker', name: 'hello-world', version: 'latest', arch: 'x86_64' },
        outputDir,
        (progress) => {
          progressCalled = true;
        }
      );

      expect(filePath).toBeDefined();
      expect(progressCalled).toBe(true);
    }, 120000);
  });

  describe('캐시 관리', () => {
    it('카탈로그 캐시 상태 조회', () => {
      // getCatalogCacheStatus는 배열을 반환함
      const status = downloader.getCatalogCacheStatus();

      expect(status).toBeDefined();
      expect(Array.isArray(status)).toBe(true);
    });

    it('카탈로그 캐시 삭제', () => {
      downloader.clearCatalogCache();

      // 삭제 후 캐시 상태 조회 시 빈 배열 반환
      const status = downloader.getCatalogCacheStatus();
      expect(status.length).toBe(0);
    });
  });
});
