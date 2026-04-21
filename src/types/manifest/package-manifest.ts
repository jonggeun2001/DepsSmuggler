import type { PackageInfo } from '../package-manager/metadata';

/**
 * Public packaging contract preserved for compatibility with `src/types`.
 * Archive-specific metadata now uses `ArchivePackageManifest`.
 */
export interface PackageManifest {
  createdAt: string;
  packages: PackageInfo[];
  totalPackages: number;
  totalSize: number;
  format: 'archive' | 'withScript';
}

export interface ArchivePackageManifest {
  version: string;
  createdAt: string;
  packages: PackageInfo[];
  totalSize: number;
  fileCount: number;
}
