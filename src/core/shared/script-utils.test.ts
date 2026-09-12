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

  it('중첩된 pip 아티팩트 디렉터리를 Bash와 PowerShell에서 모두 탐색한다', async () => {
    const outputDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'script-utils-'),
    );
    outputDirs.push(outputDir);

    await generateInstallScripts(outputDir, [
      {
        id: 'pip-requests',
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
    const powerShellBytes = fs.readFileSync(path.join(outputDir, 'install.ps1'));

    expect(powerShellBytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));

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

  it('npm tarball이 없으면 설치 성공 스크립트를 만들지 않는다', async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'script-utils-npm-'));
    outputDirs.push(outputDir);
    await expect((async () => generateInstallScripts(outputDir, [
      { id: 'npm-is-odd', type: 'npm', name: 'is-odd', version: '3.0.1' },
    ]))()).rejects.toThrow();
    expect(fs.existsSync(path.join(outputDir, 'install.sh'))).toBe(false);
  });

  it('npm 루트 다운로드가 모두 실패해도 pip만 설치하는 성공 스크립트를 만들지 않는다', async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'script-utils-root-'));
    outputDirs.push(outputDir);
    await expect(generateInstallScripts(outputDir, [
      { id: 'pip-colorama', type: 'pip', name: 'colorama', version: '0.4.6' },
    ], {
      npmRootPackages: [{ type: 'npm', name: 'is-odd', version: '3.0.1' }],
      npmPackageFiles: [],
    })).rejects.toThrow('is-odd@3.0.1');
    expect(fs.existsSync(path.join(outputDir, 'install.sh'))).toBe(false);
  });
});
