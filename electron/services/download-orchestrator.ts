import * as path from 'path';
import * as fse from 'fs-extra';
import { createConcurrencyLimiter } from './download/concurrency-limiter';
import { createDeliveryPipeline } from './download/delivery-pipeline';
import { createDownloadSessionRunner } from './download/download-session';
import {
  bindSessionProgressEmitter,
  createDownloadSessionRegistry,
  createExecutionState,
} from './download/session-registry';
import {
  createDownloadPackageRouter,
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
import type { ConcurrencyLimiterFactory } from './download/concurrency-limiter';
import type { DownloadOptions, DownloadPackage } from '../../src/core/shared';

const log = createScopedLogger('DownloadOrchestrator');

export interface DownloadOrchestratorDeps {
  getMainWindow: () => Electron.BrowserWindow | null;
  ensureDir?: (targetPath: string) => Promise<void>;
  pathExists?: (targetPath: string) => Promise<boolean>;
  emptyDir?: (targetPath: string) => Promise<void>;
  readdir?: typeof fse.readdir;
  stat?: typeof fse.stat;
  createLimiter?: ConcurrencyLimiterFactory;
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
  const createLimiter = deps.createLimiter ?? createConcurrencyLimiter;
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
  const downloadSession = createDownloadSessionRunner({
    ensureDir,
    createLimiter,
    packageRouter,
    deliveryPipeline,
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

      await Promise.resolve(scheduleTask(() => downloadSession.run(data, sessionProgressEmitter, state)));
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
}
