import type { HistoryDeliveryResult } from '../../../types';
import type {
  DownloadItem,
  PackagingStatus,
} from '../../stores/download-store';

export type DownloadPageMode =
  | 'os-dedicated'
  | 'os-reselection'
  | 'empty'
  | 'completed'
  | 'failed'
  | 'active';

interface DeriveDownloadPageModeInput {
  cartItemCount: number;
  downloadItemCount: number;
  packagingStatus: PackagingStatus;
  isDedicatedOSFlow: boolean;
  osDownloading: boolean;
  hasOSResult: boolean;
  requiresOSCartReselection: boolean;
  hasRecoverableFailureArtifacts: boolean;
}

interface RecoverableArtifactsInput {
  completedOutputPath: string;
  completedArtifactPaths: string[];
  completedDeliveryResult?: HistoryDeliveryResult;
}

export function hasRecoverableArtifacts(input: RecoverableArtifactsInput): boolean {
  return (
    Boolean(input.completedOutputPath) ||
    input.completedArtifactPaths.length > 0 ||
    Boolean(input.completedDeliveryResult?.error)
  );
}

export function deriveDownloadPageMode(input: DeriveDownloadPageModeInput): DownloadPageMode {
  const shouldRenderDedicatedOSFlow =
    input.isDedicatedOSFlow || input.osDownloading || input.hasOSResult;

  if (shouldRenderDedicatedOSFlow) {
    return 'os-dedicated';
  }

  if (input.requiresOSCartReselection) {
    return 'os-reselection';
  }

  if (input.cartItemCount === 0 && input.downloadItemCount === 0) {
    return 'empty';
  }

  if (input.packagingStatus === 'completed') {
    return 'completed';
  }

  if (input.packagingStatus === 'failed' && input.hasRecoverableFailureArtifacts) {
    return 'failed';
  }

  return 'active';
}

export function getDownloadCounts(items: DownloadItem[]) {
  const completedCount = items.filter((item) => item.status === 'completed').length;
  const failedCount = items.filter((item) => item.status === 'failed').length;
  const skippedCount = items.filter((item) => item.status === 'skipped').length;
  const allCompleted =
    items.length > 0 &&
    items.every((item) => ['completed', 'skipped'].includes(item.status));

  return {
    completedCount,
    failedCount,
    skippedCount,
    allCompleted,
  };
}
