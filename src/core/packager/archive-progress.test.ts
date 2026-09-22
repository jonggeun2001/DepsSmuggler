import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { trackArchiveProgress } from './archive-progress';
import type { Archiver } from 'archiver';
import type { WriteStream } from 'node:fs';

afterEach(() => vi.useRealTimers());

function setup() {
  vi.useFakeTimers();
  const archive = new EventEmitter();
  const output = Object.assign(new EventEmitter(), { bytesWritten: 0, writableFinished: false });
  const onProgress = vi.fn();
  trackArchiveProgress(
    archive as Archiver,
    output as unknown as WriteStream,
    { totalFiles: 2, totalBytes: 100 },
    onProgress
  );
  return { archive, output, onProgress };
}

describe('trackArchiveProgress', () => {
  it('한 파일을 압축하는 동안 기록 용량을 갱신하고 실제 파일 처리량은 저장 완료 전 99%로 제한한다', () => {
    const { archive, output, onProgress } = setup();
    output.bytesWritten = 10;
    vi.advanceTimersByTime(250);
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ percentage: 0, outputBytes: 10 })
    );
    archive.emit('entry', { name: 'folder/', stats: { isFile: () => false, size: 4096 } });
    archive.emit('entry', { name: 'README.txt', stats: false });
    archive.emit('entry', { name: 'a', stats: { isFile: () => true, size: 40 } });
    output.bytesWritten = 20;
    vi.advanceTimersByTime(250);
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ processedFiles: 1, percentage: 40, outputBytes: 20 })
    );
    archive.emit('entry', { name: 'b', stats: { isFile: () => true, size: 60 } });
    vi.advanceTimersByTime(250);
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ percentage: 99 }));
    output.writableFinished = true;
    output.emit('close');
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ percentage: 100 }));
    expect(vi.getTimerCount()).toBe(0);
    expect(archive.listenerCount('entry')).toBe(0);
  });

  it.each(['archive', 'output'] as const)('%s 오류 후 타이머와 완료 알림을 중단한다', (source) => {
    const { archive, output, onProgress } = setup();
    ({ archive, output })[source].emit('error', new Error('disk failure'));
    output.emit('close');
    vi.advanceTimersByTime(1000);
    expect(onProgress).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('정상적으로 기록을 끝내지 않은 close는 100%가 아니다', () => {
    const { output, onProgress } = setup();
    output.emit('close');
    expect(onProgress).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
