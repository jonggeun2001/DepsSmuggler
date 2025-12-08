/**
 * OS Package Archive Packager
 * 다운로드한 OS 패키지를 아카이브로 패키징
 */

import * as fs from 'fs';
import * as path from 'path';
import * as archiver from 'archiver';
import type { OSPackageInfo, OSPackageManager, ArchiveFormat } from '../types';
import { OSScriptGenerator, type GeneratedScripts } from '../utils/script-generator';

/**
 * 아카이브 옵션
 */
export interface ArchiveOptions {
  /** 아카이브 형식 */
  format: ArchiveFormat;
  /** 출력 경로 */
  outputPath: string;
  /** 스크립트 포함 여부 */
  includeScripts: boolean;
  /** 포함할 스크립트 유형 */
  scriptTypes: ('dependency-order' | 'local-repo')[];
  /** 패키지 관리자 */
  packageManager: OSPackageManager;
  /** 저장소 이름 (로컬 저장소 스크립트용) */
  repoName?: string;
  /** 메타데이터 포함 여부 */
  includeMetadata?: boolean;
  /** README 포함 여부 */
  includeReadme?: boolean;
}

/**
 * 메타데이터 정보
 */
interface PackageMetadata {
  createdAt: string;
  packageManager: OSPackageManager;
  totalPackages: number;
  totalSize: number;
  packages: Array<{
    name: string;
    version: string;
    architecture: string;
    size: number;
    filename: string;
  }>;
}

/**
 * OS 아카이브 패키저
 */
export class OSArchivePackager {
  private scriptGenerator: OSScriptGenerator;

  constructor() {
    this.scriptGenerator = new OSScriptGenerator();
  }

  /**
   * 아카이브 생성
   */
  async createArchive(
    packages: OSPackageInfo[],
    downloadedFiles: Map<string, string>,
    options: ArchiveOptions
  ): Promise<string> {
    // 출력 디렉토리 확인
    const outputDir = path.dirname(options.outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // 아카이브 파일명 결정
    const archivePath = this.getArchivePath(options);

    // 아카이브 생성
    await this.buildArchive(packages, downloadedFiles, archivePath, options);

    return archivePath;
  }

  /**
   * 아카이브 경로 결정
   */
  private getArchivePath(options: ArchiveOptions): string {
    const ext = options.format === 'zip' ? '.zip' : '.tar.gz';

    if (options.outputPath.endsWith(ext)) {
      return options.outputPath;
    }

    return options.outputPath + ext;
  }

  /**
   * 아카이브 빌드
   */
  private async buildArchive(
    packages: OSPackageInfo[],
    downloadedFiles: Map<string, string>,
    archivePath: string,
    options: ArchiveOptions
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(archivePath);
      const archive = options.format === 'zip'
        ? archiver.default('zip', { zlib: { level: 9 } })
        : archiver.default('tar', { gzip: true, gzipOptions: { level: 9 } });

      output.on('close', () => resolve());
      archive.on('error', (err) => reject(err));

      archive.pipe(output);

      // 패키지 파일 추가
      this.addPackageFiles(archive, packages, downloadedFiles);

      // 스크립트 추가
      if (options.includeScripts) {
        this.addScripts(archive, packages, options);
      }

      // 메타데이터 추가
      if (options.includeMetadata !== false) {
        this.addMetadata(archive, packages, options);
      }

      // README 추가
      if (options.includeReadme !== false) {
        this.addReadme(archive, packages, options);
      }

      archive.finalize();
    });
  }

  /**
   * 패키지 파일 추가
   */
  private addPackageFiles(
    archive: archiver.Archiver,
    packages: OSPackageInfo[],
    downloadedFiles: Map<string, string>
  ): void {
    for (const pkg of packages) {
      const key = `${pkg.name}-${pkg.version}`;
      const filePath = downloadedFiles.get(key);

      if (filePath && fs.existsSync(filePath)) {
        const filename = path.basename(filePath);
        archive.file(filePath, { name: `packages/${filename}` });
      }
    }
  }

  /**
   * 스크립트 추가
   */
  private addScripts(
    archive: archiver.Archiver,
    packages: OSPackageInfo[],
    options: ArchiveOptions
  ): void {
    const scriptOptions = {
      repoName: options.repoName || 'depssmuggler-local',
      packageDir: './packages',
    };

    // 의존성 순서 설치 스크립트
    if (options.scriptTypes.includes('dependency-order')) {
      const installScripts = this.scriptGenerator.generateDependencyOrderScript(
        packages,
        options.packageManager,
        scriptOptions
      );

      archive.append(installScripts.bash, { name: 'install.sh', mode: 0o755 });
      archive.append(installScripts.powershell, { name: 'install.ps1' });
    }

    // 로컬 저장소 설정 스크립트
    if (options.scriptTypes.includes('local-repo')) {
      const repoScripts = this.scriptGenerator.generateLocalRepoScript(
        packages,
        options.packageManager,
        scriptOptions
      );

      archive.append(repoScripts.bash, { name: 'setup-repo.sh', mode: 0o755 });
      archive.append(repoScripts.powershell, { name: 'setup-repo.ps1' });
    }
  }

  /**
   * 메타데이터 추가
   */
  private addMetadata(
    archive: archiver.Archiver,
    packages: OSPackageInfo[],
    options: ArchiveOptions
  ): void {
    const metadata: PackageMetadata = {
      createdAt: new Date().toISOString(),
      packageManager: options.packageManager,
      totalPackages: packages.length,
      totalSize: packages.reduce((sum, pkg) => sum + pkg.size, 0),
      packages: packages.map((pkg) => ({
        name: pkg.name,
        version: pkg.version,
        architecture: pkg.architecture,
        size: pkg.size,
        filename: this.getPackageFilename(pkg, options.packageManager),
      })),
    };

    archive.append(JSON.stringify(metadata, null, 2), { name: 'metadata.json' });
  }

  /**
   * README 추가
   */
  private addReadme(
    archive: archiver.Archiver,
    packages: OSPackageInfo[],
    options: ArchiveOptions
  ): void {
    const pmName = this.getPackageManagerName(options.packageManager);
    const totalSize = this.formatSize(packages.reduce((sum, pkg) => sum + pkg.size, 0));

    const readme = `DepsSmuggler - OS 패키지 아카이브
================================

패키지 관리자: ${pmName}
패키지 수: ${packages.length}
총 크기: ${totalSize}
생성일: ${new Date().toLocaleString('ko-KR')}

디렉토리 구조
-----------
packages/     - 다운로드된 패키지 파일
install.sh    - 의존성 순서 설치 스크립트 (Linux/Mac)
install.ps1   - 설치 안내 스크립트 (Windows/WSL)
setup-repo.sh - 로컬 저장소 설정 스크립트 (Linux/Mac)
metadata.json - 패키지 메타데이터

사용 방법
--------

1. 직접 설치 (의존성 순서대로):
   $ chmod +x install.sh
   $ sudo ./install.sh

2. 로컬 저장소 설정 후 설치:
   $ chmod +x setup-repo.sh
   $ sudo ./setup-repo.sh
   ${this.getInstallExample(options.packageManager)}

Windows에서 사용
--------------
WSL(Windows Subsystem for Linux)이 필요합니다.
install.ps1 또는 setup-repo.ps1을 실행하면 WSL 설정을 안내합니다.

포함된 패키지
-----------
${packages.map((pkg) => `- ${pkg.name} ${pkg.version} (${pkg.architecture})`).join('\n')}

문제 발생 시
----------
로그 파일을 확인하거나 DepsSmuggler 문서를 참조하세요.
`;

    archive.append(readme, { name: 'README.txt' });
  }

  /**
   * 패키지 파일명 생성
   */
  private getPackageFilename(pkg: OSPackageInfo, pm: OSPackageManager): string {
    switch (pm) {
      case 'yum':
        return `${pkg.name}-${pkg.version}.${pkg.architecture}.rpm`;
      case 'apt':
        const arch = pkg.architecture === 'x86_64' ? 'amd64' : pkg.architecture;
        return `${pkg.name}_${pkg.version}_${arch}.deb`;
      case 'apk':
        return `${pkg.name}-${pkg.version}.apk`;
      default:
        return `${pkg.name}-${pkg.version}`;
    }
  }

  /**
   * 패키지 관리자 이름
   */
  private getPackageManagerName(pm: OSPackageManager): string {
    switch (pm) {
      case 'yum':
        return 'YUM/RPM (RHEL/CentOS/Rocky/Alma)';
      case 'apt':
        return 'APT/DEB (Ubuntu/Debian)';
      case 'apk':
        return 'APK (Alpine Linux)';
      default:
        return pm;
    }
  }

  /**
   * 설치 예시 명령
   */
  private getInstallExample(pm: OSPackageManager): string {
    switch (pm) {
      case 'yum':
        return '   $ yum install <패키지명>';
      case 'apt':
        return '   $ apt-get install <패키지명>';
      case 'apk':
        return '   $ apk add <패키지명>';
      default:
        return '';
    }
  }

  /**
   * 파일 크기 포맷
   */
  private formatSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }
}
