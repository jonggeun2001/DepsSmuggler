import * as path from 'path';
import * as fse from 'fs-extra';
import pLimit from 'p-limit';
import { createDeliveryPipeline } from './download/delivery-pipeline';
import {
  bindSessionProgressEmitter,
  createDownloadSessionRegistry,
  createExecutionState,
} from './download/session-registry';
import {
  createDownloadPackageRouter,
  type DownloadExecutionState,
  type DownloadPackageResult,
  type DownloadPackageRouter,
} from './download-package-router';
import {
  createDownloadProgressEmitter,
  type DownloadProgressEmitter,
} from './download-progress';
import { initializeEmailSender } from '../../src/core/mailer/email-sender';
import { getArchivePackager } from '../../src/core/packager/archive-packager';
import { getFileSplitter } from '../../src/core/packager/file-splitter';
import { generateInstallScripts } from '../../src/core/shared';
import { createScopedLogger } from '../utils/logger';
import type { DownloadOptions, DownloadPackage } from '../../src/core/shared';
import type { PackageInfo } from '../../src/types';

const log = createScopedLogger('DownloadOrchestrator');

type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

export interface DownloadOrchestratorDeps {
  getMainWindow: () => Electron.BrowserWindow | null;
  ensureDir?: (targetPath: string) => Promise<void>;
  pathExists?: (targetPath: string) => Promise<boolean>;
  emptyDir?: (targetPath: string) => Promise<void>;
  readdir?: typeof fse.readdir;
  stat?: typeof fse.stat;
  createLimiter?: (concurrency: number) => Limiter;
  scheduleTask?: (task: () => Promise<void>) => Promise<void> | void;
  createPackageRouter?: () => DownloadPackageRouter;
  createProgressEmitter?: (
    getMainWindow: () => Electron.BrowserWindow | null
  ) => DownloadProgressEmitter;
  archivePackager?: ReturnType<typeof getArchivePackager>;
  generateInstallScripts?: typeof generateInstallScripts;
  initializeEmailSender?: typeof initializeEmailSender;
  getFileSplitter?: typeof getFileSplitter;
}

export interface DownloadOrchestrator {
  startDownload(data: {
    sessionId?: number;
    packages: DownloadPackage[];
    options: DownloadOptions;
  }): Promise<{ success: true; started: true }>;
  pauseDownload(): Promise<{ success: true }>;
  resumeDownload(): Promise<{ success: true }>;
  cancelDownload(): Promise<{ success: true }>;
  checkPath(
    outputDir: string
  ): Promise<{ exists: boolean; files: string[]; fileCount: number; totalSize: number }>;
  clearPath(outputDir: string): Promise<{ success: boolean; deleted: boolean }>;
}

export function createDownloadOrchestrator(
  deps: DownloadOrchestratorDeps
): DownloadOrchestrator {
  const ensureDir = deps.ensureDir ?? ((targetPath) => fse.ensureDir(targetPath));
  const pathExists = deps.pathExists ?? ((targetPath) => fse.pathExists(targetPath));
  const emptyDir = deps.emptyDir ?? ((targetPath) => fse.emptyDir(targetPath));
  const readdir = deps.readdir ?? fse.readdir.bind(fse);
  const stat = deps.stat ?? fse.stat.bind(fse);
  const createLimiter =
    deps.createLimiter ??
    ((concurrency: number): Limiter => pLimit(concurrency) as unknown as Limiter);
  const scheduleTask =
    deps.scheduleTask ??
    ((task: () => Promise<void>) => {
      setImmediate(() => {
        void task();
      });
    });
  const createPackageRouter = deps.createPackageRouter ?? createDownloadPackageRouter;
  const createProgressEmitter = deps.createProgressEmitter ?? createDownloadProgressEmitter;
  const archivePackager = deps.archivePackager ?? getArchivePackager();
  const installScripts = deps.generateInstallScripts ?? generateInstallScripts;
  const emailSenderFactory = deps.initializeEmailSender ?? initializeEmailSender;
  const fileSplitterFactory = deps.getFileSplitter ?? getFileSplitter;

  const progressEmitter = createProgressEmitter(deps.getMainWindow);
  const packageRouter = createPackageRouter();
  const sessionRegistry = createDownloadSessionRegistry();
  const deliveryPipeline = createDeliveryPipeline({
    archivePackager,
    generateInstallScripts: installScripts,
    initializeEmailSender: emailSenderFactory,
    getFileSplitter: fileSplitterFactory,
    stat,
  });

  return {
    async startDownload(data) {
      const session = sessionRegistry.createSession(data.sessionId);
      const state = createExecutionState(session);
      const sessionProgressEmitter = bindSessionProgressEmitter(progressEmitter, session.sessionId);

      sessionProgressEmitter.emitDownloadStatus({
        phase: 'downloading',
        message: '다운로드 중...',
      });

      await Promise.resolve(scheduleTask(() => runDownload(data, sessionProgressEmitter, state)));
      return { success: true, started: true };
    },

    async pauseDownload() {
      sessionRegistry.pauseActiveSession();
      return { success: true };
    },

    async resumeDownload() {
      sessionRegistry.resumeActiveSession();
      return { success: true };
    },

    async cancelDownload() {
      sessionRegistry.cancelActiveSession();
      progressEmitter.clearAllPackageProgress();
      return { success: true };
    },

    async checkPath(outputDir) {
      if (!outputDir) {
        return { exists: false, files: [], fileCount: 0, totalSize: 0 };
      }

      try {
        const exists = await pathExists(outputDir);
        if (!exists) {
          return { exists: false, files: [], fileCount: 0, totalSize: 0 };
        }

        const files: string[] = [];
        let totalSize = 0;
        const scanDirectory = async (dir: string): Promise<void> => {
          const entries = await readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              await scanDirectory(fullPath);
              continue;
            }

            files.push(path.relative(outputDir, fullPath));
            const fileStat = await stat(fullPath);
            totalSize += fileStat.size;
          }
        };

        await scanDirectory(outputDir);
        return {
          exists: true,
          files,
          fileCount: files.length,
          totalSize,
        };
      } catch (error) {
        log.error('Failed to check output path:', error);
        return { exists: false, files: [], fileCount: 0, totalSize: 0 };
      }
    },

    async clearPath(outputDir) {
      try {
        if (!outputDir) {
          return { success: false, deleted: false };
        }

        const exists = await pathExists(outputDir);
        if (!exists) {
          return { success: true, deleted: false };
        }

        await emptyDir(outputDir);
        return { success: true, deleted: true };
      } catch (error) {
        log.error('Failed to clear output path:', error);
        return { success: false, deleted: false };
      }
    },
  };

  async function runDownload(data: {
    sessionId?: number;
    packages: DownloadPackage[];
    options: DownloadOptions;
  }, sessionProgressEmitter: DownloadProgressEmitter, state: DownloadExecutionState): Promise<void> {
    const { packages, options } = data;
    const { outputDir, concurrency = 3 } = options;
    const packagesDir = path.join(outputDir, 'packages');
    const limit = createLimiter(concurrency);
    const emitCancelledCompletion = (
      currentOutputPath: string,
      currentArtifactPaths?: string[]
    ) => {
      sessionProgressEmitter.emitAllComplete({
        success: false,
        cancelled: true,
        outputPath: currentOutputPath,
        artifactPaths: currentArtifactPaths,
      });
    };

    try {
      await ensureDir(packagesDir);
      const downloadPromises = packages.map((pkg) =>
        limit(() =>
          packageRouter.downloadPackage(pkg, {
            packagesDir,
            options,
            progressEmitter: sessionProgressEmitter,
            state,
          })
        )
      );

      const rawResults: DownloadPackageResult[] = await Promise.all(downloadPromises);
      const results = rawResults.filter((result) => result.error !== 'cancelled');

      if (state.isCancelled()) {
        emitCancelledCompletion(outputDir);
        return;
      }

      const successfulPackageIds = new Set(
        results.filter((result) => result.success).map((result) => result.id)
      );
      const deliveredPackages = packages.filter((pkg) => successfulPackageIds.has(pkg.id));
      const packageInfos = deliveredPackages.map(toPackageInfo);
      const failedDownloadCount = results.filter((result) => !result.success).length;
      const completionPayload = await deliveryPipeline.finalizeDownload({
        outputDir,
        options,
        deliveredPackages,
        packageInfos,
        results,
        failedDownloadCount,
        progressEmitter: sessionProgressEmitter,
        isCancelled: () => state.isCancelled(),
      });

      sessionProgressEmitter.emitAllComplete(completionPayload);
    } catch (error) {
      sessionProgressEmitter.emitAllComplete({
        success: false,
        outputPath: outputDir,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

}

function toPackageInfo(pkg: DownloadPackage): PackageInfo {
  return {
    type: pkg.type as PackageInfo['type'],
    name: pkg.name,
    version: pkg.version,
    arch: pkg.architecture as PackageInfo['arch'],
    metadata: pkg.metadata,
  };
}
