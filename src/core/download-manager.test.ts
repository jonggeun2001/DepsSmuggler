/**
 * DownloadManager 단위 테스트
 *
 * 네트워크 호출 없이 DownloadManager의 핵심 로직을 테스트합니다.
 */

import PQueue from 'p-queue';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  DownloadManager,
  type DownloadManagerItem,
  type DownloadManagerOptions,
  type DownloadManagerResult,
} from './download-manager';
import { IDownloader, PackageType, DownloadProgressEvent } from '../types';
import { SpeedCalculator } from './speed-calculator';

/**
 * 테스트용 DownloadManager 인터페이스
 * private 멤버에 타입 안전하게 접근하기 위한 인터페이스
 */
interface DownloadManagerTestable {
  items: Map<string, DownloadManagerItem>;
  isRunning: boolean;
  isCancelled: boolean;
  startTime: number;
  options: DownloadManagerOptions;
  downloaders: Map<PackageType, IDownloader>;
  queue: PQueue;
  speedCalculator: SpeedCalculator;
  createResult: () => DownloadManagerResult;
  updateItemProgress: (id: string, event: DownloadProgressEvent) => void;
  initDownloaders: () => Promise<void>;
}

/**
 * DownloadManager를 테스트 가능한 형태로 캐스팅
 */
const asTestable = (manager: DownloadManager): DownloadManagerTestable => {
  return manager as unknown as DownloadManagerTestable;
};

// fs-extra 모킹
vi.mock('fs-extra', () => ({
  ensureDir: vi.fn().mockResolvedValue(undefined),
}));

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
      const items = asTestable(manager).items;
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
      const items = asTestable(manager).items;
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

      const items = asTestable(manager).items;
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

      const items = asTestable(manager).items;
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
      asTestable(manager).isRunning = true;
      asTestable(manager).isCancelled = true;

      manager.reset();

      expect(asTestable(manager).isRunning).toBe(false);
      expect(asTestable(manager).isCancelled).toBe(false);
    });

    it('속도 샘플 초기화', () => {
      const speedCalc = asTestable(manager).speedCalculator;
      speedCalc.addSampleForced(100);
      speedCalc.addSampleForced(200);
      speedCalc.addSampleForced(300);

      manager.reset();

      expect(speedCalc.sampleCount).toBe(0);
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

      asTestable(manager).isRunning = true;
      expect(manager.running).toBe(true);
    });
  });

  describe('createResult', () => {
    const callCreateResult = (manager: DownloadManager): DownloadManagerResult => {
      return asTestable(manager).createResult();
    };

    it('빈 결과', () => {
      asTestable(manager).startTime = Date.now();
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
      asTestable(manager).startTime = Date.now() - 1000;

      const items = asTestable(manager).items;
      const itemsArray = Array.from(items.values());
      itemsArray[0].status = 'completed';
      itemsArray[0].downloadedBytes = 1000;

      const result = callCreateResult(manager);

      expect(result.success).toBe(true);
      expect(result.totalSize).toBe(1000);
      expect(result.duration).toBeGreaterThan(0);
    });

    it('취소된 결과', () => {
      asTestable(manager).startTime = Date.now();
      asTestable(manager).isCancelled = true;

      const result = callCreateResult(manager);

      expect(result.success).toBe(false);
    });

    it('실패 아이템 포함 결과', () => {
      const packages = [
        { type: 'pip' as const, name: 'requests', version: '2.28.0' },
      ];

      manager.addToQueue(packages);
      asTestable(manager).startTime = Date.now();

      const items = asTestable(manager).items;
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
      asTestable(manager).startTime = Date.now();

      const items = asTestable(manager).items;
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
      event: DownloadProgressEvent
    ): void => {
      return asTestable(manager).updateItemProgress(itemId, event);
    };

    it('진행률 업데이트', () => {
      const packages = [
        { type: 'pip' as const, name: 'requests', version: '2.28.0' },
      ];

      manager.addToQueue(packages);
      const items = manager.getItems();
      const itemId = items[0].id;

      callUpdateItemProgress(manager, itemId, {
        itemId,
        progress: 50, // 퍼센트 값
        downloadedBytes: 500,
        totalBytes: 1000,
        speed: 100,
      });

      const updatedItems = asTestable(manager).items;
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
        itemId,
        progress: 100, // 퍼센트 값
        downloadedBytes: 1000,
        totalBytes: 1000,
        speed: 100,
      });

      const updatedItems = asTestable(manager).items;
      const item = updatedItems.get(itemId);

      expect(item?.progress).toBe(100);
    });

    it('존재하지 않는 아이템 업데이트 시 에러 없음', () => {
      expect(() =>
        callUpdateItemProgress(manager, 'nonexistent', {
          itemId: 'nonexistent',
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
      const queue = asTestable(manager).queue;
      expect(queue.concurrency).toBe(3);
    });
  });

  describe('pauseDownload', () => {
    it('다운로드 일시정지', () => {
      const queue = asTestable(manager).queue;
      const pauseSpy = vi.spyOn(queue, 'pause');

      manager.pauseDownload();

      expect(pauseSpy).toHaveBeenCalled();
    });
  });

  describe('resumeDownload', () => {
    it('다운로드 재개', () => {
      const queue = asTestable(manager).queue;
      const startSpy = vi.spyOn(queue, 'start');

      manager.resumeDownload();

      expect(startSpy).toHaveBeenCalled();
    });
  });

  describe('cancelDownload', () => {
    it('다운로드 취소 시 플래그 설정', () => {
      manager.cancelDownload();

      expect(asTestable(manager).isCancelled).toBe(true);
    });

    it('다운로드 취소 시 큐 정리', () => {
      const queue = asTestable(manager).queue;
      const clearSpy = vi.spyOn(queue, 'clear');
      const pauseSpy = vi.spyOn(queue, 'pause');

      manager.cancelDownload();

      expect(clearSpy).toHaveBeenCalled();
      expect(pauseSpy).toHaveBeenCalled();
    });

    it('다운로드 취소 시 아이템 상태 변경', () => {
      const packages = [
        { type: 'pip' as const, name: 'requests', version: '2.28.0' },
        { type: 'pip' as const, name: 'flask', version: '2.0.0' },
        { type: 'pip' as const, name: 'django', version: '4.0.0' },
      ];

      manager.addToQueue(packages);

      // 일부 아이템의 상태 변경
      const items = asTestable(manager).items;
      const itemsArray = Array.from(items.values());
      itemsArray[0].status = 'downloading';
      itemsArray[1].status = 'pending';
      itemsArray[2].status = 'completed'; // 완료된 것은 유지

      manager.cancelDownload();

      expect(itemsArray[0].status).toBe('cancelled');
      expect(itemsArray[1].status).toBe('cancelled');
      expect(itemsArray[2].status).toBe('completed'); // 완료된 것은 유지
    });
  });

  describe('initDownloaders', () => {
    it('다운로더 초기화 호출', async () => {
      const manager = createManager();
      // initDownloaders는 private async 메서드이므로 직접 호출
      await asTestable(manager).initDownloaders();

      // 다운로더가 설정되었는지 확인 (에러 없이 완료)
      expect(asTestable(manager).downloaders).toBeDefined();
    });
  });

  describe('getQueueStatus 추가 케이스', () => {
    it('취소된 아이템은 failed로 카운트됨', () => {
      const packages = [
        { type: 'pip' as const, name: 'requests', version: '2.28.0' },
        { type: 'pip' as const, name: 'flask', version: '2.0.0' },
      ];

      manager.addToQueue(packages);

      const items = asTestable(manager).items;
      const itemsArray = Array.from(items.values());
      itemsArray[0].status = 'cancelled';
      itemsArray[1].status = 'pending';

      const status = manager.getQueueStatus();

      expect(status.failed).toBe(1); // cancelled는 failed로 카운트
      expect(status.pending).toBe(1);
    });

    it('건너뛴 아이템은 failed로 카운트됨', () => {
      const packages = [
        { type: 'pip' as const, name: 'requests', version: '2.28.0' },
      ];

      manager.addToQueue(packages);

      const items = asTestable(manager).items;
      const itemsArray = Array.from(items.values());
      itemsArray[0].status = 'skipped';

      const status = manager.getQueueStatus();

      expect(status.failed).toBe(1); // skipped는 failed로 카운트
    });
  });

  describe('getOverallProgress 추가 케이스', () => {
    it('currentSpeed 계산 (SpeedCalculator 기반)', () => {
      const packages = [
        { type: 'pip' as const, name: 'requests', version: '2.28.0' },
      ];

      manager.addToQueue(packages);

      // SpeedCalculator에 샘플 추가
      const speedCalc = asTestable(manager).speedCalculator;
      speedCalc.addSampleForced(1000);
      speedCalc.addSampleForced(2000);
      speedCalc.addSampleForced(3000);

      const progress = manager.getOverallProgress();

      // 평균: (1000 + 2000 + 3000) / 3 = 2000
      expect(progress.currentSpeed).toBe(2000);
    });

    it('estimatedTimeRemaining 계산', () => {
      const packages = [
        { type: 'pip' as const, name: 'requests', version: '2.28.0' },
      ];

      manager.addToQueue(packages);

      const items = asTestable(manager).items;
      const itemsArray = Array.from(items.values());
      itemsArray[0].status = 'downloading';
      itemsArray[0].totalBytes = 10000;
      itemsArray[0].downloadedBytes = 5000;

      // SpeedCalculator에 샘플 설정
      const speedCalc = asTestable(manager).speedCalculator;
      speedCalc.addSampleForced(1000); // 1000 bytes/sec

      const progress = manager.getOverallProgress();

      // 남은 바이트(5000) / 속도(1000) = 5초
      expect(progress.estimatedTimeRemaining).toBe(5);
    });

    it('속도가 0일 때 estimatedTimeRemaining은 0', () => {
      const packages = [
        { type: 'pip' as const, name: 'requests', version: '2.28.0' },
      ];

      manager.addToQueue(packages);

      const items = asTestable(manager).items;
      const itemsArray = Array.from(items.values());
      itemsArray[0].totalBytes = 10000;
      itemsArray[0].downloadedBytes = 5000;

      // SpeedCalculator가 비어있으면 속도 0 (reset 호출)
      const speedCalc = asTestable(manager).speedCalculator;
      speedCalc.reset();

      const progress = manager.getOverallProgress();

      expect(progress.currentSpeed).toBe(0);
      expect(progress.estimatedTimeRemaining).toBe(0);
    });
  });

  describe('startDownload', () => {
    afterEach(() => {
      vi.clearAllMocks();
    });

    it('이미 실행 중이면 에러 발생', async () => {
      asTestable(manager).isRunning = true;

      await expect(
        manager.startDownload({ outputPath: '/test/output' })
      ).rejects.toThrow('다운로드가 이미 진행 중입니다');
    });

    it('옵션 설정', async () => {
      const packages = [
        { type: 'pip' as const, name: 'requests', version: '2.28.0' },
      ];
      manager.addToQueue(packages);

      // 다운로더 모킹
      const mockDownloader = {
        downloadPackage: vi.fn().mockResolvedValue('/path/to/file'),
      };
      asTestable(manager).downloaders.set('pip', mockDownloader);

      // 아이템 상태를 completed로 설정하여 다운로드 스킵
      const items = asTestable(manager).items;
      const itemsArray = Array.from(items.values());
      itemsArray[0].status = 'completed';

      await manager.startDownload({
        outputPath: '/test/output',
        concurrency: 5,
        maxRetries: 2,
      });

      expect(asTestable(manager).options.concurrency).toBe(5);
      expect(asTestable(manager).options.maxRetries).toBe(2);
    });

    it('allComplete 이벤트 발생', async () => {
      const listener = vi.fn();
      manager.on('allComplete', listener);

      // 빈 큐로 시작
      const result = await manager.startDownload({ outputPath: '/test/output' });

      expect(listener).toHaveBeenCalledWith(result);
    });

    it('다운로드 완료 후 isRunning이 false로 설정됨', async () => {
      const result = await manager.startDownload({ outputPath: '/test/output' });

      expect(manager.running).toBe(false);
      expect(result.success).toBe(true);
    });
  });

  describe('getDownloadManager 싱글톤', () => {
    it('싱글톤 인스턴스 반환', async () => {
      const { getDownloadManager } = await import('./download-manager');

      const instance1 = getDownloadManager();
      const instance2 = getDownloadManager();

      expect(instance1).toBe(instance2);
    });
  });
});
