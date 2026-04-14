import type { OSPackageInfo } from '../../../core/downloaders/os-shared/types';
import type { PackageType } from '../../stores/cart-store';
import type {
  CondaChannel,
  DockerRegistry,
  OSDistributionSetting,
} from '../../stores/settings-store';
import { getOSDistributionInfo } from './os-context';
import type { SearchResult } from './types';

interface SearchServiceElectronAPI {
  search?: {
    packages?: (
      type: string,
      query: string,
      options?: { channel?: string; registry?: string; indexUrl?: string }
    ) => Promise<{ results: SearchResult[] }>;
  };
  os?: {
    search?: (options: {
      query: string;
      distribution: unknown;
      architecture: string;
      matchType?: string;
      limit?: number;
    }) => Promise<{ packages: unknown[]; totalCount: number }>;
  };
}

export interface WizardSearchContext {
  packageType: PackageType;
  condaChannel: CondaChannel;
  dockerRegistry: DockerRegistry;
  customRegistryUrl: string;
  useCustomIndex: boolean;
  customIndexUrl: string;
  yumDistribution: OSDistributionSetting;
  aptDistribution: OSDistributionSetting;
  apkDistribution: OSDistributionSetting;
}

interface SearchServiceDependencies {
  electronAPI?: SearchServiceElectronAPI;
  fetchImpl?: typeof fetch;
}

function compareVersionsDescending(left: string, right: string): number {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);

  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const leftValue = leftParts[index] || 0;
    const rightValue = rightParts[index] || 0;
    if (leftValue !== rightValue) {
      return rightValue - leftValue;
    }
  }

  return 0;
}

function buildSearchOptions(context: WizardSearchContext): { channel?: string; registry?: string; indexUrl?: string } | undefined {
  switch (context.packageType) {
    case 'pip':
      if (context.useCustomIndex && context.customIndexUrl) {
        return { indexUrl: context.customIndexUrl };
      }
      return undefined;
    case 'conda':
      return { channel: context.condaChannel };
    case 'docker':
      return {
        registry:
          context.dockerRegistry === 'custom' && context.customRegistryUrl
            ? context.customRegistryUrl
            : context.dockerRegistry,
      };
    default:
      return undefined;
  }
}

function mapOSPackages(packages: OSPackageInfo[]): SearchResult[] {
  return packages.map((pkg) => ({
    name: pkg.name,
    version: pkg.version,
    description: pkg.summary || pkg.description || '',
    downloadUrl: `${pkg.repository.baseUrl}/${pkg.location}`,
    repository: { baseUrl: pkg.repository.baseUrl, name: pkg.repository.name },
    location: pkg.location,
    architecture: pkg.architecture,
    osPackageInfo: pkg,
  }));
}

async function searchViaHttp(
  fetchImpl: typeof fetch,
  context: WizardSearchContext,
  query: string
): Promise<SearchResult[]> {
  switch (context.packageType) {
    case 'pip':
    case 'conda': {
      const response = await fetchImpl(`/api/pypi/pypi/${encodeURIComponent(query)}/json`);
      if (!response.ok) {
        return [];
      }
      const data = await response.json() as {
        info: { name: string; version: string; summary?: string };
        releases: Record<string, unknown>;
      };

      return [
        {
          name: data.info.name,
          version: data.info.version,
          description: data.info.summary || '',
          versions: Object.keys(data.releases).sort(compareVersionsDescending).slice(0, 20),
        },
      ];
    }
    case 'maven': {
      const response = await fetchImpl(`/api/maven/search?q=${encodeURIComponent(query)}`);
      if (!response.ok) {
        return [];
      }
      const data = await response.json() as { results?: SearchResult[] };
      return data.results || [];
    }
    case 'npm': {
      const response = await fetchImpl(`/api/npm/search?q=${encodeURIComponent(query)}`);
      if (!response.ok) {
        return [];
      }
      const data = await response.json() as { results?: SearchResult[] };
      return data.results || [];
    }
    case 'docker': {
      const registry =
        context.dockerRegistry === 'custom' && context.customRegistryUrl
          ? context.customRegistryUrl
          : context.dockerRegistry;
      const response = await fetchImpl(
        `/api/docker/search?q=${encodeURIComponent(query)}&registry=${encodeURIComponent(registry)}`
      );
      if (!response.ok) {
        return [];
      }
      const data = await response.json() as { results?: SearchResult[] };
      return (data.results || []).map((item) => ({
        ...item,
        registry,
      }));
    }
    default:
      return [];
  }
}

export function createSearchService({
  electronAPI,
  fetchImpl = fetch,
}: SearchServiceDependencies) {
  return {
    async searchSuggestions(context: WizardSearchContext, query: string): Promise<SearchResult[]> {
      if (context.packageType === 'yum' || context.packageType === 'apt' || context.packageType === 'apk') {
        const distribution = getOSDistributionInfo(context.packageType, context);
        if (!distribution || !electronAPI?.os?.search) {
          return [];
        }

        const response = await electronAPI.os.search({
          query,
          distribution: {
            id: distribution.id,
            name: distribution.name,
            osType: distribution.osType,
            packageManager: distribution.packageManager,
          },
          architecture: distribution.architecture,
          matchType: 'partial',
          limit: 20,
        });

        return mapOSPackages((response.packages || []) as OSPackageInfo[]);
      }

      return this.searchPackages(context, query);
    },

    async searchPackages(context: WizardSearchContext, query: string): Promise<SearchResult[]> {
      if (context.packageType === 'yum' || context.packageType === 'apt' || context.packageType === 'apk') {
        const distribution = getOSDistributionInfo(context.packageType, context);
        if (!distribution || !electronAPI?.os?.search) {
          return [];
        }

        const response = await electronAPI.os.search({
          query,
          distribution: {
            id: distribution.id,
            name: distribution.name,
            osType: distribution.osType,
            packageManager: distribution.packageManager,
          },
          architecture: distribution.architecture,
          matchType: 'partial',
          limit: 50,
        });

        return mapOSPackages((response.packages || []) as OSPackageInfo[]);
      }

      const searchOptions = buildSearchOptions(context);

      if (electronAPI?.search?.packages) {
        const response = await electronAPI.search.packages(context.packageType, query, searchOptions);
        return response.results || [];
      }

      return searchViaHttp(fetchImpl, context, query);
    },
  };
}
