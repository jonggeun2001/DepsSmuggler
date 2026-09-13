import { dependencyManagementKey } from './maven-types';
import type { DependencyNode, PackageInfo } from '../../types';

/** Returns ordinary descendants only; model POMs and the input root are excluded. */
type ResolveDescendants = (root: PackageInfo) => Promise<PackageInfo[]>;
const MAX_MANAGED_ROOTS = 10_000;

function identity(pkg: PackageInfo): { groupId: string; artifactId: string; type?: string; classifier?: string } {
  const [groupId, artifactId] = pkg.name.split(':');
  return {
    groupId, artifactId,
    type: typeof pkg.metadata?.type === 'string' ? pkg.metadata.type : undefined,
    classifier: typeof pkg.metadata?.classifier === 'string' ? pkg.metadata.classifier : undefined,
  };
}

function artifactKey(pkg: PackageInfo): string {
  return `${dependencyManagementKey(identity(pkg))}:${pkg.version}`;
}

async function createResolver(): Promise<ResolveDescendants> {
  const [{ createRequestMavenResolver }, { ResolutionSession }] = await Promise.all([
    import('../resolver/maven-resolver'), import('./internal/resolution-session'),
  ]);
  const session = new ResolutionSession();
  return async (root) => {
    const resolver = createRequestMavenResolver(session);
    const coordinate = identity(root);
    const result = await resolver.resolveDependencies(root.name, root.version, {
      artifactType: coordinate.type, classifier: coordinate.classifier,
    });
    // flatList also contains parent/import model POMs; those declarations do not
    // make an otherwise unused project management entry an actual dependency.
    const pending: DependencyNode[] = [...result.root.dependencies];
    const seen = new Set<DependencyNode>();
    const dependencies: PackageInfo[] = [];
    while (pending.length) {
      const node = pending.pop()!;
      if (seen.has(node)) continue;
      seen.add(node);
      dependencies.push(node.package);
      pending.push(...node.dependencies);
    }
    return dependencies;
  };
}

/** Add every project-managed version encountered on a real dependency path.
 * Original roots/versions remain untouched, so this is transport collection,
 * not Maven conflict mediation. Newly added versions can expose more paths.
 */
export async function collectMavenManagedPackages(
  projectPackages: PackageInfo[],
  management: Map<string, string>,
  resolve?: ResolveDescendants,
): Promise<PackageInfo[]> {
  if (management.size === 0) return [];
  const roots = projectPackages.filter(pkg => pkg.type === 'maven' && pkg.metadata?.origin !== 'project-model');
  if (roots.length === 0) return [];
  const resolveDescendants = resolve || await createResolver();
  const pending: PackageInfo[] = [];
  const queued = new Set<string>();
  for (const root of roots) {
    const key = artifactKey(root);
    if (!queued.has(key)) { queued.add(key); pending.push(root); }
  }
  const collected = new Map<string, PackageInfo>();
  while (pending.length) {
    const batch = pending.splice(0, 4);
    const results = await Promise.allSettled(batch.map(resolveDescendants));
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason;
      for (const dependency of result.value) {
        const version = management.get(dependencyManagementKey(identity(dependency)));
        if (!version || version === dependency.version) continue;
        if (/\$\{|\s|[[\](),]/.test(version) || /^(latest|release)$/i.test(version)) {
          throw new Error(`프로젝트 관리 버전을 확정할 수 없습니다: ${dependency.name}:${version}`);
        }
        const managed: PackageInfo = {
          ...dependency, version,
          // Old artifact URLs/checksums belong to the original version. Only
          // coordinate fields can be carried to a newly requested version.
          metadata: { ...identity(dependency), origin: 'project-managed-dependency' },
        };
        const key = artifactKey(managed);
        if (queued.has(key)) continue;
        if (queued.size >= MAX_MANAGED_ROOTS) throw new Error('프로젝트 관리 의존성 수집 한도를 초과했습니다.');
        queued.add(key);
        collected.set(key, managed);
        pending.push(managed);
      }
    }
  }
  return [...collected.values()];
}
