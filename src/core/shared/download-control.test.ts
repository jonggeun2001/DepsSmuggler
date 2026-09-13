import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForDownloadResume } from './download-control';

describe('download control checkpoints', () => {
  afterEach(() => vi.useRealTimers());

  it('waits while paused, then removes its timer and abort listener on resume', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    let paused = true;
    let resumed = false;
    const waiting = waitForDownloadResume({ signal: controller.signal, shouldPause: () => paused })
      .then(() => { resumed = true; });
    await vi.advanceTimersByTimeAsync(300);
    expect(resumed).toBe(false);
    paused = false;
    await vi.advanceTimersByTimeAsync(100);
    await waiting;
    expect(resumed).toBe(true);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts a paused wait without leaving a poller', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const waiting = waitForDownloadResume({ signal: controller.signal, shouldPause: () => true });
    const rejected = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects an already aborted signal even when not paused', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(waitForDownloadResume({ signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
  });
});
