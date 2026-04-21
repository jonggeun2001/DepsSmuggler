import * as path from 'path';
import axios from 'axios';
import * as fs from 'fs-extra';
import { sanitizePath } from '../../shared/path-utils';
import type { DownloadProgressEvent } from '../../../types';

export interface LanguageArtifactDownloadPlan {
  downloadUrl: string;
  itemId: string;
  timeoutMs: number;
  fileName?: string;
  verifyFile?: (filePath: string) => Promise<boolean>;
  verificationFailureMessage?: string;
}

export abstract class BaseLanguageDownloader {
  protected async downloadArtifact(
    destPath: string,
    plan: LanguageArtifactDownloadPlan,
    onProgress?: (progress: DownloadProgressEvent) => void
  ): Promise<string> {
    const filePath = this.resolveFilePath(plan, destPath);

    await fs.ensureDir(destPath);

    const response = await axios({
      method: 'GET',
      url: plan.downloadUrl,
      responseType: 'stream',
      timeout: plan.timeoutMs,
    });

    const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
    let downloadedBytes = 0;
    let lastBytes = 0;
    let lastTime = Date.now();
    let currentSpeed = 0;

    const writer = fs.createWriteStream(filePath);

    response.data.on('data', (chunk: Buffer) => {
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

    response.data.pipe(writer);

    await new Promise<void>((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    if (plan.verifyFile) {
      const isValid = await plan.verifyFile(filePath);
      if (!isValid) {
        await fs.remove(filePath);
        throw new Error(plan.verificationFailureMessage ?? '다운로드 검증 실패');
      }
    }

    return filePath;
  }

  private resolveFilePath(plan: LanguageArtifactDownloadPlan, destPath: string): string {
    const rawFileName = plan.fileName ?? path.basename(new URL(plan.downloadUrl).pathname);
    const fileName = sanitizePath(rawFileName, /[^a-zA-Z0-9._-]/g);
    return path.join(destPath, fileName);
  }
}
