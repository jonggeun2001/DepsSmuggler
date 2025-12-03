/**
 * 설치 스크립트 생성기
 * Bash 및 PowerShell 설치 스크립트를 자동으로 생성
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { PackageInfo } from '../../types';
import logger from '../../utils/logger';

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

/**
 * 설치 스크립트 생성기 클래스
 */
export class ScriptGenerator {
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

      for (const pkg of pipPackages) {
        lines.push(`    # ${pkg.name} 설치`);
        lines.push(`    log_info "${pkg.name}==${pkg.version} 설치 중..."`);
        lines.push(`    pip install --no-index --find-links="$PACKAGE_DIR" ${pkg.name}==${pkg.version} || {`);
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
      const mavenPackages = packagesByType.get('maven') || [];

      lines.push('#-------------------------------------------------------------------------------');
      lines.push('# Maven 패키지 설치');
      lines.push('#-------------------------------------------------------------------------------');
      lines.push('');
      lines.push('install_maven_packages() {');
      lines.push('    log_info "Maven 패키지 설치 중..."');
      lines.push('');
      lines.push('    # Maven 설치 확인');
      lines.push('    if ! command -v mvn &> /dev/null; then');
      lines.push('        log_error "Maven이 설치되어 있지 않습니다."');
      lines.push('        return 1');
      lines.push('    fi');
      lines.push('');
      lines.push('    # 로컬 저장소에 설치');
      lines.push('    for jar in "$PACKAGE_DIR"/*.jar; do');
      lines.push('        if [[ -f "$jar" ]]; then');
      lines.push('            log_info "$(basename "$jar") 설치 중..."');
      lines.push('            mvn install:install-file -Dfile="$jar" -DgeneratePom=true || {');
      lines.push('                log_warn "$(basename "$jar") 설치 실패"');
      lines.push('            }');
      lines.push('        fi');
      lines.push('    done');
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
        const imageName = pkg.name.replace(/[\/]/g, '_');
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
      lines.push('    install_maven_packages');
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
    await fs.writeFile(outputPath, content, { encoding: 'utf-8', mode: 0o755 });

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
      packageDir = '.\\packages',
    } = options;

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

    // 패키지 디렉토리 설정
    lines.push('# 패키지 디렉토리 설정');
    lines.push('$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path');
    lines.push(`$PackageDir = Join-Path $ScriptDir "${packageDir.replace(/\\/g, '\\\\')}"`);
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

      for (const pkg of pipPackages) {
        lines.push(`    # ${pkg.name} 설치`);
        lines.push(`    Write-Info "${pkg.name}==${pkg.version} 설치 중..."`);
        lines.push('    try {');
        lines.push(`        pip install --no-index --find-links="$PackageDir" ${pkg.name}==${pkg.version}`);
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
      lines.push('#-------------------------------------------------------------------------------');
      lines.push('# Maven 패키지 설치');
      lines.push('#-------------------------------------------------------------------------------');
      lines.push('');
      lines.push('function Install-MavenPackages {');
      lines.push('    Write-Info "Maven 패키지 설치 중..."');
      lines.push('');
      lines.push('    # Maven 설치 확인');
      lines.push('    if (-not (Get-Command mvn -ErrorAction SilentlyContinue)) {');
      lines.push('        Write-Err "Maven이 설치되어 있지 않습니다."');
      lines.push('        return');
      lines.push('    }');
      lines.push('');
      lines.push('    # JAR 파일 설치');
      lines.push('    Get-ChildItem "$PackageDir\\*.jar" | ForEach-Object {');
      lines.push('        Write-Info "$($_.Name) 설치 중..."');
      lines.push('        try {');
      lines.push('            mvn install:install-file -Dfile="$($_.FullName)" -DgeneratePom=true');
      lines.push('        } catch {');
      lines.push('            Write-Warn "$($_.Name) 설치 실패"');
      lines.push('        }');
      lines.push('    }');
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
        const imageName = pkg.name.replace(/[\/]/g, '_');
        lines.push(`    # ${pkg.name}:${pkg.version} 로드`);
        lines.push(`    Write-Info "${pkg.name}:${pkg.version} 로드 중..."`);
        lines.push('    try {');
        lines.push(`        docker load -i "$PackageDir\\${imageName}_${pkg.version}.tar"`);
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
