import { describe, expect, it } from 'vitest';
import { DEFAULT_MAVEN_BUILD_VERSION, loadMavenLifecyclePlugins } from './maven-lifecycle';

const bindings = `<?xml version="1.0"?><component-set><components>
  <component><role>org.apache.maven.lifecycle.mapping.LifecycleMapping</role><role-hint>jar</role-hint><configuration><lifecycles><lifecycle><id>default</id><phases>
    <process-resources>org.apache.maven.plugins:maven-resources-plugin:3.3.1:resources</process-resources>
    <compile>org.apache.maven.plugins:maven-compiler-plugin:3.13.0:compile</compile>
    <package>org.apache.maven.plugins:maven-jar-plugin:3.4.1:jar</package>
    <install>org.apache.maven.plugins:maven-install-plugin:3.1.2:install</install>
  </phases></lifecycle></lifecycles></configuration></component>
</components></component-set>`;

describe('Maven lifecycle bindings', () => {
  it('loads and deduplicates phases through package for a requested Maven version', async () => {
    const result = await loadMavenLifecyclePlugins('3.9.11', 'jar', async () => bindings);

    expect(DEFAULT_MAVEN_BUILD_VERSION).toBe('3.9.11');
    expect(result.plugins).toEqual([
      { groupId: 'org.apache.maven.plugins', artifactId: 'maven-resources-plugin', version: '3.3.1' },
      { groupId: 'org.apache.maven.plugins', artifactId: 'maven-compiler-plugin', version: '3.13.0' },
      { groupId: 'org.apache.maven.plugins', artifactId: 'maven-jar-plugin', version: '3.4.1' },
    ]);
    expect(result.sourceUrl).toContain('maven-3.9.11/maven-core');
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns no package bindings for pom packaging', async () => {
    const result = await loadMavenLifecyclePlugins('3.9.11', 'pom', async () => bindings);
    expect(result.plugins).toEqual([]);
  });

  it.each([
    ['latest', 'jar'],
    ['3.9', 'jar'],
    ['3.9.11', 'unknown'],
  ])('rejects invalid input %s/%s', async (version, packaging) => {
    await expect(loadMavenLifecyclePlugins(version, packaging, async () => bindings)).rejects.toThrow();
  });

  it('rejects unresolved plugin versions and malformed XML', async () => {
    await expect(
      loadMavenLifecyclePlugins('3.9.11', 'jar', async () => bindings.replace('3.3.1', '${resources.version}')),
    ).rejects.toThrow(/version|placeholder|binding/i);
    await expect(loadMavenLifecyclePlugins('3.9.11', 'jar', async () => '<component-set>')).rejects.toThrow();
  });

  it('ignores comments and rejects a missing or malformed default phase', async () => {
    const withComment = bindings.replace(
      '<components>',
      '<components><!-- <component><role-hint>jar</role-hint><configuration><phases><compile>fake:g:0:goal</compile></phases></configuration></component> -->',
    );
    const parsed = await loadMavenLifecyclePlugins('3.9.11', 'jar', async () => withComment);
    expect(parsed.plugins).toEqual(
      expect.arrayContaining([{ artifactId: 'maven-compiler-plugin', version: '3.13.0', groupId: 'org.apache.maven.plugins' }]),
    );
    await expect(
      loadMavenLifecyclePlugins('3.9.11', 'jar', async () => bindings.replace('<phases>', '<phases><compile>invalid</compile>')),
    ).rejects.toThrow(/binding/i);
    await expect(loadMavenLifecyclePlugins('3.9.11', 'pom', async () => '<component-set/>')).rejects.toThrow(/components/i);
  });
});
