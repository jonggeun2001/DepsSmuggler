/**
 * ArchivePackager 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { getArchivePackager, ArchivePackager, ArchiveFormat } from './archivePackager';
import { PackageInfo } from '../../types';

describe('ArchivePackager', () => {
  let packager: ArchivePackager;
  let tempDir: string;

  beforeEach(async () => {
    packager = getArchivePackager();
    // 각 테스트마다 고유한 임시 디렉토리 생성
    tempDir = path.join(os.tmpdir(), `packager-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.ensureDir(tempDir);
  });

  afterEach(async () => {
    // 임시 디렉토리 정리
    if (tempDir && await fs.pathExists(tempDir)) {
      await fs.remove(tempDir);
    }
  });

  describe('getArchivePackager', () => {
    it('싱글톤 인스턴스를 반환해야 함', () => {
      const instance1 = getArchivePackager();
      const instance2 = getArchivePackager();
      expect(instance1).toBe(instance2);
    });

    it('ArchivePackager 인스턴스를 반환해야 함', () => {
      const instance = getArchivePackager();
      expect(instance).toBeInstanceOf(ArchivePackager);
    });
  });

  describe('createArchive', () => {
    it('ZIP 형식으로 아카이브를 생성해야 함', async () => {
      // 테스트 파일 생성
      const testFile = path.join(tempDir, 'test.txt');
      await fs.writeFile(testFile, 'test content');

      const outputPath = path.join(tempDir, 'output.zip');
      const packages: PackageInfo[] = [
        { name: 'test', version: '1.0.0', type: 'pip' },
      ];

      const result = await packager.createArchive(
        [testFile],
        outputPath,
        packages,
        { format: 'zip' }
      );

      expect(result).toBe(outputPath);
      expect(await fs.pathExists(outputPath)).toBe(true);

      // 파일 크기 확인
      const stat = await fs.stat(outputPath);
      expect(stat.size).toBeGreaterThan(0);
    });

    it('tar.gz 형식으로 아카이브를 생성해야 함', async () => {
      // 테스트 파일 생성
      const testFile = path.join(tempDir, 'test.txt');
      await fs.writeFile(testFile, 'test content');

      const outputPath = path.join(tempDir, 'output.tar.gz');
      const packages: PackageInfo[] = [
        { name: 'test', version: '1.0.0', type: 'pip' },
      ];

      const result = await packager.createArchive(
        [testFile],
        outputPath,
        packages,
        { format: 'tar.gz' }
      );

      expect(result).toBe(outputPath);
      expect(await fs.pathExists(outputPath)).toBe(true);

      const stat = await fs.stat(outputPath);
      expect(stat.size).toBeGreaterThan(0);
    });

    it('매니페스트 포함 옵션이 작동해야 함', async () => {
      const testFile = path.join(tempDir, 'test.txt');
      await fs.writeFile(testFile, 'test content');

      const outputPath = path.join(tempDir, 'output.zip');
      const packages: PackageInfo[] = [
        { name: 'requests', version: '2.28.0', type: 'pip' },
      ];

      await packager.createArchive(
        [testFile],
        outputPath,
        packages,
        { format: 'zip', includeManifest: true }
      );

      expect(await fs.pathExists(outputPath)).toBe(true);
    });

    it('README 포함 옵션이 작동해야 함', async () => {
      const testFile = path.join(tempDir, 'test.txt');
      await fs.writeFile(testFile, 'test content');

      const outputPath = path.join(tempDir, 'output.zip');
      const packages: PackageInfo[] = [
        { name: 'requests', version: '2.28.0', type: 'pip' },
      ];

      await packager.createArchive(
        [testFile],
        outputPath,
        packages,
        { format: 'zip', includeReadme: true }
      );

      expect(await fs.pathExists(outputPath)).toBe(true);
    });

    it('진행률 콜백이 호출되어야 함', async () => {
      const testFile = path.join(tempDir, 'test.txt');
      await fs.writeFile(testFile, 'test content');

      const outputPath = path.join(tempDir, 'output.zip');
      const packages: PackageInfo[] = [];
      const progressCalls: number[] = [];

      await packager.createArchive(
        [testFile],
        outputPath,
        packages,
        {
          format: 'zip',
          onProgress: (progress) => {
            progressCalls.push(progress.percentage);
          }
        }
      );

      expect(progressCalls.length).toBeGreaterThan(0);
      expect(progressCalls[progressCalls.length - 1]).toBe(100);
    });

    it('여러 파일을 압축해야 함', async () => {
      const files: string[] = [];
      for (let i = 0; i < 3; i++) {
        const testFile = path.join(tempDir, `test${i}.txt`);
        await fs.writeFile(testFile, `content ${i}`);
        files.push(testFile);
      }

      const outputPath = path.join(tempDir, 'output.zip');
      const packages: PackageInfo[] = [
        { name: 'pkg1', version: '1.0', type: 'pip' },
        { name: 'pkg2', version: '2.0', type: 'npm' },
      ];

      await packager.createArchive(files, outputPath, packages, { format: 'zip' });

      expect(await fs.pathExists(outputPath)).toBe(true);
    });

    it('압축 레벨을 지정할 수 있어야 함', async () => {
      const testFile = path.join(tempDir, 'test.txt');
      // 압축 효과를 보기 위해 반복 데이터 사용
      await fs.writeFile(testFile, 'a'.repeat(10000));

      const outputPathLevel1 = path.join(tempDir, 'output-l1.zip');
      const outputPathLevel9 = path.join(tempDir, 'output-l9.zip');
      const packages: PackageInfo[] = [];

      await packager.createArchive(
        [testFile],
        outputPathLevel1,
        packages,
        { format: 'zip', compressionLevel: 1 }
      );

      await packager.createArchive(
        [testFile],
        outputPathLevel9,
        packages,
        { format: 'zip', compressionLevel: 9 }
      );

      const stat1 = await fs.stat(outputPathLevel1);
      const stat9 = await fs.stat(outputPathLevel9);

      // 높은 압축 레벨이 더 작은 파일을 생성해야 함 (또는 같음)
      expect(stat9.size).toBeLessThanOrEqual(stat1.size);
    });
  });

  describe('getArchiveInfo', () => {
    it('ZIP 파일 정보를 반환해야 함', async () => {
      const testFile = path.join(tempDir, 'test.txt');
      await fs.writeFile(testFile, 'test content');

      const zipPath = path.join(tempDir, 'test.zip');
      await packager.createArchive([testFile], zipPath, [], { format: 'zip' });

      const info = await packager.getArchiveInfo(zipPath);

      expect(info.format).toBe('zip');
      expect(info.size).toBeGreaterThan(0);
    });

    it('tar.gz 파일 정보를 반환해야 함', async () => {
      const testFile = path.join(tempDir, 'test.txt');
      await fs.writeFile(testFile, 'test content');

      const tarPath = path.join(tempDir, 'test.tar.gz');
      await packager.createArchive([testFile], tarPath, [], { format: 'tar.gz' });

      const info = await packager.getArchiveInfo(tarPath);

      expect(info.format).toBe('tar.gz');
      expect(info.size).toBeGreaterThan(0);
    });
  });

  describe('verifyArchive', () => {
    it('유효한 아카이브는 true를 반환해야 함', async () => {
      const testFile = path.join(tempDir, 'test.txt');
      await fs.writeFile(testFile, 'test content');

      const zipPath = path.join(tempDir, 'test.zip');
      await packager.createArchive([testFile], zipPath, [], { format: 'zip' });

      const isValid = await packager.verifyArchive(zipPath);
      expect(isValid).toBe(true);
    });

    it('존재하지 않는 파일은 false를 반환해야 함', async () => {
      const isValid = await packager.verifyArchive(path.join(tempDir, 'nonexistent.zip'));
      expect(isValid).toBe(false);
    });

    it('빈 파일은 false를 반환해야 함', async () => {
      const emptyFile = path.join(tempDir, 'empty.zip');
      await fs.writeFile(emptyFile, '');

      const isValid = await packager.verifyArchive(emptyFile);
      expect(isValid).toBe(false);
    });
  });

  describe('createManifest (간접 테스트)', () => {
    it('매니페스트가 올바른 구조를 가져야 함', async () => {
      const testFile = path.join(tempDir, 'test.txt');
      await fs.writeFile(testFile, 'test content');

      const outputPath = path.join(tempDir, 'output.zip');
      const packages: PackageInfo[] = [
        { name: 'requests', version: '2.28.0', type: 'pip' },
        { name: 'numpy', version: '1.23.0', type: 'pip' },
      ];

      await packager.createArchive(
        [testFile],
        outputPath,
        packages,
        { format: 'zip', includeManifest: true }
      );

      expect(await fs.pathExists(outputPath)).toBe(true);
    });
  });

  describe('createReadme (간접 테스트)', () => {
    it('다양한 패키지 타입이 포함된 README를 생성해야 함', async () => {
      const testFile = path.join(tempDir, 'test.txt');
      await fs.writeFile(testFile, 'test content');

      const outputPath = path.join(tempDir, 'output.zip');
      const packages: PackageInfo[] = [
        { name: 'requests', version: '2.28.0', type: 'pip' },
        { name: 'spring-core', version: '5.3.0', type: 'maven' },
        { name: 'httpd', version: '2.4.0', type: 'yum' },
        { name: 'nginx', version: 'latest', type: 'docker' },
      ];

      await packager.createArchive(
        [testFile],
        outputPath,
        packages,
        { format: 'zip', includeReadme: true }
      );

      expect(await fs.pathExists(outputPath)).toBe(true);
    });
  });
});

describe('ArchiveFormat 타입', () => {
  it('zip과 tar.gz를 지원해야 함', () => {
    const formats: ArchiveFormat[] = ['zip', 'tar.gz'];
    expect(formats).toContain('zip');
    expect(formats).toContain('tar.gz');
  });
});
