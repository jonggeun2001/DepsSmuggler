import type { PackageType } from './package-manager/package-manager';
import type { DeliveryMethod } from './packaging';
import type { Architecture } from './platform/architecture';
import type { OSPackageOutputOptions } from '../core/downloaders/os-shared/types';

export interface HistoryPackageItem {
  type: PackageType;
  name: string;
  version: string;
  arch?: Architecture;
  languageVersion?: string;
  metadata?: Record<string, unknown>;
}

export interface HistorySettings {
  outputFormat: 'zip' | 'tar.gz';
  includeScripts: boolean;
  includeDependencies: boolean;
  deliveryMethod: DeliveryMethod;
  smtpTo?: string;
  fileSplitEnabled?: boolean;
  maxFileSizeMB?: number;
  osOutputOptions?: OSPackageOutputOptions;
}

export interface HistoryDeliveryResult {
  emailSent: boolean;
  emailsSent?: number;
  attachmentsSent?: number;
  splitApplied?: boolean;
  error?: string;
}

export type HistoryStatus = 'success' | 'partial' | 'failed';

export interface DownloadHistory {
  id: string;
  timestamp: string;
  packages: HistoryPackageItem[];
  settings: HistorySettings;
  outputPath: string;
  artifactPaths?: string[];
  deliveryMethod?: DeliveryMethod;
  deliveryResult?: HistoryDeliveryResult;
  totalSize: number;
  status: HistoryStatus;
  downloadedCount?: number;
  failedCount?: number;
}
