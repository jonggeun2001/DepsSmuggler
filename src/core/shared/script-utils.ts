// 설치 스크립트 생성 유틸리티
import * as fs from 'fs';
import * as path from 'path';
import type { DownloadPackage } from './types';

/**
 * 설치 스크립트 생성 (Bash + PowerShell)
 */
export function generateInstallScripts(
  outputDir: string,
  packages: DownloadPackage[]
): void {
  const bashScript = generateBashScript(packages);
  const psScript = generatePowerShellScript(packages);

  fs.writeFileSync(path.join(outputDir, 'install.sh'), bashScript, { mode: 0o755 });
  fs.writeFileSync(path.join(outputDir, 'install.ps1'), psScript);
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

${pipPackages.length > 0 ? `# pip 패키지 설치
${pipPackages.map((p) => `pip install --no-index --find-links="$ScriptDir\\packages" ${p.name}==${p.version}`).join('\n')}
` : ''}
${condaPackages.length > 0 ? `# conda 패키지 설치
${condaPackages.map((p) => `pip install --no-index --find-links="$ScriptDir\\packages" ${p.name}==${p.version}`).join('\n')}
` : ''}
${mavenPackages.length > 0 ? `# Maven 아티팩트 복사
Write-Host "Maven artifacts are in packages/ directory"
` : ''}
Write-Host "Installation complete!"
`;
}
