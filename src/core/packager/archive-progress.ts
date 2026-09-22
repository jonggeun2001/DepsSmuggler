import type { ArchiveProgress } from '../../types/packaging';
import type { Archiver, EntryData } from 'archiver';
import type { WriteStream } from 'fs';

/** Report completed source files and live output bytes; only a closed output can reach 100%. */
export function trackArchiveProgress(
  archive: Archiver,
  output: WriteStream,
  totals: { totalFiles: number; totalBytes: number },
  onProgress?: (progress: ArchiveProgress) => void
): void {
  if (!onProgress) return;

  let processedFiles = 0;
  let processedBytes = 0;
  let failed = false;
  const report = (complete = false) => {
    const fraction =
      totals.totalBytes > 0
        ? processedBytes / totals.totalBytes
        : totals.totalFiles > 0
          ? processedFiles / totals.totalFiles
          : 0;
    onProgress({
      ...totals,
      processedFiles: Math.min(processedFiles, totals.totalFiles),
      processedBytes: Math.min(processedBytes, totals.totalBytes),
      percentage: complete ? 100 : Math.min(99, Math.floor(fraction * 100)),
      outputBytes: output.bytesWritten,
    });
  };
  const onEntry = (entry: EntryData) => {
    // Generated metadata and directory entries are not part of the source file totals.
    if (entry.stats?.isFile?.()) {
      processedFiles += 1;
      processedBytes += entry.stats.size;
    }
  };
  archive.on('entry', onEntry);
  const timer = setInterval(() => report(), 250);
  timer.unref();
  const cleanup = () => {
    clearInterval(timer);
    archive.off('entry', onEntry);
    archive.off('error', onError);
    output.off('error', onError);
  };
  const onError = () => {
    failed = true;
    cleanup();
  };
  archive.once('error', onError);
  output.once('error', onError);
  output.once('close', () => {
    cleanup();
    if (!failed && output.writableFinished) report(true);
  });
}
