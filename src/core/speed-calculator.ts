/**
 * 다운로드 속도 계산기
 * 속도 샘플링, 평균 속도, 남은 시간 계산을 담당
 */

import { DOWNLOAD_CONSTANTS } from './constants/download';

export interface SpeedCalculatorOptions {
  /** 속도 샘플 크기 (기본: 10) */
  sampleSize?: number;
  /** 샘플 업데이트 간격 (ms, 기본: 500) */
  sampleIntervalMs?: number;
}

export interface SpeedStats {
  /** 현재 속도 (bytes/sec) */
  currentSpeed: number;
  /** 평균 속도 (bytes/sec) */
  averageSpeed: number;
  /** 남은 시간 (초) */
  estimatedTimeRemaining: number;
  /** 수집된 샘플 수 */
  sampleCount: number;
}

/**
 * 다운로드 속도 계산기
 *
 * 사용 예:
 * ```typescript
 * const calculator = new SpeedCalculator();
 * calculator.addSample(speed);
 * const stats = calculator.getStats(remainingBytes);
 * ```
 */
export class SpeedCalculator {
  private samples: number[] = [];
  private lastUpdateTime = 0;
  private readonly sampleSize: number;
  private readonly sampleIntervalMs: number;

  constructor(options: SpeedCalculatorOptions = {}) {
    this.sampleSize = options.sampleSize ?? DOWNLOAD_CONSTANTS.SPEED_SAMPLE_SIZE;
    this.sampleIntervalMs = options.sampleIntervalMs ?? DOWNLOAD_CONSTANTS.SPEED_SAMPLE_INTERVAL_MS;
  }

  /**
   * 속도 샘플 추가 (간격 제한 적용)
   * @param speed 현재 속도 (bytes/sec)
   * @returns 샘플이 추가되었는지 여부
   */
  addSample(speed: number): boolean {
    const now = Date.now();

    if (now - this.lastUpdateTime < this.sampleIntervalMs) {
      return false;
    }

    this.samples.push(speed);

    if (this.samples.length > this.sampleSize) {
      this.samples.shift();
    }

    this.lastUpdateTime = now;
    return true;
  }

  /**
   * 속도 샘플 강제 추가 (간격 제한 무시)
   * @param speed 현재 속도 (bytes/sec)
   */
  addSampleForced(speed: number): void {
    this.samples.push(speed);

    if (this.samples.length > this.sampleSize) {
      this.samples.shift();
    }

    this.lastUpdateTime = Date.now();
  }

  /**
   * 현재 속도 (가장 최근 샘플)
   */
  getCurrentSpeed(): number {
    if (this.samples.length === 0) {
      return 0;
    }
    return this.samples[this.samples.length - 1];
  }

  /**
   * 평균 속도 계산
   */
  getAverageSpeed(): number {
    if (this.samples.length === 0) {
      return 0;
    }
    return this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
  }

  /**
   * 남은 시간 계산
   * @param remainingBytes 남은 바이트 수
   * @returns 예상 남은 시간 (초)
   */
  getEstimatedTimeRemaining(remainingBytes: number): number {
    const avgSpeed = this.getAverageSpeed();
    if (avgSpeed <= 0 || remainingBytes <= 0) {
      return 0;
    }
    return remainingBytes / avgSpeed;
  }

  /**
   * 전체 속도 통계
   * @param remainingBytes 남은 바이트 수 (옵션)
   */
  getStats(remainingBytes = 0): SpeedStats {
    const averageSpeed = this.getAverageSpeed();
    return {
      currentSpeed: this.getCurrentSpeed(),
      averageSpeed,
      estimatedTimeRemaining: this.getEstimatedTimeRemaining(remainingBytes),
      sampleCount: this.samples.length,
    };
  }

  /**
   * 수집된 샘플 수
   */
  get sampleCount(): number {
    return this.samples.length;
  }

  /**
   * 모든 샘플 반환 (읽기 전용)
   */
  getSamples(): readonly number[] {
    return this.samples;
  }

  /**
   * 샘플 초기화
   */
  reset(): void {
    this.samples = [];
    this.lastUpdateTime = 0;
  }
}

// 편의 함수: 기본 설정의 SpeedCalculator 생성
export function createSpeedCalculator(options?: SpeedCalculatorOptions): SpeedCalculator {
  return new SpeedCalculator(options);
}
