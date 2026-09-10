import { execFile as execFileCallback } from 'node:child_process';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import * as fs from 'fs-extra';
import * as tar from 'tar';
import { afterEach, describe, expect, it } from 'vitest';
import { ArchivePackager } from './archive-packager';
import { getScriptGenerator } from './script-generator';
import { MavenDownloader } from '../downloaders/maven';
import { MavenResolver } from '../resolver/maven-resolver';
import type { PackageInfo } from '../../types';

const execFile = promisify(execFileCallback);
const nativeEnabled = process.env.DEPS_SMUGGLER_NATIVE_MAVEN === '1';

type RunResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

function coordinatePath(groupId: string, artifactId: string, version: string): string {
  return `${groupId.replace(/\./g, '/')}/${artifactId}/${version}`;
}

function pom(groupId: string, artifactId: string, version: string, body = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>${groupId}</groupId><artifactId>${artifactId}</artifactId><version>${version}</version>
  ${body}
</project>`;
}

function fixturePoms(): Map<string, string> {
  const poms = new Map<string, string>();
  const put = (g: string, a: string, v: string, body = '') =>
    poms.set(`/${coordinatePath(g, a, v)}/${a}-${v}.pom`, pom(g, a, v, body));
  put(
    'fixture',
    'fixture-parent',
    '1.0',
    '<packaging>pom</packaging><dependencies><dependency><groupId>fixture</groupId><artifactId>inherited-lib</artifactId><version>1.0</version></dependency><dependency><groupId>fixture</groupId><artifactId>managed-child</artifactId></dependency></dependencies><dependencyManagement><dependencies><dependency><groupId>fixture</groupId><artifactId>fixture-bom</artifactId><version>2.15.2</version><type>pom</type><scope>import</scope></dependency></dependencies></dependencyManagement>'
  );
  put(
    'fixture',
    'fixture-bom',
    '2.15.2',
    '<packaging>pom</packaging><dependencyManagement><dependencies><dependency><groupId>fixture</groupId><artifactId>managed-child</artifactId><version>2.15.2</version></dependency></dependencies></dependencyManagement>'
  );
  put('fixture', 'inherited-lib', '1.0');
  put('fixture', 'managed-child', '2.15.2');
  put('fixture', 'managed-child', '2.15.3');
  put('fixture', 'lost-child', '1.0');
  put('fixture', 'lost-parent', '1.0', '<packaging>pom</packaging>');
  put('fixture', 'lost-bom', '1.0', '<packaging>pom</packaging>');
  put(
    'fixture',
    'conflict',
    '2.21',
    '<parent><groupId>fixture</groupId><artifactId>lost-parent</artifactId><version>1.0</version></parent><dependencyManagement><dependencies><dependency><groupId>fixture</groupId><artifactId>lost-bom</artifactId><version>1.0</version><type>pom</type><scope>import</scope></dependency></dependencies></dependencyManagement><dependencies><dependency><groupId>fixture</groupId><artifactId>lost-child</artifactId><version>1.0</version></dependency></dependencies>'
  );
  put('fixture', 'conflict', '2.24');
  put(
    'fixture',
    'path-a',
    '1.0',
    '<parent><groupId>fixture</groupId><artifactId>fixture-parent</artifactId><version>1.0</version></parent><dependencies><dependency><groupId>fixture</groupId><artifactId>conflict</artifactId><version>2.21</version></dependency></dependencies>'
  );
  put(
    'fixture',
    'path-b',
    '1.0',
    '<dependencies><dependency><groupId>fixture</groupId><artifactId>conflict</artifactId><version>2.24</version></dependency><dependency><groupId>fixture</groupId><artifactId>managed-child</artifactId><version>2.15.3</version></dependency></dependencies>'
  );
  put(
    'fixture',
    'app',
    '1.0.0',
    '<parent><groupId>fixture</groupId><artifactId>fixture-parent</artifactId><version>1.0</version></parent><dependencies><dependency><groupId>fixture</groupId><artifactId>path-b</artifactId><version>1.0</version></dependency><dependency><groupId>fixture</groupId><artifactId>path-a</artifactId><version>1.0</version></dependency><dependency><groupId>fixture</groupId><artifactId>managed-child</artifactId><version>2.15.3</version></dependency></dependencies>'
  );
  return poms;
}

async function emptyJar(): Promise<Buffer> {
  const archiver = (await import('archiver')).default;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const archive = archiver('zip');
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('error', reject);
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.append('fixture', { name: 'fixture.txt' });
    void archive.finalize();
  });
}

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Maven fixture server has no port');
  return address.port;
}

async function run(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeout = 240_000
): Promise<RunResult> {
  try {
    const result = await execFile(command, args, { cwd, env, timeout, maxBuffer: 8 * 1024 * 1024 });
    return { code: 0, signal: null, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as typeof error & {
      code?: number;
      signal?: NodeJS.Signals | null;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: typeof failure.code === 'number' ? failure.code : null,
      signal: failure.signal ?? null,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

async function requireMaven(): Promise<void> {
  if (process.platform !== 'linux')
    throw new Error('DEPS_SMUGGLER_NATIVE_MAVEN=1 requires Linux CI');
  try {
    const version = await execFile('mvn', ['--version'], { timeout: 15_000 });
    console.log(`native Maven version:\n${version.stdout}`);
  } catch (error) {
    throw new Error(`DEPS_SMUGGLER_NATIVE_MAVEN=1 requires mvn: ${(error as Error).message}`);
  }
}

function packageCoordinate(pkg: PackageInfo): string {
  return `${pkg.metadata?.groupId}:${pkg.metadata?.artifactId}:${pkg.version}`;
}

function buildProjectPom(
  groupId: string,
  artifactId: string,
  version: string,
  dependency = ''
): string {
  return `<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>${groupId}</groupId><artifactId>${artifactId}</artifactId><version>${version}</version><properties><maven.compiler.release>8</maven.compiler.release><project.build.sourceEncoding>UTF-8</project.build.sourceEncoding></properties><build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-resources-plugin</artifactId><version>3.3.1</version></plugin><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.11.0</version></plugin><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-surefire-plugin</artifactId><version>3.2.5</version></plugin><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-jar-plugin</artifactId><version>3.3.0</version></plugin></plugins></build>${dependency}</project>`;
}

describe('Maven all-version delivery and native consumer', () => {
  const temporaryRoots: string[] = [];
  let server: http.Server | undefined;

  afterEach(async () => {
    if (server?.listening) await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
    await Promise.all(temporaryRoots.splice(0).map((root) => fs.remove(root)));
  });

  it('preserves all version artifacts through archive and installer, with opt-in offline Maven', async () => {
    if (nativeEnabled) await requireMaven();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-maven-native-'));
    temporaryRoots.push(root);
    const poms = fixturePoms();
    const jar = await emptyJar();
    const requests: string[] = [];
    server = http.createServer((request, response) => {
      const requestPath = request.url || '';
      requests.push(`${request.method || 'GET'} ${requestPath}`);
      const pomBody = poms.get(requestPath);
      if (pomBody !== undefined) {
        response.writeHead(200, { 'content-type': 'application/xml' });
        response.end(pomBody);
        return;
      }
      if (requestPath.endsWith('.sha1')) {
        response.writeHead(404);
        response.end();
        return;
      }
      if (requestPath.endsWith('.jar')) {
        response.writeHead(200, {
          'content-type': 'application/java-archive',
          'content-length': jar.byteLength,
        });
        response.end(jar);
        return;
      }
      response.writeHead(404);
      response.end('fixture not found');
    });
    const port = await listen(server);
    const repoUrl = `http://127.0.0.1:${port}`;
    const resolverCache = path.join(root, 'resolver-cache');
    const resolver = new MavenResolver();
    (resolver as unknown as { repoUrl: string }).repoUrl = repoUrl;
    resolver.setCacheOptions({ repoUrl, cacheDir: resolverCache, forceRefresh: true });
    const resolved = await resolver.resolveDependencies('fixture:app', '1.0.0', { maxDepth: 20 });
    const resolvedKeys = resolved.flatList.map(packageCoordinate);
    expect(resolvedKeys).toContain('fixture:conflict:2.24');
    expect(resolvedKeys).toContain('fixture:conflict:2.21');
    expect(resolvedKeys).toContain('fixture:lost-parent:1.0');
    expect(resolvedKeys).toContain('fixture:lost-child:1.0');
    expect(resolvedKeys).toContain('fixture:inherited-lib:1.0');
    expect(resolvedKeys).toContain('fixture:managed-child:2.15.2');
    expect(resolvedKeys).toContain('fixture:managed-child:2.15.3');
    expect(
      resolved.flatList.find((pkg) => packageCoordinate(pkg) === 'fixture:conflict:2.21')?.metadata
        ?.type
    ).not.toBe('pom');

    const deliveryRoot = path.join(root, 'delivery');
    const downloadRoot = path.join(deliveryRoot, 'packages');
    const downloader = new MavenDownloader();
    (downloader as unknown as { repoUrl: string }).repoUrl = repoUrl;
    const downloadedFiles: string[] = [];
    for (const pkg of resolved.flatList) {
      downloadedFiles.push(...(await downloader.downloadPackageFiles(pkg, downloadRoot)));
    }
    const scriptPath = path.join(deliveryRoot, 'install.sh');
    await getScriptGenerator().generateBashScript(resolved.flatList, scriptPath);
    const archivePath = path.join(root, 'delivery.tar.gz');
    await new ArchivePackager().createArchiveFromDirectory(
      deliveryRoot,
      archivePath,
      resolved.flatList,
      { format: 'tar.gz' }
    );
    const bundleRoot = path.join(root, 'bundle');
    await fs.ensureDir(bundleRoot);
    await tar.x({ file: archivePath, cwd: bundleRoot });
    const requiredPoms = [
      '/fixture/fixture-parent/1.0/fixture-parent-1.0.pom',
      '/fixture/conflict/2.21/conflict-2.21.pom',
      '/fixture/conflict/2.24/conflict-2.24.pom',
      '/fixture/lost-parent/1.0/lost-parent-1.0.pom',
      '/fixture/lost-bom/1.0/lost-bom-1.0.pom',
      '/fixture/lost-child/1.0/lost-child-1.0.pom',
      '/fixture/fixture-bom/2.15.2/fixture-bom-2.15.2.pom',
      '/fixture/inherited-lib/1.0/inherited-lib-1.0.pom',
      '/fixture/managed-child/2.15.2/managed-child-2.15.2.pom',
      '/fixture/managed-child/2.15.3/managed-child-2.15.3.pom',
    ];
    for (const relativePom of requiredPoms) {
      await expect(fs.readFile(path.join(bundleRoot, 'packages', relativePom))).resolves.toEqual(
        Buffer.from(poms.get(relativePom) || '', 'utf8')
      );
    }
    expect(
      requests.some((request) => request.includes('/fixture/conflict/2.21/conflict-2.21.jar'))
    ).toBe(true);
    expect(
      requests.some((request) => request.includes('/fixture/conflict/2.24/conflict-2.24.jar'))
    ).toBe(true);
    expect(
      downloadedFiles.some((file) =>
        file.split(path.sep).join('/').endsWith('/fixture/conflict/2.21/conflict-2.21.jar')
      )
    ).toBe(true);
    expect(
      downloadedFiles.some((file) =>
        file.split(path.sep).join('/').endsWith('/fixture/conflict/2.24/conflict-2.24.jar')
      )
    ).toBe(true);
    for (const relativeJar of [
      '/fixture/conflict/2.21/conflict-2.21.jar',
      '/fixture/conflict/2.24/conflict-2.24.jar',
      '/fixture/managed-child/2.15.2/managed-child-2.15.2.jar',
      '/fixture/managed-child/2.15.3/managed-child-2.15.3.jar',
      '/fixture/inherited-lib/1.0/inherited-lib-1.0.jar',
    ]) {
      expect(
        downloadedFiles.some((file) => file.split(path.sep).join('/').endsWith(relativeJar))
      ).toBe(true);
    }
    await expect(
      fs.pathExists(path.join(bundleRoot, 'packages', 'fixture/conflict/2.24/conflict-2.24.jar'))
    ).resolves.toBe(true);
    await expect(
      fs.pathExists(path.join(bundleRoot, 'packages', 'fixture/conflict/2.21/conflict-2.21.jar'))
    ).resolves.toBe(true);
    for (const relativeJar of [
      'fixture/conflict/2.21/conflict-2.21.jar',
      'fixture/conflict/2.24/conflict-2.24.jar',
      'fixture/managed-child/2.15.2/managed-child-2.15.2.jar',
      'fixture/managed-child/2.15.3/managed-child-2.15.3.jar',
      'fixture/inherited-lib/1.0/inherited-lib-1.0.jar',
    ]) {
      await expect(fs.pathExists(path.join(bundleRoot, 'packages', relativeJar))).resolves.toBe(
        true
      );
    }

    if (process.platform === 'win32') {
      console.log(
        'Skipping Bash installer execution on Windows; archive and exact-file checks remain active.'
      );
      return;
    }
    const defaultRepo = path.join(root, 'default-m2');
    const installResult = await run('bash', [path.join(bundleRoot, 'install.sh')], bundleRoot, {
      ...process.env,
      MAVEN_REPO_LOCAL: defaultRepo,
    });
    expect(installResult.code, `${installResult.stdout}\n${installResult.stderr}`).toBe(0);
    for (const relativePom of requiredPoms) {
      await expect(fs.readFile(path.join(defaultRepo, relativePom))).resolves.toEqual(
        Buffer.from(poms.get(relativePom) || '', 'utf8')
      );
    }
    if (!nativeEnabled) return;
    const isolatedRepo = path.join(root, 'native-m2');
    const bootstrap = path.join(root, 'bootstrap');
    await fs.ensureDir(path.join(bootstrap, 'src', 'main', 'java', 'fixture'));
    await fs.writeFile(
      path.join(bootstrap, 'src', 'main', 'java', 'fixture', 'Bootstrap.java'),
      'package fixture; public final class Bootstrap {}\n'
    );
    await fs.writeFile(
      path.join(bootstrap, 'pom.xml'),
      buildProjectPom('bootstrap', 'bootstrap', '1')
    );
    const bootstrapResult = await run(
      'mvn',
      [
        '-B',
        '-q',
        `-Dmaven.repo.local=${isolatedRepo}`,
        '-f',
        path.join(bootstrap, 'pom.xml'),
        'package',
        '-DskipTests',
      ],
      root,
      { ...process.env }
    );
    console.log(`native Maven bootstrap stdout:\n${bootstrapResult.stdout}`);
    console.error(`native Maven bootstrap stderr:\n${bootstrapResult.stderr}`);
    expect(bootstrapResult.code, `${bootstrapResult.stdout}\n${bootstrapResult.stderr}`).toBe(0);
    expect(await fs.pathExists(path.join(isolatedRepo, 'fixture'))).toBe(false);
    const nativeInstall = await run('bash', [path.join(bundleRoot, 'install.sh')], bundleRoot, {
      ...process.env,
      MAVEN_REPO_LOCAL: isolatedRepo,
    });
    expect(nativeInstall.code, `${nativeInstall.stdout}\n${nativeInstall.stderr}`).toBe(0);
    for (const relativePom of requiredPoms) {
      await expect(fs.readFile(path.join(isolatedRepo, relativePom))).resolves.toEqual(
        Buffer.from(poms.get(relativePom) || '', 'utf8')
      );
    }

    const consumer = path.join(root, 'consumer');
    await fs.ensureDir(path.join(consumer, 'src', 'main', 'java', 'consumer'));
    await fs.writeFile(
      path.join(consumer, 'src', 'main', 'java', 'consumer', 'Main.java'),
      'package consumer; public final class Main {}\n'
    );
    await fs.writeFile(
      path.join(consumer, 'pom.xml'),
      buildProjectPom(
        'consumer',
        'consumer',
        '1',
        '<dependencies><dependency><groupId>fixture</groupId><artifactId>app</artifactId><version>1.0.0</version></dependency></dependencies>'
      )
    );
    const nativeResult = await run(
      'mvn',
      [
        '-B',
        '-o',
        `-Dmaven.repo.local=${isolatedRepo}`,
        '-f',
        path.join(consumer, 'pom.xml'),
        'package',
        '-DskipTests',
      ],
      consumer,
      { ...process.env }
    );
    console.log(
      `native Maven offline package (exit ${nativeResult.code}):\n${nativeResult.stdout}\n${nativeResult.stderr}`
    );
    expect(nativeResult.code, `${nativeResult.stdout}\n${nativeResult.stderr}`).toBe(0);
    expect(`${nativeResult.stdout}\n${nativeResult.stderr}`).not.toMatch(
      /Could not find artifact fixture:conflict:pom:2\.21|POM.*2\.21.*missing/i
    );

    expect(nativeResult.stdout).toContain('BUILD SUCCESS');
    await expect(fs.pathExists(path.join(consumer, 'target', 'consumer-1.jar'))).resolves.toBe(
      true
    );

    for (const [name, dependencies] of [
      ['consumer-path-a-first', ['path-a', 'path-b']],
      ['consumer-path-b-first', ['path-b', 'path-a']],
    ] as const) {
      const versionConsumer = path.join(root, name);
      await fs.ensureDir(path.join(versionConsumer, 'src', 'main', 'java', 'consumer'));
      await fs.writeFile(
        path.join(versionConsumer, 'src', 'main', 'java', 'consumer', 'Main.java'),
        'package consumer; public final class Main {}\n'
      );
      const dependencyXml = dependencies
        .map(
          (artifactId) =>
            `<dependency><groupId>fixture</groupId><artifactId>${artifactId}</artifactId><version>1.0</version></dependency>`
        )
        .join('');
      await fs.writeFile(
        path.join(versionConsumer, 'pom.xml'),
        buildProjectPom('consumer', name, '1', `<dependencies>${dependencyXml}</dependencies>`)
      );
      const versionResult = await run(
        'mvn',
        [
          '-B',
          '-o',
          `-Dmaven.repo.local=${isolatedRepo}`,
          '-f',
          path.join(versionConsumer, 'pom.xml'),
          'package',
          '-DskipTests',
        ],
        versionConsumer,
        { ...process.env }
      );
      expect(versionResult.code, `${versionResult.stdout}\n${versionResult.stderr}`).toBe(0);
      expect(versionResult.stdout).toContain('BUILD SUCCESS');
      await expect(
        fs.pathExists(path.join(versionConsumer, 'target', `${name}-1.jar`))
      ).resolves.toBe(true);
    }

    const negativeRepo = path.join(root, 'negative-m2');
    await fs.copy(isolatedRepo, negativeRepo);
    await fs.remove(path.join(negativeRepo, 'fixture', 'conflict', '2.21', 'conflict-2.21.jar'));
    const negativeConsumer = path.join(root, 'negative-consumer');
    await fs.ensureDir(path.join(negativeConsumer, 'src', 'main', 'java', 'consumer'));
    await fs.writeFile(
      path.join(negativeConsumer, 'src', 'main', 'java', 'consumer', 'Main.java'),
      'package consumer; public final class Main {}\n'
    );
    await fs.writeFile(
      path.join(negativeConsumer, 'pom.xml'),
      buildProjectPom(
        'consumer',
        'negative-consumer',
        '1',
        '<dependencies><dependency><groupId>fixture</groupId><artifactId>path-a</artifactId><version>1.0</version></dependency><dependency><groupId>fixture</groupId><artifactId>path-b</artifactId><version>1.0</version></dependency></dependencies>'
      )
    );
    const negative = await run(
      'mvn',
      [
        '-B',
        '-o',
        `-Dmaven.repo.local=${negativeRepo}`,
        '-f',
        path.join(negativeConsumer, 'pom.xml'),
        'package',
        '-DskipTests',
      ],
      negativeConsumer,
      { ...process.env }
    );
    console.log(
      `native Maven missing-JAR control (exit ${negative.code}):\n${negative.stdout}\n${negative.stderr}`
    );
    expect(negative.signal).toBeNull();
    expect(negative.code).not.toBeNull();
    expect(negative.code).not.toBe(0);
    expect(`${negative.stdout}\n${negative.stderr}`).toMatch(/fixture:conflict:jar:2\.21/);
    expect(
      requests.some((request) => request.includes('/fixture/conflict/2.21/conflict-2.21.pom'))
    ).toBe(true);
    expect(
      downloadedFiles.some((file) => file.endsWith('/fixture/conflict/2.21/conflict-2.21.pom'))
    ).toBe(true);
  }, 600_000);
});
