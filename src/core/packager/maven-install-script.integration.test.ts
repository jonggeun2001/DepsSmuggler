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
    const packageCases = [
      {
        packageInfo: {
          type: 'maven' as const,
          name: 'org.example:demo',
          version: '1.0.0',
          metadata: { groupId: 'org.example', artifactId: 'demo' },
        },
        artifactId: 'demo',
        mainJar: MAIN_JAR,
        mainPom: MAIN_POM,
        classifierJar: CLASSIFIER_JAR,
        sourceJar: 'source main jar\n',
        sourcePom: '<project>source pom</project>\n',
      },
      {
        packageInfo: {
          type: 'maven' as const,
          name: 'org.example:.demo',
          version: '1.0.0',
          metadata: { groupId: 'org.example', artifactId: '.demo' },
        },
        artifactId: '.demo',
        mainJar: '.demo-1.0.0.jar',
        mainPom: '.demo-1.0.0.pom',
        classifierJar: '.demo-1.0.0-linux-x86_64.jar',
        sourceJar: 'source leading-dot jar\n',
        sourcePom: '<project>source leading-dot pom</project>\n',
      },
    ];

    for (const packageCase of packageCases) {
      const sourceFiles = new Map<string, Buffer | string>([
        [packageCase.mainJar, Buffer.from(packageCase.sourceJar, 'utf8')],
        [packageCase.mainPom, packageCase.sourcePom],
        [`${packageCase.mainJar}.sha1`, 'source jar checksum\n'],
        [`${packageCase.mainPom}.sha1`, 'source pom checksum\n'],
        [`${packageCase.mainJar}.md5`, 'source jar md5\n'],
        [`${packageCase.mainPom}.md5`, 'source pom md5\n'],
        [REMOTE_MARKER, `${packageCase.mainJar}>source-repository=\n${packageCase.mainPom}>source-repository=\n`],
      ]);

      for (const sourceLayout of ['packages', path.join('packages', 'm2repo')]) {
        const extractionRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-maven-script-'));
        temporaryRoots.push(extractionRoot);
        const sourceRoot = path.join(extractionRoot, sourceLayout);
        const coordinatePath = path.join(sourceRoot, 'org', 'example', packageCase.artifactId, '1.0.0');
        const targetRoot = path.join(extractionRoot, 'target-local-repository');
        const targetCoordinatePath = path.join(targetRoot, 'org', 'example', packageCase.artifactId, '1.0.0');
        const scriptPath = path.join(
          extractionRoot,
          process.platform === 'win32' ? 'install.ps1' : 'install.sh',
        );

        await fs.ensureDir(coordinatePath);
        await fs.ensureDir(targetCoordinatePath);
        for (const [filename, contents] of sourceFiles) {
          await fs.writeFile(path.join(coordinatePath, filename), contents);
        }
        await fs.writeFile(path.join(targetCoordinatePath, packageCase.mainJar), 'stale target main jar\n');
        await fs.writeFile(path.join(targetCoordinatePath, packageCase.classifierJar), 'destination-only classifier\n');
        await fs.writeFile(
          path.join(targetCoordinatePath, REMOTE_MARKER),
          `${packageCase.mainJar}>target-repository=\n${packageCase.classifierJar}>target-repository=`,
        );

        if (process.platform === 'win32') {
          await generator.generatePowerShellScript([packageCase.packageInfo], scriptPath);
        } else {
          await generator.generateBashScript([packageCase.packageInfo], scriptPath);
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

        const firstMainJar = await fs.readFile(path.join(targetCoordinatePath, packageCase.mainJar));
        const firstPom = await fs.readFile(path.join(targetCoordinatePath, packageCase.mainPom));
        const firstChecksums = await Promise.all([
          `${packageCase.mainJar}.sha1`,
          `${packageCase.mainPom}.sha1`,
          `${packageCase.mainJar}.md5`,
          `${packageCase.mainPom}.md5`,
        ].map(async (filename) => [
          filename,
          await fs.readFile(path.join(targetCoordinatePath, filename)),
        ] as const));
        const firstClassifier = await fs.readFile(path.join(targetCoordinatePath, packageCase.classifierJar));
        const firstMarker = await fs.readFile(path.join(targetCoordinatePath, REMOTE_MARKER));
        expect(firstMainJar).toEqual(Buffer.from(packageCase.sourceJar, 'utf8'));
        expect(firstPom).toEqual(Buffer.from(packageCase.sourcePom, 'utf8'));
        for (const [filename, contents] of firstChecksums) {
          expect(contents).toEqual(await fs.readFile(path.join(coordinatePath, filename)));
        }
        expect(firstClassifier).toEqual(Buffer.from('destination-only classifier\n', 'utf8'));

        const markerText = firstMarker.toString('utf8');
        expect(firstMarker.subarray(0, 3)).not.toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
        expect(markerText).toContain(`${packageCase.mainJar}>target-repository=`);
        expect(markerText).toContain(`${packageCase.classifierJar}>target-repository=`);
        expect(markerText).not.toContain('source-repository');
        expect(countMarkerLine(markerText, `${packageCase.mainJar}>=`)).toBe(1);
        expect(countMarkerLine(markerText, `${packageCase.mainPom}>=`)).toBe(1);
        expect(markerText).not.toContain(`${packageCase.classifierJar}>=`);
        expect(markerText).not.toContain(`${packageCase.mainJar}.sha1>=`);
        expect(markerText).not.toContain(`${packageCase.mainPom}.sha1>=`);

        await execFileAsync(command, commandArgs, {
          cwd: extractionRoot,
          env: environment,
          timeout: 45_000,
        });

        expect(await fs.readFile(path.join(targetCoordinatePath, packageCase.mainJar))).toEqual(firstMainJar);
        expect(await fs.readFile(path.join(targetCoordinatePath, packageCase.mainPom))).toEqual(firstPom);
        for (const [filename, contents] of firstChecksums) {
          expect(await fs.readFile(path.join(targetCoordinatePath, filename))).toEqual(contents);
        }
        expect(await fs.readFile(path.join(targetCoordinatePath, packageCase.classifierJar))).toEqual(firstClassifier);
        expect(await fs.readFile(path.join(targetCoordinatePath, REMOTE_MARKER))).toEqual(firstMarker);
      }
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

  it('Maven Bash/PowerShell execution disambiguates CLI and GUI m2repo layouts by GAV', async () => {
    const generator = getScriptGenerator();
    const packageInfo: PackageInfo = {
      type: 'maven',
      name: 'm2repo.example:demo',
      version: '1.0.0',
      metadata: { groupId: 'm2repo.example', artifactId: 'demo' },
    };
    const layoutCases = [
      {
        name: 'cli',
        sourceCoordinateSuffix: path.join('packages', 'm2repo', 'example', 'demo', '1.0.0'),
      },
      {
        name: 'gui',
        sourceCoordinateSuffix: path.join('packages', 'm2repo', 'm2repo', 'example', 'demo', '1.0.0'),
      },
    ];
    const jarFilename = 'demo-1.0.0.jar';
    const pomFilename = 'demo-1.0.0.pom';

    for (const layoutCase of layoutCases) {
      const extractionRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), `depssmuggler-maven-layout-${layoutCase.name}-`),
      );
      temporaryRoots.push(extractionRoot);
      const sourceCoordinatePath = path.join(extractionRoot, 'delivered-script', layoutCase.sourceCoordinateSuffix);
      const targetRoot = path.join(extractionRoot, 'target-local-repository');
      const targetCoordinatePath = path.join(targetRoot, 'm2repo', 'example', 'demo', '1.0.0');
      const scriptPath = path.join(
        extractionRoot,
        'delivered-script',
        process.platform === 'win32' ? 'install.ps1' : 'install.sh',
      );

      await fs.ensureDir(sourceCoordinatePath);
      await fs.writeFile(path.join(sourceCoordinatePath, jarFilename), `${layoutCase.name} source jar\n`);
      await fs.writeFile(path.join(sourceCoordinatePath, pomFilename), `<project>${layoutCase.name} source pom</project>\n`);

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

      const markerText = await fs.readFile(path.join(targetCoordinatePath, REMOTE_MARKER), 'utf8');
      expect(await fs.readFile(path.join(targetCoordinatePath, jarFilename), 'utf8'))
        .toBe(`${layoutCase.name} source jar\n`);
      expect(await fs.readFile(path.join(targetCoordinatePath, pomFilename), 'utf8'))
        .toBe(`<project>${layoutCase.name} source pom</project>\n`);
      expect(countMarkerLine(markerText, `${jarFilename}>=`)).toBe(1);
      expect(countMarkerLine(markerText, `${pomFilename}>=`)).toBe(1);
    }
  }, 120_000);

  it('Maven Bash/PowerShell execution preserves coexisting GAVs on their own layout paths', async () => {
    const generator = getScriptGenerator();
    const packageCases = [
      {
        packageInfo: {
          type: 'maven' as const,
          name: 'example:demo',
          version: '1.0.0',
          metadata: { groupId: 'example', artifactId: 'demo' },
        },
        targetCoordinateSuffix: path.join('example', 'demo', '1.0.0'),
        jarFilename: 'demo-1.0.0.jar',
        pomFilename: 'demo-1.0.0.pom',
      },
      {
        packageInfo: {
          type: 'maven' as const,
          name: 'm2repo.example:demo',
          version: '1.0.0',
          metadata: { groupId: 'm2repo.example', artifactId: 'demo' },
        },
        targetCoordinateSuffix: path.join('m2repo', 'example', 'demo', '1.0.0'),
        jarFilename: 'demo-1.0.0.jar',
        pomFilename: 'demo-1.0.0.pom',
      },
    ];
    const layoutCases = [
      {
        name: 'cli',
        sourceCoordinateSuffixes: [
          path.join('packages', 'example', 'demo', '1.0.0'),
          path.join('packages', 'm2repo', 'example', 'demo', '1.0.0'),
        ],
      },
      {
        name: 'gui',
        sourceCoordinateSuffixes: [
          path.join('packages', 'm2repo', 'example', 'demo', '1.0.0'),
          path.join('packages', 'm2repo', 'm2repo', 'example', 'demo', '1.0.0'),
        ],
      },
    ];

    for (const layoutCase of layoutCases) {
      const extractionRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), `depssmuggler-maven-layout-coexistence-${layoutCase.name}-`),
      );
      temporaryRoots.push(extractionRoot);
      const scriptDirectory = path.join(extractionRoot, 'delivered-script');
      const targetRoot = path.join(extractionRoot, 'target-local-repository');
      const scriptPath = path.join(
        scriptDirectory,
        process.platform === 'win32' ? 'install.ps1' : 'install.sh',
      );

      for (let index = 0; index < packageCases.length; index += 1) {
        const packageCase = packageCases[index];
        const sourceCoordinatePath = path.join(
          scriptDirectory,
          layoutCase.sourceCoordinateSuffixes[index],
        );
        await fs.ensureDir(sourceCoordinatePath);
        await fs.writeFile(
          path.join(sourceCoordinatePath, packageCase.jarFilename),
          `${layoutCase.name} GAV ${index} source jar\n`,
        );
        await fs.writeFile(
          path.join(sourceCoordinatePath, packageCase.pomFilename),
          `<project>${layoutCase.name} GAV ${index} source pom</project>\n`,
        );
      }

      if (process.platform === 'win32') {
        await generator.generatePowerShellScript(
          packageCases.map(({ packageInfo }) => packageInfo),
          scriptPath,
        );
      } else {
        await generator.generateBashScript(
          packageCases.map(({ packageInfo }) => packageInfo),
          scriptPath,
        );
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

      for (let index = 0; index < packageCases.length; index += 1) {
        const packageCase = packageCases[index];
        const targetCoordinatePath = path.join(targetRoot, packageCase.targetCoordinateSuffix);
        const markerText = await fs.readFile(path.join(targetCoordinatePath, REMOTE_MARKER), 'utf8');
        expect(await fs.readFile(path.join(targetCoordinatePath, packageCase.jarFilename), 'utf8'))
          .toBe(`${layoutCase.name} GAV ${index} source jar\n`);
        expect(await fs.readFile(path.join(targetCoordinatePath, packageCase.pomFilename), 'utf8'))
          .toBe(`<project>${layoutCase.name} GAV ${index} source pom</project>\n`);
        expect(countMarkerLine(markerText, `${packageCase.jarFilename}>=`)).toBe(1);
        expect(countMarkerLine(markerText, `${packageCase.pomFilename}>=`)).toBe(1);
      }
    }
  }, 180_000);

  it('Maven Bash/PowerShell execution rejects ambiguous or incomplete source roots before copying', async () => {
    const generator = getScriptGenerator();
    const packageCases = [
      {
        packageInfo: {
          type: 'maven' as const,
          name: 'example:demo',
          version: '1.0.0',
          metadata: { groupId: 'example', artifactId: 'demo' },
        },
        coordinateSuffix: path.join('example', 'demo', '1.0.0'),
      },
      {
        packageInfo: {
          type: 'maven' as const,
          name: 'm2repo.example:demo',
          version: '1.0.0',
          metadata: { groupId: 'm2repo.example', artifactId: 'demo' },
        },
        coordinateSuffix: path.join('m2repo', 'example', 'demo', '1.0.0'),
      },
    ];
    const negativeCases = [
      {
        name: 'ambiguous',
        sourceCoordinateSuffixes: [
          path.join('packages', 'example', 'demo', '1.0.0'),
          path.join('packages', 'm2repo', 'example', 'demo', '1.0.0'),
          path.join('packages', 'm2repo', 'm2repo', 'example', 'demo', '1.0.0'),
        ],
      },
      {
        name: 'incomplete',
        sourceCoordinateSuffixes: [
          path.join('packages', 'example', 'demo', '1.0.0'),
          path.join('packages', 'm2repo', 'm2repo', 'example', 'demo', '1.0.0'),
        ],
      },
    ];

    for (const negativeCase of negativeCases) {
      const extractionRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), `depssmuggler-maven-layout-${negativeCase.name}-`),
      );
      temporaryRoots.push(extractionRoot);
      const scriptDirectory = path.join(extractionRoot, 'delivered-script');
      const targetRoot = path.join(extractionRoot, 'target-local-repository');
      const scriptPath = path.join(
        scriptDirectory,
        process.platform === 'win32' ? 'install.ps1' : 'install.sh',
      );

      for (let index = 0; index < negativeCase.sourceCoordinateSuffixes.length; index += 1) {
        const sourceCoordinatePath = path.join(
          scriptDirectory,
          negativeCase.sourceCoordinateSuffixes[index],
        );
        await fs.ensureDir(sourceCoordinatePath);
        await fs.writeFile(
          path.join(sourceCoordinatePath, 'demo-1.0.0.jar'),
          `${negativeCase.name} source ${index} jar\n`,
        );
        await fs.writeFile(
          path.join(sourceCoordinatePath, 'demo-1.0.0.pom'),
          `<project>${negativeCase.name} source ${index} pom</project>\n`,
        );
      }

      if (process.platform === 'win32') {
        await generator.generatePowerShellScript(
          packageCases.map(({ packageInfo }) => packageInfo),
          scriptPath,
        );
      } else {
        await generator.generateBashScript(
          packageCases.map(({ packageInfo }) => packageInfo),
          scriptPath,
        );
      }

      const command = process.platform === 'win32' ? 'powershell.exe' : 'bash';
      const commandArgs = process.platform === 'win32'
        ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath]
        : [scriptPath];
      let failure: { code?: number | string | null; killed?: boolean } | undefined;
      try {
        await execFileAsync(command, commandArgs, {
          cwd: extractionRoot,
          env: { ...process.env, MAVEN_REPO_LOCAL: targetRoot },
          timeout: 45_000,
        });
      } catch (error) {
        failure = error as { code?: number | string | null; killed?: boolean };
      }

      expect(failure).toBeDefined();
      expect(typeof failure?.code).toBe('number');
      expect(failure?.code).not.toBe(0);
      expect(failure?.killed).not.toBe(true);
      for (const packageCase of packageCases) {
        expect(await fs.pathExists(path.join(targetRoot, packageCase.coordinateSuffix))).toBe(false);
      }
    }
  }, 240_000);

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
