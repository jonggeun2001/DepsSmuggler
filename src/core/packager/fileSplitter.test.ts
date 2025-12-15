/**
 * FileSplitter 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { getFileSplitter, FileSplitter } from './fileSplitter';

describe('FileSplitter', () => {
  let splitter: FileSplitter;
  let tempDir: string;

  beforeEach(async () => {
    splitter = getFileSplitter();
    // 각 테스트마다 고유한 임시 디렉토리 생성
    tempDir = path.join(os.tmpdir(), `splitter-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.ensureDir(tempDir);
  });

  afterEach(async () => {
    // 임시 디렉토리 정리
    if (tempDir && await fs.pathExists(tempDir)) {
      await fs.remove(tempDir);
    }
  });

  describe('getFileSplitter', () => {
    it('싱글톤 인스턴스를 반환해야 함', () => {
      const instance1 = getFileSplitter();
      const instance2 = getFileSplitter();
      expect(instance1).toBe(instance2);
    });

    it('FileSplitter 인스턴스를 반환해야 함', () => {
      const instance = getFileSplitter();
      expect(instance).toBeInstanceOf(FileSplitter);
    });
  });

  describe('needsSplit', () => {
    it('기본 크기보다 큰 파일은 분할이 필요함', async () => {
      // 기본 분할 크기는 25MB, 30MB 파일 생성
      const testFile = path.join(tempDir, 'large-for-split.bin');
      const content = Buffer.alloc(30 * 1024 * 1024);
      await fs.writeFile(testFile, content);

      expect(await splitter.needsSplit(testFile)).toBe(true);
    });

    it('기본 크기보다 작은 파일은 분할이 필요 없음', async () => {
      const testFile = path.join(tempDir, 'small-for-split.bin');
      const content = Buffer.alloc(10 * 1024 * 1024);
      await fs.writeFile(testFile, content);

      expect(await splitter.needsSplit(testFile)).toBe(false);
    });

    it('커스텀 크기로 분할 필요 여부 확인', async () => {
      const testFile = path.join(tempDir, 'custom-split.bin');
      const content = Buffer.alloc(15 * 1024 * 1024); // 15MB
      await fs.writeFile(testFile, content);

      expect(await splitter.needsSplit(testFile, 10)).toBe(true); // 10MB 기준, 분할 필요
      expect(await splitter.needsSplit(testFile, 20)).toBe(false); // 20MB 기준, 분할 불필요
    });

    it('정확히 경계 크기일 때 분할 불필요', async () => {
      const testFile = path.join(tempDir, 'boundary-split.bin');
      const content = Buffer.alloc(25 * 1024 * 1024); // 정확히 25MB
      await fs.writeFile(testFile, content);

      expect(await splitter.needsSplit(testFile)).toBe(false);
    });
  });

  describe('estimatePartCount', () => {
    it('파일 크기에 따른 분할 파트 수 계산', async () => {
      const testFile = path.join(tempDir, 'estimate-50mb.bin');
      const content = Buffer.alloc(50 * 1024 * 1024); // 50MB
      await fs.writeFile(testFile, content);

      expect(await splitter.estimatePartCount(testFile)).toBe(2);
    });

    it('나누어 떨어지지 않으면 올림', async () => {
      const testFile = path.join(tempDir, 'estimate-60mb.bin');
      const content = Buffer.alloc(60 * 1024 * 1024); // 60MB → 3 파트
      await fs.writeFile(testFile, content);

      expect(await splitter.estimatePartCount(testFile)).toBe(3);
    });

    it('커스텀 크기로 파트 수 계산', async () => {
      const testFile = path.join(tempDir, 'estimate-100mb.bin');
      const content = Buffer.alloc(100 * 1024 * 1024); // 100MB
      await fs.writeFile(testFile, content);

      expect(await splitter.estimatePartCount(testFile, 10)).toBe(10);
    });

    it('분할 크기보다 작은 파일은 1파트', async () => {
      const testFile = path.join(tempDir, 'estimate-10mb.bin');
      const content = Buffer.alloc(10 * 1024 * 1024); // 10MB
      await fs.writeFile(testFile, content);

      expect(await splitter.estimatePartCount(testFile)).toBe(1);
    });
  });

  describe('splitFile', () => {
    it('분할 크기보다 작은 파일은 분할하지 않음', async () => {
      const testFile = path.join(tempDir, 'small.txt');
      await fs.writeFile(testFile, 'small content');

      const result = await splitter.splitFile(testFile, { maxSizeMB: 1 });

      expect(result.parts.length).toBe(1);
      expect(result.metadata.partCount).toBe(1);
      expect(result.metadata.originalFileName).toBe('small.txt');
    });

    it('큰 파일을 여러 파트로 분할해야 함', async () => {
      // 3MB 파일 생성 (1MB 단위로 분할 시 3파트)
      const testFile = path.join(tempDir, 'large.bin');
      const content = Buffer.alloc(3 * 1024 * 1024);
      crypto.randomFillSync(content);
      await fs.writeFile(testFile, content);

      const result = await splitter.splitFile(testFile, { maxSizeMB: 1 });

      expect(result.parts.length).toBe(3);
      expect(result.metadata.partCount).toBe(3);
      expect(result.metadata.checksum).toBeDefined();
    });

    it('진행률 콜백이 호출되어야 함', async () => {
      const testFile = path.join(tempDir, 'progress.bin');
      const content = Buffer.alloc(2 * 1024 * 1024);
      await fs.writeFile(testFile, content);

      const progressCalls: number[] = [];

      await splitter.splitFile(testFile, {
        maxSizeMB: 1,
        onProgress: (progress) => {
          progressCalls.push(progress.currentPart);
        },
      });

      expect(progressCalls.length).toBeGreaterThan(0);
    });

    it('존재하지 않는 파일에 대해 에러 발생', async () => {
      const nonExistent = path.join(tempDir, 'nonexistent.txt');

      await expect(splitter.splitFile(nonExistent))
        .rejects.toThrow('파일을 찾을 수 없습니다');
    });

    it('병합 스크립트를 생성해야 함', async () => {
      const testFile = path.join(tempDir, 'script-test.bin');
      const content = Buffer.alloc(2 * 1024 * 1024);
      await fs.writeFile(testFile, content);

      const result = await splitter.splitFile(testFile, {
        maxSizeMB: 1,
        generateMergeScripts: true,
      });

      expect(result.mergeScripts).toBeDefined();
      if (result.mergeScripts) {
        expect(result.mergeScripts.bash).toBeDefined();
        expect(result.mergeScripts.powershell).toBeDefined();
      }
    });

    it('메타데이터에 올바른 정보가 포함되어야 함', async () => {
      const testFile = path.join(tempDir, 'metadata.bin');
      const content = Buffer.alloc(1024);
      await fs.writeFile(testFile, content);

      const result = await splitter.splitFile(testFile);

      expect(result.metadata).toMatchObject({
        originalFileName: 'metadata.bin',
        originalSize: 1024,
        partCount: 1,
      });
      expect(result.metadata.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(result.metadata.createdAt).toBeDefined();
    });
  });

  describe('joinFiles', () => {
    it('분할된 파일을 병합해야 함', async () => {
      // 원본 파일 생성
      const originalFile = path.join(tempDir, 'original.bin');
      const content = Buffer.alloc(2 * 1024 * 1024);
      crypto.randomFillSync(content);
      await fs.writeFile(originalFile, content);

      // 분할
      const splitResult = await splitter.splitFile(originalFile, { maxSizeMB: 1 });

      // 메타데이터 파일 생성
      const metadataPath = path.join(tempDir, 'original.bin.meta.json');
      await fs.writeJson(metadataPath, splitResult.metadata);

      // 원본 삭제
      await fs.remove(originalFile);

      // 병합 (outputPath 명시)
      const outputPath = path.join(tempDir, 'merged-original.bin');
      const joinedFile = await splitter.joinFiles(metadataPath, outputPath);

      // 파일이 생성되었는지 확인
      expect(await fs.pathExists(joinedFile)).toBe(true);

      // 크기 확인
      const joinedStat = await fs.stat(joinedFile);
      expect(joinedStat.size).toBe(splitResult.metadata.originalSize);
    });

    it('존재하지 않는 메타데이터 파일에 대해 에러 발생', async () => {
      const nonExistent = path.join(tempDir, 'nonexistent.meta.json');
      const outputPath = path.join(tempDir, 'output.bin');

      await expect(splitter.joinFiles(nonExistent, outputPath))
        .rejects.toThrow();
    });

    it('병합 진행률 콜백이 호출되어야 함', async () => {
      const originalFile = path.join(tempDir, 'join-progress.bin');
      const content = Buffer.alloc(2 * 1024 * 1024);
      await fs.writeFile(originalFile, content);

      const splitResult = await splitter.splitFile(originalFile, { maxSizeMB: 1 });
      const metadataPath = path.join(tempDir, 'join-progress.bin.meta.json');
      await fs.writeJson(metadataPath, splitResult.metadata);
      await fs.remove(originalFile);

      const progressCalls: number[] = [];
      const outputPath = path.join(tempDir, 'merged-join-progress.bin');

      await splitter.joinFiles(metadataPath, outputPath, (progress) => {
        progressCalls.push(progress.percentage);
      });

      expect(progressCalls.length).toBeGreaterThan(0);
    });
  });

  describe('통합 테스트 - 분할 및 병합', () => {
    it('분할 후 병합된 파일이 원본과 동일해야 함', async () => {
      // 원본 파일 생성
      const originalFile = path.join(tempDir, 'roundtrip.bin');
      const originalContent = Buffer.alloc(3 * 1024 * 1024);
      crypto.randomFillSync(originalContent);
      await fs.writeFile(originalFile, originalContent);

      // 원본 체크섬 계산
      const originalHash = crypto.createHash('sha256').update(originalContent).digest('hex');

      // 분할
      const splitResult = await splitter.splitFile(originalFile, { maxSizeMB: 1 });
      expect(splitResult.metadata.checksum).toBe(originalHash);

      // 메타데이터 저장
      const metadataPath = path.join(tempDir, 'roundtrip.bin.meta.json');
      await fs.writeJson(metadataPath, splitResult.metadata);

      // 원본 삭제
      await fs.remove(originalFile);

      // 병합 (outputPath 명시)
      const outputPath = path.join(tempDir, 'merged-roundtrip.bin');
      const joinedFile = await splitter.joinFiles(metadataPath, outputPath);

      // 병합된 파일 내용 검증
      const joinedContent = await fs.readFile(joinedFile);
      const joinedHash = crypto.createHash('sha256').update(joinedContent).digest('hex');

      expect(joinedHash).toBe(originalHash);
      expect(joinedContent.equals(originalContent)).toBe(true);
    });
  });
});
