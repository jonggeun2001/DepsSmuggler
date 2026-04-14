import {
  OSCartContextSnapshot,
  OSDownloadResultData,
  OS_PACKAGE_TYPES,
  PendingDownloadSource,
  SupportedOSPackageManager,
} from './types';
import type {
  OSPackageInfo,
  PackageDependency,
} from '../../../core/downloaders/os-shared/types';
import type { CartItem } from '../../stores/cart-store';
import type {
  DownloadItem,
  DownloadStatus,
} from '../../stores/download-store';

export function isOSCartItem(item: CartItem): item is CartItem & { type: SupportedOSPackageManager } {
  return OS_PACKAGE_TYPES.has(item.type);
}

export function getOSCartContextSnapshot(item: CartItem): OSCartContextSnapshot | null {
  const raw = item.metadata?.osContext;
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const { distributionId, architecture, packageManager } = raw as Partial<OSCartContextSnapshot>;
  if (
    typeof distributionId !== 'string' ||
    typeof architecture !== 'string' ||
    (packageManager !== 'yum' && packageManager !== 'apt' && packageManager !== 'apk')
  ) {
    return null;
  }

  return {
    distributionId,
    architecture,
    packageManager,
  };
}

export function toOSPackageInfo(item: CartItem): OSPackageInfo | null {
  const raw = item.metadata?.osPackageInfo as OSPackageInfo | undefined;
  if (raw) {
    return raw;
  }

  if (!item.repository || !item.location || !item.arch) {
    return null;
  }

  const architectureMap: Partial<Record<NonNullable<CartItem['arch']>, OSPackageInfo['architecture']>> = {
    x86_64: 'x86_64',
    amd64: 'amd64',
    arm64: 'arm64',
    aarch64: 'aarch64',
    i386: 'i386',
    i686: 'i686',
    noarch: 'noarch',
    all: 'all',
    'arm/v7': 'armv7',
    '386': 'i386',
  };
  const architecture = architectureMap[item.arch];
  if (!architecture) {
    return null;
  }

  const repository: OSPackageInfo['repository'] = {
    id: item.repository.baseUrl,
    name: item.repository.name || item.repository.baseUrl,
    baseUrl: item.repository.baseUrl,
    enabled: true,
    gpgCheck: true,
    isOfficial: false,
  };

  return {
    name: item.name,
    version: item.version,
    architecture,
    size: 0,
    checksum: { type: 'sha256', value: '' },
    location: item.location,
    repository,
    dependencies: [],
    description: typeof item.metadata?.description === 'string' ? item.metadata.description : undefined,
    summary: typeof item.metadata?.description === 'string' ? item.metadata.description : undefined,
  };
}

export function formatDependencyRequirement(requirement: PackageDependency): string {
  if (!requirement.version) {
    return requirement.name;
  }

  return `${requirement.name} ${requirement.operator || '='} ${requirement.version}`;
}

export function buildOSDependencyIssueMessage(
  result: Pick<OSDownloadResultData, 'warnings' | 'unresolved' | 'conflicts'>
): string {
  const sections: string[] = [];

  if (result.unresolved.length > 0) {
    sections.push(
      `해결되지 않은 의존성:\n${result.unresolved
        .map((dependency) => `- ${formatDependencyRequirement(dependency)}`)
        .join('\n')}`
    );
  }

  if (result.conflicts.length > 0) {
    sections.push(
      `버전 충돌:\n${result.conflicts
        .map((conflict) => `- ${conflict.package}: ${conflict.versions.map((pkg) => pkg.version).join(', ')}`)
        .join('\n')}`
    );
  }

  if (result.warnings.length > 0) {
    sections.push(`경고:\n${result.warnings.map((warning) => `- ${warning}`).join('\n')}`);
  }

  return sections.join('\n\n');
}

export function createPendingDownloadItems(items: PendingDownloadSource[]): DownloadItem[] {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    version: item.version,
    type: item.type,
    arch: item.arch,
    status: 'pending' as DownloadStatus,
    progress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    speed: 0,
    downloadUrl: item.downloadUrl,
    filename: item.filename,
    metadata: item.metadata,
    classifier: item.classifier,
    repository: item.repository,
    location: item.location,
    indexUrl: item.indexUrl,
    extras: item.extras,
  }));
}

export function hasMatchingCartSnapshot(snapshot: CartItem[], currentItems: CartItem[]): boolean {
  if (snapshot.length !== currentItems.length) {
    return false;
  }

  return snapshot.every((item, index) => currentItems[index]?.id === item.id);
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '-';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function getPackageDependencies(items: DownloadItem[], parentId: string): DownloadItem[] {
  return items.filter((item) => item.isDependency && item.parentId === parentId);
}

export function getPackageGroupStatus(items: DownloadItem[], parentItem: DownloadItem) {
  const deps = getPackageDependencies(items, parentItem.id);
  const allItems = [parentItem, ...deps];
  const completed = allItems.filter((item) => item.status === 'completed').length;
  const failed = allItems.filter((item) => item.status === 'failed').length;
  const downloading = allItems.filter((item) => item.status === 'downloading').length;

  return {
    total: allItems.length,
    completed,
    failed,
    downloading,
    isAllCompleted: allItems.every((item) => ['completed', 'skipped'].includes(item.status)),
    hasFailures: failed > 0,
  };
}

export async function persistHistoryAndMaybeClearCart({
  persistHistory,
  clearCart,
  canClearCart,
  onPersistError,
}: {
  persistHistory: () => Promise<void>;
  clearCart: () => void;
  canClearCart: boolean | (() => boolean);
  onPersistError: (error: unknown) => void;
}): Promise<boolean> {
  try {
    await persistHistory();

    const shouldClearCart =
      typeof canClearCart === 'function'
        ? canClearCart()
        : canClearCart;

    if (shouldClearCart) {
      clearCart();
    }

    return true;
  } catch (error) {
    onPersistError(error);
    return false;
  }
}
