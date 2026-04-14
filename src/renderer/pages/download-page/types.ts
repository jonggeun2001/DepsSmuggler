import type {
  OSPackageInfo,
  OSPackageOutputOptions,
  OSPackageManager,
  PackageDependency,
} from '../../../core/downloaders/os-shared/types';
import type { HistoryDeliveryResult } from '../../../types';

export const OS_PACKAGE_TYPES = new Set(['yum', 'apt', 'apk']);

export type SupportedOSPackageManager = 'yum' | 'apt' | 'apk';

export interface PendingDownloadSource {
  id: string;
  name: string;
  version: string;
  type?: string;
  arch?: string;
  downloadUrl?: string;
  filename?: string;
  metadata?: Record<string, unknown>;
  classifier?: string;
  repository?: unknown;
  location?: string;
  indexUrl?: string;
  extras?: string[];
}

export interface OSDownloadResultData {
  success: OSPackageInfo[];
  failed: Array<{ package: OSPackageInfo; error: string }>;
  skipped: OSPackageInfo[];
  outputPath: string;
  packageManager: OSPackageManager;
  outputOptions: OSPackageOutputOptions;
  generatedOutputs?: Array<{ type: 'archive' | 'repository'; path: string; label: string }>;
  warnings: string[];
  unresolved: PackageDependency[];
  conflicts: Array<{ package: string; versions: OSPackageInfo[] }>;
  cancelled: boolean;
}

export interface OSCartContextSnapshot {
  distributionId: string;
  architecture: string;
  packageManager: SupportedOSPackageManager;
}

export interface HistoryDownloadState {
  deliveryMethod?: 'local' | 'email';
  emailRecipient?: string;
  osOutputOptions?: OSPackageOutputOptions;
}

export interface CompletionArtifactsState {
  completedOutputPath: string;
  completedArtifactPaths: string[];
  completedDeliveryResult?: HistoryDeliveryResult;
}
