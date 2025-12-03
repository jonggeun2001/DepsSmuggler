/**
 * 오프라인 미러 패키저
 * 로컬 저장소 구조로 패키지를 배치하여 오프라인 환경에서 바로 사용 가능
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { PackageInfo } from '../../types';
import logger from '../../utils/logger';

export interface MirrorOptions {
  includeReadme?: boolean;
  onProgress?: (progress: MirrorProgress) => void;
}

export interface MirrorProgress {
  processedFiles: number;
  totalFiles: number;
  currentPackage?: string;
  percentage: number;
}

export interface MirrorResult {
  outputPath: string;
  structure: MirrorStructure;
  totalFiles: number;
  totalSize: number;
}

export interface MirrorStructure {
  pip?: string;
  maven?: string;
  yum?: string;
  docker?: string;
}

/**
 * 미러 패키저 클래스
 * 패키지 타입별로 적절한 디렉토리 구조와 인덱스 파일 생성
 */
export class MirrorPackager {
  /**
   * 미러 구조 생성
   * @param files 다운로드된 파일 경로 목록
   * @param packages 패키지 정보 목록
   * @param outputPath 출력 디렉토리 경로
   * @param options 옵션
   */
  async createMirror(
    files: string[],
    packages: PackageInfo[],
    outputPath: string,
    options: MirrorOptions = {}
  ): Promise<MirrorResult> {
    const { includeReadme = true, onProgress } = options;

    // 출력 디렉토리 생성
    await fs.ensureDir(outputPath);

    // 패키지를 타입별로 그룹화
    const packagesByType = this.groupPackagesByType(packages);
    const filesByPackage = this.mapFilesToPackages(files, packages);

    let processedFiles = 0;
    const totalFiles = files.length;
    let totalSize = 0;
    const structure: MirrorStructure = {};

    // 타입별 미러 구조 생성
    for (const [type, pkgs] of packagesByType) {
      switch (type) {
        case 'pip':
        case 'conda':
          structure.pip = await this.createPipMirror(
            pkgs,
            filesByPackage,
            outputPath,
            (current) => {
              processedFiles++;
              onProgress?.({
                processedFiles,
                totalFiles,
                currentPackage: current,
                percentage: (processedFiles / totalFiles) * 100,
              });
            }
          );
          break;

        case 'maven':
          structure.maven = await this.createMavenMirror(
            pkgs,
            filesByPackage,
            outputPath,
            (current) => {
              processedFiles++;
              onProgress?.({
                processedFiles,
                totalFiles,
                currentPackage: current,
                percentage: (processedFiles / totalFiles) * 100,
              });
            }
          );
          break;

        case 'yum':
          structure.yum = await this.createYumMirror(
            pkgs,
            filesByPackage,
            outputPath,
            (current) => {
              processedFiles++;
              onProgress?.({
                processedFiles,
                totalFiles,
                currentPackage: current,
                percentage: (processedFiles / totalFiles) * 100,
              });
            }
          );
          break;

        case 'docker':
          structure.docker = await this.createDockerMirror(
            pkgs,
            filesByPackage,
            outputPath,
            (current) => {
              processedFiles++;
              onProgress?.({
                processedFiles,
                totalFiles,
                currentPackage: current,
                percentage: (processedFiles / totalFiles) * 100,
              });
            }
          );
          break;
      }
    }

    // 총 크기 계산
    for (const file of files) {
      try {
        const stat = await fs.stat(file);
        totalSize += stat.size;
      } catch {
        // 파일이 없는 경우 무시
      }
    }

    // README 생성
    if (includeReadme) {
      const readme = this.createReadme(packages, structure);
      await fs.writeFile(path.join(outputPath, 'README.txt'), readme, 'utf-8');
    }

    logger.info('미러 구조 생성 완료', {
      outputPath,
      totalFiles,
      totalSize,
      structure,
    });

    return {
      outputPath,
      structure,
      totalFiles,
      totalSize,
    };
  }

  /**
   * pip/PyPI 미러 구조 생성
   * PyPI Simple API 구조: /pypi/simple/{package}/index.html
   */
  private async createPipMirror(
    packages: PackageInfo[],
    filesByPackage: Map<string, string[]>,
    outputPath: string,
    onFile?: (current: string) => void
  ): Promise<string> {
    const mirrorPath = path.join(outputPath, 'pypi', 'simple');
    await fs.ensureDir(mirrorPath);

    // 메인 인덱스 HTML 생성
    const mainIndexLines: string[] = [
      '<!DOCTYPE html>',
      '<html>',
      '<head><title>Simple Index</title></head>',
      '<body>',
      '<h1>Simple Index</h1>',
    ];

    for (const pkg of packages) {
      const normalizedName = this.normalizePipPackageName(pkg.name);
      const pkgDir = path.join(mirrorPath, normalizedName);
      await fs.ensureDir(pkgDir);

      mainIndexLines.push(`<a href="${normalizedName}/">${normalizedName}</a><br/>`);

      // 패키지별 인덱스 생성
      const pkgIndexLines: string[] = [
        '<!DOCTYPE html>',
        '<html>',
        '<head><title>Links for ' + pkg.name + '</title></head>',
        '<body>',
        '<h1>Links for ' + pkg.name + '</h1>',
      ];

      const pkgKey = `${pkg.type}:${pkg.name}:${pkg.version}`;
      const files = filesByPackage.get(pkgKey) || [];

      for (const file of files) {
        const fileName = path.basename(file);
        const destPath = path.join(pkgDir, fileName);
        await fs.copy(file, destPath);

        pkgIndexLines.push(`<a href="${fileName}">${fileName}</a><br/>`);
        onFile?.(pkg.name);
      }

      pkgIndexLines.push('</body>', '</html>');
      await fs.writeFile(
        path.join(pkgDir, 'index.html'),
        pkgIndexLines.join('\n'),
        'utf-8'
      );
    }

    mainIndexLines.push('</body>', '</html>');
    await fs.writeFile(
      path.join(mirrorPath, 'index.html'),
      mainIndexLines.join('\n'),
      'utf-8'
    );

    return mirrorPath;
  }

  /**
   * Maven 미러 구조 생성
   * Maven 저장소 구조: /maven2/{groupId}/{artifactId}/{version}/
   */
  private async createMavenMirror(
    packages: PackageInfo[],
    filesByPackage: Map<string, string[]>,
    outputPath: string,
    onFile?: (current: string) => void
  ): Promise<string> {
    const mirrorPath = path.join(outputPath, 'maven2');
    await fs.ensureDir(mirrorPath);

    for (const pkg of packages) {
      // Maven 좌표 파싱: groupId:artifactId 또는 groupId.artifactId
      const { groupId, artifactId } = this.parseMavenCoordinates(pkg.name);
      const groupPath = groupId.replace(/\./g, '/');
      const versionPath = path.join(mirrorPath, groupPath, artifactId, pkg.version);
      await fs.ensureDir(versionPath);

      const pkgKey = `${pkg.type}:${pkg.name}:${pkg.version}`;
      const files = filesByPackage.get(pkgKey) || [];

      for (const file of files) {
        const fileName = path.basename(file);
        const destPath = path.join(versionPath, fileName);
        await fs.copy(file, destPath);
        onFile?.(pkg.name);
      }

      // maven-metadata.xml 생성
      const metadataPath = path.join(mirrorPath, groupPath, artifactId, 'maven-metadata.xml');
      await this.updateMavenMetadata(metadataPath, groupId, artifactId, pkg.version);
    }

    return mirrorPath;
  }

  /**
   * YUM 미러 구조 생성
   * YUM 저장소 구조: /yum/{arch}/Packages/ + repodata/
   */
  private async createYumMirror(
    packages: PackageInfo[],
    filesByPackage: Map<string, string[]>,
    outputPath: string,
    onFile?: (current: string) => void
  ): Promise<string> {
    const mirrorPath = path.join(outputPath, 'yum');
    await fs.ensureDir(mirrorPath);

    // 아키텍처별로 그룹화
    const packagesByArch = new Map<string, PackageInfo[]>();
    for (const pkg of packages) {
      const arch = pkg.arch || 'x86_64';
      const archPkgs = packagesByArch.get(arch) || [];
      archPkgs.push(pkg);
      packagesByArch.set(arch, archPkgs);
    }

    for (const [arch, archPkgs] of packagesByArch) {
      const archPath = path.join(mirrorPath, arch);
      const packagesPath = path.join(archPath, 'Packages');
      const repodataPath = path.join(archPath, 'repodata');

      await fs.ensureDir(packagesPath);
      await fs.ensureDir(repodataPath);

      const rpmFiles: string[] = [];

      for (const pkg of archPkgs) {
        const pkgKey = `${pkg.type}:${pkg.name}:${pkg.version}`;
        const files = filesByPackage.get(pkgKey) || [];

        for (const file of files) {
          const fileName = path.basename(file);
          const destPath = path.join(packagesPath, fileName);
          await fs.copy(file, destPath);
          rpmFiles.push(fileName);
          onFile?.(pkg.name);
        }
      }

      // repomd.xml 생성 (간단한 버전)
      await this.createRepodata(repodataPath, rpmFiles, archPkgs);
    }

    return mirrorPath;
  }

  /**
   * Docker 미러 구조 생성
   * Docker 이미지 구조: /docker/{repository}/{tag}/
   */
  private async createDockerMirror(
    packages: PackageInfo[],
    filesByPackage: Map<string, string[]>,
    outputPath: string,
    onFile?: (current: string) => void
  ): Promise<string> {
    const mirrorPath = path.join(outputPath, 'docker');
    await fs.ensureDir(mirrorPath);

    for (const pkg of packages) {
      // Docker 이미지명 파싱: repository/image:tag
      const { repository, imageName } = this.parseDockerImage(pkg.name);
      const imagePath = path.join(mirrorPath, repository, imageName, pkg.version);
      await fs.ensureDir(imagePath);

      const pkgKey = `${pkg.type}:${pkg.name}:${pkg.version}`;
      const files = filesByPackage.get(pkgKey) || [];

      for (const file of files) {
        const fileName = path.basename(file);
        const destPath = path.join(imagePath, fileName);
        await fs.copy(file, destPath);
        onFile?.(pkg.name);
      }

      // 이미지 정보 JSON 생성
      const infoPath = path.join(imagePath, 'image-info.json');
      await fs.writeJson(infoPath, {
        repository,
        image: imageName,
        tag: pkg.version,
        arch: pkg.arch,
        files: files.map(f => path.basename(f)),
      }, { spaces: 2 });
    }

    return mirrorPath;
  }

  /**
   * Maven 메타데이터 업데이트/생성
   */
  private async updateMavenMetadata(
    metadataPath: string,
    groupId: string,
    artifactId: string,
    version: string
  ): Promise<void> {
    let versions: string[] = [];

    // 기존 메타데이터가 있으면 버전 목록 파싱
    if (await fs.pathExists(metadataPath)) {
      const content = await fs.readFile(metadataPath, 'utf-8');
      const versionMatch = content.match(/<versions>([\s\S]*?)<\/versions>/);
      if (versionMatch) {
        const versionElements = versionMatch[1].match(/<version>([^<]+)<\/version>/g) || [];
        versions = versionElements.map(v => v.replace(/<\/?version>/g, ''));
      }
    }

    // 새 버전 추가
    if (!versions.includes(version)) {
      versions.push(version);
    }

    // 버전 정렬
    versions.sort();
    const latestVersion = versions[versions.length - 1];

    const metadata = `<?xml version="1.0" encoding="UTF-8"?>
<metadata>
  <groupId>${groupId}</groupId>
  <artifactId>${artifactId}</artifactId>
  <versioning>
    <latest>${latestVersion}</latest>
    <release>${latestVersion}</release>
    <versions>
${versions.map(v => `      <version>${v}</version>`).join('\n')}
    </versions>
    <lastUpdated>${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}</lastUpdated>
  </versioning>
</metadata>`;

    await fs.writeFile(metadataPath, metadata, 'utf-8');
  }

  /**
   * YUM repodata 생성
   */
  private async createRepodata(
    repodataPath: string,
    rpmFiles: string[],
    packages: PackageInfo[]
  ): Promise<void> {
    const timestamp = Math.floor(Date.now() / 1000);

    // primary.xml 생성 (간단한 버전)
    const primaryXml = `<?xml version="1.0" encoding="UTF-8"?>
<metadata xmlns="http://linux.duke.edu/metadata/common" xmlns:rpm="http://linux.duke.edu/metadata/rpm" packages="${packages.length}">
${packages.map(pkg => `  <package type="rpm">
    <name>${pkg.name}</name>
    <version epoch="0" ver="${pkg.version}" rel="1"/>
    <arch>${pkg.arch || 'x86_64'}</arch>
    <location href="Packages/${pkg.name}-${pkg.version}.${pkg.arch || 'x86_64'}.rpm"/>
  </package>`).join('\n')}
</metadata>`;

    await fs.writeFile(path.join(repodataPath, 'primary.xml'), primaryXml, 'utf-8');

    // repomd.xml 생성
    const repomdXml = `<?xml version="1.0" encoding="UTF-8"?>
<repomd xmlns="http://linux.duke.edu/metadata/repo">
  <revision>${timestamp}</revision>
  <data type="primary">
    <location href="repodata/primary.xml"/>
    <timestamp>${timestamp}</timestamp>
  </data>
</repomd>`;

    await fs.writeFile(path.join(repodataPath, 'repomd.xml'), repomdXml, 'utf-8');
  }

  /**
   * 사용 방법 README 생성
   */
  private createReadme(packages: PackageInfo[], structure: MirrorStructure): string {
    const lines: string[] = [
      '================================================================================',
      '                    DepsSmuggler 오프라인 미러 저장소',
      '================================================================================',
      '',
      '생성 일시: ' + new Date().toLocaleString('ko-KR'),
      '',
      '이 디렉토리는 오프라인 환경에서 바로 사용할 수 있는 미러 저장소 구조입니다.',
      '',
      '--------------------------------------------------------------------------------',
      '                              디렉토리 구조',
      '--------------------------------------------------------------------------------',
      '',
    ];

    if (structure.pip) {
      lines.push('pypi/          - Python 패키지 (PyPI Simple API 구조)');
    }
    if (structure.maven) {
      lines.push('maven2/        - Maven 아티팩트 (Maven 저장소 구조)');
    }
    if (structure.yum) {
      lines.push('yum/           - YUM/RPM 패키지 (YUM 저장소 구조)');
    }
    if (structure.docker) {
      lines.push('docker/        - Docker 이미지 (tar 파일)');
    }

    lines.push('', '--------------------------------------------------------------------------------');
    lines.push('                              설정 및 사용 방법');
    lines.push('--------------------------------------------------------------------------------');
    lines.push('');

    // pip 설정 방법
    if (structure.pip) {
      lines.push('[Python/pip]');
      lines.push('');
      lines.push('방법 1: 명령줄에서 직접 사용');
      lines.push('  pip install --no-index --find-links=/path/to/pypi/simple <패키지명>');
      lines.push('');
      lines.push('방법 2: pip.conf 설정 (영구 설정)');
      lines.push('  Linux/Mac: ~/.pip/pip.conf');
      lines.push('  Windows: %APPDATA%\\pip\\pip.ini');
      lines.push('');
      lines.push('  [global]');
      lines.push('  index-url = file:///path/to/pypi/simple');
      lines.push('  trusted-host = localhost');
      lines.push('');
      lines.push('방법 3: 로컬 HTTP 서버 실행');
      lines.push('  cd /path/to/pypi');
      lines.push('  python -m http.server 8080');
      lines.push('  pip install --index-url http://localhost:8080/simple <패키지명>');
      lines.push('');
    }

    // Maven 설정 방법
    if (structure.maven) {
      lines.push('[Maven]');
      lines.push('');
      lines.push('settings.xml에 로컬 저장소 추가 (~/.m2/settings.xml):');
      lines.push('');
      lines.push('  <settings>');
      lines.push('    <mirrors>');
      lines.push('      <mirror>');
      lines.push('        <id>local-mirror</id>');
      lines.push('        <url>file:///path/to/maven2</url>');
      lines.push('        <mirrorOf>*</mirrorOf>');
      lines.push('      </mirror>');
      lines.push('    </mirrors>');
      lines.push('  </settings>');
      lines.push('');
      lines.push('오프라인 빌드:');
      lines.push('  mvn install -o');
      lines.push('');
    }

    // YUM 설정 방법
    if (structure.yum) {
      lines.push('[YUM/RPM]');
      lines.push('');
      lines.push('방법 1: 직접 설치');
      lines.push('  yum localinstall -y /path/to/yum/x86_64/Packages/*.rpm');
      lines.push('  또는');
      lines.push('  rpm -ivh /path/to/yum/x86_64/Packages/*.rpm');
      lines.push('');
      lines.push('방법 2: 로컬 저장소 설정 (/etc/yum.repos.d/local.repo):');
      lines.push('');
      lines.push('  [local-repo]');
      lines.push('  name=Local Repository');
      lines.push('  baseurl=file:///path/to/yum/x86_64');
      lines.push('  enabled=1');
      lines.push('  gpgcheck=0');
      lines.push('');
      lines.push('설치:');
      lines.push('  yum install <패키지명>');
      lines.push('');
    }

    // Docker 사용 방법
    if (structure.docker) {
      lines.push('[Docker]');
      lines.push('');
      lines.push('이미지 로드:');
      lines.push('  docker load -i /path/to/docker/<repository>/<image>/<tag>/<image>.tar');
      lines.push('');
      lines.push('예시:');
      lines.push('  docker load -i /path/to/docker/library/nginx/latest/nginx.tar');
      lines.push('  docker images  # 로드된 이미지 확인');
      lines.push('');
    }

    lines.push('================================================================================');
    lines.push('                    DepsSmuggler - 폐쇄망을 위한 패키지 다운로더');
    lines.push('                    https://github.com/jonggeun2001/DepsSmuggler');
    lines.push('================================================================================');

    return lines.join('\n');
  }

  /**
   * 패키지를 타입별로 그룹화
   */
  private groupPackagesByType(packages: PackageInfo[]): Map<string, PackageInfo[]> {
    const grouped = new Map<string, PackageInfo[]>();
    for (const pkg of packages) {
      const type = pkg.type;
      const group = grouped.get(type) || [];
      group.push(pkg);
      grouped.set(type, group);
    }
    return grouped;
  }

  /**
   * 파일을 패키지에 매핑
   */
  private mapFilesToPackages(
    files: string[],
    packages: PackageInfo[]
  ): Map<string, string[]> {
    const map = new Map<string, string[]>();

    for (const pkg of packages) {
      const pkgKey = `${pkg.type}:${pkg.name}:${pkg.version}`;
      const pkgFiles: string[] = [];

      for (const file of files) {
        const fileName = path.basename(file).toLowerCase();
        const pkgName = pkg.name.toLowerCase();
        const pkgVersion = pkg.version.toLowerCase();

        // 파일명에 패키지명과 버전이 포함되어 있는지 확인
        if (fileName.includes(pkgName) && fileName.includes(pkgVersion)) {
          pkgFiles.push(file);
        }
      }

      map.set(pkgKey, pkgFiles);
    }

    return map;
  }

  /**
   * pip 패키지명 정규화 (PEP 503)
   */
  private normalizePipPackageName(name: string): string {
    return name.toLowerCase().replace(/[-_.]+/g, '-');
  }

  /**
   * Maven 좌표 파싱
   */
  private parseMavenCoordinates(name: string): { groupId: string; artifactId: string } {
    // groupId:artifactId 형식
    if (name.includes(':')) {
      const [groupId, artifactId] = name.split(':');
      return { groupId, artifactId };
    }
    // 마지막 점 이전을 groupId로, 이후를 artifactId로
    const lastDot = name.lastIndexOf('.');
    if (lastDot > 0) {
      return {
        groupId: name.slice(0, lastDot),
        artifactId: name.slice(lastDot + 1),
      };
    }
    // 기본값
    return { groupId: name, artifactId: name };
  }

  /**
   * Docker 이미지명 파싱
   */
  private parseDockerImage(name: string): { repository: string; imageName: string } {
    // repository/image 형식
    if (name.includes('/')) {
      const parts = name.split('/');
      if (parts.length >= 2) {
        const imageName = parts.pop()!;
        const repository = parts.join('/');
        return { repository, imageName };
      }
    }
    // 기본값 (library)
    return { repository: 'library', imageName: name };
  }
}

// 싱글톤 인스턴스
let mirrorPackagerInstance: MirrorPackager | null = null;

export function getMirrorPackager(): MirrorPackager {
  if (!mirrorPackagerInstance) {
    mirrorPackagerInstance = new MirrorPackager();
  }
  return mirrorPackagerInstance;
}
