import type { PackageInfo } from '../package-manager/metadata';

export type DownloadStatus =
  | 'pending'
  | 'downloading'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export interface DownloadItem {
  id: string;
  package: PackageInfo;
  status: DownloadStatus;
  progress: number;
  downloadedBytes?: number;
  totalBytes?: number;
  speed?: number;
  error?: string;
  filePath?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export type { DownloadProgressEvent } from './progress';
