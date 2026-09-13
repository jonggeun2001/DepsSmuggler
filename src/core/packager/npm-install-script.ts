import type { NpmInstallPlan } from './npm-install-plan';
import { buildNpmProjectSetupScript } from './npm-install-runtime';

export function buildNpmBashInstallLines(npmPlan: NpmInstallPlan): string[] {
  const lines: string[] = [];
  lines.push('#-------------------------------------------------------------------------------');
  lines.push('# npm 패키지 오프라인 설치');
  lines.push('#-------------------------------------------------------------------------------');
  lines.push('');
  lines.push('install_npm_packages() {');
  lines.push('    log_info "npm 패키지 설치 중..."');
  lines.push('    if ! command -v node &> /dev/null || ! command -v npm &> /dev/null; then');
  lines.push('        log_error "Node.js와 npm이 설치되어 있어야 합니다."');
  lines.push('        return 1');
  lines.push('    fi');
  lines.push('');
  lines.push('    local npm_project_encoded npm_project');
  lines.push('    npm_project_encoded="$(node - "$SCRIPT_DIR" "$PACKAGE_DIR" <<\'DEPS_SMUGGLER_NPM\'');
  lines.push(buildNpmProjectSetupScript(npmPlan));
  lines.push('DEPS_SMUGGLER_NPM');
  lines.push('    )" || return 1');
  lines.push('    npm_project="$(node -e \'process.stdout.write(Buffer.from(process.argv[1], "base64").toString("utf8"))\' "$npm_project_encoded")" || return 1');
  lines.push('');
  lines.push('    npm install --offline --no-audit --no-fund --update-notifier=false --no-save --package-lock=false --global=false --prefix "$npm_project" || {');
  lines.push('        log_error "npm 패키지 설치에 실패했습니다."');
  lines.push('        return 1');
  lines.push('    }');
  lines.push('    log_info "npm 패키지 설치 완료: $npm_project/node_modules"');
  lines.push('}');
  lines.push('');
  return lines;
}

export function buildNpmPowerShellInstallLines(npmPlan: NpmInstallPlan): string[] {
  const lines: string[] = [];
  lines.push('#-------------------------------------------------------------------------------');
  lines.push('# npm 패키지 오프라인 설치');
  lines.push('#-------------------------------------------------------------------------------');
  lines.push('');
  lines.push('function Install-NpmPackages {');
  lines.push('    Write-Info "npm 패키지 설치 중..."');
  lines.push('    if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {');
  lines.push('        throw "Node.js와 npm이 설치되어 있어야 합니다."');
  lines.push('    }');
  lines.push('    $NpmSetupScript = @\'');
  lines.push(buildNpmProjectSetupScript(npmPlan));
  lines.push('\'@');
  lines.push('    $NpmProjectEncoded = $NpmSetupScript | & node - "$ScriptDir" "$PackageDir"');
  lines.push('    if ($LASTEXITCODE -ne 0) { throw "npm 설치 프로젝트 준비에 실패했습니다." }');
  lines.push('    $NpmProject = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($NpmProjectEncoded))');
  lines.push('    Push-Location -LiteralPath $NpmProject -ErrorAction Stop');
  lines.push('    try {');
  lines.push('        & npm install --offline --no-audit --no-fund --update-notifier=false --no-save --package-lock=false --global=false');
  lines.push('        if ($LASTEXITCODE -ne 0) { throw "npm 패키지 설치에 실패했습니다: 종료 코드 $LASTEXITCODE" }');
  lines.push('    } finally {');
  lines.push('        Pop-Location');
  lines.push('    }');
  lines.push('    Write-Info "npm 패키지 설치 완료: $NpmProject/node_modules"');
  lines.push('}');
  lines.push('');
  return lines;
}
