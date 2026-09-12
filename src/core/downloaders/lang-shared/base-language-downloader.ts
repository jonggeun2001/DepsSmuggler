import * as path from 'path';
import axios from 'axios';
import * as fs from 'fs-extra';
import type { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { sanitizePath } from '../../shared/path-utils';
import { createDownloadGate, waitForDownloadResume, type DownloadControlOptions } from '../../shared/download-control';
import type { DownloadProgressEvent } from '../../../types';

export interface LanguageArtifactDownloadPlan extends DownloadControlOptions {
  downloadUrl: string;
  itemId: string;
  timeoutMs: number;
  fileName?: string;
  relativeFilePath?: string;
  verifyFile?: (filePath: string) => Promise<boolean>;
  verificationFailureMessage?: string;
}

export abstract class BaseLanguageDownloader {
  protected async downloadArtifactFile(
    destPath: string,
    plan: LanguageArtifactDownloadPlan,
    onProgress?: (progress: DownloadProgressEvent) => void
  ): Promise<string> {
    const filePath = this.resolveFilePath(plan, destPath);

    // The local signal also releases a paused transform if the source/writer fails.
    const controller = new AbortController();
    const onAbort = () => controller.abort(plan.signal?.reason);
    plan.signal?.addEventListener('abort', onAbort, { once: true });
    if (plan.signal?.aborted) onAbort();
    const controls = { signal: controller.signal, shouldPause: plan.shouldPause };
    let source: Readable | undefined;
    let gate: Transform | undefined;
    let ownsFile = false;
    try {
      await waitForDownloadResume(controls);
      await fs.ensureDir(path.dirname(filePath));
      await waitForDownloadResume(controls);
      const response = await axios({
        method: 'GET',
        url: plan.downloadUrl,
        responseType: 'stream',
        timeout: plan.timeoutMs,
        ...(plan.signal ? { signal: controller.signal } : {}),
      });
      source = response.data as Readable;
      controller.signal.throwIfAborted();
      const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
      let downloadedBytes = 0;
      let lastBytes = 0;
      let lastTime = Date.now();
      let currentSpeed = 0;

      // A transform enforces the pause even when pipe resumes its source on drain.
      gate = createDownloadGate(controls, chunk => {
        downloadedBytes += chunk.length;
        const now = Date.now();
        const elapsed = (now - lastTime) / 1000;
        if (elapsed >= 0.3) {
          currentSpeed = (downloadedBytes - lastBytes) / elapsed;
          lastBytes = downloadedBytes;
          lastTime = now;
        }
        onProgress?.({
          itemId: plan.itemId,
          progress: totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0,
          downloadedBytes,
          totalBytes,
          speed: currentSpeed,
        });
      });
      const writer = fs.createWriteStream(filePath);
      // A failed open must not unlink an untouched existing file or directory.
      writer.once('open', () => { ownsFile = true; });
      await pipeline(source, gate, writer, { signal: controller.signal });
      await waitForDownloadResume(plan);
      if (plan.verifyFile && !(await plan.verifyFile(filePath))) {
        throw new Error(plan.verificationFailureMessage ?? '다운로드 검증 실패');
      }
      await waitForDownloadResume(plan);
      return filePath;
    } catch (error) {
      source?.destroy();
      if (ownsFile) await fs.remove(filePath);
      throw error;
    } finally {
      gate?.destroy();
      controller.abort();
      plan.signal?.removeEventListener('abort', onAbort);
    }
  }

  private resolveFilePath(plan: LanguageArtifactDownloadPlan, destPath: string): string {
    if (plan.relativeFilePath) {
      const relativePathSegments = plan.relativeFilePath
        .split(/[\\/]+/)
        .filter(Boolean)
        .map((segment) => sanitizePath(segment, /[^a-zA-Z0-9._-]/g));
      return path.join(destPath, ...relativePathSegments);
    }

    const rawFileName = plan.fileName ?? path.basename(new URL(plan.downloadUrl).pathname);
    const fileName = sanitizePath(rawFileName, /[^a-zA-Z0-9._-]/g);
    return path.join(destPath, fileName);
  }
}
