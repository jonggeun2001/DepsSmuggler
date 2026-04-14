export type CacheDetailKey = 'pip' | 'npm' | 'maven' | 'conda';

export interface CacheDetailItemsInput {
  pip?: unknown;
  npm?: unknown;
  maven?: unknown;
  conda?: unknown;
}

export interface CacheDetailItem {
  key: CacheDetailKey;
  label: string;
  entryCount: number;
  sizeBytes?: number;
  description: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function buildCacheDetailItems(details?: CacheDetailItemsInput): CacheDetailItem[] {
  const pip = asRecord(details?.pip);
  const npm = asRecord(details?.npm);
  const maven = asRecord(details?.maven);
  const conda = asRecord(details?.conda);

  const pipMemoryEntries = asNumber(pip.memoryEntries);
  const pipDiskEntries = asNumber(pip.diskEntries);
  const mavenMemoryEntries = asNumber(maven.memoryEntries);
  const mavenDiskEntries = asNumber(maven.diskEntries);
  const condaEntries = asArray(conda.entries);
  const condaChannelCount = asNumber(conda.channelCount);

  return [
    {
      key: 'pip',
      label: 'PIP',
      entryCount: Math.max(pipMemoryEntries, pipDiskEntries),
      sizeBytes: asNumber(pip.diskSize),
      description: `메모리 ${pipMemoryEntries} / 디스크 ${pipDiskEntries}`,
    },
    {
      key: 'npm',
      label: 'NPM',
      entryCount: asNumber(npm.entries),
      sizeBytes: undefined,
      description: '메모리 캐시',
    },
    {
      key: 'maven',
      label: 'MAVEN',
      entryCount: Math.max(mavenMemoryEntries, mavenDiskEntries),
      sizeBytes: asNumber(maven.diskSize),
      description: `메모리 ${mavenMemoryEntries} / 디스크 ${mavenDiskEntries}`,
    },
    {
      key: 'conda',
      label: 'CONDA',
      entryCount: condaEntries.length,
      sizeBytes: asNumber(conda.totalSize),
      description: `채널 ${condaChannelCount}개`,
    },
  ];
}
