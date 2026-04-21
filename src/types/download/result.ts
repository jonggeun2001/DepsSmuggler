import type { DownloadItem } from './item';

export interface DownloadResult {
  success: boolean;
  items: DownloadItem[];
  totalDownloaded: number;
  totalFailed: number;
  totalSkipped: number;
  outputPath?: string;
}
