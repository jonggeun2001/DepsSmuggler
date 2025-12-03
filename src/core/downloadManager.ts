import PQueue from 'p-queue';
import { EventEmitter } from 'eventemitter3';
import * as path from 'path';
import * as fs from 'fs-extra';
import {
  PackageInfo,
  PackageType,
  DownloadProgressEvent,
  IDownloader,
} from '../types';
import logger from '../utils/logger';

// 다운로더 가져오기
import { getPipDownloader } from './downloaders/pip';
import { getCondaDownloader } from './downloaders/conda';
import { getMavenDownloader } from './downloaders/maven';
import { getYumDownloader } from './downloaders/yum';
import { getDockerDownloader } from './downloaders/docker';

// 다운로드 아이템 상태
export type DownloadItemStatus =
  | 'pending'
  | 'downloading'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled';

// 다운로드 아이템
export interface DownloadItem {
  id: string;
  package: PackageInfo;
  status: DownloadItemStatus;
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
  speed: number;
  filePath?: string;
  error?: string;
  retryCount: number;
}

// 다운로드 결과
export interface DownloadResult {
  success: boolean;
  items: DownloadItem[];
  totalSize: number;
  duration: number;
  outputPath: string;
}

// 다운로드 옵션
export interface DownloadOptions {
  outputPath: string;
  concurrency?: number;
  maxRetries?: number;
  onUserDecision?: (
    item: DownloadItem,
    error: Error
  ) => Promise<'retry' | 'skip' | 'cancel'>;
}

// 이벤트 타입
export interface DownloadManagerEvents {
  progress: (item: DownloadItem, overall: OverallProgress) => void;
  itemStart: (item: DownloadItem) => void;
  itemComplete: (item: DownloadItem) => void;
  itemFailed: (item: DownloadItem, error: Error) => void;
  itemSkipped: (item: DownloadItem) => void;
  allComplete: (result: DownloadResult) => void;
  cancelled: () => void;
}

// 전체 진행률
export interface OverallProgress {
  totalItems: number;
  completedItems: number;
  failedItems: number;
  skippedItems: number;
  totalBytes: number;
  downloadedBytes: number;
  overallProgress: number;
  estimatedTimeRemaining: number;
  currentSpeed: number;
}

// ID 생성
const generateId = (): string => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

export class DownloadManager extends EventEmitter<DownloadManagerEvents> {
  private queue: PQueue;
  private items: Map<string, DownloadItem> = new Map();
  private downloaders: Map<PackageType, IDownloader> = new Map();
  private isRunning = false;
  private isCancelled = false;
  private startTime = 0;
  private options: DownloadOptions = { outputPath: '' };
  private speedSamples: number[] = [];
  private lastSpeedUpdate = 0;

  constructor() {
    super();
    this.queue = new PQueue({ concurrency: 3 });
    this.initDownloaders();
  }

  /**
   * 다운로더 초기화
   */
  private initDownloaders(): void {
    this.downloaders.set('pip', getPipDownloader());
    this.downloaders.set('conda', getCondaDownloader());
    this.downloaders.set('maven', getMavenDownloader());
    this.downloaders.set('yum', getYumDownloader());
    this.downloaders.set('docker', getDockerDownloader());
  }

  /**
   * 다운로드 큐에 패키지 추가
   */
  addToQueue(packages: PackageInfo[]): void {
    for (const pkg of packages) {
      const id = generateId();
      const item: DownloadItem = {
        id,
        package: pkg,
        status: 'pending',
        progress: 0,
        downloadedBytes: 0,
        totalBytes: 0,
        speed: 0,
        retryCount: 0,
      };
      this.items.set(id, item);
    }

    logger.info('다운로드 큐에 패키지 추가', { count: packages.length });
  }

  /**
   * 다운로드 시작
   */
  async startDownload(options: DownloadOptions): Promise<DownloadResult> {
    if (this.isRunning) {
      throw new Error('다운로드가 이미 진행 중입니다');
    }

    this.options = {
      concurrency: 3,
      maxRetries: 3,
      ...options,
    };

    this.queue = new PQueue({ concurrency: this.options.concurrency });
    this.isRunning = true;
    this.isCancelled = false;
    this.startTime = Date.now();
    this.speedSamples = [];

    // 출력 경로 생성
    await fs.ensureDir(this.options.outputPath);

    logger.info('다운로드 시작', {
      itemCount: this.items.size,
      outputPath: this.options.outputPath,
      concurrency: this.options.concurrency,
    });

    // 모든 아이템을 큐에 추가
    const downloadPromises: Promise<void>[] = [];

    for (const [id, item] of this.items) {
      if (item.status === 'pending') {
        const promise = this.queue.add(async () => {
          if (this.isCancelled) return;
          await this.downloadItem(id);
        });
        downloadPromises.push(promise as Promise<void>);
      }
    }

    // 모든 다운로드 완료 대기
    await Promise.all(downloadPromises);

    const result = this.createResult();
    this.isRunning = false;

    if (this.isCancelled) {
      this.emit('cancelled');
    } else {
      this.emit('allComplete', result);
    }

    logger.info('다운로드 완료', {
      success: result.success,
      totalSize: result.totalSize,
      duration: result.duration,
    });

    return result;
  }

  /**
   * 단일 아이템 다운로드
   */
  private async downloadItem(id: string): Promise<void> {
    const item = this.items.get(id);
    if (!item) return;

    const downloader = this.downloaders.get(item.package.type);
    if (!downloader) {
      item.status = 'failed';
      item.error = `지원하지 않는 패키지 타입: ${item.package.type}`;
      this.emit('itemFailed', item, new Error(item.error));
      return;
    }

    item.status = 'downloading';
    this.emit('itemStart', item);

    try {
      const filePath = await downloader.downloadPackage(
        item.package,
        this.options.outputPath,
        (progress: DownloadProgressEvent) => {
          this.updateItemProgress(id, progress);
        }
      );

      item.status = 'completed';
      item.progress = 100;
      item.filePath = filePath;

      this.emit('itemComplete', item);
      logger.info('패키지 다운로드 완료', {
        name: item.package.name,
        version: item.package.version,
        filePath,
      });
    } catch (error) {
      await this.handleDownloadError(id, error as Error);
    }
  }

  /**
   * 다운로드 에러 처리
   */
  private async handleDownloadError(id: string, error: Error): Promise<void> {
    const item = this.items.get(id);
    if (!item) return;

    item.retryCount++;
    const maxRetries = this.options.maxRetries || 3;

    logger.warn('패키지 다운로드 실패', {
      name: item.package.name,
      version: item.package.version,
      retryCount: item.retryCount,
      error: error.message,
    });

    // 재시도 가능 여부 확인
    if (item.retryCount < maxRetries) {
      // 사용자 결정 콜백이 있으면 호출
      if (this.options.onUserDecision) {
        const decision = await this.options.onUserDecision(item, error);

        switch (decision) {
          case 'retry':
            item.status = 'pending';
            item.progress = 0;
            item.downloadedBytes = 0;
            await this.downloadItem(id);
            return;
          case 'skip':
            item.status = 'skipped';
            item.error = error.message;
            this.emit('itemSkipped', item);
            return;
          case 'cancel':
            this.cancelDownload();
            return;
        }
      } else {
        // 자동 재시도
        item.status = 'pending';
        item.progress = 0;
        item.downloadedBytes = 0;
        await new Promise((resolve) => setTimeout(resolve, 1000 * item.retryCount));
        await this.downloadItem(id);
        return;
      }
    }

    // 최대 재시도 횟수 초과
    item.status = 'failed';
    item.error = error.message;
    this.emit('itemFailed', item, error);
  }

  /**
   * 아이템 진행률 업데이트
   */
  private updateItemProgress(id: string, progress: DownloadProgressEvent): void {
    const item = this.items.get(id);
    if (!item) return;

    item.progress = progress.progress;
    item.downloadedBytes = progress.downloadedBytes;
    item.totalBytes = progress.totalBytes;
    item.speed = progress.speed;

    // 속도 샘플 업데이트
    const now = Date.now();
    if (now - this.lastSpeedUpdate > 500) {
      this.speedSamples.push(progress.speed);
      if (this.speedSamples.length > 10) {
        this.speedSamples.shift();
      }
      this.lastSpeedUpdate = now;
    }

    this.emit('progress', item, this.getOverallProgress());
  }

  /**
   * 전체 진행률 계산
   */
  getOverallProgress(): OverallProgress {
    let totalItems = 0;
    let completedItems = 0;
    let failedItems = 0;
    let skippedItems = 0;
    let totalBytes = 0;
    let downloadedBytes = 0;

    for (const item of this.items.values()) {
      totalItems++;
      totalBytes += item.totalBytes || 0;
      downloadedBytes += item.downloadedBytes || 0;

      switch (item.status) {
        case 'completed':
          completedItems++;
          break;
        case 'failed':
          failedItems++;
          break;
        case 'skipped':
          skippedItems++;
          break;
      }
    }

    // 평균 속도 계산
    const currentSpeed =
      this.speedSamples.length > 0
        ? this.speedSamples.reduce((a, b) => a + b, 0) / this.speedSamples.length
        : 0;

    // 남은 시간 계산
    const remainingBytes = totalBytes - downloadedBytes;
    const estimatedTimeRemaining =
      currentSpeed > 0 ? remainingBytes / currentSpeed : 0;

    // 전체 진행률
    const overallProgress =
      totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;

    return {
      totalItems,
      completedItems,
      failedItems,
      skippedItems,
      totalBytes,
      downloadedBytes,
      overallProgress,
      estimatedTimeRemaining,
      currentSpeed,
    };
  }

  /**
   * 다운로드 일시정지
   */
  pauseDownload(): void {
    this.queue.pause();
    logger.info('다운로드 일시정지');
  }

  /**
   * 다운로드 재개
   */
  resumeDownload(): void {
    this.queue.start();
    logger.info('다운로드 재개');
  }

  /**
   * 다운로드 취소
   */
  cancelDownload(): void {
    this.isCancelled = true;
    this.queue.clear();
    this.queue.pause();

    // 진행 중인 아이템 취소 처리
    for (const item of this.items.values()) {
      if (item.status === 'downloading' || item.status === 'pending') {
        item.status = 'cancelled';
      }
    }

    logger.info('다운로드 취소');
  }

  /**
   * 결과 생성
   */
  private createResult(): DownloadResult {
    const items = Array.from(this.items.values());
    const totalSize = items.reduce(
      (sum, item) => sum + (item.downloadedBytes || 0),
      0
    );
    const duration = Date.now() - this.startTime;
    const success =
      !this.isCancelled &&
      items.every((item) => item.status === 'completed' || item.status === 'skipped');

    return {
      success,
      items,
      totalSize,
      duration,
      outputPath: this.options.outputPath,
    };
  }

  /**
   * 큐 상태 조회
   */
  getQueueStatus(): {
    pending: number;
    running: number;
    completed: number;
    failed: number;
  } {
    let pending = 0;
    let running = 0;
    let completed = 0;
    let failed = 0;

    for (const item of this.items.values()) {
      switch (item.status) {
        case 'pending':
          pending++;
          break;
        case 'downloading':
          running++;
          break;
        case 'completed':
          completed++;
          break;
        case 'failed':
        case 'skipped':
        case 'cancelled':
          failed++;
          break;
      }
    }

    return { pending, running, completed, failed };
  }

  /**
   * 아이템 목록 조회
   */
  getItems(): DownloadItem[] {
    return Array.from(this.items.values());
  }

  /**
   * 초기화
   */
  reset(): void {
    this.items.clear();
    this.queue.clear();
    this.isRunning = false;
    this.isCancelled = false;
    this.speedSamples = [];
  }

  /**
   * 실행 중 여부
   */
  get running(): boolean {
    return this.isRunning;
  }
}

// 싱글톤 인스턴스
let downloadManagerInstance: DownloadManager | null = null;

export function getDownloadManager(): DownloadManager {
  if (!downloadManagerInstance) {
    downloadManagerInstance = new DownloadManager();
  }
  return downloadManagerInstance;
}
