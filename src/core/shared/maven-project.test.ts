import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collectMavenProjectPackages } from './maven-project';
import { fetchPom } from './maven-cache';
import { loadMavenLifecyclePlugins } from './maven-lifecycle';
import { loadMavenSurefireProviders } from './maven-surefire';
import { collectMavenTestRuntimePackages } from './maven-test-runtime';

vi.mock('./maven-cache', () => ({ fetchPom: vi.fn() }));
vi.mock('./maven-surefire', () => ({ loadMavenSurefireProviders: vi.fn() }));
vi.mock('./maven-test-runtime', () => ({ collectMavenTestRuntimePackages: vi.fn() }));
vi.mock('./maven-lifecycle', () => ({
  DEFAULT_MAVEN_BUILD_VERSION: '3.9.11',
  loadMavenLifecyclePlugins: vi.fn(),
}));

const project = (body: string) => `<project><modelVersion>4.0.0</modelVersion>
  <groupId>local</groupId><artifactId>app</artifactId><version>1</version>${body}</project>`;
const plugin = (id: string, body = '') => `<plugin><artifactId>${id}</artifactId>${body}</plugin>`;

describe('project POM package collection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(loadMavenLifecyclePlugins).mockResolvedValue({
      plugins: [
        { groupId: 'org.apache.maven.plugins', artifactId: 'maven-resources-plugin', version: '3.3.1' },
        { groupId: 'org.apache.maven.plugins', artifactId: 'maven-compiler-plugin', version: '3.13.0' },
      ],
      sourceUrl: 'https://example.test/maven-3.9.11/default-bindings.xml', sha256: 'abc',
    });
    vi.mocked(fetchPom).mockRejectedValue(new Error('unexpected model fetch'));
    vi.mocked(collectMavenTestRuntimePackages).mockResolvedValue([]);
  });

  it('resolves properties and retains provided/test roots alongside package lifecycle plugins, without downloading the local project', async () => {
    const result = await collectMavenProjectPackages(project(`<properties><v>1.2</v></properties>
      <dependencies>
        <dependency><groupId>lib</groupId><artifactId>api</artifactId><version>\${v}</version><scope>provided</scope></dependency>
        <dependency><groupId>lib</groupId><artifactId>test</artifactId><version>2</version><scope>test</scope></dependency>
      </dependencies>`));
    expect(result.map(p => `${p.name}:${p.version}`)).toEqual([
      'lib:api:1.2', 'lib:test:2',
      'org.apache.maven.plugins:maven-resources-plugin:3.3.1',
      'org.apache.maven.plugins:maven-compiler-plugin:3.13.0',
    ]);
    expect(loadMavenLifecyclePlugins).toHaveBeenCalledWith('3.9.11', 'jar');
    expect(result[2].metadata).toMatchObject({ type: 'maven-plugin', mavenVersion: '3.9.11' });
    expect(fetchPom).not.toHaveBeenCalled();
  });

  it('merges inherited plugins and management with child overrides, retaining plugin dependencies and parent POM', async () => {
    vi.mocked(fetchPom).mockResolvedValue({
      groupId: 'org', artifactId: 'parent', version: '1',
      properties: { compiler: '3.11.0' },
      build: {
        plugins: { plugin: [
          { artifactId: 'maven-compiler-plugin', version: '${compiler}' },
          { groupId: 'tools', artifactId: 'not-inherited', version: '1', inherited: 'false' },
          { groupId: 'tools', artifactId: 'custom', version: '1', dependencies: { dependency: { groupId: 'tools', artifactId: 'helper', version: '2' } } },
        ] },
        pluginManagement: { plugins: { plugin: [
          { artifactId: 'maven-resources-plugin', version: '3.2.0' },
          { groupId: 'tools', artifactId: 'unused', version: '1' },
        ] } },
      },
    });
    const result = await collectMavenProjectPackages(project(`
      <parent><groupId>org</groupId><artifactId>parent</artifactId><version>1</version></parent>
      <properties><compiler>3.12.1</compiler></properties>
      <build><plugins>${plugin('maven-compiler-plugin')}</plugins></build>`));
    expect(result.map(p => `${p.name}:${p.version}`)).toEqual(expect.arrayContaining([
      'org:parent:1', 'org.apache.maven.plugins:maven-resources-plugin:3.2.0',
      'org.apache.maven.plugins:maven-compiler-plugin:3.12.1', 'tools:custom:1', 'tools:helper:2',
    ]));
    expect(result.some(p => /unused|not-inherited/.test(p.name))).toBe(false);
    expect(result.find(p => p.name === 'org:parent')?.metadata?.type).toBe('pom');
    expect(fetchPom).toHaveBeenCalledTimes(1);
  });

  it('includes required BOMs and managed used dependencies without expanding unused management', async () => {
    vi.mocked(fetchPom).mockResolvedValue({ dependencyManagement: { dependencies: { dependency: [
      { groupId: 'lib', artifactId: 'used', version: '2' },
      { groupId: 'lib', artifactId: 'unused', version: '9' },
    ] } } });
    const result = await collectMavenProjectPackages(project(`
      <dependencyManagement><dependencies><dependency><groupId>lib</groupId><artifactId>bom</artifactId><version>1</version><type>pom</type><scope>import</scope></dependency></dependencies></dependencyManagement>
      <dependencies><dependency><groupId>lib</groupId><artifactId>used</artifactId></dependency></dependencies>`));
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'lib:used', version: '2' }),
      expect.objectContaining({ name: 'lib:bom', version: '1', metadata: expect.objectContaining({ type: 'pom' }) }),
    ]));
    expect(result.some(p => p.name === 'lib:unused')).toBe(false);
  });

  it('honors an explicit plugin version over pluginManagement and the target lifecycle version', async () => {
    const result = await collectMavenProjectPackages(project(`<build>
      <pluginManagement><plugins>${plugin('maven-compiler-plugin', '<version>3.10.1</version>')}</plugins></pluginManagement>
      <plugins>${plugin('maven-compiler-plugin', '<version>3.11.0</version>')}</plugins></build>`), { mavenVersion: '3.8.6' });
    expect(result.find(p => p.name.endsWith(':maven-compiler-plugin'))?.version).toBe('3.11.0');
    expect(loadMavenLifecyclePlugins).toHaveBeenCalledWith('3.8.6', 'jar');
  });

  it('keeps POM packaging free of jar lifecycle plugins', async () => {
    vi.mocked(loadMavenLifecyclePlugins).mockResolvedValue({ plugins: [], sourceUrl: 'source', sha256: 'hash' });
    expect(await collectMavenProjectPackages(project('<packaging>pom</packaging>'))).toEqual([]);
    expect(loadMavenLifecyclePlugins).toHaveBeenCalledWith('3.9.11', 'pom');
  });

  it('collects runtime test providers for the effective Surefire version and propagates failures', async () => {
    vi.mocked(collectMavenTestRuntimePackages).mockResolvedValue([
      { type: 'maven', name: 'org.junit.platform:junit-platform-launcher', version: '1.10.1' },
    ]);
    vi.mocked(loadMavenSurefireProviders).mockResolvedValue([
      { groupId: 'org.apache.maven.surefire', artifactId: 'surefire-providers', version: '3.2.5', type: 'pom' },
      { groupId: 'org.apache.maven.surefire', artifactId: 'surefire-junit-platform', version: '3.2.5' },
    ]);
    const pom = project(`<build><plugins>${plugin('maven-surefire-plugin', '<version>3.2.5</version>')}</plugins></build>`);
    const result = await collectMavenProjectPackages(pom);
    expect(loadMavenSurefireProviders).toHaveBeenCalledWith('3.2.5');
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'org.apache.maven.surefire:surefire-junit-platform', version: '3.2.5' }),
      expect.objectContaining({ name: 'org.apache.maven.surefire:surefire-providers', metadata: expect.objectContaining({ type: 'pom' }) }),
      expect.objectContaining({ name: 'org.junit.platform:junit-platform-launcher', version: '1.10.1' }),
    ]));
    vi.mocked(loadMavenSurefireProviders).mockRejectedValue(new Error('provider POM unavailable'));
    await expect(collectMavenProjectPackages(pom)).rejects.toThrow('provider POM unavailable');
  });

  it.each([
    ['unresolved dependency', '<dependencies><dependency><groupId>lib</groupId><artifactId>a</artifactId><version>${missing}</version></dependency></dependencies>'],
    ['versionless plugin', `<build><plugins>${plugin('custom')}</plugins></build>`],
    ['system path', '<dependencies><dependency><groupId>lib</groupId><artifactId>a</artifactId><version>1</version><scope>system</scope></dependency></dependencies>'],
    ['profiles', '<profiles><profile><id>target</id></profile></profiles>'],
    ['reactor', '<modules><module>child</module></modules>'],
  ])('fails explicitly for %s instead of returning an incomplete offline project', async (_, body) => {
    await expect(collectMavenProjectPackages(project(body))).rejects.toThrow();
  });

  it('rejects invalid XML and dependency fragments at the project API boundary', async () => {
    await expect(collectMavenProjectPackages('<project>')).rejects.toThrow();
    await expect(collectMavenProjectPackages('<dependency/>')).rejects.toThrow();
  });
});
