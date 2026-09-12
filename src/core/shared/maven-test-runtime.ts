import type { PackageInfo } from '../../types/package-manager/metadata';

type ResolvePackage = (pkg: PackageInfo) => Promise<PackageInfo[]>;

const JUNIT_API = 'org.junit.jupiter:junit-jupiter-api';
const JUNIT_ENGINE = 'org.junit.jupiter:junit-jupiter-engine';
const VINTAGE_ENGINE = 'org.junit.vintage:junit-vintage-engine';
const JUNIT4 = 'junit:junit';
const PLATFORM_ENGINE = 'org.junit.platform:junit-platform-engine';
const PLATFORM_LAUNCHER = 'org.junit.platform:junit-platform-launcher';
const MAX_CONCURRENCY = 4;

function coordinate(pkg: PackageInfo): string {
  return `${pkg.metadata?.groupId || pkg.name.split(':')[0]}:${pkg.metadata?.artifactId || pkg.name.split(':')[1]}`;
}

function key(pkg: PackageInfo): string {
  return `${coordinate(pkg)}:${pkg.version}:${pkg.metadata?.type || 'jar'}:${pkg.metadata?.classifier || ''}`;
}

function runtimePackage(name: string, version: string): PackageInfo {
  const [groupId, artifactId] = name.split(':');
  return {
    type: 'maven',
    name,
    version,
    metadata: { groupId, artifactId, type: 'jar', origin: 'maven-test-runtime' },
  };
}

function isProjectRoot(pkg: PackageInfo): boolean {
  if (pkg.type !== 'maven') return false;
  const origin = String(pkg.metadata?.origin || '').toLowerCase();
  const type = String(pkg.metadata?.type || '').toLowerCase();
  if (type === 'pom') return false;
  return origin !== 'lifecycle' && origin !== 'provider-plugin' && origin !== 'project-build-plugin';
}

async function mapLimited<T, R>(values: T[], limit: number, mapper: (value: T) => Promise<R>): Promise<R[]> {
  const result: R[] = new Array(values.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < values.length) {
      const index = next++;
      result[index] = await mapper(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return result;
}

async function createDefaultResolver(): Promise<ResolvePackage> {
  const [{ createRequestMavenResolver }, { ResolutionSession }] = await Promise.all([
    import('../resolver/maven-resolver'),
    import('./internal/resolution-session'),
  ]);
  const session = new ResolutionSession();
  return async (pkg: PackageInfo): Promise<PackageInfo[]> => {
    const resolver = createRequestMavenResolver(session);
    const result = await resolver.resolveDependencies(coordinate(pkg), pkg.version, {
      classifier: typeof pkg.metadata?.classifier === 'string' ? pkg.metadata.classifier : undefined,
      artifactType: typeof pkg.metadata?.type === 'string' && pkg.metadata.type !== 'pom'
        ? pkg.metadata.type
        : undefined,
    });
    return result.flatList;
  };
}

/** 프로젝트 dependency tree에서 JUnit 플랫폼 실행에 필요한 companion만 찾아 추가한다. */
export async function collectMavenTestRuntimePackages(
  projectPackages: PackageInfo[],
  resolve?: ResolvePackage,
): Promise<PackageInfo[]> {
  const roots = projectPackages.filter(isProjectRoot);
  const resolvePackage = resolve ?? (await createDefaultResolver());
  const rootTrees = await mapLimited(roots, MAX_CONCURRENCY, resolvePackage);
  const discovered = rootTrees.flat();
  const added = new Map<string, PackageInfo>();
  const resolvedRuntime = new Set<string>();
  const engineQueue: PackageInfo[] = [];
  const directPlatformVersions = new Set<string>();

  const add = (pkg: PackageInfo): void => {
    const artifactKey = key(pkg);
    if (!added.has(artifactKey)) added.set(artifactKey, pkg);
  };
  const queueEngine = (name: string, version: string): void => {
    const engine = runtimePackage(name, version);
    add(engine);
    if (!resolvedRuntime.has(key(engine))) {
      resolvedRuntime.add(key(engine));
      engineQueue.push(engine);
    }
  };

  const apiVersions = new Set<string>();
  let hasJunit4 = false;
  for (const pkg of discovered) {
    if (pkg.type !== 'maven' || pkg.metadata?.type === 'pom') continue;
    if (coordinate(pkg) === JUNIT_API) apiVersions.add(pkg.version);
    if (coordinate(pkg) === JUNIT4) hasJunit4 = true;
    if (coordinate(pkg) === PLATFORM_ENGINE) directPlatformVersions.add(pkg.version);
  }
  for (const version of apiVersions) queueEngine(JUNIT_ENGINE, version);
  if (hasJunit4 && apiVersions.size > 0) {
    for (const version of apiVersions) queueEngine(VINTAGE_ENGINE, version);
  }

  while (engineQueue.length > 0) {
    const batch = engineQueue.splice(0, MAX_CONCURRENCY);
    const engineTrees = await mapLimited(batch, MAX_CONCURRENCY, resolvePackage);
    for (const pkg of engineTrees.flat()) {
      if (pkg.type === 'maven' && pkg.metadata?.type !== 'pom' && coordinate(pkg) === PLATFORM_ENGINE) {
        add(runtimePackage(PLATFORM_LAUNCHER, pkg.version));
      }
    }
  }

  for (const version of directPlatformVersions) add(runtimePackage(PLATFORM_LAUNCHER, version));

  return [...added.values()];
}
