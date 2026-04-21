import type { PackageInfo } from '../package-manager/metadata';

export interface PackageManifest {
  version: string;
  createdAt: string;
  packages: PackageInfo[];
  totalSize: number;
  fileCount: number;
}
