export type DownloadProgressStatus =
  | 'pending'
  | 'downloading'
  | 'completed'
  | 'failed'
  | 'paused';

export interface DownloadProgress {
  packageId: string;
  status: DownloadProgressStatus;
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
  speed: number;
  error?: string;
}

export interface DownloadProgressEvent {
  itemId: string;
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
  speed: number;
}
