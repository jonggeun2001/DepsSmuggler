/**
 * ScriptGenerator 테스트
 */

import { execFile } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import * as fs from 'fs-extra';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getScriptGenerator, ScriptGenerator } from './script-generator';
import { PackageInfo } from '../../types';

const execFileAsync = promisify(execFile);

describe('ScriptGenerator', () => {
  let generator: ScriptGenerator;
  let tempDir: string;

  beforeEach(async () => {
    generator = getScriptGenerator();
    // 각 테스트마다 고유한 임시 디렉토리 생성
    tempDir = path.join(os.tmpdir(), `scriptgen-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.ensureDir(tempDir);
  });

  afterEach(async () => {
    // 임시 디렉토리 정리
    if (tempDir && await fs.pathExists(tempDir)) {
      await fs.remove(tempDir);
    }
  });

  describe('getScriptGenerator', () => {
    it('싱글톤 인스턴스를 반환해야 함', () => {
      const instance1 = getScriptGenerator();
      const instance2 = getScriptGenerator();
      expect(instance1).toBe(instance2);
    });

    it('ScriptGenerator 인스턴스를 반환해야 함', () => {
      const instance = getScriptGenerator();
      expect(instance).toBeInstanceOf(ScriptGenerator);
    });
  });

  describe('generateBashScript', () => {
    it('빈 패키지 목록으로 스크립트를 생성해야 함', async () => {
      const outputPath = path.join(tempDir, 'install.sh');
      const packages: PackageInfo[] = [];

      const result = await generator.generateBashScript(packages, outputPath);

      expect(result).toBe(outputPath);
      expect(await fs.pathExists(outputPath)).toBe(true);

      const content = await fs.readFile(outputPath, 'utf-8');
      expect(content).toContain('#!/bin/bash');
    });

    it('pip 패키지 설치 명령을 포함해야 함', async () => {
      const outputPath = path.join(tempDir, 'install.sh');
      const packages: PackageInfo[] = [
        { name: 'requests', version: '2.28.0', type: 'pip' },
        { name: 'numpy', version: '1.23.0', type: 'pip' },
      ];

      await generator.generateBashScript(packages, outputPath);

      const content = await fs.readFile(outputPath, 'utf-8');
      expect(content).toContain('pip install');
      expect(content).toContain('--no-index');
      expect(content).toContain('--find-links');
      expect(content).toContain(
        'find "$PACKAGE_DIR" -type d -print0',
      );
      expect(content).toContain(
        '"${PIP_FIND_LINK_ARGS[@]}"',
      );
    });

    it('Maven 패키지 설치 명령을 포함해야 함', async () => {
      const outputPath = path.join(tempDir, 'install.sh');
      const packages: PackageInfo[] = [
        { name: 'org.springframework:spring-core', version: '5.3.0', type: 'maven', metadata: { groupId: 'org.springframework', artifactId: 'spring-core' } },
      ];

      await generator.generateBashScript(packages, outputPath);

      const content = await fs.readFile(outputPath, 'utf-8');
      expect(content).toContain('MAVEN_REPO_LOCAL');
      expect(content).toContain('copy_maven_coordinate');
      expect(content).not.toContain('install:install-file');
    });

    it('Maven canonical tree의 모든 파일을 실제 설치 subprocess로 복사해야 함', async () => {
      const packageCoordinates: PackageInfo[] = [
        { type: 'maven', name: 'org.example:app', version: '1.0', metadata: { groupId: 'org.example', artifactId: 'app' } },
        { type: 'maven', name: 'org.example:parent', version: '1.0', metadata: { groupId: 'org.example', artifactId: 'parent', packaging: 'pom' } },
        { type: 'maven', name: 'org.example:bom', version: '1.0', metadata: { groupId: 'org.example', artifactId: 'bom', packaging: 'pom' } },
        { type: 'maven', name: 'org.example:jar-only', version: '1.0', metadata: { groupId: 'org.example', artifactId: 'jar-only' } },
      ];
      const files = new Map([
        ['org/example/app/1.0/app-1.0.jar', 'app jar'],
        ['org/example/app/1.0/app-1.0.pom', '<project>app companion</project>'],
        ['org/example/app/1.0/app-1.0.jar.sha1', 'app checksum'],
        ['org/example/app/1.0/app-1.0.pom.sha1', 'app POM checksum'],
        ['org/example/app/1.0/app-1.0-linux-x86_64.jar', 'classifier jar'],
        ['org/example/parent/1.0/parent-1.0.pom', '<project>parent</project>'],
        ['org/example/parent/1.0/parent-1.0.pom.sha1', 'parent checksum'],
        ['org/example/bom/1.0/bom-1.0.pom', '<project>bom</project>'],
        ['org/example/jar-only/1.0/jar-only-1.0.jar', 'jar without pom'],
      ]);

      for (const sourceRoot of ['packages', 'packages/m2repo']) {
        const extractionRoot = path.join(os.tmpdir(), `deps smuggler maven-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const sourceDir = path.join(extractionRoot, sourceRoot);
        const targetDir = path.join(extractionRoot, 'isolated-local-repository');
        const usePowerShell = process.platform === 'win32';
        const scriptPath = path.join(extractionRoot, usePowerShell ? 'install.ps1' : 'install.sh');
        await fs.ensureDir(sourceDir);
        for (const [relativePath, contents] of files) {
          const sourcePath = path.join(sourceDir, relativePath);
          await fs.ensureDir(path.dirname(sourcePath));
          await fs.writeFile(sourcePath, contents);
        }
        await fs.writeFile(path.join(extractionRoot, 'packages', 'unrelated-flat.jar'), 'must not be copied');
        await fs.ensureDir(path.join(extractionRoot, 'packages', 'pip'));
        await fs.writeFile(path.join(extractionRoot, 'packages', 'pip', 'requests.whl'), 'must not be copied');
        await fs.ensureDir(path.join(targetDir, 'org/example/app/1.0'));
        await fs.writeFile(path.join(targetDir, 'org/example/app/1.0/_remote.repositories'), 'app-1.0.jar>old-repository=\n');

        try {
          if (usePowerShell) {
            await generator.generatePowerShellScript(packageCoordinates, scriptPath);
          } else {
            await generator.generateBashScript(packageCoordinates, scriptPath);
          }
          const command = usePowerShell ? 'powershell.exe' : 'bash';
          const commandArgs = usePowerShell
            ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath]
            : [scriptPath];
          await execFileAsync(command, commandArgs, {
            cwd: extractionRoot,
            env: { ...process.env, MAVEN_REPO_LOCAL: targetDir },
            timeout: 45_000,
          });
          await execFileAsync(command, commandArgs, {
            cwd: extractionRoot,
            env: { ...process.env, MAVEN_REPO_LOCAL: targetDir },
            timeout: 45_000,
          });

          for (const [relativePath, contents] of files) {
            await expect(fs.readFile(path.join(targetDir, relativePath), 'utf8')).resolves.toBe(contents);
          }
          await expect(fs.pathExists(path.join(targetDir, 'unrelated-flat.jar'))).resolves.toBe(false);
          await expect(fs.pathExists(path.join(targetDir, 'pip', 'requests.whl'))).resolves.toBe(false);
          const remoteMarker = await fs.readFile(path.join(targetDir, 'org/example/app/1.0/_remote.repositories'), 'utf8');
          expect(remoteMarker).toContain('app-1.0.jar>old-repository=');
          expect(remoteMarker).toContain('app-1.0.jar>=');
          expect(remoteMarker).toContain('app-1.0.pom>=');
          expect(remoteMarker).toContain('app-1.0-linux-x86_64.jar>=');
          expect(remoteMarker.match(/app-1\.0\.jar>=/g)).toHaveLength(1);
        } finally {
          await fs.remove(extractionRoot);
        }
      }
    }, 240_000);

    it('Maven canonical source가 없으면 실제 설치 subprocess가 실패해야 함', async () => {
      const extractionRoot = path.join(os.tmpdir(), `deps smuggler maven-missing-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const usePowerShell = process.platform === 'win32';
      const scriptPath = path.join(extractionRoot, usePowerShell ? 'install.ps1' : 'install.sh');
      await fs.ensureDir(path.join(extractionRoot, 'packages'));
      try {
        const packages: PackageInfo[] = [
          { type: 'maven', name: 'org.example:missing', version: '1.0', metadata: { groupId: 'org.example', artifactId: 'missing' } },
        ];
        if (usePowerShell) {
          await generator.generatePowerShellScript(packages, scriptPath);
        } else {
          await generator.generateBashScript(packages, scriptPath);
        }
        const command = usePowerShell ? 'powershell.exe' : 'bash';
        const commandArgs = usePowerShell
          ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath]
          : [scriptPath];
        await expect(execFileAsync(command, commandArgs, {
          cwd: extractionRoot,
          env: { ...process.env, MAVEN_REPO_LOCAL: path.join(extractionRoot, 'target repo') },
          timeout: 45_000,
        })).rejects.toThrow();
      } finally {
        await fs.remove(extractionRoot);
      }
    }, 60_000);

    it('YUM 패키지 설치 명령을 포함해야 함', async () => {
      const outputPath = path.join(tempDir, 'install.sh');
      const packages: PackageInfo[] = [
        { name: 'httpd', version: '2.4.0', type: 'yum' },
      ];

      await generator.generateBashScript(packages, outputPath);

      const content = await fs.readFile(outputPath, 'utf-8');
      expect(content).toMatch(/yum|rpm/);
    });

    it('Docker 이미지 로드 명령을 포함해야 함', async () => {
      const outputPath = path.join(tempDir, 'install.sh');
      const packages: PackageInfo[] = [
        { name: 'nginx', version: 'latest', type: 'docker' },
      ];

      await generator.generateBashScript(packages, outputPath);

      const content = await fs.readFile(outputPath, 'utf-8');
      expect(content).toContain('docker');
      expect(content).toContain('load');
    });

    it('헤더 포함 옵션이 작동해야 함', async () => {
      const outputPath = path.join(tempDir, 'install.sh');
      const packages: PackageInfo[] = [];

      await generator.generateBashScript(packages, outputPath, { includeHeader: true });

      const content = await fs.readFile(outputPath, 'utf-8');
      expect(content).toContain('DepsSmuggler');
      expect(content).toContain('설치 스크립트');
    });

    it('헤더 제외 옵션이 작동해야 함', async () => {
      const outputPath = path.join(tempDir, 'install.sh');
      const packages: PackageInfo[] = [];

      await generator.generateBashScript(packages, outputPath, { includeHeader: false });

      const content = await fs.readFile(outputPath, 'utf-8');
      expect(content).toContain('#!/bin/bash');
    });

    it('에러 핸들링 옵션이 작동해야 함', async () => {
      const outputPath = path.join(tempDir, 'install.sh');
      const packages: PackageInfo[] = [];

      await generator.generateBashScript(packages, outputPath, { includeErrorHandling: true });

      const content = await fs.readFile(outputPath, 'utf-8');
      expect(content).toContain('set -e');
      expect(content).toContain('trap');
    });

    it('커스텀 패키지 디렉토리를 사용해야 함', async () => {
      const outputPath = path.join(tempDir, 'install.sh');
      const packages: PackageInfo[] = [];

      await generator.generateBashScript(packages, outputPath, { packageDir: './custom-packages' });

      const content = await fs.readFile(outputPath, 'utf-8');
      expect(content).toContain('custom-packages');
    });
  });

  describe('generatePowerShellScript', () => {
    it('빈 패키지 목록으로 스크립트를 생성해야 함', async () => {
      const outputPath = path.join(tempDir, 'install.ps1');
      const packages: PackageInfo[] = [];

      const result = await generator.generatePowerShellScript(packages, outputPath);

      expect(result).toBe(outputPath);
      expect(await fs.pathExists(outputPath)).toBe(true);

      const content = await fs.readFile(outputPath, 'utf-8');
      expect(content).toContain('param'); // PowerShell 파라미터
    });

    it('pip 패키지 설치 명령을 포함해야 함', async () => {
      const outputPath = path.join(tempDir, 'install.ps1');
      const packages: PackageInfo[] = [
        { name: 'requests', version: '2.28.0', type: 'pip' },
      ];

      await generator.generatePowerShellScript(packages, outputPath);

      const content = await fs.readFile(outputPath, 'utf-8');
      expect(content).toContain('pip install');
      expect(content).toContain(
        'Get-ChildItem -Path $PackageDir -Directory -Recurse',
      );
      expect(content).toContain('@PipFindLinkArgs');
    });

    it('Maven canonical tree 복사 경로를 생성해야 함', async () => {
      const outputPath = path.join(tempDir, 'install.ps1');
      const packages: PackageInfo[] = [
        { name: 'org.springframework:spring-core', version: '5.3.0', type: 'maven', metadata: { groupId: 'org.springframework', artifactId: 'spring-core' } },
      ];

      await generator.generatePowerShellScript(packages, outputPath);

      const content = await fs.readFile(outputPath, 'utf-8');
      expect(content).toContain('Copy-MavenCoordinate');
      expect(content).toContain('$MavenLocalRepo');
      expect(content).not.toContain('install:install-file');
      expect((await fs.readFile(outputPath)).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    });

    it('Docker 이미지 로드 명령을 포함해야 함', async () => {
      const outputPath = path.join(tempDir, 'install.ps1');
      const packages: PackageInfo[] = [
        { name: 'nginx', version: 'latest', type: 'docker' },
      ];

      await generator.generatePowerShellScript(packages, outputPath);

      const content = await fs.readFile(outputPath, 'utf-8');
      expect(content).toContain('docker');
    });

    it('헤더 포함 옵션이 작동해야 함', async () => {
      const outputPath = path.join(tempDir, 'install.ps1');
      const packages: PackageInfo[] = [];

      await generator.generatePowerShellScript(packages, outputPath, { includeHeader: true });

      const content = await fs.readFile(outputPath, 'utf-8');
      expect(content).toContain('DepsSmuggler');
    });

    it('에러 핸들링 옵션이 작동해야 함', async () => {
      const outputPath = path.join(tempDir, 'install.ps1');
      const packages: PackageInfo[] = [];

      await generator.generatePowerShellScript(packages, outputPath, { includeErrorHandling: true });

      const content = await fs.readFile(outputPath, 'utf-8');
      expect(content).toContain('ErrorActionPreference');
    });
  });

  describe('generateAllScripts', () => {
    it('Bash와 PowerShell 스크립트를 모두 생성해야 함', async () => {
      const packages: PackageInfo[] = [
        { name: 'requests', version: '2.28.0', type: 'pip' },
      ];

      const result = await generator.generateAllScripts(packages, tempDir);

      expect(result.length).toBe(2);

      const bashScript = result.find(s => s.type === 'bash');
      const psScript = result.find(s => s.type === 'powershell');

      expect(bashScript).toBeDefined();
      expect(psScript).toBeDefined();

      if (bashScript) {
        expect(await fs.pathExists(bashScript.path)).toBe(true);
      }
      if (psScript) {
        expect(await fs.pathExists(psScript.path)).toBe(true);
      }
    });

    it('스크립트 내용이 포함되어야 함', async () => {
      const packages: PackageInfo[] = [];

      const result = await generator.generateAllScripts(packages, tempDir);

      for (const script of result) {
        expect(script.content).toBeDefined();
        expect(script.content.length).toBeGreaterThan(0);
      }
    });
  });

  describe('복합 패키지 타입', () => {
    it('여러 타입의 패키지를 처리해야 함', async () => {
      const outputPath = path.join(tempDir, 'install.sh');
      const packages: PackageInfo[] = [
        { name: 'requests', version: '2.28.0', type: 'pip' },
        { name: 'numpy', version: '1.23.0', type: 'conda', metadata: { filename: 'numpy-1.23.0-py312_0.conda' } },
        { name: 'org.springframework:spring-core', version: '5.3.0', type: 'maven', metadata: { groupId: 'org.springframework', artifactId: 'spring-core' } },
        { name: 'httpd', version: '2.4.0', type: 'yum' },
        { name: 'nginx', version: 'latest', type: 'docker' },
      ];

      await generator.generateBashScript(packages, outputPath);

      const content = await fs.readFile(outputPath, 'utf-8');

      // 각 패키지 타입에 대한 설치 명령 확인
      expect(content).toContain('pip');
      expect(content).toContain('copy_maven_coordinate');
      expect(content).toContain('docker');
    });

    it('Conda 패키지는 명시된 archive를 offline 설치해야 함', async () => {
      const outputPath = path.join(tempDir, 'install.sh');
      const packages: PackageInfo[] = [
        {
          name: 'six',
          version: '1.17.0',
          type: 'conda',
          metadata: { filename: 'six-1.17.0-py312h06a4308_0.tar.bz2' },
        },
      ];

      await generator.generateBashScript(packages, outputPath, { includeErrorHandling: false });

      const content = await fs.readFile(outputPath, 'utf-8');
      expect(content).toContain('command -v conda');
      expect(content).toContain('conda create --offline --yes --no-default-packages');
      expect(content).toContain('six-1.17.0-py312h06a4308_0.tar.bz2');
      expect(content).toContain('DEPS_SMUGGLER_CONDA_PREFIX');
      expect(content).toContain('install_conda_packages || exit 1');
      expect(content).not.toContain('pip install');
    });

    it('Conda 매핑은 portable 경로를 dedupe하고 셸 특수문자를 보존해야 함', async () => {
      const bashPath = path.join(tempDir, 'install.sh');
      const powershellPath = path.join(tempDir, 'install.ps1');
      const packages: PackageInfo[] = [
        { name: 'six', version: '1.17.0', type: 'conda' },
      ];
      const relativePath = "nested dir/O'Reilly $six.conda";

      await generator.generateBashScript(packages, bashPath, {
        condaPackageFiles: [{ relativePath }, { relativePath }],
      });
      await generator.generatePowerShellScript(packages, powershellPath, {
        condaPackageFiles: [{ relativePath }],
      });

      const bash = await fs.readFile(bashPath, 'utf-8');
      const powershell = await fs.readFile(powershellPath, 'utf-8');
      expect(bash).toContain("'nested dir/O'\\''Reilly $six.conda'");
      expect(bash.match(/nested dir\/O'\\''Reilly \$six\.conda/g)).toHaveLength(1);
      expect(powershell).toContain("'nested dir/O''Reilly $six.conda'");
    });

    it('Conda 매핑이 없으면 metadata filename을 요구하고 잘못된 경로를 거부해야 함', async () => {
      const outputPath = path.join(tempDir, 'install.sh');
      const packages: PackageInfo[] = [{ name: 'six', version: '1.17.0', type: 'conda' }];

      await expect(generator.generateBashScript(packages, outputPath)).rejects.toThrow(/Conda.*filename|파일명/i);
      await expect(generator.generateBashScript(packages, outputPath, {
        condaPackageFiles: [{ relativePath: '../escape.conda' }],
      })).rejects.toThrow(/경로|상대|portable/i);
    });
  });

  describe('아키텍처 처리', () => {
    it('아키텍처 정보가 있는 패키지를 처리해야 함', async () => {
      const outputPath = path.join(tempDir, 'install.sh');
      const packages: PackageInfo[] = [
        { name: 'numpy', version: '1.23.0', type: 'pip', arch: 'x86_64' },
      ];

      await generator.generateBashScript(packages, outputPath);

      const content = await fs.readFile(outputPath, 'utf-8');
      expect(content).toBeDefined();
    });
  });
});
