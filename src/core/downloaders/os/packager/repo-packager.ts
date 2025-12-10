/**
 * OS Package Repository Packager
 * 다운로드한 OS 패키지를 로컬 저장소 구조로 패키징
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { promisify } from 'util';
import type { OSPackageInfo, OSPackageManager } from '../types';
import { OSScriptGenerator } from '../utils/script-generator';
import { getWriteOptions } from '../../../shared/path-utils';

const gzip = promisify(zlib.gzip);

/**
 * 저장소 옵션
 */
export interface RepoOptions {
  /** 패키지 관리자 */
  packageManager: OSPackageManager;
  /** 출력 경로 */
  outputPath: string;
  /** 저장소 이름 */
  repoName: string;
  /** 설정 스크립트 포함 여부 */
  includeSetupScript?: boolean;
}

/**
 * 저장소 생성 결과
 */
export interface RepoResult {
  /** 저장소 경로 */
  repoPath: string;
  /** 패키지 수 */
  packageCount: number;
  /** 총 크기 */
  totalSize: number;
  /** 생성된 메타데이터 파일 */
  metadataFiles: string[];
}

/**
 * OS 로컬 저장소 패키저
 */
export class OSRepoPackager {
  private scriptGenerator: OSScriptGenerator;

  constructor() {
    this.scriptGenerator = new OSScriptGenerator();
  }

  /**
   * 로컬 저장소 생성
   */
  async createLocalRepo(
    packages: OSPackageInfo[],
    downloadedFiles: Map<string, string>,
    options: RepoOptions
  ): Promise<RepoResult> {
    // 저장소 디렉토리 생성
    const repoPath = options.outputPath;
    if (!fs.existsSync(repoPath)) {
      fs.mkdirSync(repoPath, { recursive: true });
    }

    // 패키지 파일 복사
    await this.copyPackageFiles(packages, downloadedFiles, repoPath, options.packageManager);

    // 메타데이터 생성
    let metadataFiles: string[] = [];
    switch (options.packageManager) {
      case 'yum':
        metadataFiles = await this.createYumRepoMetadata(packages, repoPath);
        break;
      case 'apt':
        metadataFiles = await this.createAptRepoMetadata(packages, repoPath);
        break;
      case 'apk':
        metadataFiles = await this.createApkRepoMetadata(packages, repoPath);
        break;
    }

    // 설정 스크립트 생성
    if (options.includeSetupScript !== false) {
      const scripts = this.scriptGenerator.generateLocalRepoScript(
        packages,
        options.packageManager,
        { repoName: options.repoName, packageDir: '.' }
      );

      fs.writeFileSync(path.join(repoPath, 'setup-repo.sh'), scripts.bash, getWriteOptions(true));
      fs.writeFileSync(path.join(repoPath, 'setup-repo.ps1'), scripts.powershell);
    }

    return {
      repoPath,
      packageCount: packages.length,
      totalSize: packages.reduce((sum, pkg) => sum + pkg.size, 0),
      metadataFiles,
    };
  }

  /**
   * 패키지 파일 복사
   */
  private async copyPackageFiles(
    packages: OSPackageInfo[],
    downloadedFiles: Map<string, string>,
    repoPath: string,
    pm: OSPackageManager
  ): Promise<void> {
    // YUM의 경우 Packages 디렉토리 사용
    const packagesDir = pm === 'yum' ? path.join(repoPath, 'Packages') : repoPath;

    if (!fs.existsSync(packagesDir)) {
      fs.mkdirSync(packagesDir, { recursive: true });
    }

    for (const pkg of packages) {
      const key = `${pkg.name}-${pkg.version}`;
      const sourcePath = downloadedFiles.get(key);

      if (sourcePath && fs.existsSync(sourcePath)) {
        const filename = path.basename(sourcePath);
        const destPath = path.join(packagesDir, filename);
        fs.copyFileSync(sourcePath, destPath);
      }
    }
  }

  /**
   * YUM 저장소 메타데이터 생성
   */
  private async createYumRepoMetadata(
    packages: OSPackageInfo[],
    repoPath: string
  ): Promise<string[]> {
    const repodataDir = path.join(repoPath, 'repodata');
    if (!fs.existsSync(repodataDir)) {
      fs.mkdirSync(repodataDir, { recursive: true });
    }

    const metadataFiles: string[] = [];

    // primary.xml 생성
    const primaryXml = this.generateYumPrimaryXml(packages);
    const primaryGz = await gzip(Buffer.from(primaryXml));
    const primaryPath = path.join(repodataDir, 'primary.xml.gz');
    fs.writeFileSync(primaryPath, primaryGz);
    metadataFiles.push(primaryPath);

    // filelists.xml 생성
    const filelistsXml = this.generateYumFilelistsXml(packages);
    const filelistsGz = await gzip(Buffer.from(filelistsXml));
    const filelistsPath = path.join(repodataDir, 'filelists.xml.gz');
    fs.writeFileSync(filelistsPath, filelistsGz);
    metadataFiles.push(filelistsPath);

    // other.xml 생성
    const otherXml = this.generateYumOtherXml(packages);
    const otherGz = await gzip(Buffer.from(otherXml));
    const otherPath = path.join(repodataDir, 'other.xml.gz');
    fs.writeFileSync(otherPath, otherGz);
    metadataFiles.push(otherPath);

    // repomd.xml 생성
    const repomdXml = await this.generateYumRepomdXml(repodataDir);
    const repomdPath = path.join(repodataDir, 'repomd.xml');
    fs.writeFileSync(repomdPath, repomdXml);
    metadataFiles.push(repomdPath);

    return metadataFiles;
  }

  /**
   * YUM primary.xml 생성
   */
  private generateYumPrimaryXml(packages: OSPackageInfo[]): string {
    const lines: string[] = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push(`<metadata xmlns="http://linux.duke.edu/metadata/common" xmlns:rpm="http://linux.duke.edu/metadata/rpm" packages="${packages.length}">`);

    for (const pkg of packages) {
      const filename = `${pkg.name}-${pkg.version}.${pkg.architecture}.rpm`;
      lines.push(`  <package type="rpm">`);
      lines.push(`    <name>${this.escapeXml(pkg.name)}</name>`);
      lines.push(`    <arch>${pkg.architecture}</arch>`);
      lines.push(`    <version epoch="0" ver="${this.escapeXml(pkg.version)}" rel="1"/>`);
      lines.push(`    <checksum type="${pkg.checksum?.type || 'sha256'}" pkgid="YES">${pkg.checksum?.value || ''}</checksum>`);
      lines.push(`    <summary>${this.escapeXml(pkg.description?.substring(0, 100) || pkg.name)}</summary>`);
      lines.push(`    <description>${this.escapeXml(pkg.description || '')}</description>`);
      lines.push(`    <packager>DepsSmuggler</packager>`);
      lines.push(`    <url></url>`);
      lines.push(`    <time file="${Math.floor(Date.now() / 1000)}" build="${Math.floor(Date.now() / 1000)}"/>`);
      lines.push(`    <size package="${pkg.size}" installed="${pkg.size}" archive="${pkg.size}"/>`);
      lines.push(`    <location href="Packages/${filename}"/>`);
      lines.push(`    <format>`);
      lines.push(`      <rpm:provides>`);
      lines.push(`        <rpm:entry name="${this.escapeXml(pkg.name)}" flags="EQ" epoch="0" ver="${this.escapeXml(pkg.version)}" rel="1"/>`);
      lines.push(`      </rpm:provides>`);

      if (pkg.dependencies.length > 0) {
        lines.push(`      <rpm:requires>`);
        for (const dep of pkg.dependencies) {
          if (dep.version) {
            lines.push(`        <rpm:entry name="${this.escapeXml(dep.name)}" flags="GE" epoch="0" ver="${this.escapeXml(dep.version)}"/>`);
          } else {
            lines.push(`        <rpm:entry name="${this.escapeXml(dep.name)}"/>`);
          }
        }
        lines.push(`      </rpm:requires>`);
      }

      lines.push(`    </format>`);
      lines.push(`  </package>`);
    }

    lines.push('</metadata>');
    return lines.join('\n');
  }

  /**
   * YUM filelists.xml 생성
   */
  private generateYumFilelistsXml(packages: OSPackageInfo[]): string {
    const lines: string[] = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push(`<filelists xmlns="http://linux.duke.edu/metadata/filelists" packages="${packages.length}">`);

    for (const pkg of packages) {
      lines.push(`  <package pkgid="${pkg.checksum?.value || ''}" name="${this.escapeXml(pkg.name)}" arch="${pkg.architecture}">`);
      lines.push(`    <version epoch="0" ver="${this.escapeXml(pkg.version)}" rel="1"/>`);
      lines.push(`  </package>`);
    }

    lines.push('</filelists>');
    return lines.join('\n');
  }

  /**
   * YUM other.xml 생성
   */
  private generateYumOtherXml(packages: OSPackageInfo[]): string {
    const lines: string[] = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push(`<otherdata xmlns="http://linux.duke.edu/metadata/other" packages="${packages.length}">`);

    for (const pkg of packages) {
      lines.push(`  <package pkgid="${pkg.checksum?.value || ''}" name="${this.escapeXml(pkg.name)}" arch="${pkg.architecture}">`);
      lines.push(`    <version epoch="0" ver="${this.escapeXml(pkg.version)}" rel="1"/>`);
      lines.push(`  </package>`);
    }

    lines.push('</otherdata>');
    return lines.join('\n');
  }

  /**
   * YUM repomd.xml 생성
   */
  private async generateYumRepomdXml(repodataDir: string): Promise<string> {
    const timestamp = Math.floor(Date.now() / 1000);
    const lines: string[] = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<repomd xmlns="http://linux.duke.edu/metadata/repo">');
    lines.push(`  <revision>${timestamp}</revision>`);

    const dataTypes = ['primary', 'filelists', 'other'];

    for (const dataType of dataTypes) {
      const filePath = path.join(repodataDir, `${dataType}.xml.gz`);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath);
        const checksum = crypto.createHash('sha256').update(content).digest('hex');
        const stat = fs.statSync(filePath);

        lines.push(`  <data type="${dataType}">`);
        lines.push(`    <checksum type="sha256">${checksum}</checksum>`);
        lines.push(`    <location href="repodata/${dataType}.xml.gz"/>`);
        lines.push(`    <timestamp>${timestamp}</timestamp>`);
        lines.push(`    <size>${stat.size}</size>`);
        lines.push(`  </data>`);
      }
    }

    lines.push('</repomd>');
    return lines.join('\n');
  }

  /**
   * APT 저장소 메타데이터 생성
   */
  private async createAptRepoMetadata(
    packages: OSPackageInfo[],
    repoPath: string
  ): Promise<string[]> {
    const metadataFiles: string[] = [];

    // Packages 파일 생성
    const packagesContent = this.generateAptPackagesFile(packages);
    const packagesPath = path.join(repoPath, 'Packages');
    fs.writeFileSync(packagesPath, packagesContent);
    metadataFiles.push(packagesPath);

    // Packages.gz 생성
    const packagesGz = await gzip(Buffer.from(packagesContent));
    const packagesGzPath = path.join(repoPath, 'Packages.gz');
    fs.writeFileSync(packagesGzPath, packagesGz);
    metadataFiles.push(packagesGzPath);

    // Release 파일 생성
    const releaseContent = this.generateAptReleaseFile(packages, packagesContent);
    const releasePath = path.join(repoPath, 'Release');
    fs.writeFileSync(releasePath, releaseContent);
    metadataFiles.push(releasePath);

    return metadataFiles;
  }

  /**
   * APT Packages 파일 생성
   */
  private generateAptPackagesFile(packages: OSPackageInfo[]): string {
    const entries: string[] = [];

    for (const pkg of packages) {
      const arch = pkg.architecture === 'x86_64' ? 'amd64' : pkg.architecture;
      const filename = `${pkg.name}_${pkg.version}_${arch}.deb`;

      const lines: string[] = [];
      lines.push(`Package: ${pkg.name}`);
      lines.push(`Version: ${pkg.version}`);
      lines.push(`Architecture: ${arch}`);
      lines.push(`Maintainer: DepsSmuggler`);
      lines.push(`Installed-Size: ${Math.ceil(pkg.size / 1024)}`);

      if (pkg.dependencies.length > 0) {
        const deps = pkg.dependencies
          .filter((d) => !d.isOptional)
          .map((d) => d.version ? `${d.name} (>= ${d.version})` : d.name)
          .join(', ');
        if (deps) {
          lines.push(`Depends: ${deps}`);
        }
      }

      lines.push(`Filename: ./${filename}`);
      lines.push(`Size: ${pkg.size}`);

      if (pkg.checksum) {
        if (pkg.checksum.type === 'sha256') {
          lines.push(`SHA256: ${pkg.checksum.value}`);
        } else {
          lines.push(`SHA256: ${pkg.checksum.value}`);
        }
      }

      lines.push(`Description: ${pkg.description || pkg.name}`);
      lines.push('');

      entries.push(lines.join('\n'));
    }

    return entries.join('\n');
  }

  /**
   * APT Release 파일 생성
   */
  private generateAptReleaseFile(packages: OSPackageInfo[], packagesContent: string): string {
    const packagesChecksum = crypto.createHash('sha256').update(packagesContent).digest('hex');
    const packagesSize = Buffer.byteLength(packagesContent);

    const lines: string[] = [];
    lines.push('Origin: DepsSmuggler');
    lines.push('Label: DepsSmuggler Local Repository');
    lines.push('Codename: local');
    lines.push(`Date: ${new Date().toUTCString()}`);
    lines.push('Architectures: amd64 arm64 i386');
    lines.push('Components: ./');
    lines.push('SHA256:');
    lines.push(` ${packagesChecksum} ${packagesSize} Packages`);

    return lines.join('\n');
  }

  /**
   * APK 저장소 메타데이터 생성
   */
  private async createApkRepoMetadata(
    packages: OSPackageInfo[],
    repoPath: string
  ): Promise<string[]> {
    const metadataFiles: string[] = [];

    // APKINDEX 내용 생성
    const apkindexContent = this.generateApkIndexContent(packages);

    // APKINDEX.tar.gz 생성 (간단한 형태)
    // 실제로는 tar 아카이브지만, 여기서는 gzip된 인덱스만 생성
    const apkindexGz = await gzip(Buffer.from(apkindexContent));
    const apkindexPath = path.join(repoPath, 'APKINDEX.tar.gz');
    fs.writeFileSync(apkindexPath, apkindexGz);
    metadataFiles.push(apkindexPath);

    return metadataFiles;
  }

  /**
   * APK 인덱스 내용 생성
   */
  private generateApkIndexContent(packages: OSPackageInfo[]): string {
    const entries: string[] = [];

    for (const pkg of packages) {
      const lines: string[] = [];
      lines.push(`P:${pkg.name}`);
      lines.push(`V:${pkg.version}`);
      lines.push(`A:${pkg.architecture}`);
      lines.push(`S:${pkg.size}`);
      lines.push(`I:${pkg.size}`);
      lines.push(`T:${pkg.description || pkg.name}`);

      if (pkg.dependencies.length > 0) {
        const deps = pkg.dependencies
          .filter((d) => !d.isOptional)
          .map((d) => d.name)
          .join(' ');
        if (deps) {
          lines.push(`D:${deps}`);
        }
      }

      if (pkg.checksum) {
        lines.push(`C:${pkg.checksum.value}`);
      }

      lines.push('');
      entries.push(lines.join('\n'));
    }

    return entries.join('\n');
  }

  /**
   * XML 이스케이프
   */
  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
