import { Transform } from 'stream';

export interface DownloadControlOptions {
  signal?: AbortSignal;
  shouldPause?: () => boolean;
}

/** Check cancellation at every boundary; paused work must remain abortable. */
export async function waitForDownloadResume(options: DownloadControlOptions = {}): Promise<void> {
  const { signal, shouldPause } = options;
  signal?.throwIfAborted();
  if (!shouldPause?.()) return;

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearInterval(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(signal?.reason ?? new Error('Download cancelled'));
    };
    const timer = setInterval(() => {
      try {
        if (signal?.aborted) return onAbort();
        if (!shouldPause?.()) {
          cleanup();
          resolve();
        }
      } catch (error) {
        cleanup();
        reject(error);
      }
    }, 100);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

/** Gate writes with backpressure; destroying the stream also releases paused waits. */
export function createDownloadGate(
  options: DownloadControlOptions = {},
  onChunk?: (chunk: Buffer) => void
): Transform {
  const controller = new AbortController();
  const onAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) onAbort();
  const controls = { signal: controller.signal, shouldPause: options.shouldPause };
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      void (async () => {
        await waitForDownloadResume(controls);
        onChunk?.(chunk);
        await waitForDownloadResume(controls);
        callback(null, chunk);
      })().catch(error => callback(error instanceof Error ? error : new Error(String(error))));
    },
    destroy(error, callback) {
      options.signal?.removeEventListener('abort', onAbort);
      controller.abort(error ?? undefined);
      callback(error);
    },
  });
}
