import { describe, expect, it } from 'vitest';
import {
  createPendingDownloadItems,
  getPackageGroupStatus,
  getPackageDependencies,
} from './utils';

describe('download-page/utils', () => {
  it('pending download item 생성 시 기본 진행 상태를 채워야 함', () => {
    const items = createPendingDownloadItems([
      {
        id: 'pip-requests-1.0.0',
        name: 'requests',
        version: '1.0.0',
        type: 'pip',
        arch: 'x86_64',
      },
    ]);

    expect(items).toEqual([
      expect.objectContaining({
        id: 'pip-requests-1.0.0',
        name: 'requests',
        version: '1.0.0',
        type: 'pip',
        arch: 'x86_64',
        status: 'pending',
        progress: 0,
        downloadedBytes: 0,
        totalBytes: 0,
        speed: 0,
      }),
    ]);
  });

  it('원본 패키지별 의존성 그룹을 찾아야 함', () => {
    const items = [
      {
        id: 'root',
        name: 'root',
        version: '1.0.0',
        status: 'completed' as const,
        progress: 100,
        downloadedBytes: 0,
        totalBytes: 0,
        speed: 0,
      },
      {
        id: 'dep-1',
        name: 'dep-1',
        version: '1.0.0',
        status: 'completed' as const,
        progress: 100,
        downloadedBytes: 0,
        totalBytes: 0,
        speed: 0,
        isDependency: true,
        parentId: 'root',
      },
      {
        id: 'dep-2',
        name: 'dep-2',
        version: '1.0.0',
        status: 'failed' as const,
        progress: 50,
        downloadedBytes: 0,
        totalBytes: 0,
        speed: 0,
        isDependency: true,
        parentId: 'root',
      },
    ];

    expect(getPackageDependencies(items, 'root')).toHaveLength(2);
    expect(getPackageGroupStatus(items, items[0])).toEqual({
      total: 3,
      completed: 2,
      failed: 1,
      downloading: 0,
      isAllCompleted: false,
      hasFailures: true,
    });
  });
});
