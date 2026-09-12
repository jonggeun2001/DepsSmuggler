import { execFile as execFileCallback } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import * as fs from 'fs-extra';
import pLimit from 'p-limit';
import * as tar from 'tar';
import { afterEach, describe, expect, it } from 'vitest';
import { ArchivePackager } from './archive-packager';
import { getScriptGenerator } from './script-generator';
import { MavenDownloader } from '../downloaders/maven';
import { resolveAllDependencies } from '../shared/dependency-resolver';
import { collectMavenProjectPackages } from '../shared/maven-project';
import type { PackageInfo } from '../../types';
import type { DownloadPackage } from '../shared/types';

const execFile = promisify(execFileCallback);
const nativeEnabled = process.env.DEPS_SMUGGLER_NATIVE_MAVEN_PROJECT === '1';
const mavenBinary = process.env.MAVEN_BINARY || 'mvn';

async function runMaven(args: string[], cwd: string, localRepo: string) {
  return execFile(mavenBinary, ['--batch-mode', '--offline', `-Dmaven.repo.local=${localRepo}`, ...args], {
    cwd,
    timeout: 240_000,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, MAVEN_OPTS: '' },
  });
}

function projectPom(): string {
  return `<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>fixture</groupId><artifactId>offline-consumer</artifactId><version>1.0.0</version>
  <properties><maven.compiler.source>1.8</maven.compiler.source><maven.compiler.target>1.8</maven.compiler.target><project.build.sourceEncoding>UTF-8</project.build.sourceEncoding></properties>
  <dependencies>
    <dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId><version>5.10.1</version><scope>test</scope></dependency>
    <dependency><groupId>org.apache.commons</groupId><artifactId>commons-lang3</artifactId><version>3.14.0</version></dependency>
  </dependencies>
</project>`;
}

function smokeTest(): string {
  return `package fixture;
import org.apache.commons.lang3.StringUtils;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertTrue;
class OfflineSmokeTest {
  @Test void dependenciesAreUsable() { assertTrue(StringUtils.isNotBlank("offline")); }
}`;
}

describe.skipIf(!nativeEnabled)('Maven project archive native consumer', () => {
  const tempRoots: string[] = [];
  const preservedRoots = new Set<string>();

  afterEach(async () => {
    const currentRoots = tempRoots.splice(0);
    await Promise.all(currentRoots.filter((root) => !preservedRoots.has(root)).map((root) => fs.remove(root)));
    for (const root of currentRoots.filter((candidate) => preservedRoots.has(candidate))) {
      console.error(`Preserved native Maven failure bundle: ${root}`);
    }
  });

  it('installs a project collector bundle into empty local Maven and runs package offline', async () => {
    if (process.platform !== 'linux' && process.platform !== 'darwin') {
      throw new Error('Native Maven project consumer requires Linux or macOS');
    }
    const versionOutput = await execFile(mavenBinary, ['--version'], { timeout: 15_000 });
    const mavenVersion = versionOutput.stdout.match(/Apache Maven\s+(\d+\.\d+\.\d+)/)?.[1];
    if (!mavenVersion) throw new Error(`Could not derive Maven version from mvn --version:\n${versionOutput.stdout}`);
    if (!/^3\.\d+\.\d+$/.test(mavenVersion)) throw new Error(`Unsupported Maven version: ${mavenVersion}`);

    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-maven-project-native-'));
    tempRoots.push(root);
    const output = path.join(root, 'delivery');
    const packagesDir = path.join(output, 'packages');
    const project = await collectMavenProjectPackages(projectPom(), { mavenVersion });
    const projectRoots: DownloadPackage[] = project.map((pkg, index) => ({
      id: `project-${index}`,
      type: pkg.type,
      name: pkg.name,
      version: pkg.version,
      architecture: pkg.arch,
      metadata: pkg.metadata ? { ...pkg.metadata } : undefined,
    }));
    const resolved = await resolveAllDependencies(projectRoots, {
      includeDependencies: true,
    });
    expect(resolved.failedPackages).toEqual([]);
    const packages = resolved.allPackages as PackageInfo[];
    const pluginNames = packages
      .filter((pkg) => pkg.metadata?.type === 'maven-plugin')
      .map((pkg) => pkg.name);
    expect(pluginNames).toEqual(expect.arrayContaining([
      'org.apache.maven.plugins:maven-resources-plugin',
      'org.apache.maven.plugins:maven-compiler-plugin',
      'org.apache.maven.plugins:maven-surefire-plugin',
      'org.apache.maven.plugins:maven-jar-plugin',
    ]));
    const pluginVersions = packages
      .filter((pkg) => pkg.metadata?.type === 'maven-plugin')
      .map((pkg) => `${pkg.name}:${pkg.version}`);
    expect(pluginVersions.every((name) => /:\d+(?:[.-][\w]+)+$/.test(name))).toBe(true);

    const downloader = new MavenDownloader();
    const limit = pLimit(6);
    await Promise.all(packages.map((pkg) => limit(() => downloader.downloadPackageFiles(pkg, packagesDir))));
    const scriptPath = path.join(output, 'install.sh');
    await getScriptGenerator().generateBashScript(packages, scriptPath);
    const archivePath = path.join(root, 'bundle.tar.gz');
    await new ArchivePackager().createArchiveFromDirectory(output, archivePath, packages, { format: 'tar.gz' });

    const bundle = path.join(root, 'bundle');
    await fs.ensureDir(bundle);
    await tar.x({ file: archivePath, cwd: bundle });
    const consumer = path.join(bundle, 'consumer');
    await fs.outputFile(path.join(consumer, 'pom.xml'), projectPom());
    await fs.outputFile(path.join(consumer, 'src/test/java/fixture/OfflineSmokeTest.java'), smokeTest());
    const localRepo = path.join(root, 'empty-local-m2');
    await fs.ensureDir(localRepo);
    expect(await fs.readdir(localRepo)).toEqual([]);

    const install = await execFile('bash', [path.join(bundle, 'install.sh')], {
      cwd: bundle,
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, MAVEN_REPO_LOCAL: localRepo },
    });
    expect(install.stderr).not.toMatch(/error/i);
    let build;
    try {
      build = await runMaven(['-f', path.join(consumer, 'pom.xml'), '-DskipTests=false', 'package'], consumer, localRepo);
    } catch (error) {
      preservedRoots.add(root);
      const failure = error as { stdout?: string; stderr?: string };
      console.error(`Native Maven stdout:\n${failure.stdout || ''}`);
      console.error(`Native Maven stderr:\n${failure.stderr || ''}`);
      throw error;
    }
    expect(build.stdout).toMatch(/BUILD SUCCESS/);
    expect(build.stdout).toMatch(/Tests run:\s*1/);
    await expect(fs.pathExists(path.join(consumer, 'target', 'test-classes', 'fixture', 'OfflineSmokeTest.class'))).resolves.toBe(true);
  }, 360_000);
});
