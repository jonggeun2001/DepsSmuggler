import { createScopedLogger } from '../utils/logger';
import {
  getYumResolver,
  getAptResolver,
  getApkResolver,
} from '../../src/core';
import {
  OS_DISTRIBUTIONS,
  getDistributionById,
  getDistributionsByPackageManager,
} from '../../src/core/downloaders/os-shared/repositories';
import {
  getSimplifiedDistributions,
  invalidateDistributionCache,
} from '../../src/core/downloaders/os-shared/distribution-fetcher';
import type {
  MatchType,
  OSArchitecture,
  OSDistribution,
  OSPackageManager,
} from '../../src/core/downloaders/os-shared/types';

const log = createScopedLogger('OSSearchService');

export function createOSSearchService() {
  return {
    async getDistributions(osType: OSPackageManager): Promise<OSDistribution[]> {
      return getDistributionsByPackageManager(osType);
    },

    async getAllDistributions(options?: {
      source?: 'internet' | 'local';
      refresh?: boolean;
    }): Promise<
      {
        id: string;
        name: string;
        version: string;
        osType: string;
        packageManager: string;
        architectures: string[];
      }[]
    > {
      const source = options?.source || 'internet';
      const refresh = options?.refresh || false;

      if (source === 'internet') {
        try {
          if (refresh) {
            invalidateDistributionCache();
          }
          return await getSimplifiedDistributions();
        } catch (error) {
          log.error('Failed to fetch distributions from internet, falling back to local:', error);
        }
      }

      return OS_DISTRIBUTIONS.map((distribution) => ({
        id: distribution.id,
        name: distribution.name,
        version: distribution.version,
        osType: 'linux',
        packageManager: distribution.packageManager,
        architectures: distribution.architectures as string[],
      }));
    },

    async getDistribution(distributionId: string): Promise<OSDistribution | undefined> {
      return getDistributionById(distributionId);
    },

    async searchPackages(options: {
      query: string;
      distribution: OSDistribution | { id: string; packageManager: string };
      architecture: OSArchitecture;
      matchType?: MatchType;
      limit?: number;
    }): Promise<{ packages: unknown[]; totalCount: number }> {
      const fullDistribution = getDistributionById(options.distribution.id);
      if (!fullDistribution) {
        throw new Error(`Unknown distribution: ${options.distribution.id}`);
      }

      log.info(
        `OS package search: ${options.query} on ${fullDistribution.id} (${options.architecture})`
      );

      let searchResults;
      switch (fullDistribution.packageManager) {
        case 'yum':
          searchResults = await getYumResolver({
            repositories: fullDistribution.defaultRepos,
            architecture: options.architecture,
            distribution: fullDistribution,
            includeOptional: false,
            includeRecommends: false,
          }).searchPackages(options.query, options.matchType === 'exact' ? 'exact' : 'partial');
          break;
        case 'apt':
          searchResults = await getAptResolver({
            repositories: fullDistribution.defaultRepos,
            architecture: options.architecture,
            distribution: fullDistribution,
            includeOptional: false,
            includeRecommends: false,
          }).searchPackages(options.query, options.matchType === 'exact' ? 'exact' : 'partial');
          break;
        case 'apk':
          searchResults = await getApkResolver({
            repositories: fullDistribution.defaultRepos,
            architecture: options.architecture,
            distribution: fullDistribution,
            includeOptional: false,
            includeRecommends: false,
          }).searchPackages(options.query, options.matchType === 'exact' ? 'exact' : 'partial');
          break;
        default:
          throw new Error(`Unsupported package manager: ${fullDistribution.packageManager}`);
      }

      const packages = searchResults.map((result) => result.latest);
      return {
        packages: options.limit ? packages.slice(0, options.limit) : packages,
        totalCount: packages.length,
      };
    },
  };
}
