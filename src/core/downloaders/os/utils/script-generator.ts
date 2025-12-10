/**
 * OS Package Script Generator
 * 의존성 순서 설치 스크립트 및 로컬 저장소 설정 스크립트 생성
 */

import type { OSPackageInfo, OSPackageManager, ScriptType } from '../types';
import { stripLeadingDotSlash, toUnixPath } from '../../../shared/path-utils';

/**
 * 생성된 스크립트
 */
export interface GeneratedScripts {
  /** Bash 스크립트 */
  bash: string;
  /** PowerShell 스크립트 */
  powershell: string;
}

/**
 * 스크립트 생성 옵션
 */
export interface ScriptGeneratorOptions {
  /** 저장소 이름 */
  repoName?: string;
  /** 패키지 디렉토리 경로 */
  packageDir?: string;
  /** 에러 시 중단 여부 */
  stopOnError?: boolean;
  /** 진행 상황 출력 여부 */
  showProgress?: boolean;
  /** 한국어 주석 포함 여부 */
  includeKoreanComments?: boolean;
}

/**
 * OS 패키지 스크립트 생성기
 */
export class OSScriptGenerator {
  private defaultOptions: Required<ScriptGeneratorOptions> = {
    repoName: 'depssmuggler-local',
    packageDir: './packages',
    stopOnError: true,
    showProgress: true,
    includeKoreanComments: true,
  };

  /**
   * 의존성 순서대로 설치하는 스크립트 생성
   */
  generateDependencyOrderScript(
    packages: OSPackageInfo[],
    packageManager: OSPackageManager,
    options: ScriptGeneratorOptions = {}
  ): GeneratedScripts {
    const opts = { ...this.defaultOptions, ...options };

    return {
      bash: this.generateBashInstallScript(packages, packageManager, opts),
      powershell: this.generatePowerShellInstallScript(packages, packageManager, opts),
    };
  }

  /**
   * 로컬 저장소 설정 스크립트 생성
   */
  generateLocalRepoScript(
    packages: OSPackageInfo[],
    packageManager: OSPackageManager,
    options: ScriptGeneratorOptions = {}
  ): GeneratedScripts {
    const opts = { ...this.defaultOptions, ...options };

    return {
      bash: this.generateBashRepoScript(packages, packageManager, opts),
      powershell: this.generatePowerShellRepoScript(packageManager, opts),
    };
  }

  /**
   * Bash 설치 스크립트 생성
   */
  private generateBashInstallScript(
    packages: OSPackageInfo[],
    pm: OSPackageManager,
    opts: Required<ScriptGeneratorOptions>
  ): string {
    const lines: string[] = [];

    // 헤더
    lines.push('#!/bin/bash');
    if (opts.includeKoreanComments) {
      lines.push('# DepsSmuggler - OS 패키지 설치 스크립트');
      lines.push('# 이 스크립트는 의존성 순서대로 패키지를 설치합니다.');
      lines.push('#');
      lines.push('# 사용법: sudo ./install.sh');
      lines.push('');
    }

    // 에러 처리
    if (opts.stopOnError) {
      lines.push('set -e');
      lines.push('');
    }

    // 변수 설정 - 크로스 플랫폼 경로 처리 (./와 .\ 모두 지원)
    lines.push('SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"');
    lines.push(`PACKAGE_DIR="\${SCRIPT_DIR}/${stripLeadingDotSlash(toUnixPath(opts.packageDir))}"`);
    lines.push('');

    // 관리자 권한 확인
    lines.push('# 관리자 권한 확인');
    lines.push('if [ "$EUID" -ne 0 ]; then');
    lines.push('  echo "이 스크립트는 관리자 권한이 필요합니다."');
    lines.push('  echo "sudo ./install.sh 로 실행해주세요."');
    lines.push('  exit 1');
    lines.push('fi');
    lines.push('');

    // 패키지 존재 확인
    lines.push('# 패키지 디렉토리 확인');
    lines.push('if [ ! -d "${PACKAGE_DIR}" ]; then');
    lines.push('  echo "오류: 패키지 디렉토리를 찾을 수 없습니다: ${PACKAGE_DIR}"');
    lines.push('  exit 1');
    lines.push('fi');
    lines.push('');

    // 설치 시작
    if (opts.showProgress) {
      lines.push(`echo "총 ${packages.length}개의 패키지를 설치합니다..."`);
      lines.push('echo ""');
    }

    // 각 패키지 설치
    const installCmd = this.getInstallCommand(pm);
    packages.forEach((pkg, index) => {
      const filename = this.getPackageFilename(pkg, pm);
      const num = index + 1;
      const total = packages.length;

      if (opts.showProgress) {
        lines.push(`# [${num}/${total}] ${pkg.name}-${pkg.version}`);
        lines.push(`echo "[${num}/${total}] 설치 중: ${pkg.name}-${pkg.version}"`);
      }

      lines.push(`${installCmd} "\${PACKAGE_DIR}/${filename}"`);
      lines.push('');
    });

    // 완료 메시지
    if (opts.showProgress) {
      lines.push('echo ""');
      lines.push('echo "모든 패키지 설치가 완료되었습니다!"');
    }

    return lines.join('\n');
  }

  /**
   * PowerShell 설치 스크립트 생성
   */
  private generatePowerShellInstallScript(
    packages: OSPackageInfo[],
    pm: OSPackageManager,
    opts: Required<ScriptGeneratorOptions>
  ): string {
    const lines: string[] = [];

    // 헤더
    lines.push('# DepsSmuggler - OS 패키지 설치 스크립트 (PowerShell)');
    if (opts.includeKoreanComments) {
      lines.push('# 이 스크립트는 WSL을 통해 Linux 패키지를 설치하는 안내를 제공합니다.');
      lines.push('#');
      lines.push('# 주의: Linux 패키지는 Windows에서 직접 설치할 수 없습니다.');
      lines.push('#       WSL(Windows Subsystem for Linux)을 사용하세요.');
      lines.push('');
    }

    // WSL 확인
    lines.push('$ErrorActionPreference = "Stop"');
    lines.push('');
    lines.push('# WSL 설치 확인');
    lines.push('try {');
    lines.push('    $wslVersion = wsl --version 2>&1');
    lines.push('    if ($LASTEXITCODE -ne 0) {');
    lines.push('        throw "WSL not found"');
    lines.push('    }');
    lines.push('} catch {');
    lines.push('    Write-Host "WSL이 설치되어 있지 않습니다." -ForegroundColor Red');
    lines.push('    Write-Host ""');
    lines.push('    Write-Host "WSL 설치 방법:" -ForegroundColor Yellow');
    lines.push('    Write-Host "  1. PowerShell을 관리자 권한으로 실행"');
    lines.push('    Write-Host "  2. wsl --install 명령 실행"');
    lines.push('    Write-Host "  3. 재부팅 후 Linux 배포판 설정"');
    lines.push('    Write-Host ""');
    lines.push('    Write-Host "설치 후 WSL에서 install.sh를 실행하세요."');
    lines.push('    exit 1');
    lines.push('}');
    lines.push('');

    // 안내 메시지
    lines.push('$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path');
    lines.push('$BashScript = Join-Path $ScriptDir "install.sh"');
    lines.push('');
    lines.push('Write-Host "Linux 패키지 설치 안내" -ForegroundColor Cyan');
    lines.push('Write-Host "========================" -ForegroundColor Cyan');
    lines.push('Write-Host ""');
    lines.push(`Write-Host "패키지 관리자: ${pm}"`);
    lines.push(`Write-Host "패키지 수: ${packages.length}"`);
    lines.push('Write-Host ""');
    lines.push('Write-Host "WSL에서 다음 명령을 실행하세요:" -ForegroundColor Yellow');
    lines.push('Write-Host ""');

    // WSL 경로 변환 및 실행 명령
    lines.push('# Windows 경로를 WSL 경로로 변환');
    lines.push('$WslPath = wsl wslpath -a "$ScriptDir"');
    lines.push('Write-Host "  cd $WslPath" -ForegroundColor Green');
    lines.push('Write-Host "  chmod +x install.sh" -ForegroundColor Green');
    lines.push('Write-Host "  sudo ./install.sh" -ForegroundColor Green');
    lines.push('Write-Host ""');

    // 자동 실행 옵션
    lines.push('$response = Read-Host "WSL에서 자동으로 실행하시겠습니까? (y/N)"');
    lines.push('if ($response -eq "y" -or $response -eq "Y") {');
    lines.push('    Write-Host ""');
    lines.push('    Write-Host "WSL에서 설치 스크립트를 실행합니다..." -ForegroundColor Yellow');
    lines.push('    wsl bash -c "cd \'$WslPath\' && chmod +x install.sh && sudo ./install.sh"');
    lines.push('}');

    return lines.join('\n');
  }

  /**
   * Bash 로컬 저장소 설정 스크립트 생성
   */
  private generateBashRepoScript(
    packages: OSPackageInfo[],
    pm: OSPackageManager,
    opts: Required<ScriptGeneratorOptions>
  ): string {
    const lines: string[] = [];

    // 헤더
    lines.push('#!/bin/bash');
    if (opts.includeKoreanComments) {
      lines.push('# DepsSmuggler - 로컬 저장소 설정 스크립트');
      lines.push('# 이 스크립트는 다운로드된 패키지로 로컬 저장소를 생성합니다.');
      lines.push('#');
      lines.push('# 사용법: sudo ./setup-repo.sh');
      lines.push('');
    }

    if (opts.stopOnError) {
      lines.push('set -e');
      lines.push('');
    }

    // 변수 설정 - 크로스 플랫폼 경로 처리 (./와 .\ 모두 지원)
    lines.push('SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"');
    lines.push(`REPO_DIR="\${SCRIPT_DIR}/${stripLeadingDotSlash(toUnixPath(opts.packageDir))}"`);
    lines.push(`REPO_NAME="${opts.repoName}"`);
    lines.push('');

    // 관리자 권한 확인
    lines.push('# 관리자 권한 확인');
    lines.push('if [ "$EUID" -ne 0 ]; then');
    lines.push('  echo "이 스크립트는 관리자 권한이 필요합니다."');
    lines.push('  echo "sudo ./setup-repo.sh 로 실행해주세요."');
    lines.push('  exit 1');
    lines.push('fi');
    lines.push('');

    // 패키지 관리자별 설정
    switch (pm) {
      case 'yum':
        this.appendYumRepoSetup(lines, opts);
        break;
      case 'apt':
        this.appendAptRepoSetup(lines, opts);
        break;
      case 'apk':
        this.appendApkRepoSetup(lines, opts);
        break;
    }

    return lines.join('\n');
  }

  /**
   * YUM 저장소 설정 추가
   */
  private appendYumRepoSetup(lines: string[], opts: Required<ScriptGeneratorOptions>): void {
    lines.push('# createrepo 설치 확인');
    lines.push('if ! command -v createrepo &> /dev/null; then');
    lines.push('  echo "createrepo 도구가 필요합니다. 설치를 시도합니다..."');
    lines.push('  yum install -y createrepo || dnf install -y createrepo_c');
    lines.push('fi');
    lines.push('');

    lines.push('echo "로컬 YUM 저장소를 생성합니다..."');
    lines.push('');

    lines.push('# 저장소 메타데이터 생성');
    lines.push('createrepo "${REPO_DIR}"');
    lines.push('');

    lines.push('# 저장소 설정 파일 생성');
    lines.push('cat > "/etc/yum.repos.d/${REPO_NAME}.repo" << EOF');
    lines.push('[${REPO_NAME}]');
    lines.push('name=DepsSmuggler Local Repository');
    lines.push('baseurl=file://${REPO_DIR}');
    lines.push('enabled=1');
    lines.push('gpgcheck=0');
    lines.push('EOF');
    lines.push('');

    lines.push('echo "저장소 캐시를 업데이트합니다..."');
    lines.push('yum clean all');
    lines.push('yum makecache');
    lines.push('');

    lines.push('echo ""');
    lines.push('echo "로컬 저장소 설정이 완료되었습니다!"');
    lines.push('echo "저장소 이름: ${REPO_NAME}"');
    lines.push('echo "저장소 경로: ${REPO_DIR}"');
    lines.push('echo ""');
    lines.push('echo "사용 예시:"');
    lines.push('echo "  yum install --disablerepo=* --enablerepo=${REPO_NAME} <패키지명>"');
  }

  /**
   * APT 저장소 설정 추가
   */
  private appendAptRepoSetup(lines: string[], opts: Required<ScriptGeneratorOptions>): void {
    lines.push('# dpkg-dev 설치 확인 (dpkg-scanpackages 포함)');
    lines.push('if ! command -v dpkg-scanpackages &> /dev/null; then');
    lines.push('  echo "dpkg-dev 패키지가 필요합니다. 설치를 시도합니다..."');
    lines.push('  apt-get update && apt-get install -y dpkg-dev');
    lines.push('fi');
    lines.push('');

    lines.push('echo "로컬 APT 저장소를 생성합니다..."');
    lines.push('');

    lines.push('# Packages.gz 생성');
    lines.push('cd "${REPO_DIR}"');
    lines.push('dpkg-scanpackages . /dev/null | gzip -9c > Packages.gz');
    lines.push('');

    lines.push('# sources.list.d에 저장소 추가');
    lines.push('echo "deb [trusted=yes] file://${REPO_DIR} ./" > "/etc/apt/sources.list.d/${REPO_NAME}.list"');
    lines.push('');

    lines.push('echo "패키지 목록을 업데이트합니다..."');
    lines.push('apt-get update');
    lines.push('');

    lines.push('echo ""');
    lines.push('echo "로컬 저장소 설정이 완료되었습니다!"');
    lines.push('echo "저장소 이름: ${REPO_NAME}"');
    lines.push('echo "저장소 경로: ${REPO_DIR}"');
    lines.push('echo ""');
    lines.push('echo "사용 예시:"');
    lines.push('echo "  apt-get install <패키지명>"');
  }

  /**
   * APK 저장소 설정 추가
   */
  private appendApkRepoSetup(lines: string[], opts: Required<ScriptGeneratorOptions>): void {
    lines.push('echo "로컬 APK 저장소를 설정합니다..."');
    lines.push('');

    lines.push('# APKINDEX 생성 (apk-tools 필요)');
    lines.push('if command -v apk &> /dev/null; then');
    lines.push('  cd "${REPO_DIR}"');
    lines.push('  ');
    lines.push('  # 기존 APKINDEX 삭제');
    lines.push('  rm -f APKINDEX.tar.gz');
    lines.push('  ');
    lines.push('  # 새 APKINDEX 생성');
    lines.push('  apk index -o APKINDEX.tar.gz *.apk 2>/dev/null || {');
    lines.push('    echo "APKINDEX 생성을 건너뜁니다. (개별 패키지 설치 가능)"');
    lines.push('  }');
    lines.push('fi');
    lines.push('');

    lines.push('# 저장소 추가');
    lines.push('REPO_LINE="${REPO_DIR}"');
    lines.push('if ! grep -q "${REPO_LINE}" /etc/apk/repositories 2>/dev/null; then');
    lines.push('  echo "${REPO_LINE}" >> /etc/apk/repositories');
    lines.push('fi');
    lines.push('');

    lines.push('echo "패키지 목록을 업데이트합니다..."');
    lines.push('apk update --allow-untrusted');
    lines.push('');

    lines.push('echo ""');
    lines.push('echo "로컬 저장소 설정이 완료되었습니다!"');
    lines.push('echo "저장소 경로: ${REPO_DIR}"');
    lines.push('echo ""');
    lines.push('echo "사용 예시:"');
    lines.push('echo "  apk add --allow-untrusted <패키지명>"');
    lines.push('echo ""');
    lines.push('echo "또는 직접 설치:"');
    lines.push('echo "  apk add --allow-untrusted ${REPO_DIR}/<패키지파일>.apk"');
  }

  /**
   * PowerShell 로컬 저장소 설정 스크립트 생성
   */
  private generatePowerShellRepoScript(
    pm: OSPackageManager,
    opts: Required<ScriptGeneratorOptions>
  ): string {
    const lines: string[] = [];

    lines.push('# DepsSmuggler - 로컬 저장소 설정 스크립트 (PowerShell)');
    if (opts.includeKoreanComments) {
      lines.push('# 이 스크립트는 WSL을 통해 Linux 로컬 저장소를 설정합니다.');
      lines.push('');
    }

    lines.push('$ErrorActionPreference = "Stop"');
    lines.push('');

    lines.push('$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path');
    lines.push('');

    lines.push('Write-Host "Linux 로컬 저장소 설정 안내" -ForegroundColor Cyan');
    lines.push('Write-Host "==============================" -ForegroundColor Cyan');
    lines.push('Write-Host ""');
    lines.push(`Write-Host "패키지 관리자: ${pm}"`);
    lines.push('Write-Host ""');
    lines.push('Write-Host "WSL에서 다음 명령을 실행하세요:" -ForegroundColor Yellow');
    lines.push('Write-Host ""');

    lines.push('$WslPath = wsl wslpath -a "$ScriptDir"');
    lines.push('Write-Host "  cd $WslPath" -ForegroundColor Green');
    lines.push('Write-Host "  chmod +x setup-repo.sh" -ForegroundColor Green');
    lines.push('Write-Host "  sudo ./setup-repo.sh" -ForegroundColor Green');
    lines.push('Write-Host ""');

    lines.push('$response = Read-Host "WSL에서 자동으로 실행하시겠습니까? (y/N)"');
    lines.push('if ($response -eq "y" -or $response -eq "Y") {');
    lines.push('    Write-Host ""');
    lines.push('    Write-Host "WSL에서 저장소 설정 스크립트를 실행합니다..." -ForegroundColor Yellow');
    lines.push('    wsl bash -c "cd \'$WslPath\' && chmod +x setup-repo.sh && sudo ./setup-repo.sh"');
    lines.push('}');

    return lines.join('\n');
  }

  /**
   * 패키지 관리자별 설치 명령
   */
  private getInstallCommand(pm: OSPackageManager): string {
    switch (pm) {
      case 'yum':
        return 'rpm -ivh --nodeps';
      case 'apt':
        return 'dpkg -i --force-depends';
      case 'apk':
        return 'apk add --allow-untrusted';
      default:
        throw new Error(`Unsupported package manager: ${pm}`);
    }
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
}
