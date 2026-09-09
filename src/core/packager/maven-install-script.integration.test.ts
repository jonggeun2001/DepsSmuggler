import { execFile } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import * as fs from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';
import { getScriptGenerator } from './script-generator';
import { PackageInfo } from '../../types';

const execFileAsync = promisify(execFile);

const MAIN_JAR = 'demo-1.0.0.jar';
const MAIN_POM = 'demo-1.0.0.pom';
const CLASSIFIER_JAR = 'demo-1.0.0-linux-x86_64.jar';
const REMOTE_MARKER = '_remote.repositories';

const countMarkerLine = (markerText: string, expectedLine: string): number => (
  markerText.split(/\r?\n/).filter((line) => line === expectedLine).length
);

describe('Maven install script canonical layout integration', () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => fs.remove(root)));
  });

  it('Maven Bash/PowerShell execution preserves tracking edges and is idempotent', async () => {
    const generator = getScriptGenerator();
    const packageInfo: PackageInfo = {
      type: 'maven',
      name: 'org.example:demo',
      version: '1.0.0',
      metadata: { groupId: 'org.example', artifactId: 'demo' },
    };
    const sourceFiles = new Map<string, Buffer | string>([
      [MAIN_JAR, Buffer.from('source main jar\n', 'utf8')],
      [MAIN_POM, '<project>source pom</project>\n'],
      [`${MAIN_JAR}.sha1`, 'source jar checksum\n'],
      [`${MAIN_POM}.sha1`, 'source pom checksum\n'],
      [`${MAIN_JAR}.md5`, 'source jar md5\n'],
      [`${MAIN_POM}.md5`, 'source pom md5\n'],
      [REMOTE_MARKER, `${MAIN_JAR}>source-repository=\n${MAIN_POM}>source-repository=\n`],
    ]);

    for (const sourceLayout of ['packages', path.join('packages', 'm2repo')]) {
      const extractionRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-maven-script-'));
      temporaryRoots.push(extractionRoot);
      const sourceRoot = path.join(extractionRoot, sourceLayout);
      const coordinatePath = path.join(sourceRoot, 'org', 'example', 'demo', '1.0.0');
      const targetRoot = path.join(extractionRoot, 'target-local-repository');
      const targetCoordinatePath = path.join(targetRoot, 'org', 'example', 'demo', '1.0.0');
      const scriptPath = path.join(
        extractionRoot,
        process.platform === 'win32' ? 'install.ps1' : 'install.sh',
      );

      await fs.ensureDir(coordinatePath);
      await fs.ensureDir(targetCoordinatePath);
      for (const [filename, contents] of sourceFiles) {
        await fs.writeFile(path.join(coordinatePath, filename), contents);
      }
      await fs.writeFile(path.join(targetCoordinatePath, MAIN_JAR), 'stale target main jar\n');
      await fs.writeFile(path.join(targetCoordinatePath, CLASSIFIER_JAR), 'destination-only classifier\n');
      await fs.writeFile(
        path.join(targetCoordinatePath, REMOTE_MARKER),
        `${MAIN_JAR}>target-repository=\n${CLASSIFIER_JAR}>target-repository=`,
      );

      if (process.platform === 'win32') {
        await generator.generatePowerShellScript([packageInfo], scriptPath);
      } else {
        await generator.generateBashScript([packageInfo], scriptPath);
      }

      const command = process.platform === 'win32' ? 'powershell.exe' : 'bash';
      const commandArgs = process.platform === 'win32'
        ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath]
        : [scriptPath];
      const environment = { ...process.env, MAVEN_REPO_LOCAL: targetRoot };

      await execFileAsync(command, commandArgs, {
        cwd: extractionRoot,
        env: environment,
        timeout: 45_000,
      });

      const firstMainJar = await fs.readFile(path.join(targetCoordinatePath, MAIN_JAR));
      const firstPom = await fs.readFile(path.join(targetCoordinatePath, MAIN_POM));
      const firstMarker = await fs.readFile(path.join(targetCoordinatePath, REMOTE_MARKER));
      expect(firstMainJar).toEqual(Buffer.from('source main jar\n', 'utf8'));
      expect(firstPom).toEqual(Buffer.from('<project>source pom</project>\n', 'utf8'));

      const markerText = firstMarker.toString('utf8');
      expect(firstMarker.subarray(0, 3)).not.toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
      expect(markerText).toContain(`${MAIN_JAR}>target-repository=`);
      expect(markerText).toContain(`${CLASSIFIER_JAR}>target-repository=`);
      expect(markerText).not.toContain('source-repository');
      expect(countMarkerLine(markerText, `${MAIN_JAR}>=`)).toBe(1);
      expect(countMarkerLine(markerText, `${MAIN_POM}>=`)).toBe(1);
      expect(markerText).not.toContain(`${CLASSIFIER_JAR}>=`);
      expect(markerText).not.toContain(`${MAIN_JAR}.sha1>=`);
      expect(markerText).not.toContain(`${MAIN_POM}.sha1>=`);

      await execFileAsync(command, commandArgs, {
        cwd: extractionRoot,
        env: environment,
        timeout: 45_000,
      });

      expect(await fs.readFile(path.join(targetCoordinatePath, MAIN_JAR))).toEqual(firstMainJar);
      expect(await fs.readFile(path.join(targetCoordinatePath, MAIN_POM))).toEqual(firstPom);
      expect(await fs.readFile(path.join(targetCoordinatePath, REMOTE_MARKER))).toEqual(firstMarker);
    }
  }, 240_000);

  it('Maven Bash/PowerShell execution resolves relative MAVEN_REPO_LOCAL from SCRIPT_DIR', async () => {
    const generator = getScriptGenerator();
    const packageInfo: PackageInfo = {
      type: 'maven',
      name: 'org.example:relative-repository',
      version: '1.0.0',
      metadata: { groupId: 'org.example', artifactId: 'relative-repository' },
    };
    const extractionRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-maven-relative-repository-'));
    temporaryRoots.push(extractionRoot);
    const scriptDirectory = path.join(extractionRoot, 'delivered-script');
    const callerDirectory = path.join(extractionRoot, 'caller');
    const sourceCoordinatePath = path.join(
      scriptDirectory,
      'packages',
      'org',
      'example',
      'relative-repository',
      '1.0.0',
    );
    const expectedRepository = path.join(scriptDirectory, 'relative-repository');
    const callerRepository = path.join(callerDirectory, 'relative-repository');
    const scriptPath = path.join(
      scriptDirectory,
      process.platform === 'win32' ? 'install.ps1' : 'install.sh',
    );
    const jarFilename = 'relative-repository-1.0.0.jar';
    const pomFilename = 'relative-repository-1.0.0.pom';

    await fs.ensureDir(sourceCoordinatePath);
    await fs.ensureDir(callerDirectory);
    await fs.writeFile(path.join(sourceCoordinatePath, jarFilename), 'relative source jar\n');
    await fs.writeFile(path.join(sourceCoordinatePath, pomFilename), '<project>relative source pom</project>\n');

    if (process.platform === 'win32') {
      await generator.generatePowerShellScript([packageInfo], scriptPath);
    } else {
      await generator.generateBashScript([packageInfo], scriptPath);
    }

    const command = process.platform === 'win32' ? 'powershell.exe' : 'bash';
    const commandArgs = process.platform === 'win32'
      ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath]
      : [scriptPath];
    await execFileAsync(command, commandArgs, {
      cwd: callerDirectory,
      env: { ...process.env, MAVEN_REPO_LOCAL: './relative-repository' },
      timeout: 45_000,
    });

    const targetCoordinatePath = path.join(
      expectedRepository,
      'org',
      'example',
      'relative-repository',
      '1.0.0',
    );
    const markerText = await fs.readFile(path.join(targetCoordinatePath, REMOTE_MARKER), 'utf8');
    expect(await fs.readFile(path.join(targetCoordinatePath, jarFilename), 'utf8'))
      .toBe('relative source jar\n');
    expect(await fs.readFile(path.join(targetCoordinatePath, pomFilename), 'utf8'))
      .toBe('<project>relative source pom</project>\n');
    expect(countMarkerLine(markerText, `${jarFilename}>=`)).toBe(1);
    expect(countMarkerLine(markerText, `${pomFilename}>=`)).toBe(1);
    expect(await fs.pathExists(callerRepository)).toBe(false);
  }, 120_000);

  const skipReadOnlyMarkerFailure = process.platform !== 'win32'
    && typeof process.getuid === 'function'
    && process.getuid() === 0;

  it.skipIf(skipReadOnlyMarkerFailure)('Maven Bash/PowerShell execution fails when target tracking marker cannot be written', async () => {
    const generator = getScriptGenerator();
    const packageInfo: PackageInfo = {
      type: 'maven',
      name: 'org.example:marker-failure',
      version: '1.0.0',
      metadata: { groupId: 'org.example', artifactId: 'marker-failure' },
    };

    for (const sourceLayout of ['packages', path.join('packages', 'm2repo')]) {
      const extractionRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-maven-marker-failure-'));
      temporaryRoots.push(extractionRoot);
      const sourceRoot = path.join(extractionRoot, sourceLayout, 'org', 'example', 'marker-failure', '1.0.0');
      const targetRoot = path.join(extractionRoot, 'target-local-repository');
      const targetCoordinatePath = path.join(targetRoot, 'org', 'example', 'marker-failure', '1.0.0');
      const scriptPath = path.join(
        extractionRoot,
        process.platform === 'win32' ? 'install.ps1' : 'install.sh',
      );

      await fs.ensureDir(sourceRoot);
      await fs.ensureDir(targetCoordinatePath);
      await fs.writeFile(path.join(sourceRoot, MAIN_JAR), 'marker failure main jar\n');
      await fs.writeFile(path.join(sourceRoot, MAIN_POM), '<project>marker failure pom</project>\n');
      const targetMarkerPath = path.join(targetCoordinatePath, REMOTE_MARKER);
      await fs.writeFile(targetMarkerPath, `${MAIN_JAR}>target-repository=`);
      await fs.chmod(targetMarkerPath, 0o444);

      if (process.platform === 'win32') {
        await generator.generatePowerShellScript([packageInfo], scriptPath);
      } else {
        await generator.generateBashScript([packageInfo], scriptPath);
      }

      const command = process.platform === 'win32' ? 'powershell.exe' : 'bash';
      const commandArgs = process.platform === 'win32'
        ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath]
        : [scriptPath];
      try {
        let failure: { stdout?: string; stderr?: string; code?: number | string | null; killed?: boolean } | undefined;
        try {
          await execFileAsync(command, commandArgs, {
            cwd: extractionRoot,
            env: { ...process.env, MAVEN_REPO_LOCAL: targetRoot },
            timeout: 45_000,
          });
        } catch (error) {
          failure = error as { stdout?: string; stderr?: string };
        }

        expect(failure).toBeDefined();
        expect(typeof failure?.code).toBe('number');
        expect(failure?.code).not.toBe(0);
        expect(failure?.killed).not.toBe(true);
        const output = `${failure?.stdout ?? ''}\n${failure?.stderr ?? ''}`;
        expect(output).not.toContain('모든 설치가 완료되었습니다!');
      } finally {
        await fs.chmod(targetMarkerPath, 0o666).catch(() => undefined);
      }
    }
  }, 120_000);

  it('Maven Bash/PowerShell execution does not promote a destination-only POM', async () => {
    const generator = getScriptGenerator();
    const packageInfo: PackageInfo = {
      type: 'maven',
      name: 'org.example:jar-only',
      version: '1.0.0',
      metadata: { groupId: 'org.example', artifactId: 'jar-only' },
    };
    const jarFilename = 'jar-only-1.0.0.jar';
    const pomFilename = 'jar-only-1.0.0.pom';

    for (const sourceLayout of ['packages', path.join('packages', 'm2repo')]) {
      const extractionRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-maven-destination-pom-'));
      temporaryRoots.push(extractionRoot);
      const sourceCoordinatePath = path.join(extractionRoot, sourceLayout, 'org', 'example', 'jar-only', '1.0.0');
      const targetRoot = path.join(extractionRoot, 'target-local-repository');
      const targetCoordinatePath = path.join(targetRoot, 'org', 'example', 'jar-only', '1.0.0');
      const scriptPath = path.join(
        extractionRoot,
        process.platform === 'win32' ? 'install.ps1' : 'install.sh',
      );
      const targetMarkerPath = path.join(targetCoordinatePath, REMOTE_MARKER);

      await fs.ensureDir(sourceCoordinatePath);
      await fs.ensureDir(targetCoordinatePath);
      await fs.writeFile(path.join(sourceCoordinatePath, jarFilename), 'source jar-only artifact\n');
      await fs.writeFile(path.join(targetCoordinatePath, pomFilename), 'destination-only pom\n');
      await fs.writeFile(targetMarkerPath, `${pomFilename}>target-repository=`);

      if (process.platform === 'win32') {
        await generator.generatePowerShellScript([packageInfo], scriptPath);
      } else {
        await generator.generateBashScript([packageInfo], scriptPath);
      }

      const command = process.platform === 'win32' ? 'powershell.exe' : 'bash';
      const commandArgs = process.platform === 'win32'
        ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath]
        : [scriptPath];
      await execFileAsync(command, commandArgs, {
        cwd: extractionRoot,
        env: { ...process.env, MAVEN_REPO_LOCAL: targetRoot },
        timeout: 45_000,
      });

      const markerText = await fs.readFile(targetMarkerPath, 'utf8');
      expect(await fs.readFile(path.join(targetCoordinatePath, pomFilename), 'utf8'))
        .toBe('destination-only pom\n');
      expect(countMarkerLine(markerText, `${pomFilename}>target-repository=`)).toBe(1);
      expect(countMarkerLine(markerText, `${pomFilename}>=`)).toBe(0);
      expect(countMarkerLine(markerText, `${jarFilename}>=`)).toBe(1);
    }
  }, 120_000);
});
