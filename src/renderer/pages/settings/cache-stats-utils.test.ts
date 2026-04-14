import { describe, expect, it } from 'vitest';
import { buildCacheDetailItems } from './cache-stats-utils';

describe('cache-stats-utils', () => {
  it('cache.getStats().details를 타입별 breakdown 뷰 모델로 정규화한다', () => {
    expect(
      buildCacheDetailItems({
        pip: { memoryEntries: 2, diskEntries: 5, diskSize: 4096 },
        npm: { entries: 4, oldestEntry: 1, newestEntry: 2 },
        maven: { memoryEntries: 1, diskEntries: 3, diskSize: 8192, pendingRequests: 0 },
        conda: {
          totalSize: 3072,
          channelCount: 2,
          entries: [
            { channel: 'conda-forge', subdir: 'linux-64', meta: {}, dataSize: 1024 },
            { channel: 'defaults', subdir: 'linux-64', meta: {}, dataSize: 2048 },
          ],
        },
      })
    ).toEqual([
      {
        key: 'pip',
        label: 'PIP',
        entryCount: 5,
        sizeBytes: 4096,
        description: '메모리 2 / 디스크 5',
      },
      {
        key: 'npm',
        label: 'NPM',
        entryCount: 4,
        sizeBytes: undefined,
        description: '메모리 캐시',
      },
      {
        key: 'maven',
        label: 'MAVEN',
        entryCount: 3,
        sizeBytes: 8192,
        description: '메모리 1 / 디스크 3',
      },
      {
        key: 'conda',
        label: 'CONDA',
        entryCount: 2,
        sizeBytes: 3072,
        description: '채널 2개',
      },
    ]);
  });

  it('details가 비어 있어도 네 타입을 0 값으로 유지한다', () => {
    expect(buildCacheDetailItems(undefined)).toEqual([
      { key: 'pip', label: 'PIP', entryCount: 0, sizeBytes: 0, description: '메모리 0 / 디스크 0' },
      { key: 'npm', label: 'NPM', entryCount: 0, sizeBytes: undefined, description: '메모리 캐시' },
      { key: 'maven', label: 'MAVEN', entryCount: 0, sizeBytes: 0, description: '메모리 0 / 디스크 0' },
      { key: 'conda', label: 'CONDA', entryCount: 0, sizeBytes: 0, description: '채널 0개' },
    ]);
  });
});
