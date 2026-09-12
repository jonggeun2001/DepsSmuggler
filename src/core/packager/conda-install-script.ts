import type { PackageInfo } from '../../types';

export interface CondaPackageFile {
  relativePath: string;
}


function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function powerShellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}


export function getCondaArchivePaths(
  packages: PackageInfo[],
  packageFiles?: CondaPackageFile[],
): string[] {
  const relativePaths = packageFiles !== undefined
    ? packageFiles.map(file => file.relativePath)
    : packages.map(pkg => {
      const filename = pkg.metadata?.filename;
      if (typeof filename !== 'string' || filename.length === 0) {
        throw new Error(`Conda 패키지 ${pkg.name}@${pkg.version}의 아카이브 파일명이 없습니다 (metadata.filename)`);
      }
      return filename;
    });

  if (relativePaths.length === 0) {
    throw new Error('Conda 패키지 파일 매핑이 비어 있습니다.');
  }

  const normalized = new Set<string>();
  for (const relativePath of relativePaths) {
    if (typeof relativePath !== 'string') {
      throw new Error('Conda 패키지 파일 경로가 유효하지 않습니다.');
    }
    const portablePath = relativePath.replace(/\\/g, '/');
    const segments = portablePath.split('/');
    if (
      portablePath.length === 0 ||
      portablePath.startsWith('/') ||
      /^[A-Za-z]:\//.test(portablePath) ||
      segments.some(segment => segment.length === 0 || segment === '.' || segment === '..') ||
      !/\.(?:conda|tar\.bz2)$/i.test(portablePath)
    ) {
      throw new Error(`Conda 패키지 파일 경로가 유효하지 않습니다: ${relativePath}`);
    }
    normalized.add(portablePath);
  }

  return [...normalized];
}

export function buildCondaBashInstallLines(condaArchivePaths: string[]): string[] {
  const lines: string[] = [];
  lines.push('#-------------------------------------------------------------------------------');
  lines.push('# Conda 패키지 오프라인 설치');
  lines.push('#-------------------------------------------------------------------------------');
  lines.push('');
  lines.push('install_conda_packages() {');
  lines.push('    log_info "Conda 패키지 설치 중..."');
  lines.push('    if ! command -v conda &> /dev/null; then');
  lines.push('        log_error "Conda가 설치되어 있지 않습니다."');
  lines.push('        return 1');
  lines.push('    fi');
  lines.push('');
  lines.push('    local conda_relative_path conda_archive_path');
  lines.push('    local conda_archive_paths=()');
  for (const relativePath of condaArchivePaths) {
    lines.push(`    conda_relative_path=${shellQuote(relativePath)}`);
    lines.push('    conda_archive_path="$SCRIPT_DIR/$PACKAGE_DIR/$conda_relative_path"');
    lines.push('    if [[ ! -f "$conda_archive_path" ]]; then');
    lines.push('        log_error "Conda 아카이브를 찾을 수 없습니다: $conda_archive_path"');
    lines.push('        return 1');
    lines.push('    fi');
    lines.push('    conda_archive_paths+=("$conda_archive_path")');
  }
  lines.push('');
  lines.push('    local conda_prefix="${DEPS_SMUGGLER_CONDA_PREFIX:-$SCRIPT_DIR/conda-env}"');
  lines.push('    if [[ "$conda_prefix" != /* ]]; then conda_prefix="$SCRIPT_DIR/$conda_prefix"; fi');
  lines.push('    if [[ -e "$conda_prefix" && ! -d "$conda_prefix" ]]; then');
  lines.push('        log_error "Conda 환경 경로가 디렉터리가 아닙니다: $conda_prefix"');
  lines.push('        return 1');
  lines.push('    fi');
  lines.push('    if [[ -f "$conda_prefix/conda-meta/history" ]]; then');
  lines.push('        conda install --offline --yes --prefix "$conda_prefix" "${conda_archive_paths[@]}" || {');
  lines.push('            log_error "Conda 패키지 설치에 실패했습니다."');
  lines.push('            return 1');
  lines.push('        }');
  lines.push('    elif [[ -e "$conda_prefix" ]]; then');
  lines.push('        log_error "기존 경로가 Conda 환경이 아닙니다: $conda_prefix"');
  lines.push('        return 1');
  lines.push('    else');
  lines.push('        conda create --offline --yes --no-default-packages --prefix "$conda_prefix" "${conda_archive_paths[@]}" || {');
  lines.push('            log_error "Conda 환경 생성에 실패했습니다."');
  lines.push('            return 1');
  lines.push('        }');
  lines.push('    fi');
  lines.push('    log_info "Conda 패키지 설치 완료: $conda_prefix"');
  lines.push('}');
  lines.push('');
  return lines;
}

export function buildCondaPowerShellInstallLines(condaArchivePaths: string[]): string[] {
  const lines: string[] = [];
  lines.push('#-------------------------------------------------------------------------------');
  lines.push('# Conda 패키지 오프라인 설치');
  lines.push('#-------------------------------------------------------------------------------');
  lines.push('');
  lines.push('function Install-CondaPackages {');
  lines.push('    Write-Info "Conda 패키지 설치 중..."');
  lines.push('    if (-not (Get-Command conda -ErrorAction SilentlyContinue)) {');
  lines.push('        throw "Conda가 설치되어 있지 않습니다."');
  lines.push('    }');
  lines.push('');
  lines.push('    $CondaArchivePaths = @()');
  for (const relativePath of condaArchivePaths) {
    lines.push(`    $CondaArchivePath = Join-Path -Path $PackageDir -ChildPath ${powerShellQuote(relativePath)}`);
    lines.push('    if (-not (Test-Path -LiteralPath $CondaArchivePath -PathType Leaf)) {');
    lines.push('        throw "Conda 아카이브를 찾을 수 없습니다: $CondaArchivePath"');
    lines.push('    }');
    lines.push('    $CondaArchivePaths += $CondaArchivePath');
  }
  lines.push('');
  lines.push('    $CondaPrefix = $env:DEPS_SMUGGLER_CONDA_PREFIX');
  lines.push('    if ([string]::IsNullOrWhiteSpace($CondaPrefix)) {');
  lines.push('        $CondaPrefix = Join-Path -Path $ScriptDir -ChildPath \'conda-env\'');
  lines.push('    } elseif (-not [System.IO.Path]::IsPathRooted($CondaPrefix)) {');
  lines.push('        $CondaPrefix = Join-Path -Path $ScriptDir -ChildPath $CondaPrefix');
  lines.push('    }');
  lines.push('    if (Test-Path -LiteralPath $CondaPrefix -PathType Leaf) {');
  lines.push('        throw "Conda 환경 경로가 디렉터리가 아닙니다: $CondaPrefix"');
  lines.push('    }');
  lines.push('    $CondaHistory = Join-Path -Path $CondaPrefix -ChildPath \'conda-meta/history\'');
  lines.push('    if (Test-Path -LiteralPath $CondaHistory -PathType Leaf) {');
  lines.push('        & conda install --offline --yes --prefix $CondaPrefix @CondaArchivePaths');
  lines.push('        if ($LASTEXITCODE -ne 0) { throw "Conda 패키지 설치에 실패했습니다: 종료 코드 $LASTEXITCODE" }');
  lines.push('    } elseif (Test-Path -LiteralPath $CondaPrefix) {');
  lines.push('        throw "기존 경로가 Conda 환경이 아닙니다: $CondaPrefix"');
  lines.push('    } else {');
  lines.push('        & conda create --offline --yes --no-default-packages --prefix $CondaPrefix @CondaArchivePaths');
  lines.push('        if ($LASTEXITCODE -ne 0) { throw "Conda 환경 생성에 실패했습니다: 종료 코드 $LASTEXITCODE" }');
  lines.push('    }');
  lines.push('    Write-Info "Conda 패키지 설치 완료: $CondaPrefix"');
  lines.push('}');
  lines.push('');
  return lines;
}
