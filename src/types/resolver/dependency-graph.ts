import type { PackageInfo } from '../package-manager/metadata';
import type { Architecture } from '../platform/architecture';

export type DependencyScope =
  | 'compile'
  | 'runtime'
  | 'test'
  | 'provided'
  | 'system';

export interface DependencyNode {
  package: PackageInfo;
  dependencies: DependencyNode[];
  optional?: boolean;
  scope?: DependencyScope;
}

export type ConflictType = 'version' | 'circular' | 'missing';

export interface DependencyConflict {
  type: ConflictType;
  packageName: string;
  versions: string[];
  resolvedVersion?: string;
}

export interface DependencyResolutionResult {
  root: DependencyNode;
  flatList: PackageInfo[];
  conflicts: DependencyConflict[];
  totalSize?: number;
}

export interface ResolverTargetPlatform {
  system?: 'Linux' | 'Windows' | 'Darwin';
  machine?: 'x86_64' | 'aarch64' | 'arm64';
}

export interface ResolverOptions {
  includeDevDependencies?: boolean;
  includeOptionalDependencies?: boolean;
  maxDepth?: number;
  architecture?: Architecture;
  targetPlatform?: ResolverTargetPlatform;
  pythonVersion?: string;
}
