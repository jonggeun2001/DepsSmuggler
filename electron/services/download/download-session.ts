import * as path from 'path';
import type { DownloadOptions, DownloadPackage } from '../../../src/core/shared';
import type { PackageInfo } from '../../../src/types';
import type {
  DownloadExecutionState,
  DownloadPackageResult,
  DownloadPackageRouter,
} from '../download-package-router';
import type { DownloadProgressEmitter } from '../download-progress';
import type { ConcurrencyLimiterFactory } from './concurrency-limiter';
import type { DeliveryPipeline } from './delivery-pipeline';

export interface DownloadSessionRunnerDeps {
  ensureDir: (targetPath: string) => Promise<void>;
  createLimiter: ConcurrencyLimiterFactory;
  packageRouter: DownloadPackageRouter;
  deliveryPipeline: DeliveryPipeline;
}

export interface DownloadSessionRunner {
  run(
    data: {
      sessionId?: number;
      packages: DownloadPackage[];
      options: DownloadOptions;
    },
    progressEmitter: DownloadProgressEmitter,
    state: DownloadExecutionState
  ): Promise<void>;
}

export function createDownloadSessionRunner(
  deps: DownloadSessionRunnerDeps
): DownloadSessionRunner {
  return {
    async run(data, progressEmitter, state) {
      const { packages, options } = data;
      const { outputDir, concurrency = 3 } = options;
      const packagesDir = path.join(outputDir, 'packages');
      const limit = deps.createLimiter(concurrency);
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

      try {
        await deps.ensureDir(packagesDir);
        const downloadPromises = packages.map((pkg) =>
          limit(() =>
            deps.packageRouter.downloadPackage(pkg, {
              packagesDir,
              options,
              progressEmitter,
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
        const completionPayload = await deps.deliveryPipeline.finalizeDownload({
          outputDir,
          options,
          deliveredPackages,
          packageInfos,
          results,
          failedDownloadCount,
          progressEmitter,
          isCancelled: () => state.isCancelled(),
        });

        progressEmitter.emitAllComplete(completionPayload);
      } catch (error) {
        progressEmitter.emitAllComplete({
          success: false,
          outputPath: outputDir,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
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
