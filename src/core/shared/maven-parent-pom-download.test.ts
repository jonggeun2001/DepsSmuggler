import { createHash } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import axios, { AxiosError, type AxiosAdapter } from 'axios';
import * as fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveAllDependencies } from './dependency-resolver';
import { clearMemoryCache, type MavenCacheOptions } from './maven-cache';
import { MavenDownloader } from '../downloaders/maven';
import { getMavenResolver } from '../resolver/maven-resolver';
import type { DownloadPackage } from './types';

const flinkGroup = 'org.apache.flink';
const flinkVersion = '1.20.5';
const root: DownloadPackage = {
  id: 'streaming',
  type: 'maven',
  name: 'org.apache.flink:flink-streaming-java',
  version: flinkVersion,
};

function coordinates(groupId: string, artifactId: string, version: string): string {
  return `<groupId>${groupId}</groupId><artifactId>${artifactId}</artifactId><version>${version}</version>`;
}

function dependency(artifactId: string): string {
  return `<dependency>${coordinates(flinkGroup, artifactId, flinkVersion)}</dependency>`;
}

function artifactPath(groupId: string, artifactId: string, version: string, extension: string): string {
  return `${groupId.replace(/\./g, '/')}/${artifactId}/${version}/${artifactId}-${version}.${extension}`;
}

describe('Maven 부모·BOM POM의 실제 다운로드 산출물', () => {
  let temporaryDir: string;
  let previousCacheOptions: MavenCacheOptions;
  let previousAdapter: typeof axios.defaults.adapter;
  let responses: Map<string, string>;
  let failedStreams: Set<string>;
  let requests: Array<{ path: string; method: string; streamed: boolean }>;

  function addProject(
    groupId: string,
    artifactId: string,
    version: string,
    body = '',
    packaging = 'jar',
  ): void {
    const pom = `<project><modelVersion>4.0.0</modelVersion>${coordinates(groupId, artifactId, version)}<packaging>${packaging}</packaging>${body}</project>`;
    responses.set(artifactPath(groupId, artifactId, version, 'pom'), pom);
    if (packaging !== 'pom') {
      responses.set(artifactPath(groupId, artifactId, version, 'jar'), `JAR fixture for ${groupId}:${artifactId}:${version}`);
    }
  }

  function parent(artifactId: string): string {
    return `<parent>${coordinates(flinkGroup, artifactId, flinkVersion)}</parent>`;
  }

  function installFlinkFixture(): void {
    const bom = '<dependency><groupId>org.example</groupId><artifactId>platform-bom</artifactId><version>2.0</version><type>pom</type><scope>import</scope></dependency>';
    const runtimeDependency = `<dependency>${coordinates('org.example', 'runtime-helper', '3.0')}<scope>runtime</scope></dependency>`;
    const excludedDependencies = `<dependency>${coordinates('org.excluded', 'optional-helper', '1.0')}<optional>true</optional></dependency><dependency>${coordinates('org.excluded', 'test-helper', '1.0')}<scope>test</scope></dependency>`;
    const unusedManagement = Array.from({ length: 631 }, (_, index) =>
      `<dependency>${coordinates('org.unused', `managed-${index}`, '9.9')}</dependency>`,
    ).join('');
    addProject(flinkGroup, 'flink-parent', flinkVersion,
      `<dependencyManagement><dependencies>${bom}${unusedManagement}</dependencies></dependencyManagement>`, 'pom');
    addProject(flinkGroup, 'flink-metrics', flinkVersion, parent('flink-parent'), 'pom');
    addProject(flinkGroup, 'flink-streaming-java', flinkVersion,
      `${parent('flink-parent')}<dependencies>${dependency('flink-core')}${runtimeDependency}${excludedDependencies}</dependencies>`);
    addProject(flinkGroup, 'flink-core', flinkVersion,
      `${parent('flink-parent')}<dependencies>${dependency('flink-core-api')}</dependencies>`);
    addProject(flinkGroup, 'flink-core-api', flinkVersion,
      `${parent('flink-parent')}<dependencies>${dependency('flink-metrics-core')}</dependencies>`);
    addProject(flinkGroup, 'flink-metrics-core', flinkVersion, parent('flink-metrics'));
    addProject('org.example', 'runtime-helper', '3.0', parent('flink-parent'));
    addProject('org.example', 'platform-bom', '2.0',
      `<parent>${coordinates('org.example', 'bom-parent', '2.0')}</parent><dependencyManagement><dependencies>${unusedManagement}</dependencies></dependencyManagement>`, 'pom');
    addProject('org.example', 'bom-parent', '2.0', '', 'pom');
  }

  beforeEach(async () => {
    temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'maven-parent-pom-download-'));
    responses = new Map();
    failedStreams = new Set();
    requests = [];
    previousAdapter = axios.defaults.adapter;
    // Only the HTTP boundary is replaced; XML parsing, cache, resolver, checksums
    // and output writes all run through their production implementations.
    const adapter: AxiosAdapter = async (config) => {
      const url = new URL(config.url || '', config.baseURL || 'https://repo1.maven.org/maven2/');
      const relativePath = url.pathname.replace(/^\/maven2\//, '').replace(/^\//, '');
      requests.push({ path: relativePath, method: config.method || 'get', streamed: config.responseType === 'stream' });
      if (config.responseType === 'stream' && failedStreams.has(relativePath)) {
        throw new AxiosError(`Fixture POM stream unavailable: ${relativePath}`, 'ERR_BAD_RESPONSE', config, undefined, {
          config, status: 503, statusText: 'Service Unavailable', headers: {}, data: '',
        });
      }
      const artifact = responses.get(relativePath.replace(/\.sha1$/, ''));
      if (artifact === undefined) {
        throw new AxiosError(`Fixture artifact not found: ${relativePath}`, 'ERR_BAD_REQUEST', config, undefined, {
          config, status: 404, statusText: 'Not Found', headers: {}, data: '',
        });
      }
      const content = relativePath.endsWith('.sha1')
        ? createHash('sha1').update(artifact).digest('hex')
        : artifact;
      return {
        config,
        status: 200,
        statusText: 'OK',
        headers: { 'content-length': String(Buffer.byteLength(content)) },
        data: config.responseType === 'stream' ? Readable.from([Buffer.from(content)]) : content,
      };
    };
    axios.defaults.adapter = adapter;
    const resolver = getMavenResolver();
    previousCacheOptions = resolver.getCacheOptions();
    resolver.setCacheOptions({ cacheDir: path.join(temporaryDir, 'cache') });
    clearMemoryCache();
    installFlinkFixture();
  });

  afterEach(async () => {
    getMavenResolver().setCacheOptions(previousCacheOptions);
    clearMemoryCache();
    axios.defaults.adapter = previousAdapter;
    await fs.remove(temporaryDir);
  });

  async function downloadPackages(packages: DownloadPackage[]): Promise<string> {
    const packagesDir = path.join(temporaryDir, 'output', 'packages');
    const downloader = new MavenDownloader();
    // Download sequentially: identical GAV JAR/POM jobs share the companion POM.
    // The Electron router separately owns serialization and flattened copies.
    for (const pkg of packages) {
      await downloader.downloadPackage({
        type: 'maven', name: pkg.name, version: pkg.version, metadata: pkg.metadata,
      }, path.join(packagesDir, 'm2repo'));
    }
    return packagesDir;
  }

  it('Flink 전이 의존성의 부모와 import BOM 체인을 POM으로 반입하고 631개 관리 항목은 내려받지 않는다', async () => {
    const result = await resolveAllDependencies([root], { maxDepth: 10 });
    expect(result.failedPackages).toEqual([]);
    const requiredPoms = [
      [flinkGroup, 'flink-metrics', flinkVersion],
      [flinkGroup, 'flink-parent', flinkVersion],
      ['org.example', 'platform-bom', '2.0'],
      ['org.example', 'bom-parent', '2.0'],
    ];

    for (const [groupId, artifactId, version] of requiredPoms) {
      const matching = result.allPackages.filter((pkg) => pkg.name === `${groupId}:${artifactId}` && pkg.version === version);
      expect.soft(matching).toHaveLength(1);
      expect.soft(matching[0]?.metadata).toMatchObject({ type: 'pom', filename: `${artifactId}-${version}.pom` });
      const pomRequests = requests.filter((request) => request.path === artifactPath(groupId, artifactId, version, 'pom') && request.method === 'get');
      expect.soft(pomRequests).toHaveLength(1);
    }

    const packagesDir = await downloadPackages(result.allPackages);
    for (const [groupId, artifactId, version] of requiredPoms) {
      const relativePath = artifactPath(groupId, artifactId, version, 'pom');
      const filePath = path.join(packagesDir, 'm2repo', relativePath);
      expect.soft(await fs.pathExists(filePath), relativePath).toBe(true);
      if (await fs.pathExists(filePath)) {
        expect(await fs.readFile(filePath, 'utf8')).toBe(responses.get(relativePath));
        expect(await fs.readFile(`${filePath}.sha1`, 'utf8')).toBe(createHash('sha1').update(await fs.readFile(filePath)).digest('hex'));
      }
      expect.soft(requests.filter((request) => request.path === relativePath && request.streamed)).toHaveLength(1);
      expect.soft(requests.some((request) => request.path === artifactPath(groupId, artifactId, version, 'jar'))).toBe(false);
    }
    for (const artifactId of ['flink-streaming-java', 'flink-core', 'flink-core-api', 'flink-metrics-core']) {
      const jar = artifactPath(flinkGroup, artifactId, flinkVersion, 'jar');
      expect(await fs.readFile(path.join(packagesDir, 'm2repo', jar), 'utf8')).toBe(responses.get(jar));
      expect(await fs.pathExists(path.join(packagesDir, 'm2repo', artifactPath(flinkGroup, artifactId, flinkVersion, 'pom')))).toBe(true);
    }
    const runtimeJar = artifactPath('org.example', 'runtime-helper', '3.0', 'jar');
    expect(await fs.readFile(path.join(packagesDir, 'm2repo', runtimeJar), 'utf8')).toBe(responses.get(runtimeJar));
    expect(result.allPackages).toHaveLength(9);
    expect(requests.some((request) => request.path.startsWith('org/unused/'))).toBe(false);
    expect(requests.some((request) => request.path.startsWith('org/excluded/'))).toBe(false);
    expect(result.allPackages.some((pkg) => pkg.name.startsWith('org.excluded:'))).toBe(false);
  });

  it('같은 GAV의 명시적 JAR와 POM을 부모 POM 수집 이후에도 각각 저장한다', async () => {
    const result = await resolveAllDependencies(['jar', 'pom'].map((type) => ({
      id: type,
      type: 'maven' as const,
      name: 'org.apache.flink:flink-metrics-core',
      version: flinkVersion,
      metadata: { type },
    })), { maxDepth: 10 });
    expect(result.failedPackages).toEqual([]);
    expect(result.allPackages.filter((pkg) => pkg.name === 'org.apache.flink:flink-metrics-core')
      .map((pkg) => pkg.metadata?.type).sort()).toEqual(['jar', 'pom']);
    const packagesDir = await downloadPackages(result.allPackages);
    for (const extension of ['jar', 'pom']) {
      const relativePath = artifactPath(flinkGroup, 'flink-metrics-core', flinkVersion, extension);
      expect(await fs.readFile(path.join(packagesDir, 'm2repo', relativePath), 'utf8')).toBe(responses.get(relativePath));
    }
    expect(result.allPackages.filter((pkg) => pkg.name === 'org.apache.flink:flink-metrics')).toHaveLength(1);
  });

  it('필수 부모 POM을 읽지 못하면 불완전한 루트를 성공 목록에 포함하지 않는다', async () => {
    responses.delete(artifactPath(flinkGroup, 'flink-parent', flinkVersion, 'pom'));
    const result = await resolveAllDependencies([root], { maxDepth: 10 });
    expect(result.failedPackages).toEqual([
      expect.objectContaining({ name: root.name, version: flinkVersion, error: expect.stringContaining('flink-parent') }),
    ]);
    expect(result.successfulPackages).toEqual([]);
  });

  it('모델 조회가 성공해도 JAR의 부속 POM 파일 다운로드 실패를 성공 처리하지 않는다', async () => {
    addProject('org.example', 'ordinary-library', '1.0');
    const result = await resolveAllDependencies([{
      id: 'ordinary', type: 'maven', name: 'org.example:ordinary-library', version: '1.0',
    }]);
    expect(result.failedPackages).toEqual([]);
    expect(result.successfulPackages).toHaveLength(1);
    const pom = artifactPath('org.example', 'ordinary-library', '1.0', 'pom');
    failedStreams.add(pom);

    const pkg = result.allPackages[0];
    const downloader = new MavenDownloader();
    await expect(downloader.downloadPackage({
      type: 'maven', name: pkg.name, version: pkg.version, metadata: pkg.metadata,
    }, path.join(temporaryDir, 'm2repo'))).rejects.toThrow('POM');
  });
});
