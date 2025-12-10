// 설치 스크립트 생성 유틸리티
import * as fs from 'fs';
import * as path from 'path';
import type { DownloadPackage } from './types';
import { isWindows } from './path-utils';

/**
 * 설치 스크립트 생성 (Bash + PowerShell)
 */
export function generateInstallScripts(
  outputDir: string,
  packages: DownloadPackage[]
): void {
  const bashScript = generateBashScript(packages);
  const psScript = generatePowerShellScript(packages);

  // Windows에서는 mode 옵션이 무시되므로 조건부 처리
  const bashWriteOptions = isWindows ? {} : { mode: 0o755 };
  fs.writeFileSync(path.join(outputDir, 'install.sh'), bashScript, bashWriteOptions);
  fs.writeFileSync(path.join(outputDir, 'install.ps1'), psScript);

  // Docker 이미지가 포함된 경우 docker-load 스크립트 생성
  const dockerPackages = packages.filter((p) => p.type === 'docker');
  if (dockerPackages.length > 0) {
    const dockerBashScript = generateDockerLoadBashScript(dockerPackages);
    const dockerPsScript = generateDockerLoadPowerShellScript(dockerPackages);

    const dockerBashWriteOptions = isWindows ? {} : { mode: 0o755 };
    fs.writeFileSync(path.join(outputDir, 'docker-load.sh'), dockerBashScript, dockerBashWriteOptions);
    fs.writeFileSync(path.join(outputDir, 'docker-load.ps1'), dockerPsScript);
  }
}

/**
 * Bash 설치 스크립트 생성
 */
function generateBashScript(packages: DownloadPackage[]): string {
  const pipPackages = packages.filter((p) => p.type === 'pip');
  const condaPackages = packages.filter((p) => p.type === 'conda');
  const mavenPackages = packages.filter((p) => p.type === 'maven');

  return `#!/bin/bash
# DepsSmuggler 설치 스크립트
# 생성일: ${new Date().toISOString()}

set -e

echo "Installing packages..."

SCRIPT_DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"

${pipPackages.length > 0 ? `# pip 패키지 설치
${pipPackages.map((p) => `pip install --no-index --find-links="$SCRIPT_DIR/packages" ${p.name}==${p.version}`).join('\n')}
` : ''}
${condaPackages.length > 0 ? `# conda 패키지 설치
${condaPackages.map((p) => `pip install --no-index --find-links="$SCRIPT_DIR/packages" ${p.name}==${p.version}`).join('\n')}
` : ''}
${mavenPackages.length > 0 ? `# Maven 아티팩트 복사
echo "Maven artifacts are in packages/ directory"
` : ''}
echo "Installation complete!"
`;
}

/**
 * PowerShell 설치 스크립트 생성
 */
function generatePowerShellScript(packages: DownloadPackage[]): string {
  const pipPackages = packages.filter((p) => p.type === 'pip');
  const condaPackages = packages.filter((p) => p.type === 'conda');
  const mavenPackages = packages.filter((p) => p.type === 'maven');

  return `# DepsSmuggler 설치 스크립트
# 생성일: ${new Date().toISOString()}

$ErrorActionPreference = "Stop"

Write-Host "Installing packages..."

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$PackagesDir = Join-Path -Path $ScriptDir -ChildPath 'packages'

${pipPackages.length > 0 ? `# pip 패키지 설치
${pipPackages.map((p) => `pip install --no-index --find-links="$PackagesDir" ${p.name}==${p.version}`).join('\n')}
` : ''}
${condaPackages.length > 0 ? `# conda 패키지 설치
${condaPackages.map((p) => `pip install --no-index --find-links="$PackagesDir" ${p.name}==${p.version}`).join('\n')}
` : ''}
${mavenPackages.length > 0 ? `# Maven 아티팩트 복사
Write-Host "Maven artifacts are in packages/ directory"
` : ''}
Write-Host "Installation complete!"
`;
}

/**
 * Docker load Bash 스크립트 생성
 */
function generateDockerLoadBashScript(packages: DownloadPackage[]): string {
  const dockerImages = packages.map((p) => {
    const imageName = p.name.replace(/[:/]/g, '-');
    const fileName = `${imageName}-${p.version}.tar`;
    return {
      fileName,
      fullName: `${p.name}:${p.version}`,
    };
  });

  return `#!/bin/bash
# DepsSmuggler Docker 이미지 로드 스크립트
# 생성일: ${new Date().toISOString()}

set -e

echo "Loading Docker images..."

SCRIPT_DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"

# Docker 설치 확인
if ! command -v docker &> /dev/null; then
    echo "Error: Docker가 설치되어 있지 않습니다."
    exit 1
fi

# Docker 데몬 실행 확인
if ! docker info &> /dev/null; then
    echo "Error: Docker 데몬이 실행 중이지 않습니다."
    exit 1
fi

# 이미지 로드
${dockerImages.map((img) => `echo "Loading ${img.fullName}..."
docker load -i "$SCRIPT_DIR/packages/${img.fileName}"
if [ $? -eq 0 ]; then
    echo "  ✓ ${img.fullName} 로드 완료"
else
    echo "  ✗ ${img.fullName} 로드 실패"
fi
`).join('\n')}

echo ""
echo "Docker 이미지 로드 완료!"
echo "로드된 이미지 목록:"
docker images | head -20
`;
}

/**
 * Docker load PowerShell 스크립트 생성
 */
function generateDockerLoadPowerShellScript(packages: DownloadPackage[]): string {
  const dockerImages = packages.map((p) => {
    const imageName = p.name.replace(/[:/]/g, '-');
    const fileName = `${imageName}-${p.version}.tar`;
    return {
      fileName,
      fullName: `${p.name}:${p.version}`,
    };
  });

  return `# DepsSmuggler Docker 이미지 로드 스크립트
# 생성일: ${new Date().toISOString()}

$ErrorActionPreference = "Stop"

Write-Host "Loading Docker images..."

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PackagesDir = Join-Path -Path $ScriptDir -ChildPath 'packages'

# Docker 설치 확인
try {
    docker --version | Out-Null
} catch {
    Write-Host "Error: Docker가 설치되어 있지 않습니다." -ForegroundColor Red
    exit 1
}

# Docker 데몬 실행 확인
try {
    docker info | Out-Null
} catch {
    Write-Host "Error: Docker 데몬이 실행 중이지 않습니다." -ForegroundColor Red
    exit 1
}

# 이미지 로드
${dockerImages.map((img) => `Write-Host "Loading ${img.fullName}..."
try {
    $ImagePath = Join-Path -Path $PackagesDir -ChildPath '${img.fileName}'
    docker load -i $ImagePath
    Write-Host "  [OK] ${img.fullName} 로드 완료" -ForegroundColor Green
} catch {
    Write-Host "  [FAIL] ${img.fullName} 로드 실패" -ForegroundColor Red
}
`).join('\n')}

Write-Host ""
Write-Host "Docker 이미지 로드 완료!"
Write-Host "로드된 이미지 목록:"
docker images | Select-Object -First 20
`;
}