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
