import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPom } from './maven-cache';
import { loadMavenSurefireProviders } from './maven-surefire';

vi.mock('./maven-cache', () => ({ fetchPom: vi.fn() }));

const providerModules = [
  'common-junit3', 'common-java5', 'common-junit4', 'common-junit48',
  'surefire-junit3', 'surefire-junit4', 'surefire-junit47',
  'surefire-junit-platform', 'surefire-testng-utils', 'surefire-testng',
];

describe('Maven Surefire provider discovery', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fetchPom).mockImplementation(async (coordinate) => {
      if (coordinate.artifactId === 'surefire-providers') {
        return { artifactId: 'surefire-providers', modules: { module: providerModules } } as never;
      }
      return { groupId: 'org.apache.maven.surefire', artifactId: coordinate.artifactId } as never;
    });
  });

  it('returns the versioned aggregator and all published provider modules', async () => {
    const result = await loadMavenSurefireProviders('3.2.5');
    expect(result).toEqual([
      { groupId: 'org.apache.maven.surefire', artifactId: 'surefire-providers', version: '3.2.5', type: 'pom' },
      ...['surefire-junit3', 'surefire-junit4', 'surefire-junit47', 'surefire-junit-platform', 'surefire-testng']
        .map((artifactId) => ({ groupId: 'org.apache.maven.surefire', artifactId, version: '3.2.5' })),
    ]);
    expect(fetchPom).toHaveBeenCalledTimes(6);
  });

  it('accepts an older aggregator whose published provider set predates JUnit Platform', async () => {
    vi.mocked(fetchPom).mockResolvedValueOnce({ modules: { module: ['surefire-junit3'] } } as never);
    await expect(loadMavenSurefireProviders('2.12.4')).resolves.toEqual([
      { groupId: 'org.apache.maven.surefire', artifactId: 'surefire-providers', version: '2.12.4', type: 'pom' },
      { groupId: 'org.apache.maven.surefire', artifactId: 'surefire-junit3', version: '2.12.4' },
    ]);
  });

  it('rejects an aggregator with no recognized provider modules', async () => {
    vi.mocked(fetchPom).mockResolvedValueOnce({ modules: { module: ['common-junit3'] } } as never);
    await expect(loadMavenSurefireProviders('3.2.5')).rejects.toThrow(/provider modules missing/);
  });

  it('validates provider POM coordinates and rejects invalid versions', async () => {
    vi.mocked(fetchPom).mockImplementation(async (coordinate) => {
      if (coordinate.artifactId === 'surefire-providers') return { modules: { module: providerModules } } as never;
      return { groupId: 'wrong.group', artifactId: coordinate.artifactId } as never;
    });
    await expect(loadMavenSurefireProviders('3.2.5')).rejects.toThrow(/Unexpected Surefire/);
    await expect(loadMavenSurefireProviders('latest')).rejects.toThrow(/Invalid Maven Surefire version/);
    await expect(loadMavenSurefireProviders('2.12')).rejects.toThrow(/Unexpected Surefire/);
  });

  it('validates the published aggregator coordinates', async () => {
    vi.mocked(fetchPom).mockResolvedValueOnce({
      groupId: 'org.apache.maven.surefire', artifactId: 'wrong-aggregator', version: '3.2.5',
      modules: { module: providerModules },
    } as never);
    await expect(loadMavenSurefireProviders('3.2.5')).rejects.toThrow(/Unexpected Surefire aggregator/);
  });

  it('accepts coordinates inherited from the provider parent', async () => {
    vi.mocked(fetchPom).mockImplementation(async (coordinate) => {
      if (coordinate.artifactId === 'surefire-providers') return { modules: { module: ['surefire-junit3'] } } as never;
      return {
        artifactId: coordinate.artifactId,
        parent: { groupId: 'org.apache.maven.surefire', version: '2.12' },
      } as never;
    });
    await expect(loadMavenSurefireProviders('2.12')).resolves.toHaveLength(2);
  });
});
