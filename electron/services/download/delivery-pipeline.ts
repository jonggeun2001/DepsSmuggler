import * as fse from 'fs-extra';
import { initializeEmailSender } from '../../../src/core/mailer/email-sender';
import { getArchivePackager } from '../../../src/core/packager/archive-packager';
import { getFileSplitter } from '../../../src/core/packager/file-splitter';
import { generateInstallScripts } from '../../../src/core/shared';
import type { DownloadOptions, DownloadPackage } from '../../../src/core/shared';
import type { PackageInfo } from '../../../src/types';
import type { DownloadPackageResult } from '../download-package-router';
import type { DownloadProgressEmitter } from '../download-progress';

export interface DeliveryPipelineDeps {
  archivePackager: ReturnType<typeof getArchivePackager>;
  generateInstallScripts: typeof generateInstallScripts;
  initializeEmailSender: typeof initializeEmailSender;
  getFileSplitter: typeof getFileSplitter;
  stat: typeof fse.stat;
}

export interface DeliveryPipeline {
  finalizeDownload(params: {
    outputDir: string;
    options: DownloadOptions;
    deliveredPackages: DownloadPackage[];
    packageInfos: PackageInfo[];
    results: DownloadPackageResult[];
    failedDownloadCount: number;
    progressEmitter: DownloadProgressEmitter;
    isCancelled: () => boolean;
  }): Promise<Record<string, unknown>>;
}

export function createDeliveryPipeline(deps: DeliveryPipelineDeps): DeliveryPipeline {
  return {
    async finalizeDownload(params) {
      const {
        outputDir,
        options,
        deliveredPackages,
        packageInfos,
        results,
        failedDownloadCount,
        progressEmitter,
        isCancelled,
      } = params;
      const { outputFormat, includeScripts } = options;
      const deliveryMethod = options.deliveryMethod || 'local';

      if (deliveredPackages.length === 0) {
        return {
          success: false,
          outputPath: outputDir,
          deliveryMethod,
          error: '다운로드에 성공한 패키지가 없습니다.',
          results,
        };
      }

      if (includeScripts) {
        try {
          deps.generateInstallScripts(outputDir, deliveredPackages);
        } catch (error) {
          return {
            success: false,
            outputPath: outputDir,
            error: error instanceof Error ? error.message : String(error),
            results,
          };
        }
      }

      if (outputFormat !== 'zip' && outputFormat !== 'tar.gz') {
        return {
          success: false,
          outputPath: outputDir,
          error: `지원하지 않는 출력 형식입니다: ${String(outputFormat)}`,
          results,
        };
      }

      const cancelledBeforePackaging = createCancelledPayload({
        isCancelled,
        outputPath: outputDir,
      });
      if (cancelledBeforePackaging) {
        return cancelledBeforePackaging;
      }

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

      try {
        progressEmitter.emitDownloadStatus({
          phase: 'packaging',
          message: `${outputFormat.toUpperCase()} 패키징 중...`,
        });

        const archivePath = `${outputDir}.${outputFormat === 'zip' ? 'zip' : 'tar.gz'}`;
        finalOutputPath = await deps.archivePackager.createArchiveFromDirectory(
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
        return {
          success: false,
          outputPath: outputDir,
          error: error instanceof Error ? error.message : String(error),
          results,
        };
      }

      const cancelledAfterPackaging = createCancelledPayload({
        isCancelled,
        outputPath: finalOutputPath,
        artifactPaths,
      });
      if (cancelledAfterPackaging) {
        return cancelledAfterPackaging;
      }

      if (deliveryMethod === 'email') {
        const emailOutcome = await deliverByEmail({
          deps,
          options,
          packageInfos,
          results,
          finalOutputPath,
          artifactPaths,
          failedDownloadCount,
          isCancelled,
          progressEmitter,
        });

        if (!emailOutcome.success) {
          return emailOutcome.completionPayload;
        }

        finalOutputPath = emailOutcome.finalOutputPath;
        artifactPaths = emailOutcome.artifactPaths;
        deliveryResult = emailOutcome.deliveryResult;
      }

      const cancelledAfterDelivery = !deliveryResult?.emailSent
        ? createCancelledPayload({
            isCancelled,
            outputPath: finalOutputPath,
            artifactPaths: artifactPaths.length > 0 ? artifactPaths : [finalOutputPath],
            deliveryMethod,
            deliveryResult,
            results,
          })
        : null;
      if (cancelledAfterDelivery) {
        return cancelledAfterDelivery;
      }

      return {
        success: true,
        outputPath: finalOutputPath,
        artifactPaths: artifactPaths.length > 0 ? artifactPaths : [finalOutputPath],
        deliveryMethod,
        deliveryResult,
        results,
      };
    },
  };
}

async function deliverByEmail(params: {
  deps: DeliveryPipelineDeps;
  options: DownloadOptions;
  packageInfos: PackageInfo[];
  results: DownloadPackageResult[];
  finalOutputPath: string;
  artifactPaths: string[];
  failedDownloadCount: number;
  isCancelled: () => boolean;
  progressEmitter: DownloadProgressEmitter;
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
  const { deps, options, packageInfos, results, failedDownloadCount, isCancelled, progressEmitter } = params;
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
  const getCancelledOutcome = (deliveryResult?: {
    emailSent: boolean;
    emailsSent?: number;
    attachmentsSent?: number;
    splitApplied?: boolean;
    error?: string;
  }) => {
    const completionPayload = createCancelledPayload({
      isCancelled,
      outputPath: finalOutputPath,
      artifactPaths: getCurrentArtifacts(),
      deliveryMethod,
      deliveryResult,
      results,
    });

    if (!completionPayload) {
      return null;
    }

    return {
      success: false as const,
      completionPayload,
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

    const archiveStat = await deps.stat(finalOutputPath);
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

      const splitter = deps.getFileSplitter();
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

    const emailSender = deps.initializeEmailSender(
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

    const cancelledAfterSend = getCancelledOutcome({
      emailSent: emailSendResult.success,
      emailsSent: emailSendResult.emailsSent,
      attachmentsSent: emailSendResult.attachmentsSent,
      splitApplied: emailSendResult.splitApplied ?? splitApplied,
      error: emailSendResult.success ? undefined : emailSendResult.error,
    });
    if (cancelledAfterSend) {
      return cancelledAfterSend;
    }

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

function createCancelledPayload(params: {
  isCancelled: () => boolean;
  outputPath: string;
  artifactPaths?: string[];
  deliveryMethod?: string;
  deliveryResult?: Record<string, unknown>;
  results?: DownloadPackageResult[];
}): Record<string, unknown> | null {
  if (!params.isCancelled()) {
    return null;
  }

  return {
    success: false,
    cancelled: true,
    outputPath: params.outputPath,
    artifactPaths: params.artifactPaths,
    deliveryMethod: params.deliveryMethod,
    deliveryResult: params.deliveryResult,
    results: params.results,
  };
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
