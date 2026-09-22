import type { PackageManifest } from './manifest/package-manifest';

export type OutputFormat = 'archive' | 'withScript';
export type ArchiveType = 'zip' | 'tar.gz';
export type DeliveryMethod = 'local' | 'email';

export interface ArchiveProgress {
  processedFiles: number;
  totalFiles: number;
  processedBytes: number;
  totalBytes: number;
  percentage: number;
  /** 압축 결과로 실제 기록된 바이트. 원본 처리량과 별개입니다. */
  outputBytes?: number;
}

export interface PackagingDetails {
  message: string;
  archiveProgress?: ArchiveProgress;
}

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
