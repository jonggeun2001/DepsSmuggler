import type { PackageManifest } from './manifest/package-manifest';

export type OutputFormat = 'archive' | 'withScript';
export type ArchiveType = 'zip' | 'tar.gz';
export type DeliveryMethod = 'local' | 'email';

export interface PackagingOptions {
  format: OutputFormat;
  archiveType?: ArchiveType;
  outputPath: string;
  includeScript?: boolean;
  splitSize?: number;
}

export interface PackagingResult {
  success: boolean;
  files: string[];
  totalSize: number;
  manifest?: PackageManifest;
}
