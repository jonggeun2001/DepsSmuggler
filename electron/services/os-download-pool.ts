import type { OSPackageDownloadResult } from '../../src/core/downloaders/os-shared/base-downloader';
import type { OSDownloadProgress, OSPackageInfo } from '../../src/core/downloaders/os-shared/types';

/** A session owns all slots and drains them before its caller can remove staging files. */
export async function runOSDownloadPool(options: {
  packages: OSPackageInfo[];
  concurrency: number;
  controller: AbortController;
  cancel: () => void;
  createDownloader: (
    slot: number,
    onProgress: (progress: OSDownloadProgress) => void
  ) => {
    downloadPackage: (pkg: OSPackageInfo) => Promise<OSPackageDownloadResult>;
  };
  onProgress: (progress: OSDownloadProgress) => void;
}): Promise<Array<OSPackageDownloadResult | undefined>> {
  const { packages, controller } = options;
  const limit =
    Number.isFinite(options.concurrency) && options.concurrency >= 1
      ? Math.floor(options.concurrency)
      : 3;
  const results = new Array<OSPackageDownloadResult | undefined>(packages.length);
  const active = new Map<number, OSDownloadProgress>();
  let next = 0;
  let completed = 0;
  let failure: { error: unknown } | undefined;
  let finished = false;

  const emit = () => {
    if (finished || controller.signal.aborted) return;
    // Keep focus on the earliest active input, rather than flickering on every parallel chunk.
    const focus = active.size ? active.get(Math.min(...active.keys())) : undefined;
    options.onProgress({
      currentPackage:
        focus?.currentPackage ??
        (completed === packages.length ? '패키지 처리 완료' : '다음 패키지 준비 중'),
      currentIndex: Math.min(completed + (active.size ? 1 : 0), packages.length),
      totalPackages: packages.length,
      completedPackages: completed,
      activePackages: active.size,
      bytesDownloaded: focus?.bytesDownloaded ?? 0,
      totalBytes: focus?.totalBytes ?? 0,
      speed: focus?.speed ?? 0,
      phase: focus?.phase ?? 'downloading',
    });
  };

  const worker = async (slot: number) => {
    try {
      while (!controller.signal.aborted && next < packages.length) {
        const index = next++;
        const pkg = packages[index];
        active.set(index, {
          currentPackage: pkg.name,
          currentIndex: 0,
          totalPackages: 1,
          bytesDownloaded: 0,
          totalBytes: pkg.size,
          speed: 0,
          phase: 'downloading',
        });
        emit();
        try {
          // Callback belongs to this package: late callbacks cannot update a reused slot.
          const downloader = options.createDownloader(slot, (progress) => {
            if (finished || controller.signal.aborted || !active.has(index)) return;
            active.set(index, { ...progress, currentPackage: pkg.name });
            emit();
          });
          const result = await downloader.downloadPackage(pkg);
          if (result.cancelled && !controller.signal.aborted) options.cancel();
          results[index] = controller.signal.aborted
            ? { success: false, skipped: true, cancelled: true }
            : result;
        } catch (error) {
          if (!controller.signal.aborted) {
            failure = { error };
            controller.abort();
          }
        } finally {
          active.delete(index);
          completed++;
          emit();
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        failure = { error };
        controller.abort();
      }
    }
  };

  try {
    await Promise.allSettled(
      Array.from({ length: Math.min(limit, packages.length) }, (_, slot) => worker(slot))
    );
    if (failure) throw failure.error;
    return results;
  } finally {
    finished = true;
  }
}
