import { describe, expect, it } from 'vitest';
import { createConcurrencyLimiter } from './concurrency-limiter';

describe('createConcurrencyLimiter', () => {
  it('concurrency 1에서는 다음 작업을 앞선 작업 완료 후 실행해야 함', async () => {
    const limit = createConcurrencyLimiter(1);
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const firstTask = limit(async () => {
      events.push('first:start');
      await firstGate;
      events.push('first:end');
    });

    const secondTask = limit(async () => {
      events.push('second:start');
      events.push('second:end');
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(['first:start']);

    releaseFirst();
    await Promise.all([firstTask, secondTask]);

    expect(events).toEqual([
      'first:start',
      'first:end',
      'second:start',
      'second:end',
    ]);
  });
});
