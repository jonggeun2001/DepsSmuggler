import archiver from 'archiver';
import * as fs from 'fs-extra';
import * as path from 'path';
import { PackageInfo } from '../../types';
import type { PackageManifest } from '../../types/manifest/package-manifest';
import logger from '../../utils/logger';
import { resolvePath, toUnixPath } from '../shared/path-utils';

export type { PackageManifest } from '../../types/manifest/package-manifest';

// 압축 형식 타입
export type ArchiveFormat = 'zip' | 'tar.gz';

// 압축 옵션
export interface ArchiveOptions {
  format: ArchiveFormat;
  compressionLevel?: number; // 0-9
  includeManifest?: boolean;
  includeReadme?: boolean;
  onProgress?: (progress: ArchiveProgress) => void;
}

// 압축 진행률
export interface ArchiveProgress {
  processedFiles: number;
  totalFiles: number;
  processedBytes: number;
  totalBytes: number;
  percentage: number;
}

export class ArchivePackager {
  /**
   * 압축 파일 생성
   */
  async createArchive(
    files: string[],
    outputPath: string,
    packages: PackageInfo[],
    options: ArchiveOptions
  ): Promise<string> {
    const fileEntries = files.map((file) => ({
      sourcePath: file,
      archivePath: path.posix.join('packages', path.basename(file)),
    }));

    return this.createArchiveFromFileEntries(fileEntries, outputPath, packages, options);
  }

  /**
   * 준비된 디렉터리를 그대로 보존하면서 압축 파일 생성
   */
  async createArchiveFromDirectory(
    sourceDir: string,
    outputPath: string,
    packages: PackageInfo[],
    options: ArchiveOptions
  ): Promise<string> {
    const sourceFiles = await this.collectFiles(sourceDir);
    const { totalBytes, totalFiles } = await this.reportPreparationProgress(sourceFiles, options.onProgress);
    const metadataEntries = this.buildMetadataEntries(
      packages,
      totalBytes,
      totalFiles,
      options.includeManifest,
      options.includeReadme
    );

    await fs.ensureDir(path.dirname(outputPath));

    if (options.format === 'zip') {
      await this.createZipFromDirectory(sourceDir, outputPath, options.compressionLevel ?? 6, metadataEntries);
    } else {
      await this.createTarGzFromDirectory(sourceDir, outputPath, options.compressionLevel ?? 6, metadataEntries);
    }

    logger.info('압축 파일 생성 완료', {
      outputPath,
      format: options.format,
      fileCount: totalFiles,
      totalBytes,
    });

    return outputPath;
  }

  /**
   * ZIP 압축 파일 생성
   * ZIP 표준에서는 경로 구분자로 forward slash(/)만 허용
   */
  private async createZipFromDirectory(
    sourceDir: string,
    outputPath: string,
    compressionLevel: number,
    metadataEntries: Array<{ name: string; content: string }>
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const normalizedSourceDir = resolvePath(sourceDir);
      const normalizedOutputPath = resolvePath(outputPath);

      const output = fs.createWriteStream(normalizedOutputPath);
      const archive = archiver('zip', {
        zlib: { level: compressionLevel },
      });

      output.on('close', () => resolve());
      output.on('error', (err) => reject(err));
      archive.on('error', (err) => reject(err));

      archive.pipe(output);
      archive.directory(normalizedSourceDir, false);
      for (const entry of metadataEntries) {
        archive.append(entry.content, { name: entry.name });
      }
      archive.finalize();
    });
  }

  /**
   * TAR.GZ 압축 파일 생성
   */
  private async createTarGzFromDirectory(
    sourceDir: string,
    outputPath: string,
    compressionLevel: number,
    metadataEntries: Array<{ name: string; content: string }>
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const normalizedSourceDir = resolvePath(sourceDir);
      const normalizedOutputPath = resolvePath(outputPath);

      const output = fs.createWriteStream(normalizedOutputPath);
      const archive = archiver('tar', {
        gzip: true,
        gzipOptions: { level: compressionLevel },
      });

      output.on('close', () => resolve());
      output.on('error', (err) => reject(err));
      archive.on('error', (err) => reject(err));

      archive.pipe(output);
      archive.directory(normalizedSourceDir, false);
      for (const entry of metadataEntries) {
        archive.append(entry.content, { name: entry.name });
      }
      archive.finalize();
    });
  }

  private async collectFiles(sourceDir: string): Promise<string[]> {
    const entries = await fs.readdir(sourceDir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(sourceDir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await this.collectFiles(fullPath));
      } else {
        files.push(fullPath);
      }
    }

    return files;
  }

  private async createArchiveFromFileEntries(
    files: Array<{ sourcePath: string; archivePath: string }>,
    outputPath: string,
    packages: PackageInfo[],
    options: ArchiveOptions
  ): Promise<string> {
    const { totalBytes, totalFiles } = await this.reportPreparationProgress(
      files.map((file) => file.sourcePath),
      options.onProgress
    );
    const metadataEntries = this.buildMetadataEntries(
      packages,
      totalBytes,
      totalFiles,
      options.includeManifest,
      options.includeReadme
    );

    await fs.ensureDir(path.dirname(outputPath));

    if (options.format === 'zip') {
      await this.createZipFromFileEntries(files, outputPath, options.compressionLevel ?? 6, metadataEntries);
    } else {
      await this.createTarGzFromFileEntries(files, outputPath, options.compressionLevel ?? 6, metadataEntries);
    }

    logger.info('압축 파일 생성 완료', {
      outputPath,
      format: options.format,
      fileCount: totalFiles,
      totalBytes,
    });

    return outputPath;
  }

  private async reportPreparationProgress(
    files: string[],
    onProgress?: (progress: ArchiveProgress) => void
  ): Promise<{ totalBytes: number; totalFiles: number }> {
    let totalBytes = 0;
    const sizes: number[] = [];

    for (const file of files) {
      const stat = await fs.stat(file);
      sizes.push(stat.size);
      totalBytes += stat.size;
    }

    if (onProgress && files.length > 0) {
      let processedBytes = 0;
      files.forEach((_, index) => {
        processedBytes += sizes[index];
        onProgress({
          processedFiles: index + 1,
          totalFiles: files.length,
          processedBytes,
          totalBytes,
          percentage: totalBytes === 0 ? 100 : (processedBytes / totalBytes) * 100,
        });
      });
    }

    return { totalBytes, totalFiles: files.length };
  }

  private buildMetadataEntries(
    packages: PackageInfo[],
    totalBytes: number,
    fileCount: number,
    includeManifest = true,
    includeReadme = true
  ): Array<{ name: string; content: string }> {
    const metadataEntries: Array<{ name: string; content: string }> = [];

    if (includeManifest) {
      metadataEntries.push({
        name: 'manifest.json',
        content: JSON.stringify(this.createManifest(packages, totalBytes, fileCount), null, 2),
      });
    }

    if (includeReadme) {
      metadataEntries.push({
        name: 'README.txt',
        content: this.createReadme(packages),
      });
    }

    return metadataEntries;
  }

  private async createZipFromFileEntries(
    files: Array<{ sourcePath: string; archivePath: string }>,
    outputPath: string,
    compressionLevel: number,
    metadataEntries: Array<{ name: string; content: string }>
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(resolvePath(outputPath));
      const archive = archiver('zip', {
        zlib: { level: compressionLevel },
      });

      output.on('close', () => resolve());
      output.on('error', (err) => reject(err));
      archive.on('error', (err) => reject(err));

      archive.pipe(output);
      for (const file of files) {
        archive.file(resolvePath(file.sourcePath), { name: toUnixPath(file.archivePath) });
      }
      for (const entry of metadataEntries) {
        archive.append(entry.content, { name: entry.name });
      }
      archive.finalize();
    });
  }

  private async createTarGzFromFileEntries(
    files: Array<{ sourcePath: string; archivePath: string }>,
    outputPath: string,
    compressionLevel: number,
    metadataEntries: Array<{ name: string; content: string }>
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(resolvePath(outputPath));
      const archive = archiver('tar', {
        gzip: true,
        gzipOptions: { level: compressionLevel },
      });

      output.on('close', () => resolve());
      output.on('error', (err) => reject(err));
      archive.on('error', (err) => reject(err));

      archive.pipe(output);
      for (const file of files) {
        archive.file(resolvePath(file.sourcePath), { name: toUnixPath(file.archivePath) });
      }
      for (const entry of metadataEntries) {
        archive.append(entry.content, { name: entry.name });
      }
      archive.finalize();
    });
  }

  /**
   * 매니페스트 생성
   */
  private createManifest(
    packages: PackageInfo[],
    totalSize: number,
    fileCount: number
  ): PackageManifest {
    return {
      version: '1.0',
      createdAt: new Date().toISOString(),
      packages,
      totalSize,
      fileCount,
    };
  }

  /**
   * README 생성
   */
  private createReadme(packages: PackageInfo[]): string {
    const lines: string[] = [
      '================================================================================',
      '                        DepsSmuggler 패키지 아카이브',
      '================================================================================',
      '',
      '생성 일시: ' + new Date().toLocaleString('ko-KR'),
      '',
      '--------------------------------------------------------------------------------',
      '                              패키지 목록',
      '--------------------------------------------------------------------------------',
      '',
    ];

    // 타입별로 그룹화
    const grouped = new Map<string, PackageInfo[]>();
    for (const pkg of packages) {
      const group = grouped.get(pkg.type) || [];
      group.push(pkg);
      grouped.set(pkg.type, group);
    }

    for (const [type, pkgs] of grouped) {
      lines.push(`[${type.toUpperCase()}]`);
      for (const pkg of pkgs) {
        lines.push(`  - ${pkg.name}@${pkg.version}${pkg.arch ? ` (${pkg.arch})` : ''}`);
      }
      lines.push('');
    }

    lines.push('--------------------------------------------------------------------------------');
    lines.push('                              설치 방법');
    lines.push('--------------------------------------------------------------------------------');
    lines.push('');

    // 타입별 설치 방법
    if (grouped.has('pip') || grouped.has('conda')) {
      lines.push('[Python 패키지]');
      lines.push('  pip install --no-index --find-links=./packages <패키지명>');
      lines.push('  또는');
      lines.push('  pip install --no-index --find-links=./packages -r requirements.txt');
      lines.push('');
    }

    if (grouped.has('maven')) {
      lines.push('[Maven 패키지]');
      lines.push('  1. settings.xml에 로컬 저장소 추가:');
      lines.push('     <localRepository>/path/to/packages</localRepository>');
      lines.push('  2. 오프라인 모드로 빌드:');
      lines.push('     mvn install -o');
      lines.push('');
    }

    if (grouped.has('yum')) {
      lines.push('[YUM/RPM 패키지]');
      lines.push('  yum localinstall -y ./packages/*.rpm');
      lines.push('  또는');
      lines.push('  rpm -ivh ./packages/*.rpm');
      lines.push('');
    }

    if (grouped.has('docker')) {
      lines.push('[Docker 이미지]');
      lines.push('  docker load -i ./packages/<이미지명>.tar');
      lines.push('');
    }

    lines.push('--------------------------------------------------------------------------------');
    lines.push('                              스크립트 실행');
    lines.push('--------------------------------------------------------------------------------');
    lines.push('');
    lines.push('[Windows]');
    lines.push('  - PowerShell 스크립트 (.ps1):');
    lines.push('    Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser');
    lines.push('    .\\install.ps1');
    lines.push('');
    lines.push('  - Bash 스크립트 (.sh): Git Bash 또는 WSL 필요');
    lines.push('    bash install.sh');
    lines.push('');
    lines.push('[Linux/macOS]');
    lines.push('  chmod +x install.sh');
    lines.push('  ./install.sh');
    lines.push('');

    lines.push('================================================================================');
    lines.push('                    DepsSmuggler - 폐쇄망을 위한 패키지 다운로더');
    lines.push('                    https://github.com/jonggeun2001/DepsSmuggler');
    lines.push('================================================================================');

    return lines.join('\n');
  }

  /**
   * 아카이브 정보 조회
   */
  async getArchiveInfo(archivePath: string): Promise<{
    format: ArchiveFormat;
    size: number;
    fileCount: number;
  }> {
    const stat = await fs.stat(archivePath);
    const ext = path.extname(archivePath).toLowerCase();

    let format: ArchiveFormat = 'zip';
    if (ext === '.gz' || archivePath.endsWith('.tar.gz')) {
      format = 'tar.gz';
    }

    // 파일 수는 추정값 (실제로는 압축 해제 필요)
    return {
      format,
      size: stat.size,
      fileCount: 0, // 실제 구현 시 압축 해제하여 카운트
    };
  }

  /**
   * 아카이브 유효성 검증
   */
  async verifyArchive(archivePath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(archivePath);
      return stat.size > 0;
    } catch {
      return false;
    }
  }
}

// 싱글톤 인스턴스
let archivePackagerInstance: ArchivePackager | null = null;

export function getArchivePackager(): ArchivePackager {
  if (!archivePackagerInstance) {
    archivePackagerInstance = new ArchivePackager();
  }
  return archivePackagerInstance;
}
