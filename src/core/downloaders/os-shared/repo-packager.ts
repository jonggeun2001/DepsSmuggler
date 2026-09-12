/**
 * OS Package Repository Packager
 * 다운로드한 OS 패키지를 로컬 저장소 구조로 패키징
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { promisify } from 'util';
import * as tar from 'tar';
import type { OSPackageInfo, OSPackageManager } from './types';
import { getDownloadedFileKey, getPackageFilename } from './package-file-utils';
import { OSScriptGenerator } from './script-generator';
import { getWriteOptions } from '../../shared/path-utils';

const gzip = promisify(zlib.gzip);
const APK_INDEX_GENERATED_FIELDS = new Set(['P', 'V', 'A', 'S', 'I', 'C', 'D', 'p', 'T']);

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isCanonicalBase64(value: string, byteLength: number): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    return false;
  }
  const decoded = Buffer.from(value, 'base64');
  return decoded.length === byteLength && decoded.toString('base64') === value;
}

function validateApkIndexChecksum(value: string): string {
  if (/^Q1[A-Za-z0-9+/]{27}={0,2}$/.test(value)) {
    const digest = value.substring(2);
    if (isCanonicalBase64(digest, 20)) return value;
  }
  if (/^X1[0-9a-fA-F]{40}$/.test(value)) return value;
  if (/^[0-9a-f]{32}$/i.test(value)) return value;
  throw new Error(`APK 체크섬 형식이 유효하지 않습니다: ${value}`);
}

function formatApkChecksum(pkg: OSPackageInfo): string {
  const rawChecksum = pkg.apkIndexFields?.C;
  if (rawChecksum !== undefined) return validateApkIndexChecksum(rawChecksum);

  const checksum = pkg.checksum;
  if (!checksum?.value) {
    throw new Error(`APK 체크섬이 없습니다: ${pkg.name}-${pkg.version}`);
  }
  if (checksum.type === 'sha1') {
    if (/^[0-9a-f]{40}$/i.test(checksum.value)) {
      return `Q1${Buffer.from(checksum.value, 'hex').toString('base64')}`;
    }
    if (isCanonicalBase64(checksum.value, 20)) return `Q1${checksum.value}`;
  }
  if (checksum.type === 'md5' && /^[0-9a-f]{32}$/i.test(checksum.value)) {
    return checksum.value;
  }
  throw new Error(`APK 체크섬 형식을 지원하지 않습니다: ${pkg.name}-${pkg.version}`);
}

function resolveApkInstalledSize(pkg: OSPackageInfo): string {
  const rawInstalledSize = pkg.apkIndexFields?.I;
  if (rawInstalledSize !== undefined && /^\d+$/.test(rawInstalledSize)) {
    const parsed = Number(rawInstalledSize);
    if (isSafeNonNegativeInteger(parsed)) return rawInstalledSize;
  }
  if (isSafeNonNegativeInteger(pkg.installedSize)) return String(pkg.installedSize);
  throw new Error(`APK 설치 크기 메타데이터가 없습니다: ${pkg.name}-${pkg.version}`);
}

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
        metadataFiles = await this.createAptRepoMetadata(packages, repoPath, downloadedFiles);
        break;
      case 'apk':
        metadataFiles = await this.createApkRepoMetadata(packages, repoPath, downloadedFiles);
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
      const key = getDownloadedFileKey(pkg);
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
      const filename = getPackageFilename(pkg, 'yum');
      const release = this.escapeXml(pkg.release || '1');
      lines.push(`  <package type="rpm">`);
      lines.push(`    <name>${this.escapeXml(pkg.name)}</name>`);
      lines.push(`    <arch>${pkg.architecture}</arch>`);
      lines.push(`    <version epoch="0" ver="${this.escapeXml(pkg.version)}" rel="${release}"/>`);
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
      lines.push(`        <rpm:entry name="${this.escapeXml(pkg.name)}" flags="EQ" epoch="0" ver="${this.escapeXml(pkg.version)}" rel="${release}"/>`);
      for (const provide of [...new Set(pkg.provides ?? [])]) {
        if (provide && provide !== pkg.name) {
          lines.push(`        <rpm:entry name="${this.escapeXml(provide)}"/>`);
        }
      }
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

      lines.push(...this.generateYumFileEntries(pkg, '      '));
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
      const release = this.escapeXml(pkg.release || '1');
      lines.push(`  <package pkgid="${pkg.checksum?.value || ''}" name="${this.escapeXml(pkg.name)}" arch="${pkg.architecture}">`);
      lines.push(`    <version epoch="0" ver="${this.escapeXml(pkg.version)}" rel="${release}"/>`);
      lines.push(...this.generateYumFileEntries(pkg, '    '));
      lines.push(`  </package>`);
    }

    lines.push('</filelists>');
    return lines.join('\n');
  }

  /** Retain primary file records in both indexes so native solvers can find file providers. */
  private generateYumFileEntries(pkg: OSPackageInfo, indent: string): string[] {
    return [...new Set((pkg.rpmPrimaryFiles ?? []).map((file) => {
      const type = file.type === 'file' ? '' : ` type="${file.type}"`;
      return `${indent}<file${type}>${this.escapeXml(file.path)}</file>`;
    }))];
  }

  /**
   * YUM other.xml 생성
   */
  private generateYumOtherXml(packages: OSPackageInfo[]): string {
    const lines: string[] = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push(`<otherdata xmlns="http://linux.duke.edu/metadata/other" packages="${packages.length}">`);

    for (const pkg of packages) {
      const release = this.escapeXml(pkg.release || '1');
      lines.push(`  <package pkgid="${pkg.checksum?.value || ''}" name="${this.escapeXml(pkg.name)}" arch="${pkg.architecture}">`);
      lines.push(`    <version epoch="0" ver="${this.escapeXml(pkg.version)}" rel="${release}"/>`);
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
    repoPath: string,
    downloadedFiles: Map<string, string>
  ): Promise<string[]> {
    const metadataFiles: string[] = [];

    // Packages 파일 생성
    const packagesContent = await this.generateAptPackagesFile(packages, repoPath, downloadedFiles);
    const packagesPath = path.join(repoPath, 'Packages');
    fs.writeFileSync(packagesPath, packagesContent);
    metadataFiles.push(packagesPath);

    // Packages.gz 생성
    const packagesGz = await gzip(Buffer.from(packagesContent));
    const packagesGzPath = path.join(repoPath, 'Packages.gz');
    fs.writeFileSync(packagesGzPath, packagesGz);
    metadataFiles.push(packagesGzPath);

    // Release 파일 생성
    const releaseContent = this.generateAptReleaseFile(packagesContent);
    const releasePath = path.join(repoPath, 'Release');
    fs.writeFileSync(releasePath, releaseContent);
    metadataFiles.push(releasePath);

    return metadataFiles;
  }

  /**
   * APT Packages 파일 생성
   */
  private async generateAptPackagesFile(
    packages: OSPackageInfo[],
    repoPath: string,
    downloadedFiles: Map<string, string>
  ): Promise<string> {
    const entries: string[] = [];

    for (const pkg of packages) {
      const sourcePath = downloadedFiles.get(getDownloadedFileKey(pkg));
      if (!sourcePath || !fs.existsSync(sourcePath)) {
        throw new Error(`APT 패키지 ${pkg.name}의 다운로드 payload가 없습니다`);
      }

      const filename = path.basename(sourcePath);
      const copiedPath = path.join(repoPath, filename);
      if (!fs.existsSync(copiedPath) || !fs.statSync(copiedPath).isFile()) {
        throw new Error(`APT 패키지 ${pkg.name}의 복사된 payload가 없습니다: ${filename}`);
      }

      const actualSize = fs.statSync(copiedPath).size;
      const actualSha256 = await this.calculateSha256(copiedPath);
      const fields = new Map<string, string>(Object.entries(pkg.aptControlFields || {}));

      const removeFields = (...names: string[]) => {
        for (const key of [...fields.keys()]) {
          if (names.some((name) => key.toLowerCase() === name.toLowerCase())) {
            fields.delete(key);
          }
        }
      };
      const setField = (name: string, value: string) => {
        removeFields(name);
        fields.set(name, value);
      };
      const hasField = (name: string): boolean =>
        [...fields.keys()].some((key) => key.toLowerCase() === name.toLowerCase());

      const arch = pkg.architecture === 'x86_64' ? 'amd64' : pkg.architecture;
      setField('Package', pkg.name);
      setField('Version', pkg.version);
      setField('Architecture', arch);
      if (!hasField('Maintainer')) {
        setField('Maintainer', 'DepsSmuggler');
      }
      if (!hasField('Installed-Size') && pkg.installedSize !== undefined) {
        setField('Installed-Size', String(Math.ceil(pkg.installedSize / 1024)));
      }
      if (!hasField('Depends') && pkg.dependencies.length > 0) {
        const deps = pkg.dependencies
          .filter((dependency) => !dependency.isOptional)
          .map((dependency) => {
            if (!dependency.version) return dependency.name;
            const operator = dependency.operator === '<'
              ? '<<'
              : dependency.operator === '>'
                ? '>>'
                : dependency.operator || '>=';
            return `${dependency.name} (${operator} ${dependency.version})`;
          })
          .join(', ');
        if (deps) setField('Depends', deps);
      }
      if (!hasField('Provides') && pkg.provides?.length) {
        setField('Provides', pkg.provides.join(', '));
      }
      if (!hasField('Conflicts') && pkg.conflicts?.length) {
        setField('Conflicts', pkg.conflicts.join(', '));
      }
      if (!hasField('Recommends') && pkg.recommends?.length) {
        setField('Recommends', pkg.recommends.join(', '));
      }
      if (!hasField('Suggests') && pkg.suggests?.length) {
        setField('Suggests', pkg.suggests.join(', '));
      }
      if (!hasField('Description')) {
        setField('Description', pkg.description || pkg.name);
      }

      setField('Filename', `./${filename}`);
      setField('Size', String(actualSize));
      removeFields('MD5sum', 'SHA1', 'SHA256', 'SHA512');
      fields.set('SHA256', actualSha256);

      const lines: string[] = [];
      for (const [name, value] of fields) {
        const valueLines = value.split('\n');
        lines.push(`${name}: ${valueLines[0]}`);
        for (const continuation of valueLines.slice(1)) {
          lines.push(` ${continuation || '.'}`);
        }
      }
      lines.push('');
      entries.push(lines.join('\n'));
    }

    return entries.join('\n');
  }

  private async calculateSha256(filePath: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    await new Promise<void>((resolve, reject) => {
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve());
      stream.on('error', reject);
    });
    return hash.digest('hex');
  }

  /**
   * APT Release 파일 생성
   */
  private generateAptReleaseFile(packagesContent: string): string {
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
    repoPath: string,
    downloadedFiles: Map<string, string>
  ): Promise<string[]> {
    const metadataFiles: string[] = [];
    const deliveredFiles = this.resolveApkDeliveredFiles(packages, downloadedFiles, repoPath);

    // APKINDEX 내용 생성
    const apkindexContent = this.generateApkIndexContent(packages, deliveredFiles);

    // Keep caller-owned repository files untouched until the completed archive is ready.
    const stagingDir = fs.mkdtempSync(path.join(repoPath, '.depssmuggler-apkindex-'));
    const stagedIndexPath = path.join(stagingDir, 'APKINDEX');
    const stagedArchivePath = path.join(stagingDir, 'APKINDEX.tar.gz');
    const apkindexPath = path.join(repoPath, 'APKINDEX.tar.gz');

    try {
      fs.writeFileSync(stagedIndexPath, apkindexContent, 'utf8');
      await tar.c(
        {
          cwd: stagingDir,
          file: stagedArchivePath,
          gzip: true,
          noPax: true,
          portable: true,
        },
        ['APKINDEX']
      );
      fs.renameSync(stagedArchivePath, apkindexPath);
      metadataFiles.push(apkindexPath);
    } finally {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }

    return metadataFiles;
  }

  /**
   * APK 인덱스 내용 생성
   */
  private generateApkIndexContent(
    packages: OSPackageInfo[],
    deliveredFiles: Map<string, string>
  ): string {
    const entries: string[] = [];

    for (const pkg of packages) {
      const deliveredPath = deliveredFiles.get(getDownloadedFileKey(pkg));
      if (!deliveredPath) {
        throw new Error(`APK 패키지 파일을 찾을 수 없습니다: ${pkg.name}-${pkg.version}`);
      }
      const deliveredSize = fs.statSync(deliveredPath).size;
      const rawFields = pkg.apkIndexFields;
      const lines: string[] = [];
      lines.push(`P:${pkg.name}`);
      lines.push(`V:${pkg.version}`);
      lines.push(`A:${pkg.architecture}`);
      lines.push(`S:${deliveredSize}`);
      lines.push(`I:${resolveApkInstalledSize(pkg)}`);
      lines.push(`T:${rawFields?.T ?? pkg.description ?? pkg.name}`);
      for (const [field, value] of Object.entries(rawFields || {})) {
        if (!APK_INDEX_GENERATED_FIELDS.has(field)) lines.push(`${field}:${value}`);
      }

      if (rawFields?.D !== undefined) {
        if (rawFields.D) lines.push(`D:${rawFields.D}`);
      } else if (pkg.dependencies.length > 0) {
        const deps = pkg.dependencies
          .filter((d) => !d.isOptional)
          .map((d) => (d.operator && d.version ? `${d.name}${d.operator}${d.version}` : d.name))
          .join(' ');
        if (deps) {
          lines.push(`D:${deps}`);
        }
      }

      if (rawFields?.p !== undefined) {
        if (rawFields.p) lines.push(`p:${rawFields.p}`);
      } else if (pkg.provides?.length) {
        lines.push(`p:${pkg.provides.join(' ')}`);
      }

      lines.push(`C:${formatApkChecksum(pkg)}`);

      lines.push('');
      entries.push(lines.join('\n'));
    }

    return entries.join('\n');
  }

  private resolveApkDeliveredFiles(
    packages: OSPackageInfo[],
    downloadedFiles: Map<string, string>,
    repoPath: string
  ): Map<string, string> {
    const deliveredFiles = new Map<string, string>();
    for (const pkg of packages) {
      const key = getDownloadedFileKey(pkg);
      const sourcePath = downloadedFiles.get(key);
      if (!sourcePath || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
        throw new Error(`APK 패키지 파일을 찾을 수 없습니다: ${pkg.name}-${pkg.version}`);
      }
      const copiedPath = path.join(repoPath, path.basename(sourcePath));
      if (!fs.existsSync(copiedPath) || !fs.statSync(copiedPath).isFile()) {
        throw new Error(`APK 패키지 파일을 저장하지 못했습니다: ${pkg.name}-${pkg.version}`);
      }
      deliveredFiles.set(key, copiedPath);
    }
    return deliveredFiles;
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
