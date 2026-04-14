import * as path from 'path';
import * as fse from 'fs-extra';
import pLimit from 'p-limit';
import { createScopedLogger } from '../utils/logger';
import { generateInstallScripts } from '../../src/core/shared';
import type { DownloadOptions, DownloadPackage } from '../../src/core/shared';
import { getArchivePackager } from '../../src/core/packager/archive-packager';
import { getFileSplitter } from '../../src/core/packager/file-splitter';
import { initializeEmailSender } from '../../src/core/mailer/email-sender';
import type { PackageInfo } from '../../src/types';
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

  let downloadCancelled = false;
  let downloadPaused = false;
  let downloadAbortController: AbortController | null = null;

  const state: DownloadExecutionState = {
    isCancelled: () => downloadCancelled,
    isPaused: () => downloadPaused,
    waitWhilePaused: async () => {
      while (downloadPaused && !downloadCancelled) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
    get signal() {
      return downloadAbortController?.signal;
    },
  };

  return {
    async startDownload(data) {
      const { packages, options } = data;
      downloadCancelled = false;
      downloadPaused = false;
      downloadAbortController = new AbortController();

      progressEmitter.emitDownloadStatus({
        phase: 'downloading',
        message: '다운로드 중...',
      });

      await Promise.resolve(scheduleTask(() => runDownload(data)));
      return { success: true, started: true };
    },

    async pauseDownload() {
      downloadPaused = true;
      return { success: true };
    },

    async resumeDownload() {
      downloadPaused = false;
      return { success: true };
    },

    async cancelDownload() {
      downloadCancelled = true;
      downloadAbortController?.abort();
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
    packages: DownloadPackage[];
    options: DownloadOptions;
  }): Promise<void> {
    const { packages, options } = data;
    const { outputDir, outputFormat, includeScripts, concurrency = 3 } = options;
    const packagesDir = path.join(outputDir, 'packages');
    const limit = createLimiter(concurrency);
    const emitCancelledCompletion = (
      currentOutputPath: string,
      currentArtifactPaths?: string[]
    ) => {
      progressEmitter.emitAllComplete({
        success: false,
        cancelled: true,
        outputPath: currentOutputPath,
        artifactPaths: currentArtifactPaths,
      });
    };
    const shouldStopForCancellation = (
      currentOutputPath: string,
      currentArtifactPaths?: string[]
    ): boolean => {
      if (!downloadCancelled) {
        return false;
      }

      emitCancelledCompletion(currentOutputPath, currentArtifactPaths);
      return true;
    };

    try {
      await ensureDir(packagesDir);
      const downloadPromises = packages.map((pkg) =>
        limit(() =>
          packageRouter.downloadPackage(pkg, {
            packagesDir,
            options,
            progressEmitter,
            state,
          })
        )
      );

      const rawResults: DownloadPackageResult[] = await Promise.all(downloadPromises);
      const results = rawResults.filter((result) => result.error !== 'cancelled');

      if (downloadCancelled) {
        emitCancelledCompletion(outputDir);
        return;
      }

      const successfulPackageIds = new Set(
        results.filter((result) => result.success).map((result) => result.id)
      );
      const deliveredPackages = packages.filter((pkg) => successfulPackageIds.has(pkg.id));
      const packageInfos = deliveredPackages.map(toPackageInfo);
      const failedDownloadCount = results.filter((result) => !result.success).length;
      let finalOutputPath = outputDir;
      let artifactPaths: string[] = [];
      let deliveryResult:
        | {
            emailSent: boolean;
            emailsSent?: number;
            attachmentsSent?: number;
            splitApplied?: boolean;
            error?: string;
          }
        | undefined;
      const deliveryMethod = options.deliveryMethod || 'local';

      if (successfulPackageIds.size === 0) {
        progressEmitter.emitAllComplete({
          success: false,
          outputPath: outputDir,
          deliveryMethod,
          error: '다운로드에 성공한 패키지가 없습니다.',
          results,
        });
        return;
      }

      if (includeScripts) {
        try {
          installScripts(outputDir, deliveredPackages);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          progressEmitter.emitAllComplete({
            success: false,
            outputPath: outputDir,
            error: errorMessage,
            results,
          });
          return;
        }
      }

      if (outputFormat !== 'zip' && outputFormat !== 'tar.gz') {
        progressEmitter.emitAllComplete({
          success: false,
          outputPath: outputDir,
          error: `지원하지 않는 출력 형식입니다: ${String(outputFormat)}`,
          results,
        });
        return;
      }

      if (shouldStopForCancellation(finalOutputPath, artifactPaths)) {
        return;
      }

      try {
        progressEmitter.emitDownloadStatus({
          phase: 'packaging',
          message: `${outputFormat.toUpperCase()} 패키징 중...`,
        });
        const archivePath = `${outputDir}.${outputFormat === 'zip' ? 'zip' : 'tar.gz'}`;
        finalOutputPath = await archivePackager.createArchiveFromDirectory(
          outputDir,
          archivePath,
          packageInfos,
          {
            format: outputFormat,
            includeManifest: true,
            includeReadme: true,
          }
        );
        artifactPaths = [finalOutputPath];
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        progressEmitter.emitAllComplete({
          success: false,
          outputPath: outputDir,
          error: errorMessage,
          results,
        });
        return;
      }

      if (shouldStopForCancellation(finalOutputPath, artifactPaths)) {
        return;
      }

      if (deliveryMethod === 'email') {
        const emailOutcome = await deliverByEmail({
          options,
          packageInfos,
          results,
          finalOutputPath,
          artifactPaths,
          failedDownloadCount,
          isCancelled: () => downloadCancelled,
        });

        if (!emailOutcome.success) {
          progressEmitter.emitAllComplete(emailOutcome.completionPayload);
          return;
        }

        finalOutputPath = emailOutcome.finalOutputPath;
        artifactPaths = emailOutcome.artifactPaths;
        deliveryResult = emailOutcome.deliveryResult;
      }

      if (
        !deliveryResult?.emailSent &&
        shouldStopForCancellation(
          finalOutputPath,
          artifactPaths.length > 0 ? artifactPaths : [finalOutputPath]
        )
      ) {
        return;
      }

      progressEmitter.emitAllComplete({
        success: true,
        outputPath: finalOutputPath,
        artifactPaths: artifactPaths.length > 0 ? artifactPaths : [finalOutputPath],
        deliveryMethod,
        deliveryResult,
        results,
      });
    } catch (error) {
      progressEmitter.emitAllComplete({
        success: false,
        outputPath: outputDir,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function deliverByEmail(params: {
    options: DownloadOptions;
    packageInfos: PackageInfo[];
    results: DownloadPackageResult[];
    finalOutputPath: string;
    artifactPaths: string[];
    failedDownloadCount: number;
    isCancelled: () => boolean;
  }): Promise<
    | {
        success: true;
        finalOutputPath: string;
        artifactPaths: string[];
        deliveryResult: {
          emailSent: true;
          emailsSent?: number;
          attachmentsSent?: number;
          splitApplied: boolean;
        };
      }
    | {
        success: false;
        completionPayload: Record<string, unknown>;
      }
  > {
    const { options, packageInfos, results, failedDownloadCount, isCancelled } = params;
    let { finalOutputPath, artifactPaths } = params;
    const smtpOptions = options.smtp;
    const emailOptions = options.email;
    const deliveryMethod = options.deliveryMethod || 'local';
    const effectiveFrom = emailOptions?.from || smtpOptions?.from || smtpOptions?.user;

    if (!smtpOptions?.host || !smtpOptions.port || !emailOptions?.to) {
      return {
        success: false,
        completionPayload: {
          success: false,
          outputPath: finalOutputPath,
          artifactPaths: artifactPaths.length > 0 ? artifactPaths : [finalOutputPath],
          deliveryMethod,
          deliveryResult: {
            emailSent: false,
            splitApplied: false,
            error: '이메일 전달에 필요한 SMTP 또는 수신자 설정이 없습니다',
          },
          error: '이메일 전달에 필요한 SMTP 또는 수신자 설정이 없습니다',
          results,
        },
      };
    }

    if (!effectiveFrom) {
      return {
        success: false,
        completionPayload: {
          success: false,
          outputPath: finalOutputPath,
          artifactPaths: artifactPaths.length > 0 ? artifactPaths : [finalOutputPath],
          deliveryMethod,
          deliveryResult: {
            emailSent: false,
            splitApplied: false,
            error:
              '이메일 전달에 필요한 발신자 설정이 없습니다. SMTP 발신자 또는 로그인 사용자를 설정하세요.',
          },
          error:
            '이메일 전달에 필요한 발신자 설정이 없습니다. SMTP 발신자 또는 로그인 사용자를 설정하세요.',
          results,
        },
      };
    }

    const maxAttachmentSizeBytes = (options.fileSplit?.maxSizeMB ?? 25) * 1024 * 1024;
    let attachments = artifactPaths.length > 0 ? [...artifactPaths] : [finalOutputPath];
    let splitApplied = false;
    const getCurrentArtifacts = () =>
      attachments.length > 0 ? attachments : artifactPaths.length > 0 ? artifactPaths : [finalOutputPath];
    const getCancelledOutcome = () => {
      if (!isCancelled()) {
        return null;
      }

      return {
        success: false as const,
        completionPayload: {
          success: false,
          cancelled: true,
          outputPath: finalOutputPath,
          artifactPaths: getCurrentArtifacts(),
        },
      };
    };

    progressEmitter.emitDownloadStatus({
      phase: 'packaging',
      message: '이메일 전달 준비 중...',
    });

    try {
      const cancelledBeforeStat = getCancelledOutcome();
      if (cancelledBeforeStat) {
        return cancelledBeforeStat;
      }

      const archiveStat = await (deps.stat ?? fse.stat.bind(fse))(finalOutputPath);
      const cancelledAfterStat = getCancelledOutcome();
      if (cancelledAfterStat) {
        return cancelledAfterStat;
      }

      if (archiveStat.size > maxAttachmentSizeBytes) {
        if (!options.fileSplit?.enabled) {
          return {
            success: false,
            completionPayload: {
              success: false,
              outputPath: finalOutputPath,
              artifactPaths: [finalOutputPath],
              deliveryMethod,
              deliveryResult: {
                emailSent: false,
                splitApplied: false,
                error: '첨부 파일 크기가 제한을 초과했습니다. 파일 분할을 활성화하세요.',
              },
              error: '첨부 파일 크기가 제한을 초과했습니다. 파일 분할을 활성화하세요.',
              results,
            },
          };
        }

        const splitter = fileSplitterFactory();
        const splitResult = await splitter.splitFile(finalOutputPath, {
          maxSizeMB: options.fileSplit.maxSizeMB,
          generateMergeScripts: true,
        });
        attachments = collectSplitArtifacts(splitResult);
        artifactPaths = attachments;
        finalOutputPath = attachments[0] || finalOutputPath;
        splitApplied = true;
      }

      const cancelledBeforeEmailSetup = getCancelledOutcome();
      if (cancelledBeforeEmailSetup) {
        return cancelledBeforeEmailSetup;
      }

      const emailSender = emailSenderFactory(
        {
          host: smtpOptions.host,
          port: smtpOptions.port,
          secure: smtpOptions.secure ?? smtpOptions.port === 465,
          auth: smtpOptions.user
            ? {
                user: smtpOptions.user,
                pass: smtpOptions.password || '',
              }
            : undefined,
          from: effectiveFrom,
        },
        maxAttachmentSizeBytes
      );

      const cancelledBeforeSend = getCancelledOutcome();
      if (cancelledBeforeSend) {
        return cancelledBeforeSend;
      }

      const emailSendResult = await emailSender.sendEmail({
        to: emailOptions.to,
        subject:
          emailOptions.subject || `DepsSmuggler 패키지 전달 (${packageInfos.length}개 패키지)`,
        body: [
          splitApplied
            ? '첨부 용량 제한에 맞춰 파일을 분할해 전달했습니다.'
            : '다운로드된 패키지 아카이브를 전달합니다.',
          failedDownloadCount > 0
            ? `다운로드 실패한 ${failedDownloadCount}개 패키지는 이번 전달에서 제외되었습니다.`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
        attachments: getCurrentArtifacts(),
        packages: packageInfos,
      });

      if (!emailSendResult.success) {
        const errorMessage = emailSendResult.error || '이메일 전달에 실패했습니다';
        return {
          success: false,
          completionPayload: {
            success: false,
            outputPath: finalOutputPath,
            artifactPaths: attachments,
            deliveryMethod,
            deliveryResult: {
              emailSent: false,
              emailsSent: emailSendResult.emailsSent,
              attachmentsSent: emailSendResult.attachmentsSent,
              splitApplied,
              error: errorMessage,
            },
            error: errorMessage,
            results,
          },
        };
      }

      return {
        success: true,
        finalOutputPath,
        artifactPaths: attachments,
        deliveryResult: {
          emailSent: true,
          emailsSent: emailSendResult.emailsSent,
          attachmentsSent: emailSendResult.attachmentsSent,
          splitApplied,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        completionPayload: {
          success: false,
          outputPath: finalOutputPath,
          artifactPaths: artifactPaths.length > 0 ? artifactPaths : [finalOutputPath],
          deliveryMethod,
          deliveryResult: {
            emailSent: false,
            splitApplied,
            error: errorMessage,
          },
          error: errorMessage,
          results,
        },
      };
    }
  }
}

function collectSplitArtifacts(splitResult: {
  parts: string[];
  metadataPath?: string;
  mergeScripts?: {
    bash?: string;
    powershell?: string;
  };
}): string[] {
  return [
    ...splitResult.parts,
    splitResult.metadataPath,
    splitResult.mergeScripts?.bash,
    splitResult.mergeScripts?.powershell,
  ].filter((value): value is string => Boolean(value));
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
