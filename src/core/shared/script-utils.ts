// 설치 스크립트 생성 유틸리티
import * as fs from 'fs';
import * as path from 'path';
import type { DownloadPackage } from './types';
import { isWindows } from './path-utils';
import type { PackageInfo } from '../../types';
import { createNpmInstallPlan, type NpmInstallPlan, type NpmPackageFile } from '../packager/npm-install-plan';
import { buildNpmBashInstallLines, buildNpmPowerShellInstallLines } from '../packager/npm-install-script';
import {
  getCondaArchivePaths,
  buildCondaBashInstallLines,
  buildCondaPowerShellInstallLines,
  type CondaPackageFile,
} from '../packager/conda-install-script';

export interface InstallScriptOptions {
  npmRootPackages?: PackageInfo[];
  npmPackageFiles?: NpmPackageFile[];
  condaPackageFiles?: CondaPackageFile[];
}

/**
 * 설치 스크립트 생성 (Bash + PowerShell)
 */
export async function generateInstallScripts(
  outputDir: string,
  packages: DownloadPackage[],
  options: InstallScriptOptions = {},
): Promise<void> {
  for (const root of options.npmRootPackages ?? []) {
    if (root.type === 'npm' && !packages.some(pkg =>
      pkg.type === 'npm' && pkg.name === root.name && pkg.version === root.version)) {
      throw new Error(`직접 npm 패키지 다운로드가 누락되었습니다: ${root.name}@${root.version}`);
    }
  }
  const npmPlan = packages.some(pkg => pkg.type === 'npm')
    ? await createNpmInstallPlan(
        packages.map(pkg => ({ ...pkg, type: pkg.type as PackageInfo['type'] })),
        path.join(outputDir, 'install.sh'),
        './packages',
        options.npmPackageFiles,
        options.npmRootPackages,
      )
    : undefined;
  const condaPackages = packages.filter(pkg => pkg.type === 'conda');
  const condaArchivePaths = condaPackages.length > 0
    ? getCondaArchivePaths(
        condaPackages.map(pkg => ({ ...pkg, type: 'conda' as const })),
        options.condaPackageFiles,
      )
    : undefined;
  const bashScript = generateBashScript(packages, npmPlan, condaArchivePaths);
  const psScript = generatePowerShellScript(packages, npmPlan, condaArchivePaths);

  // Windows에서는 mode 옵션이 무시되므로 조건부 처리
  const bashWriteOptions = isWindows ? {} : { mode: 0o755 };
  fs.writeFileSync(path.join(outputDir, 'install.sh'), bashScript, bashWriteOptions);
  // Windows PowerShell 5.1 needs the UTF-8 BOM to decode Korean diagnostics correctly.
  fs.writeFileSync(
    path.join(outputDir, 'install.ps1'),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(psScript, 'utf8')]),
  );

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
function generateBashScript(
  packages: DownloadPackage[], npmPlan?: NpmInstallPlan, condaArchivePaths?: string[],
): string {
  const pipPackages = packages.filter((p) => p.type === 'pip');
  const mavenPackages = packages.filter((p) => p.type === 'maven');

  return `#!/bin/bash
# DepsSmuggler 설치 스크립트
# 생성일: ${new Date().toISOString()}

set -e

echo "Installing packages..."

SCRIPT_DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"

${npmPlan || condaArchivePaths ? `PACKAGE_DIR="./packages"
log_info() { echo "$@"; }
log_error() { echo "$@" >&2; }
${npmPlan ? buildNpmBashInstallLines(npmPlan).join('\n') : ''}
${condaArchivePaths ? buildCondaBashInstallLines(condaArchivePaths).join('\n') : ''}
` : ''}

${pipPackages.length > 0 ? `PIP_FIND_LINK_ARGS=()
while IFS= read -r -d '' directory; do
    PIP_FIND_LINK_ARGS+=(--find-links="$directory")
done < <(find "$SCRIPT_DIR/packages" -type d -print0)

` : ''}
${pipPackages.length > 0 ? `# pip 패키지 설치
${pipPackages.map((p) => `pip install --no-index "\${PIP_FIND_LINK_ARGS[@]}" ${p.name}==${p.version}`).join('\n')}
` : ''}
${condaArchivePaths ? 'install_conda_packages || exit 1' : ''}
${mavenPackages.length > 0 ? `# Maven 아티팩트 복사
echo "Maven artifacts are in packages/ directory"
` : ''}
${npmPlan ? 'install_npm_packages || exit 1' : ''}
echo "Installation complete!"
`;
}

/**
 * PowerShell 설치 스크립트 생성
 */
function generatePowerShellScript(
  packages: DownloadPackage[], npmPlan?: NpmInstallPlan, condaArchivePaths?: string[],
): string {
  const pipPackages = packages.filter((p) => p.type === 'pip');
  const mavenPackages = packages.filter((p) => p.type === 'maven');

  return `# DepsSmuggler 설치 스크립트
# 생성일: ${new Date().toISOString()}

$ErrorActionPreference = "Stop"

Write-Host "Installing packages..."

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$PackagesDir = Join-Path -Path $ScriptDir -ChildPath 'packages'

${npmPlan || condaArchivePaths ? `$PackageDir = $PackagesDir
function Write-Info { param([string]$Message) Write-Host $Message }
${npmPlan ? buildNpmPowerShellInstallLines(npmPlan).join('\n') : ''}
${condaArchivePaths ? buildCondaPowerShellInstallLines(condaArchivePaths).join('\n') : ''}
` : ''}

${pipPackages.length > 0 ? `$PipFindLinkArgs = @("--find-links=$PackagesDir")
$PipFindLinkArgs += @(
    Get-ChildItem -Path $PackagesDir -Directory -Recurse |
        ForEach-Object { "--find-links=$($_.FullName)" }
)

` : ''}
${pipPackages.length > 0 ? `# pip 패키지 설치
${pipPackages.map((p) => `pip install --no-index @PipFindLinkArgs ${p.name}==${p.version}
if ($LASTEXITCODE -ne 0) { throw "pip 패키지 설치에 실패했습니다: 종료 코드 $LASTEXITCODE" }`).join('\n')}
` : ''}
${condaArchivePaths ? 'Install-CondaPackages' : ''}
${mavenPackages.length > 0 ? `# Maven 아티팩트 복사
Write-Host "Maven artifacts are in packages/ directory"
` : ''}
${npmPlan ? 'Install-NpmPackages' : ''}
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
