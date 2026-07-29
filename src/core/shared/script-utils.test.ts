import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import { generateInstallScripts } from './script-utils';

describe('generateInstallScripts', () => {
  const outputDirs: string[] = [];

  afterEach(() => {
    for (const outputDir of outputDirs.splice(0)) {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('중첩된 pip 아티팩트 디렉터리를 Bash와 PowerShell에서 모두 탐색한다', () => {
    const outputDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'script-utils-'),
    );
    outputDirs.push(outputDir);

    generateInstallScripts(outputDir, [
      {
        name: 'requests',
        version: '2.28.0',
        type: 'pip',
      },
    ]);

    const bashScript = fs.readFileSync(
      path.join(outputDir, 'install.sh'),
      'utf8',
    );
    const powerShellScript = fs.readFileSync(
      path.join(outputDir, 'install.ps1'),
      'utf8',
    );

    expect(bashScript).toContain(
      'find "$SCRIPT_DIR/packages" -type d -print0',
    );
    expect(bashScript).toContain(
      '"${PIP_FIND_LINK_ARGS[@]}"',
    );
    expect(powerShellScript).toContain(
      'Get-ChildItem -Path $PackagesDir -Directory -Recurse',
    );
    expect(powerShellScript).toContain('@PipFindLinkArgs');
  });
});
