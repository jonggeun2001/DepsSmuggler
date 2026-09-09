/**
 * 설치 스크립트 생성기
 * Bash 및 PowerShell 설치 스크립트를 자동으로 생성
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import { PackageInfo } from '../../types';
import logger from '../../utils/logger';
import { stripLeadingDotSlash, toUnixPath, getWriteOptions } from '../shared/path-utils';

export interface ScriptOptions {
  includeHeader?: boolean;
  includeErrorHandling?: boolean;
  packageDir?: string; // 패키지 디렉토리 경로 (기본: ./packages)
}

export interface GeneratedScript {
  path: string;
  content: string;
  type: 'bash' | 'powershell';
}

interface MavenCoordinate {
  groupPath: string;
  artifactId: string;
  version: string;
}

/**
 * 설치 스크립트 생성기 클래스
 */
export class ScriptGenerator {
  private getMavenCoordinates(packages: PackageInfo[]): MavenCoordinate[] {
    const coordinates = new Map<string, MavenCoordinate>();

    for (const pkg of packages) {
      if (pkg.type !== 'maven') continue;

      const metadata = pkg.metadata as Record<string, unknown> | undefined;
      const nameParts = pkg.name.split(':');
      const groupId = typeof metadata?.groupId === 'string'
        ? metadata.groupId
        : nameParts[0];
      const artifactId = typeof metadata?.artifactId === 'string'
        ? metadata.artifactId
        : nameParts[1];

      // The Maven downloader always carries these coordinates. Refuse unsafe
      // path segments so generated scripts cannot escape the repository root.
      if (!groupId || !artifactId || !pkg.version ||
          groupId.split('.').some(segment => !/^[A-Za-z0-9_-]+$/.test(segment)) ||
          !/^[A-Za-z0-9_.+-]+$/.test(artifactId) || artifactId === '.' || artifactId === '..' ||
          !/^[A-Za-z0-9_.+-]+$/.test(pkg.version) || pkg.version === '.' || pkg.version === '..') {
        throw new Error(`Maven 패키지 좌표가 유효하지 않습니다: ${pkg.name}:${pkg.version}`);
      }

      const coordinate = {
        groupPath: groupId.split('.').join('/'),
        artifactId,
        version: pkg.version,
      };
      coordinates.set(`${coordinate.groupPath}/${artifactId}/${pkg.version}`, coordinate);
    }

    return [...coordinates.values()];
  }

  private shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
  }

  private powerShellQuote(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
  }

  /**
   * Bash 설치 스크립트 생성 (Linux/macOS용)
   */
  async generateBashScript(
    packages: PackageInfo[],
    outputPath: string,
    options: ScriptOptions = {}
  ): Promise<string> {
    const {
      includeHeader = true,
      includeErrorHandling = true,
      packageDir = './packages',
    } = options;

    const lines: string[] = [];

    // Shebang 및 헤더
    lines.push('#!/bin/bash');
    lines.push('');

    if (includeHeader) {
      lines.push('#===============================================================================');
      lines.push('# DepsSmuggler 패키지 설치 스크립트');
      lines.push('# 생성 일시: ' + new Date().toLocaleString('ko-KR'));
      lines.push('#');
      lines.push('# 사용법: chmod +x install.sh && ./install.sh');
      lines.push('#===============================================================================');
      lines.push('');
    }

    // 색상 정의
    lines.push('# 색상 정의');
    lines.push('RED="\\033[0;31m"');
    lines.push('GREEN="\\033[0;32m"');
    lines.push('YELLOW="\\033[1;33m"');
    lines.push('NC="\\033[0m" # No Color');
    lines.push('');

    // 로깅 함수
    lines.push('# 로깅 함수');
    lines.push('log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }');
    lines.push('log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }');
    lines.push('log_error() { echo -e "${RED}[ERROR]${NC} $1"; }');
    lines.push('');

    // 에러 처리
    if (includeErrorHandling) {
      lines.push('# 에러 처리');
      lines.push('set -e');
      lines.push('trap \'log_error "스크립트 실행 중 오류가 발생했습니다. 종료합니다."\' ERR');
      lines.push('');
    }

    // 패키지 디렉토리 확인
    lines.push('# 패키지 디렉토리 확인');
    lines.push(`PACKAGE_DIR="${packageDir}"`);
    lines.push('SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"');
    lines.push('');
    lines.push('if [[ ! -d "$SCRIPT_DIR/$PACKAGE_DIR" ]]; then');
    lines.push('    log_error "패키지 디렉토리를 찾을 수 없습니다: $SCRIPT_DIR/$PACKAGE_DIR"');
    lines.push('    exit 1');
    lines.push('fi');
    lines.push('');
    lines.push('cd "$SCRIPT_DIR"');
    lines.push('log_info "설치를 시작합니다..."');
    lines.push('');

    // 패키지 타입별로 그룹화
    const packagesByType = this.groupPackagesByType(packages);

    // pip/conda 패키지 설치
    if (packagesByType.has('pip') || packagesByType.has('conda')) {
      const pipPackages = [
        ...(packagesByType.get('pip') || []),
        ...(packagesByType.get('conda') || []),
      ];

      lines.push('#-------------------------------------------------------------------------------');
      lines.push('# Python 패키지 설치');
      lines.push('#-------------------------------------------------------------------------------');
      lines.push('');
      lines.push('install_python_packages() {');
      lines.push('    log_info "Python 패키지 설치 중..."');
      lines.push('');
      lines.push('    # pip 설치 확인');
      lines.push('    if ! command -v pip &> /dev/null; then');
      lines.push('        log_error "pip가 설치되어 있지 않습니다."');
      lines.push('        return 1');
      lines.push('    fi');
      lines.push('');
      lines.push('    PIP_FIND_LINK_ARGS=()');
      lines.push('    while IFS= read -r -d \'\' directory; do');
      lines.push('        PIP_FIND_LINK_ARGS+=(--find-links="$directory")');
      lines.push('    done < <(find "$PACKAGE_DIR" -type d -print0)');
      lines.push('');

      for (const pkg of pipPackages) {
        lines.push(`    # ${pkg.name} 설치`);
        lines.push(`    log_info "${pkg.name}==${pkg.version} 설치 중..."`);
        lines.push(`    pip install --no-index "\${PIP_FIND_LINK_ARGS[@]}" ${pkg.name}==${pkg.version} || {`);
        lines.push(`        log_warn "${pkg.name} 설치 실패, 계속 진행합니다."`);
        lines.push('    }');
        lines.push('');
      }

      lines.push('    log_info "Python 패키지 설치 완료"');
      lines.push('}');
      lines.push('');
    }

    // Maven 패키지 설치
    if (packagesByType.has('maven')) {
      const mavenCoordinates = this.getMavenCoordinates(packagesByType.get('maven') || []);
      lines.push('#-------------------------------------------------------------------------------');
      lines.push('# Maven 패키지 설치');
      lines.push('#-------------------------------------------------------------------------------');
      lines.push('');
      lines.push('install_maven_packages() {');
      lines.push('    log_info "Maven 패키지 설치 중..."');
      lines.push('');
      lines.push('    # Maven local repository와 같은 canonical layout을 그대로 복사합니다.');
      lines.push('    local maven_source_root="$PACKAGE_DIR"');
      lines.push('    if [[ -d "$PACKAGE_DIR/m2repo" ]]; then');
      lines.push('        maven_source_root="$PACKAGE_DIR/m2repo"');
      lines.push('    fi');
      lines.push('    local maven_repo_local="${MAVEN_REPO_LOCAL:-$HOME/.m2/repository}"');
      lines.push('    copy_maven_coordinate() {');
      lines.push('        local relative_path="$1"');
      lines.push('        local source_path="$maven_source_root/$relative_path"');
      lines.push('        local target_path="$maven_repo_local/$relative_path"');
      lines.push('        if [[ ! -d "$source_path" ]]; then');
      lines.push('            log_error "Maven canonical artifact directory를 찾을 수 없습니다: $source_path"');
      lines.push('            return 1');
      lines.push('        fi');
      lines.push('        mkdir -p "$target_path" || return 1');
      lines.push('        cp -a "$source_path/." "$target_path/" || return 1');
      lines.push('    }');
      lines.push('');
      for (const coordinate of mavenCoordinates) {
        const relativePath = `${coordinate.groupPath}/${coordinate.artifactId}/${coordinate.version}`;
        lines.push(`    copy_maven_coordinate ${this.shellQuote(relativePath)} || return 1`);
      }
      if (mavenCoordinates.length === 0) {
        lines.push('    log_error "Maven 패키지에 유효한 groupId/artifactId/version 좌표가 없습니다."');
        lines.push('    return 1');
      }
      lines.push('');
      lines.push('    log_info "Maven 패키지 설치 완료"');
      lines.push('}');
      lines.push('');
    }

    // YUM 패키지 설치
    if (packagesByType.has('yum')) {
      const yumPackages = packagesByType.get('yum') || [];

      lines.push('#-------------------------------------------------------------------------------');
      lines.push('# YUM/RPM 패키지 설치');
      lines.push('#-------------------------------------------------------------------------------');
      lines.push('');
      lines.push('install_yum_packages() {');
      lines.push('    log_info "YUM/RPM 패키지 설치 중..."');
      lines.push('');
      lines.push('    # root 권한 확인');
      lines.push('    if [[ $EUID -ne 0 ]]; then');
      lines.push('        log_warn "YUM 패키지 설치에는 root 권한이 필요합니다."');
      lines.push('        log_info "sudo를 사용하여 다시 실행합니다..."');
      lines.push('        SUDO="sudo"');
      lines.push('    else');
      lines.push('        SUDO=""');
      lines.push('    fi');
      lines.push('');

      for (const pkg of yumPackages) {
        const arch = pkg.arch || 'x86_64';
        lines.push(`    # ${pkg.name} 설치`);
        lines.push(`    log_info "${pkg.name}-${pkg.version} 설치 중..."`);
        lines.push(`    $SUDO rpm -ivh "$PACKAGE_DIR/${pkg.name}-${pkg.version}.${arch}.rpm" 2>/dev/null || {`);
        lines.push(`        $SUDO rpm -Uvh "$PACKAGE_DIR/${pkg.name}-${pkg.version}.${arch}.rpm" 2>/dev/null || {`);
        lines.push(`            log_warn "${pkg.name} 설치 실패 또는 이미 설치됨"`);
        lines.push('        }');
        lines.push('    }');
        lines.push('');
      }

      lines.push('    log_info "YUM/RPM 패키지 설치 완료"');
      lines.push('}');
      lines.push('');
    }

    // Docker 이미지 로드
    if (packagesByType.has('docker')) {
      const dockerPackages = packagesByType.get('docker') || [];

      lines.push('#-------------------------------------------------------------------------------');
      lines.push('# Docker 이미지 로드');
      lines.push('#-------------------------------------------------------------------------------');
      lines.push('');
      lines.push('load_docker_images() {');
      lines.push('    log_info "Docker 이미지 로드 중..."');
      lines.push('');
      lines.push('    # Docker 설치 확인');
      lines.push('    if ! command -v docker &> /dev/null; then');
      lines.push('        log_error "Docker가 설치되어 있지 않습니다."');
      lines.push('        return 1');
      lines.push('    fi');
      lines.push('');

      for (const pkg of dockerPackages) {
        const imageName = pkg.name.replace(/\//g, '_');
        lines.push(`    # ${pkg.name}:${pkg.version} 로드`);
        lines.push(`    log_info "${pkg.name}:${pkg.version} 로드 중..."`);
        lines.push(`    docker load -i "$PACKAGE_DIR/${imageName}_${pkg.version}.tar" || {`);
        lines.push(`        log_warn "${pkg.name}:${pkg.version} 로드 실패"`);
        lines.push('    }');
        lines.push('');
      }

      lines.push('    log_info "Docker 이미지 로드 완료"');
      lines.push('}');
      lines.push('');
    }

    // 메인 실행부
    lines.push('#-------------------------------------------------------------------------------');
    lines.push('# 메인 실행');
    lines.push('#-------------------------------------------------------------------------------');
    lines.push('');
    lines.push('main() {');
    lines.push('    log_info "====================================="');
    lines.push('    log_info "DepsSmuggler 패키지 설치 스크립트"');
    lines.push('    log_info "====================================="');
    lines.push('    echo ""');
    lines.push('');

    if (packagesByType.has('pip') || packagesByType.has('conda')) {
      lines.push('    install_python_packages');
      lines.push('    echo ""');
    }
    if (packagesByType.has('maven')) {
      lines.push('    install_maven_packages || exit 1');
      lines.push('    echo ""');
    }
    if (packagesByType.has('yum')) {
      lines.push('    install_yum_packages');
      lines.push('    echo ""');
    }
    if (packagesByType.has('docker')) {
      lines.push('    load_docker_images');
      lines.push('    echo ""');
    }

    lines.push('');
    lines.push('    log_info "====================================="');
    lines.push('    log_info "모든 설치가 완료되었습니다!"');
    lines.push('    log_info "====================================="');
    lines.push('}');
    lines.push('');
    lines.push('# 스크립트 실행');
    lines.push('main "$@"');

    const content = lines.join('\n');
    await fs.ensureDir(path.dirname(outputPath));
    // 플랫폼에 따른 파일 권한 처리 - Windows에서는 mode 무시됨
    await fs.writeFile(outputPath, content, getWriteOptions(true));

    logger.info('Bash 스크립트 생성 완료', { outputPath });

    return outputPath;
  }

  /**
   * PowerShell 설치 스크립트 생성 (Windows용)
   */
  async generatePowerShellScript(
    packages: PackageInfo[],
    outputPath: string,
    options: ScriptOptions = {}
  ): Promise<string> {
    const {
      includeHeader = true,
      includeErrorHandling = true,
      packageDir = './packages',
    } = options;

    // 크로스 플랫폼 경로 처리: 입력 경로를 정규화하고 선행 ./ 제거
    const normalizedPackageDir = stripLeadingDotSlash(toUnixPath(packageDir));

    const lines: string[] = [];

    // 헤더
    if (includeHeader) {
      lines.push('#===============================================================================');
      lines.push('# DepsSmuggler 패키지 설치 스크립트 (PowerShell)');
      lines.push('# 생성 일시: ' + new Date().toLocaleString('ko-KR'));
      lines.push('#');
      lines.push('# 사용법: powershell -ExecutionPolicy Bypass -File install.ps1');
      lines.push('#===============================================================================');
      lines.push('');
    }

    // 에러 처리
    if (includeErrorHandling) {
      lines.push('# 에러 처리 설정');
      lines.push('$ErrorActionPreference = "Continue"');
      lines.push('');
    }

    // 로깅 함수
    lines.push('# 로깅 함수');
    lines.push('function Write-Info { param($Message) Write-Host "[INFO] $Message" -ForegroundColor Green }');
    lines.push('function Write-Warn { param($Message) Write-Host "[WARN] $Message" -ForegroundColor Yellow }');
    lines.push('function Write-Err { param($Message) Write-Host "[ERROR] $Message" -ForegroundColor Red }');
    lines.push('');

    // 패키지 디렉토리 설정 - Join-Path를 사용하여 플랫폼 독립적으로 경로 생성
    lines.push('# 패키지 디렉토리 설정');
    lines.push('$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path');
    lines.push(`$PackageDir = Join-Path -Path $ScriptDir -ChildPath '${normalizedPackageDir}'`);
    lines.push('');
    lines.push('if (-not (Test-Path $PackageDir)) {');
    lines.push('    Write-Err "패키지 디렉토리를 찾을 수 없습니다: $PackageDir"');
    lines.push('    exit 1');
    lines.push('}');
    lines.push('');
    lines.push('Set-Location $ScriptDir');
    lines.push('Write-Info "설치를 시작합니다..."');
    lines.push('');

    // 패키지 타입별로 그룹화
    const packagesByType = this.groupPackagesByType(packages);

    // pip/conda 패키지 설치
    if (packagesByType.has('pip') || packagesByType.has('conda')) {
      const pipPackages = [
        ...(packagesByType.get('pip') || []),
        ...(packagesByType.get('conda') || []),
      ];

      lines.push('#-------------------------------------------------------------------------------');
      lines.push('# Python 패키지 설치');
      lines.push('#-------------------------------------------------------------------------------');
      lines.push('');
      lines.push('function Install-PythonPackages {');
      lines.push('    Write-Info "Python 패키지 설치 중..."');
      lines.push('');
      lines.push('    # pip 설치 확인');
      lines.push('    if (-not (Get-Command pip -ErrorAction SilentlyContinue)) {');
      lines.push('        Write-Err "pip가 설치되어 있지 않습니다."');
      lines.push('        return');
      lines.push('    }');
      lines.push('');
      lines.push('    $PipFindLinkArgs = @("--find-links=$PackageDir")');
      lines.push('    $PipFindLinkArgs += @(');
      lines.push('        Get-ChildItem -Path $PackageDir -Directory -Recurse |');
      lines.push('            ForEach-Object { "--find-links=$($_.FullName)" }');
      lines.push('    )');
      lines.push('');

      for (const pkg of pipPackages) {
        lines.push(`    # ${pkg.name} 설치`);
        lines.push(`    Write-Info "${pkg.name}==${pkg.version} 설치 중..."`);
        lines.push('    try {');
        lines.push(`        pip install --no-index @PipFindLinkArgs ${pkg.name}==${pkg.version}`);
        lines.push('    } catch {');
        lines.push(`        Write-Warn "${pkg.name} 설치 실패, 계속 진행합니다."`);
        lines.push('    }');
        lines.push('');
      }

      lines.push('    Write-Info "Python 패키지 설치 완료"');
      lines.push('}');
      lines.push('');
    }

    // Maven 패키지 설치
    if (packagesByType.has('maven')) {
      const mavenCoordinates = this.getMavenCoordinates(packagesByType.get('maven') || []);
      lines.push('#-------------------------------------------------------------------------------');
      lines.push('# Maven 패키지 설치');
      lines.push('#-------------------------------------------------------------------------------');
      lines.push('');
      lines.push('function Install-MavenPackages {');
      lines.push('    Write-Info "Maven 패키지 설치 중..."');
      lines.push('');
      lines.push('    # Maven local repository와 같은 canonical layout을 그대로 복사합니다.');
      lines.push('    $MavenSourceRoot = Join-Path -Path $PackageDir -ChildPath \'m2repo\'');
      lines.push('    if (-not (Test-Path -LiteralPath $MavenSourceRoot -PathType Container)) {');
      lines.push('        $MavenSourceRoot = $PackageDir');
      lines.push('    }');
      lines.push('    $MavenLocalRepo = if ($env:MAVEN_REPO_LOCAL) { $env:MAVEN_REPO_LOCAL } else { Join-Path $HOME \'.m2/repository\' }');
      lines.push('    function Copy-MavenCoordinate {');
      lines.push('        param([string]$RelativePath)');
      lines.push('        $SourcePath = Join-Path -Path $MavenSourceRoot -ChildPath $RelativePath');
      lines.push('        $TargetPath = Join-Path -Path $MavenLocalRepo -ChildPath $RelativePath');
      lines.push('        if (-not (Test-Path -LiteralPath $SourcePath -PathType Container)) {');
      lines.push('            throw "Maven canonical artifact directory를 찾을 수 없습니다: $SourcePath"');
      lines.push('        }');
      lines.push('        New-Item -ItemType Directory -Path $TargetPath -Force -ErrorAction Stop | Out-Null');
      lines.push('        Copy-Item -Path (Join-Path $SourcePath \'*\') -Destination $TargetPath -Recurse -Force -ErrorAction Stop');
      lines.push('    }');
      lines.push('');
      for (const coordinate of mavenCoordinates) {
        const relativePath = `${coordinate.groupPath}/${coordinate.artifactId}/${coordinate.version}`;
        lines.push(`    Copy-MavenCoordinate ${this.powerShellQuote(relativePath)}`);
      }
      if (mavenCoordinates.length === 0) {
        lines.push('    throw "Maven 패키지에 유효한 groupId/artifactId/version 좌표가 없습니다."');
      }
      lines.push('');
      lines.push('    Write-Info "Maven 패키지 설치 완료"');
      lines.push('}');
      lines.push('');
    }

    // Docker 이미지 로드
    if (packagesByType.has('docker')) {
      const dockerPackages = packagesByType.get('docker') || [];

      lines.push('#-------------------------------------------------------------------------------');
      lines.push('# Docker 이미지 로드');
      lines.push('#-------------------------------------------------------------------------------');
      lines.push('');
      lines.push('function Load-DockerImages {');
      lines.push('    Write-Info "Docker 이미지 로드 중..."');
      lines.push('');
      lines.push('    # Docker 설치 확인');
      lines.push('    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {');
      lines.push('        Write-Err "Docker가 설치되어 있지 않습니다."');
      lines.push('        return');
      lines.push('    }');
      lines.push('');

      for (const pkg of dockerPackages) {
        const imageName = pkg.name.replace(/\//g, '_');
        const tarFileName = `${imageName}_${pkg.version}.tar`;
        lines.push(`    # ${pkg.name}:${pkg.version} 로드`);
        lines.push(`    Write-Info "${pkg.name}:${pkg.version} 로드 중..."`);
        lines.push(`    $ImagePath = Join-Path -Path $PackageDir -ChildPath '${tarFileName}'`);
        lines.push('    try {');
        lines.push('        docker load -i $ImagePath');
        lines.push('    } catch {');
        lines.push(`        Write-Warn "${pkg.name}:${pkg.version} 로드 실패"`);
        lines.push('    }');
        lines.push('');
      }

      lines.push('    Write-Info "Docker 이미지 로드 완료"');
      lines.push('}');
      lines.push('');
    }

    // 메인 실행부
    lines.push('#-------------------------------------------------------------------------------');
    lines.push('# 메인 실행');
    lines.push('#-------------------------------------------------------------------------------');
    lines.push('');
    lines.push('Write-Info "====================================="');
    lines.push('Write-Info "DepsSmuggler 패키지 설치 스크립트"');
    lines.push('Write-Info "====================================="');
    lines.push('Write-Host ""');
    lines.push('');

    if (packagesByType.has('pip') || packagesByType.has('conda')) {
      lines.push('Install-PythonPackages');
      lines.push('Write-Host ""');
    }
    if (packagesByType.has('maven')) {
      lines.push('Install-MavenPackages');
      lines.push('Write-Host ""');
    }
    if (packagesByType.has('docker')) {
      lines.push('Load-DockerImages');
      lines.push('Write-Host ""');
    }

    lines.push('');
    lines.push('Write-Info "====================================="');
    lines.push('Write-Info "모든 설치가 완료되었습니다!"');
    lines.push('Write-Info "====================================="');

    const content = lines.join('\r\n'); // Windows 줄바꿈
    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeFile(outputPath, content, 'utf-8');

    logger.info('PowerShell 스크립트 생성 완료', { outputPath });

    return outputPath;
  }

  /**
   * 모든 스크립트 생성
   */
  async generateAllScripts(
    packages: PackageInfo[],
    outputDir: string,
    options: ScriptOptions = {}
  ): Promise<GeneratedScript[]> {
    const results: GeneratedScript[] = [];

    // Bash 스크립트 생성
    const bashPath = path.join(outputDir, 'install.sh');
    await this.generateBashScript(packages, bashPath, options);
    const bashContent = await fs.readFile(bashPath, 'utf-8');
    results.push({ path: bashPath, content: bashContent, type: 'bash' });

    // PowerShell 스크립트 생성
    const psPath = path.join(outputDir, 'install.ps1');
    await this.generatePowerShellScript(packages, psPath, options);
    const psContent = await fs.readFile(psPath, 'utf-8');
    results.push({ path: psPath, content: psContent, type: 'powershell' });

    logger.info('모든 설치 스크립트 생성 완료', { outputDir, count: results.length });

    return results;
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
}

// 싱글톤 인스턴스
let scriptGeneratorInstance: ScriptGenerator | null = null;

export function getScriptGenerator(): ScriptGenerator {
  if (!scriptGeneratorInstance) {
    scriptGeneratorInstance = new ScriptGenerator();
  }
  return scriptGeneratorInstance;
}
