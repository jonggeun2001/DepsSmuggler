/**
 * ScriptGenerator 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { getScriptGenerator, ScriptGenerator } from './script-generator';
import { PackageInfo } from '../../types';

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
    });

    it('Maven 패키지 설치 명령을 포함해야 함', async () => {
      const outputPath = path.join(tempDir, 'install.sh');
      const packages: PackageInfo[] = [
        { name: 'spring-core', version: '5.3.0', type: 'maven' },
      ];

      await generator.generateBashScript(packages, outputPath);

      const content = await fs.readFile(outputPath, 'utf-8');
      expect(content).toContain('mvn');
      expect(content).toContain('install:install-file'); // 로컬 저장소에 설치
    });

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
        { name: 'numpy', version: '1.23.0', type: 'conda' },
        { name: 'spring-core', version: '5.3.0', type: 'maven' },
        { name: 'httpd', version: '2.4.0', type: 'yum' },
        { name: 'nginx', version: 'latest', type: 'docker' },
      ];

      await generator.generateBashScript(packages, outputPath);

      const content = await fs.readFile(outputPath, 'utf-8');

      // 각 패키지 타입에 대한 설치 명령 확인
      expect(content).toContain('pip');
      expect(content).toContain('mvn');
      expect(content).toContain('docker');
    });

    it('conda 패키지도 pip으로 설치되어야 함', async () => {
      const outputPath = path.join(tempDir, 'install.sh');
      const packages: PackageInfo[] = [
        { name: 'numpy', version: '1.23.0', type: 'conda' },
      ];

      await generator.generateBashScript(packages, outputPath);

      const content = await fs.readFile(outputPath, 'utf-8');
      // conda 패키지도 pip install로 처리됨
      expect(content).toContain('pip install');
      expect(content).toContain('numpy');
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
