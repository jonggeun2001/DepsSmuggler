/**
 * DownloadManager 단위 테스트
 *
 * 네트워크 호출 없이 DownloadManager의 핵심 로직을 테스트합니다.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DownloadManager, DownloadItem, OverallProgress } from './downloadManager';

// DownloadManager 인스턴스 생성
// 주의: DownloadManager 생성자는 옵션을 받지 않고, startDownload에서 옵션을 설정함
const createManager = () => {
  return new DownloadManager();
};

describe('DownloadManager 단위 테스트', () => {
  let manager: DownloadManager;

  beforeEach(() => {
    manager = createManager();
  });

  describe('addToQueue', () => {
    it('단일 패키지 추가', () => {
      const packages = [
        { type: 'pip' as const, name: 'requests', version: '2.28.0' },
      ];

      manager.addToQueue(packages);
      const items = manager.getItems();

      expect(items).toHaveLength(1);
      expect(items[0].package.name).toBe('requests');
      expect(items[0].status).toBe('pending');
    });

    it('여러 패키지 추가', () => {
      const packages = [
        { type: 'pip' as const, name: 'requests', version: '2.28.0' },
        { type: 'npm' as const, name: 'lodash', version: '4.17.21' },
        { type: 'maven' as const, name: 'org.springframework:spring-core', version: '5.3.0' },
      ];

      manager.addToQueue(packages);
      const items = manager.getItems();

      expect(items).toHaveLength(3);
    });

    it('빈 배열 추가', () => {
      manager.addToQueue([]);
      const items = manager.getItems();

      expect(items).toHaveLength(0);
    });

    it('추가된 아이템은 고유 ID를 가짐', () => {
      const packages = [
        { type: 'pip' as const, name: 'requests', version: '2.28.0' },
        { type: 'pip' as const, name: 'requests', version: '2.28.0' },
      ];

      manager.addToQueue(packages);
      const items = manager.getItems();

      expect(items[0].id).not.toBe(items[1].id);
    });

    it('초기 상태 확인', () => {
      const packages = [
        { type: 'pip' as const, name: 'requests', version: '2.28.0' },
      ];

      manager.addToQueue(packages);
      const items = manager.getItems();

      expect(items[0].status).toBe('pending');
      expect(items[0].progress).toBe(0);
      expect(items[0].downloadedBytes).toBe(0);
      expect(items[0].totalBytes).toBe(0);
      expect(items[0].speed).toBe(0);
      expect(items[0].retryCount).toBe(0);
    });
  });

  describe('getQueueStatus', () => {
    it('빈 큐 상태', () => {
      const status = manager.getQueueStatus();

      expect(status.pending).toBe(0);
      expect(status.running).toBe(0);
      expect(status.completed).toBe(0);
      expect(status.failed).toBe(0);
    });

    it('pending 아이템만 있는 경우', () => {
      const packages = [
        { type: 'pip' as const, name: 'requests', version: '2.28.0' },
        { type: 'pip' as const, name: 'flask', version: '2.0.0' },
      ];

      manager.addToQueue(packages);
      const status = manager.getQueueStatus();

      expect(status.pending).toBe(2);
      expect(status.running).toBe(0);
      expect(status.completed).toBe(0);
      expect(status.failed).toBe(0);
    });

    it('다양한 상태의 아이템', () => {
      const packages = [
        { type: 'pip' as const, name: 'requests', version: '2.28.0' },
        { type: 'pip' as const, name: 'flask', version: '2.0.0' },
        { type: 'pip' as const, name: 'django', version: '4.0.0' },
        { type: 'pip' as const, name: 'numpy', version: '1.24.0' },
      ];

      manager.addToQueue(packages);

      // items에 직접 접근하여 상태 변경
      const items = (manager as any).items as Map<string, DownloadItem>;
      const itemsArray = Array.from(items.values());
      itemsArray[0].status = 'completed';
      itemsArray[1].status = 'downloading';
      itemsArray[2].status = 'failed';
      // itemsArray[3] is still 'pending'

      const status = manager.getQueueStatus();

      expect(status.pending).toBe(1);
      expect(status.running).toBe(1);
      expect(status.completed).toBe(1);
      expect(status.failed).toBe(1);
    });
  });

  describe('getOverallProgress', () => {
    it('빈 큐 진행률', () => {
      const progress = manager.getOverallProgress();

      expect(progress.totalItems).toBe(0);
      expect(progress.completedItems).toBe(0);
      expect(progress.failedItems).toBe(0);
      expect(progress.skippedItems).toBe(0);
      expect(progress.totalBytes).toBe(0);
      expect(progress.downloadedBytes).toBe(0);
      expect(progress.overallProgress).toBe(0);
    });

    it('일부 완료된 진행률', () => {
      const packages = [
        { type: 'pip' as const, name: 'requests', version: '2.28.0' },
        { type: 'pip' as const, name: 'flask', version: '2.0.0' },
      ];

      manager.addToQueue(packages);

      // items에 직접 접근하여 상태 변경
      const items = (manager as any).items as Map<string, DownloadItem>;
      const itemsArray = Array.from(items.values());
      itemsArray[0].status = 'completed';
      itemsArray[0].totalBytes = 1000;
      itemsArray[0].downloadedBytes = 1000;

      itemsArray[1].status = 'downloading';
      itemsArray[1].totalBytes = 1000;
      itemsArray[1].downloadedBytes = 500;

      const progress = manager.getOverallProgress();

      expect(progress.totalItems).toBe(2);
      expect(progress.completedItems).toBe(1);
      expect(progress.totalBytes).toBe(2000);
      expect(progress.downloadedBytes).toBe(1500);
      expect(progress.overallProgress).toBe(75);
    });

    it('모두 완료된 진행률', () => {
      const packages = [
        { type: 'pip' as const, name: 'requests', version: '2.28.0' },
      ];

      manager.addToQueue(packages);

      const items = (manager as any).items as Map<string, DownloadItem>;
      const itemsArray = Array.from(items.values());
      itemsArray[0].status = 'completed';
      itemsArray[0].totalBytes = 1000;
      itemsArray[0].downloadedBytes = 1000;

      const progress = manager.getOverallProgress();

      expect(progress.completedItems).toBe(1);
      expect(progress.overallProgress).toBe(100);
    });

    it('실패와 건너뛰기 카운트', () => {
      const packages = [
        { type: 'pip' as const, name: 'a', version: '1.0' },
        { type: 'pip' as const, name: 'b', version: '1.0' },
        { type: 'pip' as const, name: 'c', version: '1.0' },
        { type: 'pip' as const, name: 'd', version: '1.0' },
      ];

      manager.addToQueue(packages);

      const items = (manager as any).items as Map<string, DownloadItem>;
      const itemsArray = Array.from(items.values());
      itemsArray[0].status = 'completed';
      itemsArray[1].status = 'failed';
      itemsArray[2].status = 'skipped';
      itemsArray[3].status = 'pending';

      const progress = manager.getOverallProgress();

      expect(progress.completedItems).toBe(1);
      expect(progress.failedItems).toBe(1);
      expect(progress.skippedItems).toBe(1);
    });
  });

  describe('reset', () => {
    it('큐 초기화', () => {
      const packages = [
        { type: 'pip' as const, name: 'requests', version: '2.28.0' },
        { type: 'pip' as const, name: 'flask', version: '2.0.0' },
      ];

      manager.addToQueue(packages);
      expect(manager.getItems()).toHaveLength(2);

      manager.reset();
      expect(manager.getItems()).toHaveLength(0);
    });

    it('상태 플래그 초기화', () => {
      const packages = [
        { type: 'pip' as const, name: 'requests', version: '2.28.0' },
      ];

      manager.addToQueue(packages);
      (manager as any).isRunning = true;
      (manager as any).isCancelled = true;

      manager.reset();

      expect((manager as any).isRunning).toBe(false);
      expect((manager as any).isCancelled).toBe(false);
    });

    it('속도 샘플 초기화', () => {
      (manager as any).speedSamples = [100, 200, 300];

      manager.reset();

      expect((manager as any).speedSamples).toHaveLength(0);
    });
  });

  describe('getItems', () => {
    it('빈 배열 반환', () => {
      expect(manager.getItems()).toEqual([]);
    });

    it('추가된 아이템 반환', () => {
      const packages = [
        { type: 'pip' as const, name: 'requests', version: '2.28.0' },
      ];

      manager.addToQueue(packages);
      const items = manager.getItems();

      expect(items).toHaveLength(1);
      expect(items[0].package.name).toBe('requests');
    });
  });

  describe('running', () => {
    it('isRunning getter', () => {
      expect(manager.running).toBe(false);

      (manager as any).isRunning = true;
      expect(manager.running).toBe(true);
    });
  });

  describe('createResult', () => {
    const callCreateResult = (manager: DownloadManager): any => {
      return (manager as any).createResult();
    };

    it('빈 결과', () => {
      (manager as any).startTime = Date.now();
      const result = callCreateResult(manager);

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(0);
      expect(result.totalSize).toBe(0);
    });

    it('성공 결과', () => {
      const packages = [
        { type: 'pip' as const, name: 'requests', version: '2.28.0' },
      ];

      manager.addToQueue(packages);
      (manager as any).startTime = Date.now() - 1000;

      const items = (manager as any).items as Map<string, DownloadItem>;
      const itemsArray = Array.from(items.values());
      itemsArray[0].status = 'completed';
      itemsArray[0].downloadedBytes = 1000;

      const result = callCreateResult(manager);

      expect(result.success).toBe(true);
      expect(result.totalSize).toBe(1000);
      expect(result.duration).toBeGreaterThan(0);
    });

    it('취소된 결과', () => {
      (manager as any).startTime = Date.now();
      (manager as any).isCancelled = true;

      const result = callCreateResult(manager);

      expect(result.success).toBe(false);
    });

    it('실패 아이템 포함 결과', () => {
      const packages = [
        { type: 'pip' as const, name: 'requests', version: '2.28.0' },
      ];

      manager.addToQueue(packages);
      (manager as any).startTime = Date.now();

      const items = (manager as any).items as Map<string, DownloadItem>;
      const itemsArray = Array.from(items.values());
      itemsArray[0].status = 'failed';

      const result = callCreateResult(manager);

      expect(result.success).toBe(false);
    });

    it('건너뛰기는 성공으로 처리', () => {
      const packages = [
        { type: 'pip' as const, name: 'requests', version: '2.28.0' },
      ];

      manager.addToQueue(packages);
      (manager as any).startTime = Date.now();

      const items = (manager as any).items as Map<string, DownloadItem>;
      const itemsArray = Array.from(items.values());
      itemsArray[0].status = 'skipped';

      const result = callCreateResult(manager);

      expect(result.success).toBe(true);
    });
  });

  describe('updateItemProgress', () => {
    // updateItemProgress는 DownloadProgressEvent를 받으며, progress 값을 직접 사용함
    const callUpdateItemProgress = (
      manager: DownloadManager,
      itemId: string,
      event: any
    ): void => {
      return (manager as any).updateItemProgress(itemId, event);
    };

    it('진행률 업데이트', () => {
      const packages = [
        { type: 'pip' as const, name: 'requests', version: '2.28.0' },
      ];

      manager.addToQueue(packages);
      const items = manager.getItems();
      const itemId = items[0].id;

      callUpdateItemProgress(manager, itemId, {
        progress: 50, // 퍼센트 값
        downloadedBytes: 500,
        totalBytes: 1000,
        speed: 100,
      });

      const updatedItems = (manager as any).items as Map<string, DownloadItem>;
      const item = updatedItems.get(itemId);

      expect(item?.downloadedBytes).toBe(500);
      expect(item?.totalBytes).toBe(1000);
      expect(item?.progress).toBe(50);
      expect(item?.speed).toBe(100);
    });

    it('100% 진행률', () => {
      const packages = [
        { type: 'pip' as const, name: 'requests', version: '2.28.0' },
      ];

      manager.addToQueue(packages);
      const items = manager.getItems();
      const itemId = items[0].id;

      callUpdateItemProgress(manager, itemId, {
        progress: 100, // 퍼센트 값
        downloadedBytes: 1000,
        totalBytes: 1000,
        speed: 100,
      });

      const updatedItems = (manager as any).items as Map<string, DownloadItem>;
      const item = updatedItems.get(itemId);

      expect(item?.progress).toBe(100);
    });

    it('존재하지 않는 아이템 업데이트 시 에러 없음', () => {
      expect(() =>
        callUpdateItemProgress(manager, 'nonexistent', {
          progress: 50,
          downloadedBytes: 500,
          totalBytes: 1000,
          speed: 100,
        })
      ).not.toThrow();
    });
  });

  describe('이벤트 에미터', () => {
    it('progress 이벤트 리스너 등록', () => {
      const listener = vi.fn();
      manager.on('progress', listener);

      // 이벤트 리스너가 등록되었는지 확인
      expect(manager.listenerCount('progress')).toBe(1);
    });

    it('여러 이벤트 리스너', () => {
      const progressListener = vi.fn();
      const itemStartListener = vi.fn();
      const itemCompleteListener = vi.fn();

      manager.on('progress', progressListener);
      manager.on('itemStart', itemStartListener);
      manager.on('itemComplete', itemCompleteListener);

      expect(manager.listenerCount('progress')).toBe(1);
      expect(manager.listenerCount('itemStart')).toBe(1);
      expect(manager.listenerCount('itemComplete')).toBe(1);
    });

    it('이벤트 리스너 제거', () => {
      const listener = vi.fn();
      manager.on('progress', listener);
      expect(manager.listenerCount('progress')).toBe(1);

      manager.off('progress', listener);
      expect(manager.listenerCount('progress')).toBe(0);
    });
  });

  describe('동시성 옵션', () => {
    it('기본 동시성은 3', () => {
      const manager = createManager();
      const queue = (manager as any).queue;
      expect(queue.concurrency).toBe(3);
    });
  });
});
