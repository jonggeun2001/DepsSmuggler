import { createHash } from 'crypto';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import { expect, it, vi } from 'vitest';
import { MavenDownloader } from './maven';
import { MavenResolver } from '../resolver/maven-resolver';
import { clearMemoryCache } from '../shared/maven-cache';

const testHome = vi.hoisted(() => ({ path: '' }));
vi.mock('os', async (original) => ({
  ...(await original<typeof import('os')>()),
  homedir: () => testHome.path,
}));

// Explicit opt-in: exercise the user's real public repository without changing their settings.
it.skipIf(process.env.DEPS_SMUGGLER_ALFRESCO_TEST !== '1')(
  'downloads com.ibm.db2.jcc:db2jcc4:10.1 from the configured Alfresco repository',
  async () => {
    testHome.path = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-alfresco-'));
    const repository = 'https://artifacts.alfresco.com/nexus/content/repositories/public';
    const name = 'com.ibm.db2.jcc:db2jcc4';
    try {
      await fs.outputJson(path.join(testHome.path, '.depssmuggler/settings.json'), {
        mavenRepositories: [repository + '/'],
      });
      const downloader = new MavenDownloader();
      expect(await downloader.searchPackages(name)).toMatchObject([{ name, version: '10.1' }]);
      expect(await downloader.getVersions(name)).toContain('10.1');
      const metadata = await downloader.getPackageMetadata(name, '10.1');
      expect(metadata.metadata?.downloadUrl).toBe(
        `${repository}/com/ibm/db2/jcc/db2jcc4/10.1/db2jcc4-10.1.jar`
      );
      const resolver = new MavenResolver();
      resolver.setCacheOptions({ cacheDir: path.join(testHome.path, 'cache') });
      const resolved = await resolver.resolveDependencies(name, 'latest');
      expect(resolved.flatList).toMatchObject([{ name, version: '10.1' }]);
      const output = path.join(testHome.path, 'output');
      const files = await downloader.downloadPackageFiles(resolved.flatList[0], output);
      expect(files.map((file) => path.basename(file)).sort()).toEqual([
        'db2jcc4-10.1.jar',
        'db2jcc4-10.1.jar.sha1',
        'db2jcc4-10.1.pom',
        'db2jcc4-10.1.pom.sha1',
      ]);
      const jar = files.find((file) => file.endsWith('.jar'));
      if (!jar) throw new Error('JAR 다운로드 결과가 없습니다.');
      const content = await fs.readFile(jar);
      const checksum = (await fs.readFile(jar + '.sha1', 'utf8')).trim();
      expect(content.subarray(0, 2).toString()).toBe('PK');
      expect(createHash('sha1').update(content).digest('hex')).toBe(checksum);
      console.info('Alfresco DB2 download verified', {
        coordinate: `${name}:10.1`,
        repository,
        bytes: content.length,
        sha1: checksum,
        sha256: createHash('sha256').update(content).digest('hex'),
        files: files.map((file) => path.basename(file)),
      });
    } finally {
      clearMemoryCache();
      await fs.remove(testHome.path);
    }
  },
  120000
);
