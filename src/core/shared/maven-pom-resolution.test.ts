import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveAllDependencies } from './dependency-resolver';
import { fetchPom } from './maven-cache';

vi.mock('./maven-cache', async (importOriginal) => ({
  ...await importOriginal<typeof import('./maven-cache')>(),
  fetchPom: vi.fn(),
}));

const fetchPomMock = vi.mocked(fetchPom);

describe('Maven POM 의존성 포함 다운로드 목록', () => {
  beforeEach(() => {
    fetchPomMock.mockReset();
    const createClient = axios.create.bind(axios);
    vi.spyOn(axios, 'create').mockImplementation((config) => {
      const client = createClient(config);
      vi.spyOn(client, 'head').mockResolvedValue({ headers: { 'content-length': '10' } });
      return client;
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it.each(['jar', 'pom', undefined])(
    '원격 packaging=%s이어도 명시한 POM root type과 파일명을 유지한다',
    async (packaging) => {
      fetchPomMock.mockResolvedValue({ packaging });

      const result = await resolveAllDependencies([{
        id: 'pom', type: 'maven', name: 'org.example:sample', version: '1.0',
        metadata: { type: 'pom' },
      }]);

      expect(result.failedPackages).toEqual([]);
      expect(result.allPackages).toHaveLength(1);
      expect(result.allPackages[0].metadata).toMatchObject({
        type: 'pom', filename: 'sample-1.0.pom',
      });
      expect(result.successfulPackages).toEqual(result.allPackages);
    }
  );

  it.each(['jar', 'pom', undefined])(
    '원격 packaging=%s이어도 같은 GAV의 명시적 JAR와 POM을 각각 다운로드한다',
    async (packaging) => {
      fetchPomMock.mockResolvedValue({ packaging });

      const result = await resolveAllDependencies(['jar', 'pom'].map((type) => ({
        id: type, type: 'maven' as const, name: 'org.example:sample', version: '1.0',
        metadata: { type },
      })));

      expect(result.failedPackages).toEqual([]);
      expect(result.allPackages.map((pkg) => pkg.metadata?.filename).sort()).toEqual([
        'sample-1.0.jar', 'sample-1.0.pom',
      ]);
      expect(result.successfulPackages).toHaveLength(2);
    }
  );

  it('type을 지정하지 않은 POM-only root의 파일명도 packaging과 일치한다', async () => {
    fetchPomMock.mockResolvedValue({ packaging: 'pom' });

    const result = await resolveAllDependencies([{
      id: 'auto', type: 'maven', name: 'org.example:parent', version: '1.0',
    }]);

    expect(result.failedPackages).toEqual([]);
    expect(result.allPackages[0].metadata).toMatchObject({
      type: 'pom', filename: 'parent-1.0.pom',
    });
  });

  it('전이 의존성의 명시한 POM type을 원격 packaging으로 덮어쓰지 않는다', async () => {
    fetchPomMock.mockImplementation(async (coordinate) => coordinate.artifactId === 'root'
      ? { dependencies: { dependency: [{
        groupId: 'org.example', artifactId: 'child', version: '1.0', type: 'pom',
      }] } }
      : { packaging: 'jar' });

    const result = await resolveAllDependencies([{
      id: 'root', type: 'maven', name: 'org.example:root', version: '1.0',
    }]);

    expect(result.failedPackages).toEqual([]);
    expect(result.allPackages.find((pkg) => pkg.name === 'org.example:child')?.metadata)
      .toMatchObject({ type: 'pom', filename: 'child-1.0.pom' });
  });
});
