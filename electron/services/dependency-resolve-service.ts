import { createScopedLogger } from '../utils/logger';
import { resolveAllDependencies } from '../../src/core/shared';
import type { DownloadPackage } from '../../src/core/shared';

const log = createScopedLogger('DependencyResolveService');

export function createDependencyResolveService() {
  return {
    async resolveDependencies(
      packages: DownloadPackage[],
      options:
        | {
            includeDependencies?: boolean;
            targetOS?: string;
            architecture?: string;
            pythonVersion?: string;
            cudaVersion?: string | null;
            yumDistribution?: { id: string; architecture: string };
            aptDistribution?: { id: string; architecture: string };
            apkDistribution?: { id: string; architecture: string };
            includeRecommends?: boolean;
          }
        | undefined,
      sender: { send: (channel: string, payload: unknown) => void }
    ) {
      log.info(
        `Resolving dependencies for ${packages.length} packages (targetOS: ${
          options?.targetOS || 'any'
        }, python: ${options?.pythonVersion || 'any'}, cuda: ${options?.cudaVersion || 'none'})`
      );

      const resolved = await resolveAllDependencies(packages, {
        includeDependencies: options?.includeDependencies,
        targetOS: options?.targetOS as 'any' | 'windows' | 'macos' | 'linux' | undefined,
        architecture: options?.architecture,
        pythonVersion: options?.pythonVersion,
        cudaVersion: options?.cudaVersion,
        yumDistribution: options?.yumDistribution,
        aptDistribution: options?.aptDistribution,
        apkDistribution: options?.apkDistribution,
        includeRecommends: options?.includeRecommends,
        onProgress: (progress) => {
          sender.send('dependency:progress', progress);
        },
      });

      return {
        originalPackages: packages,
        allPackages: resolved.allPackages,
        dependencyTrees: resolved.dependencyTrees,
        failedPackages: resolved.failedPackages,
      };
    },
  };
}
