import { flattenDependencyTree, getPackageArtifactKey } from '../../../core/shared/dependency-tree-utils';
import type { DownloadPackage } from '../../../core/shared/types';
import type { DependencyNode, PackageInfo } from '../../../types';
import type { DownloadStoreItem } from '../../stores/download-store';
import { createPendingDownloadItems } from './utils';

export interface ResolvedDownloadData {
  originalPackages: DownloadPackage[];
  allPackages: DownloadPackage[];
  dependencyTrees?: Array<{ root: DependencyNode; flatList?: PackageInfo[] }>;
  failedPackages?: Array<{ name: string; version: string; error: string }>;
}

type Artifact = Parameters<typeof getPackageArtifactKey>[0];

/** Metadata can be enriched during resolution; never merge distinct Maven types/classifiers. */
function getCoordinateKey(pkg: Artifact): string {
  return getPackageArtifactKey({
    type: pkg.type, name: pkg.name, version: pkg.version,
    classifier: pkg.classifier ?? (typeof pkg.metadata?.classifier === 'string' ? pkg.metadata.classifier : undefined),
    metadata: { type: pkg.metadata?.type },
  });
}

/** Preview and download events use the same complete artifact list and real package IDs. */
export function createResolvedDownloadItems(data: ResolvedDownloadData): DownloadStoreItem[] {
  const originalIds = new Set(data.originalPackages.map(pkg => pkg.id));
  const byArtifact = new Map<string, DownloadPackage[]>();
  const byCoordinate = new Map<string, DownloadPackage[]>();
  for (const pkg of data.allPackages) {
    for (const [index, key] of [
      [byArtifact, getPackageArtifactKey(pkg)],
      [byCoordinate, getCoordinateKey(pkg)],
    ] as const) {
      const matches = index.get(key);
      if (matches) matches.push(pkg);
      else index.set(key, [pkg]);
    }
  }

  const findPackage = (pkg: Artifact, originalOnly = false): DownloadPackage | undefined => {
    const eligible = (candidate: DownloadPackage) => !originalOnly || originalIds.has(candidate.id);
    const exact = (byArtifact.get(getPackageArtifactKey(pkg)) ?? []).filter(eligible);
    if (exact.length > 0) return exact.length === 1 ? exact[0] : undefined;
    // A unique coordinate tolerates enriched URLs/filenames, but ambiguous artifacts stay separate.
    const fallback = (byCoordinate.get(getCoordinateKey(pkg)) ?? []).filter(eligible);
    return fallback.length === 1 ? fallback[0] : undefined;
  };

  const owners = new Map<string, { parentId: string; dependencyOf: string }>();
  for (const tree of data.dependencyTrees ?? []) {
    const root = findPackage(tree.root.package, true);
    if (!root) continue;
    for (const member of tree.flatList ?? flattenDependencyTree(tree.root)) {
      const pkg = findPackage(member);
      if (pkg && !originalIds.has(pkg.id) && !owners.has(pkg.id)) {
        owners.set(pkg.id, { parentId: root.id, dependencyOf: root.name });
      }
    }
  }

  return createPendingDownloadItems(data.allPackages.map(pkg => ({
    ...pkg,
    arch: pkg.architecture,
    filename: pkg.filename ?? (typeof pkg.metadata?.filename === 'string' ? pkg.metadata.filename : undefined),
  }))).map((item, index) => ({
    ...item,
    totalBytes: data.allPackages[index].size ??
      (typeof item.metadata?.size === 'number' ? item.metadata.size : 0),
    isDependency: !originalIds.has(item.id),
    ...owners.get(item.id),
  }));
}
