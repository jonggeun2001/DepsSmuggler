import archiver from 'archiver';
import * as tar from 'tar';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as zlib from 'zlib';
import { PackageInfo } from '../../types';
import logger from '../../utils/logger';
import { resolvePath, toUnixPath } from '../shared/path-utils';

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

// 패키지 매니페스트
export interface PackageManifest {
  version: string;
  createdAt: string;
  packages: PackageInfo[];
  totalSize: number;
  fileCount: number;
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
    const {
      format,
      compressionLevel = 6,
      includeManifest = true,
      includeReadme = true,
      onProgress,
    } = options;

    // 출력 디렉토리 생성
    await fs.ensureDir(path.dirname(outputPath));

    // 총 파일 크기 계산
    let totalBytes = 0;
    for (const file of files) {
      const stat = await fs.stat(file);
      totalBytes += stat.size;
    }

    // 임시 디렉토리 생성
    const tempDir = path.join(path.dirname(outputPath), `.temp-${Date.now()}`);
    await fs.ensureDir(tempDir);
    const packagesDir = path.join(tempDir, 'packages');
    await fs.ensureDir(packagesDir);

    try {
      // 파일 복사
      let processedBytes = 0;
      let processedFiles = 0;

      for (const file of files) {
        const destPath = path.join(packagesDir, path.basename(file));
        await fs.copy(file, destPath);

        const stat = await fs.stat(file);
        processedBytes += stat.size;
        processedFiles++;

        if (onProgress) {
          onProgress({
            processedFiles,
            totalFiles: files.length,
            processedBytes,
            totalBytes,
            percentage: (processedBytes / totalBytes) * 100,
          });
        }
      }

      // 매니페스트 생성
      if (includeManifest) {
        const manifest = this.createManifest(packages, totalBytes, files.length);
        await fs.writeJson(
          path.join(tempDir, 'manifest.json'),
          manifest,
          { spaces: 2 }
        );
      }

      // README 생성
      if (includeReadme) {
        const readme = this.createReadme(packages);
        await fs.writeFile(path.join(tempDir, 'README.txt'), readme, 'utf-8');
      }

      // 압축 실행
      if (format === 'zip') {
        await this.createZip(tempDir, outputPath, compressionLevel);
      } else {
        await this.createTarGz(tempDir, outputPath, compressionLevel);
      }

      logger.info('압축 파일 생성 완료', {
        outputPath,
        format,
        fileCount: files.length,
        totalBytes,
      });

      return outputPath;
    } finally {
      // 임시 디렉토리 삭제
      await fs.remove(tempDir);
    }
  }

  /**
   * ZIP 압축 파일 생성
   * ZIP 표준에서는 경로 구분자로 forward slash(/)만 허용
   */
  private async createZip(
    sourceDir: string,
    outputPath: string,
    compressionLevel: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // 경로 정규화
      const normalizedSourceDir = resolvePath(sourceDir);
      const normalizedOutputPath = resolvePath(outputPath);

      const output = fs.createWriteStream(normalizedOutputPath);
      const archive = archiver('zip', {
        zlib: { level: compressionLevel },
      });

      output.on('close', () => resolve());
      archive.on('error', (err) => reject(err));

      archive.pipe(output);
      // archiver는 내부적으로 경로를 처리하지만, 명시적으로 정규화된 경로 사용
      archive.directory(normalizedSourceDir, false);
      archive.finalize();
    });
  }

  /**
   * TAR.GZ 압축 파일 생성
   */
  private async createTarGz(
    sourceDir: string,
    outputPath: string,
    compressionLevel: number
  ): Promise<void> {
    const files = await fs.readdir(sourceDir);

    await tar.create(
      {
        gzip: { level: compressionLevel },
        file: outputPath,
        cwd: sourceDir,
      },
      files
    );
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
