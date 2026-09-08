import { describe, expect, it } from 'vitest';
import {
  createPendingDownloadItems,
  hasMatchingActiveCartSnapshot,
  hasMatchingCartSnapshot,
  getPackageGroupStatus,
  getPackageDependencies,
  groupDownloadItems,
  persistHistoryAndMaybeClearCart,
} from './utils';
import type { DownloadStoreItem, DownloadStoreStatus } from '../../stores/download-store';

describe('download-page/utils', () => {
  it('그룹 인덱스가 입력 순서·상태 집계를 유지하면서 전체 목록의 반복 스캔을 피한다', () => {
    let dependencyReads = 0;
    const statuses: DownloadStoreStatus[] = ['pending', 'downloading', 'completed', 'failed', 'skipped', 'paused', 'cancelled'];
    const items: DownloadStoreItem[] = Array.from({ length: 80 }, (_, index) => ({
      id: `item-${index}`, name: `item-${index}`, version: '1',
      status: statuses[index % statuses.length], progress: 0, downloadedBytes: 0,
      totalBytes: 0, speed: 0,
      get isDependency() { dependencyReads++; return index >= 20; },
      parentId: index >= 20 ? `item-${index % 21}` : undefined,
    }));
    const expected = items.filter((item) => !item.isDependency).map((parent) => ({
      parent, dependencies: getPackageDependencies(items, parent.id),
      status: getPackageGroupStatus(items, parent),
    }));
    dependencyReads = 0;

    const actual = groupDownloadItems(items);
    const reads = dependencyReads;

    expect(actual).toEqual(expected);
    expect(actual[0].parent).toBe(items[0]);
    expect(actual[0].dependencies[0]).toBe(items[21]);
    expect(reads).toBeLessThanOrEqual(items.length * 2);
    expect(groupDownloadItems([])).toEqual([]);
  });

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

  it('cart snapshot과 현재 장바구니가 같을 때만 true를 반환한다', () => {
    const snapshot = [
      { id: 'a', name: 'a', version: '1.0.0', type: 'pip', addedAt: 1 },
      { id: 'b', name: 'b', version: '1.0.0', type: 'npm', addedAt: 2 },
    ];

    expect(hasMatchingCartSnapshot(snapshot, [...snapshot])).toBe(true);
    expect(hasMatchingCartSnapshot(snapshot, [snapshot[0]])).toBe(false);
    expect(hasMatchingCartSnapshot(snapshot, [snapshot[1], snapshot[0]])).toBe(false);
  });

  it('활성 다운로드 세션이 바뀌면 같은 cart snapshot이어도 false를 반환한다', () => {
    const snapshot = [
      { id: 'a', name: 'a', version: '1.0.0', type: 'pip', addedAt: 1 },
      { id: 'b', name: 'b', version: '1.0.0', type: 'npm', addedAt: 2 },
    ];

    expect(
      hasMatchingActiveCartSnapshot({
        snapshot,
        currentItems: [...snapshot],
        expectedSessionId: 3,
        activeSessionId: 3,
      })
    ).toBe(true);

    expect(
      hasMatchingActiveCartSnapshot({
        snapshot,
        currentItems: [...snapshot],
        expectedSessionId: 3,
        activeSessionId: 4,
      })
    ).toBe(false);
  });

  it('히스토리 저장이 성공하면 장바구니를 비운다', async () => {
    let cleared = false;

    const result = await persistHistoryAndMaybeClearCart({
      persistHistory: async () => undefined,
      clearCart: () => {
        cleared = true;
      },
      canClearCart: true,
      onPersistError: () => {
        throw new Error('should not be called');
      },
    });

    expect(result).toBe(true);
    expect(cleared).toBe(true);
  });

  it('히스토리 저장이 실패하면 장바구니를 유지한다', async () => {
    let cleared = false;
    let capturedError: unknown;

    const result = await persistHistoryAndMaybeClearCart({
      persistHistory: async () => {
        throw new Error('history failed');
      },
      clearCart: () => {
        cleared = true;
      },
      canClearCart: true,
      onPersistError: (error) => {
        capturedError = error;
      },
    });

    expect(result).toBe(false);
    expect(cleared).toBe(false);
    expect(capturedError).toBeInstanceOf(Error);
  });

  it('히스토리 저장이 성공해도 canClearCart가 false면 장바구니를 유지한다', async () => {
    let cleared = false;

    const result = await persistHistoryAndMaybeClearCart({
      persistHistory: async () => undefined,
      clearCart: () => {
        cleared = true;
      },
      canClearCart: () => false,
      onPersistError: () => {
        throw new Error('should not be called');
      },
    });

    expect(result).toBe(true);
    expect(cleared).toBe(false);
  });
});
