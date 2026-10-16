import { createHash } from 'crypto';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';
import axios, { AxiosError, type AxiosAdapter } from 'axios';
import * as fs from 'fs-extra';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearMemoryCache, fetchPomWithCacheInfo, type MavenCacheOptions } from './maven-cache';
import { resolveAllDependencies } from './dependency-resolver';
import { getMavenRepositories } from './maven-repositories';
import { MAVEN_CENTRAL_URL } from '../../utils/maven-repositories';
import { MavenDownloader } from '../downloaders/maven';
import { MavenResolver, getMavenResolver } from '../resolver/maven-resolver';

const testHome = vi.hoisted(() => ({ path: '' }));
vi.mock('os', async (original) => ({
  ...(await original<typeof import('os')>()),
  homedir: () => testHome.path,
}));

const external = 'https://repo.example.test/repository/releases';
const coordinates = (artifact: string) =>
  `<groupId>example</groupId><artifactId>${artifact}</artifactId><version>1.0</version>`;
const artifactPath = (artifact: string, extension: string) =>
  `example/${artifact}/1.0/${artifact}-1.0.${extension}`;
let previousAdapter: typeof axios.defaults.adapter;
let previousCacheOptions: MavenCacheOptions;
let responses: Map<string, string>;
let requests: string[];

function addProject(repository: string, artifact: string, body = '', packaging = 'jar') {
  responses.set(
    `${repository}/${artifactPath(artifact, 'pom')}`,
    `<project><modelVersion>4.0.0</modelVersion>${coordinates(artifact)}<packaging>${packaging}</packaging>${body}</project>`
  );
  if (packaging !== 'pom')
    responses.set(`${repository}/${artifactPath(artifact, 'jar')}`, `fixture:${artifact}`);
}

beforeEach(async () => {
  testHome.path = await fs.mkdtemp(path.join(os.tmpdir(), 'maven-external-'));
  await fs.outputJson(path.join(testHome.path, '.depssmuggler/settings.json'), {
    mavenRepositories: [external, 'https://unused.example.test/repo'],
  });
  previousCacheOptions = getMavenResolver().getCacheOptions();
  getMavenResolver().setCacheOptions({ cacheDir: path.join(testHome.path, 'resolver-cache') });
  responses = new Map();
  requests = [];
  previousAdapter = axios.defaults.adapter;
  const adapter: AxiosAdapter = async (config) => {
    const url = axios.getUri(config);
    requests.push(url);
    const payload = responses.get(url) ?? responses.get(url.replace(/\.sha1$/, ''));
    if (payload === undefined) {
      throw new AxiosError(`Not found: ${url}`, 'ERR_BAD_REQUEST', config, undefined, {
        config,
        status: 404,
        statusText: 'Not Found',
        headers: {},
        data: '',
      });
    }
    const content =
      url.endsWith('.sha1') && !responses.has(url)
        ? createHash('sha1').update(payload).digest('hex')
        : payload;
    return {
      config,
      status: 200,
      statusText: 'OK',
      headers: { 'content-length': String(content.length) },
      data: config.responseType === 'stream' ? Readable.from([Buffer.from(content)]) : content,
    };
  };
  axios.defaults.adapter = adapter;
  clearMemoryCache();
});

afterEach(async () => {
  clearMemoryCache();
  axios.defaults.adapter = previousAdapter;
  getMavenResolver().setCacheOptions(previousCacheOptions);
  await fs.remove(testHome.path);
});

it('queries only the selected repository and ignores saved addresses', async () => {
  const metadata = (versions: string[]) =>
    `<metadata><versioning><versions>${versions.map((v) => `<version>${v}</version>`).join('')}</versions></versioning></metadata>`;
  responses.set(`${MAVEN_CENTRAL_URL}/example/app/maven-metadata.xml`, metadata(['1.0', '2.0']));
  responses.set(`${external}/example/app/maven-metadata.xml`, metadata(['2.0', '3.0']));
  const downloader = new MavenDownloader();
  expect(await downloader.getVersions('example:app')).toEqual(['2.0', '1.0']);
  expect(await downloader.getVersions('example:app', external)).toEqual(['3.0', '2.0']);
  responses.delete(`${MAVEN_CENTRAL_URL}/example/app/maven-metadata.xml`);
  expect(await downloader.searchPackages('example:app', external)).toMatchObject([
    { name: 'example:app', version: '3.0' },
  ]);
  expect(requests.some((url) => url.includes('search.maven.org'))).toBe(false);
  await fs.outputJson(path.join(testHome.path, '.depssmuggler/settings.json'), {
    mavenRepositories: [],
  });
  expect(await getMavenRepositories()).toEqual([MAVEN_CENTRAL_URL]);
  await expect(downloader.getVersions('example:app')).rejects.toThrow();
});

it('resolves external parent/BOM/transitive POMs and downloads artifacts with matching checksums', async () => {
  addProject(
    external,
    'app',
    `<parent>${coordinates('parent')}</parent><dependencies><dependency><groupId>example</groupId><artifactId>library</artifactId></dependency></dependencies>`
  );
  addProject(
    external,
    'parent',
    `<dependencyManagement><dependencies><dependency>${coordinates('bom')}<type>pom</type><scope>import</scope></dependency></dependencies></dependencyManagement>`,
    'pom'
  );
  addProject(
    external,
    'bom',
    `<dependencyManagement><dependencies><dependency>${coordinates('library')}</dependency></dependencies></dependencyManagement>`,
    'pom'
  );
  addProject(MAVEN_CENTRAL_URL, 'library');
  responses.set(`${MAVEN_CENTRAL_URL}/${artifactPath('app', 'jar.sha1')}`, '0'.repeat(40));
  const resolver = new MavenResolver();
  resolver.setCacheOptions({ cacheDir: path.join(testHome.path, 'cache') });
  const resolved = await resolver.resolveDependencies('example:app', '1.0', {
    repositoryUrl: external,
  });
  expect(resolved.flatList.map((pkg) => pkg.name)).toEqual(
    expect.arrayContaining(['example:app', 'example:parent', 'example:bom', 'example:library'])
  );
  const downloader = new MavenDownloader();
  const metadata = await downloader.getPackageMetadata('example:bom', '1.0', external);
  expect(metadata.metadata?.packaging).toBe('pom');
  const output = path.join(testHome.path, 'output');
  for (const pkg of resolved.flatList) await downloader.downloadPackageFiles(pkg, output);
  expect(await fs.readFile(path.join(output, artifactPath('app', 'jar')), 'utf8')).toBe(
    'fixture:app'
  );
  expect(await fs.readFile(path.join(output, artifactPath('app', 'jar.sha1')), 'utf8')).toBe(
    createHash('sha1').update('fixture:app').digest('hex')
  );
  expect(await fs.pathExists(path.join(output, artifactPath('parent', 'pom')))).toBe(true);
  expect(await fs.pathExists(path.join(output, artifactPath('bom', 'jar')))).toBe(false);
  expect(requests).not.toContain(`${MAVEN_CENTRAL_URL}/${artifactPath('app', 'pom')}`);
  expect(requests.some((url) => url.includes('unused.example.test'))).toBe(false);
});

it('isolates disk POM caches for identical coordinates from different repositories', async () => {
  addProject(MAVEN_CENTRAL_URL, 'app', '<name>Central</name>');
  addProject(external, 'app', '<name>External</name>');
  const coordinate = { groupId: 'example', artifactId: 'app', version: '1.0' };
  const cacheDir = path.join(testHome.path, 'cache');
  await fetchPomWithCacheInfo(coordinate, { cacheDir, repoUrl: external });
  const central = await fetchPomWithCacheInfo(coordinate, { cacheDir, repoUrl: MAVEN_CENTRAL_URL });
  expect(central.pom).toMatchObject({ name: 'Central' });
  clearMemoryCache();
  const cached = await fetchPomWithCacheInfo(coordinate, { cacheDir, repoUrl: external });
  expect(cached.fromCache).toBe('disk');
  expect(cached.pom).toMatchObject({ name: 'External' });
});

it('rejects malformed metadata and does not try another repository after cancellation', async () => {
  responses.set(`${external}/example/app/maven-metadata.xml`, '<html>login page</html>');
  const downloader = new MavenDownloader();
  await expect(downloader.getVersions('example:app', external)).rejects.toThrow();
  const controller = new AbortController();
  controller.abort();
  requests.length = 0;
  await expect(
    downloader.downloadArtifact(
      'example',
      'app',
      '1.0',
      testHome.path,
      'jar',
      undefined,
      undefined,
      { signal: controller.signal }
    )
  ).rejects.toThrow();
  expect(requests).toEqual([]);
});

it('stops on checksum failure instead of hiding corruption by trying another repository', async () => {
  addProject(MAVEN_CENTRAL_URL, 'app');
  addProject(external, 'app');
  responses.set(`${MAVEN_CENTRAL_URL}/${artifactPath('app', 'jar.sha1')}`, '0'.repeat(40));
  const output = path.join(testHome.path, 'output');
  await expect(
    new MavenDownloader().downloadArtifact('example', 'app', '1.0', output)
  ).rejects.toThrow('체크섬 검증 실패');
  expect(requests).not.toContain(`${external}/${artifactPath('app', 'jar')}`);
  expect(await fs.pathExists(path.join(output, artifactPath('app', 'jar')))).toBe(false);
});

it('keeps separate repository selections across cart roots and defaults unselected roots to Central', async () => {
  const another = 'https://another.example.test/releases';
  addProject(external, 'first');
  addProject(another, 'second');
  addProject(MAVEN_CENTRAL_URL, 'central');
  const result = await resolveAllDependencies([
    {
      id: 'first',
      type: 'maven',
      name: 'example:first',
      version: '1.0',
      metadata: { mavenRepository: external },
    },
    {
      id: 'second',
      type: 'maven',
      name: 'example:second',
      version: '1.0',
      metadata: { mavenRepository: another },
    },
    { id: 'central', type: 'maven', name: 'example:central', version: '1.0' },
  ]);
  expect(result.failedPackages).toEqual([]);
  expect(
    result.allPackages.find((pkg) => pkg.name === 'example:first')?.metadata?.mavenRepository
  ).toBe(external);
  expect(
    result.allPackages.find((pkg) => pkg.name === 'example:second')?.metadata?.mavenRepository
  ).toBe(another);
  expect(
    result.allPackages.find((pkg) => pkg.name === 'example:central')?.metadata?.mavenRepository
  ).toBeUndefined();
  expect(
    requests.filter((url) => url.includes('/first/')).every((url) => url.startsWith(external))
  ).toBe(true);
  expect(
    requests.filter((url) => url.includes('/second/')).every((url) => url.startsWith(another))
  ).toBe(true);
  expect(
    requests
      .filter((url) => url.includes('/central/'))
      .every((url) => url.startsWith(MAVEN_CENTRAL_URL))
  ).toBe(true);
});

it.each([false, true])(
  'rejects conflicting shared artifact sources without overwriting either root selection (reverse=%s)',
  async (reverse) => {
    const dependency = `<dependencies><dependency>${coordinates('shared')}</dependency></dependencies>`;
    addProject(external, 'external-root', dependency);
    addProject(MAVEN_CENTRAL_URL, 'central-root', dependency);
    addProject(external, 'shared');
    addProject(MAVEN_CENTRAL_URL, 'shared');
    const roots = [
      {
        id: 'external',
        type: 'maven',
        name: 'example:external-root',
        version: '1.0',
        metadata: { mavenRepository: external },
      },
      { id: 'central', type: 'maven', name: 'example:central-root', version: '1.0' },
    ];
    if (reverse) roots.reverse();
    const result = await resolveAllDependencies(roots);
    expect(result.failedPackages).toHaveLength(1);
    expect(result.failedPackages[0].name).toBe(roots[1].name);
    expect(result.failedPackages[0].error).toContain('Maven 저장소 충돌');
    const shared = result.successfulPackages?.find((pkg) => pkg.name === 'example:shared');
    expect(shared?.metadata?.mavenRepository || MAVEN_CENTRAL_URL).toBe(
      reverse ? MAVEN_CENTRAL_URL : external
    );
  }
);

it('deduplicates a shared Central dependency after selected repository fallback', async () => {
  const dependency = `<dependencies><dependency>${coordinates('shared')}</dependency></dependencies>`;
  addProject(external, 'external-root', dependency);
  addProject(MAVEN_CENTRAL_URL, 'central-root', dependency);
  addProject(MAVEN_CENTRAL_URL, 'shared');
  const result = await resolveAllDependencies([
    {
      id: 'external',
      type: 'maven',
      name: 'example:external-root',
      version: '1.0',
      metadata: { mavenRepository: external },
    },
    { id: 'central', type: 'maven', name: 'example:central-root', version: '1.0' },
  ]);
  expect(result.failedPackages).toEqual([]);
  const shared = result.allPackages.filter((pkg) => pkg.name === 'example:shared');
  expect(shared).toHaveLength(1);
  expect(shared[0].metadata?.mavenRepository).toBe(MAVEN_CENTRAL_URL);
});


it('rejects different sources for the shared POM even when the JAR classifiers differ', async () => {
  addProject(external, 'external-root', `<dependencies><dependency>${coordinates('shared')}<classifier>custom</classifier></dependency></dependencies>`);
  addProject(MAVEN_CENTRAL_URL, 'central-root', `<dependencies><dependency>${coordinates('shared')}</dependency></dependencies>`);
  addProject(external, 'shared');
  addProject(MAVEN_CENTRAL_URL, 'shared');
  const result = await resolveAllDependencies([
    { id: 'external', type: 'maven', name: 'example:external-root', version: '1.0', metadata: { mavenRepository: external } },
    { id: 'central', type: 'maven', name: 'example:central-root', version: '1.0' },
  ]);
  expect(result.failedPackages).toEqual([
    expect.objectContaining({ name: 'example:central-root', error: expect.stringContaining('Maven 저장소 충돌') }),
  ]);
});
