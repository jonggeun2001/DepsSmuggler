import { fetchPom } from './maven-cache';
import type { MavenCoordinate, PomProject } from './maven-types';

const SUREFIRE_GROUP = 'org.apache.maven.surefire';
const PROVIDER_ARTIFACTS = new Set([
  'surefire-junit3',
  'surefire-junit4',
  'surefire-junit47',
  'surefire-junit-platform',
  'surefire-testng',
]);

function asModules(value: unknown): string[] {
  const modules = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return modules.filter((module): module is string => typeof module === 'string' && module.trim() !== '');
}

function coordinate(artifactId: string, version: string, type?: string): MavenCoordinate {
  return { groupId: SUREFIRE_GROUP, artifactId, version, ...(type ? { type } : {}) };
}

function effectiveValue(
  project: PomProject,
  field: 'groupId' | 'version',
  fallback: string,
): string {
  return project[field] || project.parent?.[field] || fallback;
}

/**
 * Discovers the provider modules published by the versioned Surefire
 * aggregator. The aggregator itself is returned first so its parent and
 * dependency metadata remain available to the normal Maven closure resolver.
 */
export async function loadMavenSurefireProviders(version: string): Promise<MavenCoordinate[]> {
  if (!/^\d+(?:\.\d+)+(?:[-.][A-Za-z0-9][A-Za-z0-9.-]*)?$/.test(version)) {
    throw new Error(`Invalid Maven Surefire version: ${version}`);
  }

  const aggregate = coordinate('surefire-providers', version, 'pom');
  const pom = await fetchPom(aggregate);
  if (
    pom.artifactId !== undefined && pom.artifactId !== aggregate.artifactId
    || effectiveValue(pom, 'groupId', SUREFIRE_GROUP) !== SUREFIRE_GROUP
    || effectiveValue(pom, 'version', version) !== version
  ) {
    throw new Error('Unexpected Surefire aggregator POM coordinates');
  }
  const modules = asModules((pom as PomProject & { modules?: { module?: unknown } }).modules?.module)
    .filter((module) => PROVIDER_ARTIFACTS.has(module));
  if (modules.length === 0) {
    throw new Error(`Surefire ${version} provider modules missing from aggregator`);
  }

  const providers: MavenCoordinate[] = [];
  for (const artifactId of modules) {
    if (!PROVIDER_ARTIFACTS.has(artifactId)) continue;
    const expected = coordinate(artifactId, version);
    const providerPom = await fetchPom({ ...expected, type: 'pom' });
    const actualGroupId = effectiveValue(providerPom, 'groupId', SUREFIRE_GROUP);
    const actualVersion = effectiveValue(providerPom, 'version', version);
    if (actualGroupId !== SUREFIRE_GROUP || actualVersion !== version || providerPom.artifactId !== artifactId) {
      throw new Error(
        `Unexpected Surefire provider POM coordinates: ${actualGroupId}:${providerPom.artifactId || '(missing)'}:${actualVersion}`,
      );
    }
    providers.push(expected);
  }

  return [aggregate, ...providers];
}
