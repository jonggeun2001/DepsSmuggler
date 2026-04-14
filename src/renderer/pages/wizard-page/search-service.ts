import type { PackageType } from '../../stores/cart-store';
import type {
  CondaChannel,
  DockerRegistry,
  OSDistributionSetting,
} from '../../stores/settings-store';
import {
  createRendererDataClient,
  type RendererDataClient,
  type RendererDataClientDependencies,
} from '../../lib/renderer-data-client';
import { getOSDistributionInfo } from './os-context';
import type { SearchResult } from './types';

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

interface SearchServiceDependencies extends RendererDataClientDependencies {
  client?: RendererDataClient;
}

function buildSearchOptions(
  context: WizardSearchContext
): { channel?: string; registry?: string; indexUrl?: string } | undefined {
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

export function createSearchService({
  client,
  electronAPI,
  fetchImpl = typeof fetch === 'function' ? fetch : undefined,
}: SearchServiceDependencies) {
  const rendererDataClient = client ?? createRendererDataClient({ electronAPI, fetchImpl });

  return {
    async searchSuggestions(context: WizardSearchContext, query: string): Promise<SearchResult[]> {
      if (context.packageType === 'yum' || context.packageType === 'apt' || context.packageType === 'apk') {
        const distribution = getOSDistributionInfo(context.packageType, context);
        if (!distribution) {
          return [];
        }

        return rendererDataClient.searchOSPackages({
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
      }

      return this.searchPackages(context, query);
    },

    async searchPackages(context: WizardSearchContext, query: string): Promise<SearchResult[]> {
      if (context.packageType === 'yum' || context.packageType === 'apt' || context.packageType === 'apk') {
        const distribution = getOSDistributionInfo(context.packageType, context);
        if (!distribution) {
          return [];
        }

        return rendererDataClient.searchOSPackages({
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
      }

      return rendererDataClient.searchPackages(
        context.packageType,
        query,
        buildSearchOptions(context)
      );
    },
  };
}
