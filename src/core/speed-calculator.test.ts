/**
 * SpeedCalculator 단위 테스트
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SpeedCalculator, createSpeedCalculator } from './speed-calculator';

describe('SpeedCalculator', () => {
  let calculator: SpeedCalculator;

  beforeEach(() => {
    calculator = new SpeedCalculator({ sampleSize: 5, sampleIntervalMs: 0 });
  });

  describe('addSample', () => {
    it('샘플을 추가해야 함', () => {
      calculator.addSampleForced(1000);
      expect(calculator.sampleCount).toBe(1);
    });

    it('sampleSize를 초과하면 오래된 샘플을 제거해야 함', () => {
      for (let i = 1; i <= 7; i++) {
        calculator.addSampleForced(i * 100);
      }

      expect(calculator.sampleCount).toBe(5);
      // 첫 2개(100, 200)가 제거되고 300~700이 남아야 함
      const samples = calculator.getSamples();
      expect(samples[0]).toBe(300);
      expect(samples[4]).toBe(700);
    });

    it('간격 제한 내에서는 샘플을 추가하지 않아야 함', () => {
      const intervalCalc = new SpeedCalculator({ sampleIntervalMs: 1000 });
      intervalCalc.addSample(1000);
      const added = intervalCalc.addSample(2000);

      expect(added).toBe(false);
      expect(intervalCalc.sampleCount).toBe(1);
    });
  });

  describe('getCurrentSpeed', () => {
    it('가장 최근 샘플을 반환해야 함', () => {
      calculator.addSampleForced(100);
      calculator.addSampleForced(200);
      calculator.addSampleForced(300);

      expect(calculator.getCurrentSpeed()).toBe(300);
    });

    it('샘플이 없으면 0을 반환해야 함', () => {
      expect(calculator.getCurrentSpeed()).toBe(0);
    });
  });

  describe('getAverageSpeed', () => {
    it('평균 속도를 계산해야 함', () => {
      calculator.addSampleForced(100);
      calculator.addSampleForced(200);
      calculator.addSampleForced(300);

      expect(calculator.getAverageSpeed()).toBe(200);
    });

    it('샘플이 없으면 0을 반환해야 함', () => {
      expect(calculator.getAverageSpeed()).toBe(0);
    });
  });

  describe('getEstimatedTimeRemaining', () => {
    it('남은 시간을 계산해야 함', () => {
      // 평균 속도 1000 bytes/sec
      calculator.addSampleForced(1000);
      calculator.addSampleForced(1000);
      calculator.addSampleForced(1000);

      // 5000 bytes 남음 -> 5초 예상
      expect(calculator.getEstimatedTimeRemaining(5000)).toBe(5);
    });

    it('속도가 0이면 0을 반환해야 함', () => {
      expect(calculator.getEstimatedTimeRemaining(5000)).toBe(0);
    });

    it('남은 바이트가 0이면 0을 반환해야 함', () => {
      calculator.addSampleForced(1000);
      expect(calculator.getEstimatedTimeRemaining(0)).toBe(0);
    });
  });

  describe('getStats', () => {
    it('전체 통계를 반환해야 함', () => {
      calculator.addSampleForced(100);
      calculator.addSampleForced(200);
      calculator.addSampleForced(300);

      const stats = calculator.getStats(600);

      expect(stats.currentSpeed).toBe(300);
      expect(stats.averageSpeed).toBe(200);
      expect(stats.estimatedTimeRemaining).toBe(3); // 600 / 200 = 3
      expect(stats.sampleCount).toBe(3);
    });
  });

  describe('reset', () => {
    it('모든 샘플을 초기화해야 함', () => {
      calculator.addSampleForced(100);
      calculator.addSampleForced(200);

      calculator.reset();

      expect(calculator.sampleCount).toBe(0);
      expect(calculator.getCurrentSpeed()).toBe(0);
    });
  });

  describe('createSpeedCalculator', () => {
    it('기본 설정으로 인스턴스를 생성해야 함', () => {
      const calc = createSpeedCalculator();
      expect(calc).toBeInstanceOf(SpeedCalculator);
    });

    it('사용자 설정으로 인스턴스를 생성해야 함', () => {
      const calc = createSpeedCalculator({ sampleSize: 20 });
      expect(calc).toBeInstanceOf(SpeedCalculator);
    });
  });
});
