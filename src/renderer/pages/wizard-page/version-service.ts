import type { SearchResult } from './types';
import type { WizardSearchContext } from './search-service';
import {
  createRendererDataClient,
  type RendererDataClient,
  type RendererDataClientDependencies,
} from '../../lib/renderer-data-client';

interface VersionServiceDependencies extends RendererDataClientDependencies {
  client?: RendererDataClient;
}

export interface VersionDetails {
  versions: string[];
  selectedVersion: string;
  usedIndexUrl?: string;
  isNativeLibrary: boolean;
  availableClassifiers: string[];
}

function buildVersionOptions(
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

async function loadMavenClassifierDetails(
  client: RendererDataClient,
  record: SearchResult
): Promise<Pick<VersionDetails, 'isNativeLibrary' | 'availableClassifiers'>> {
  const groupId = record.groupId || record.name.split(':')[0];
  const artifactId = record.artifactId || record.name.split(':')[1] || record.name;
  const isNativeLibrary = await client.isNativeMavenArtifact(groupId, artifactId, record.version);

  return {
    isNativeLibrary,
    availableClassifiers: isNativeLibrary
      ? await client.getAvailableMavenClassifiers(groupId, artifactId, record.version)
      : [],
  };
}

export function createVersionService({
  client,
  electronAPI,
  fetchImpl = typeof fetch === 'function' ? fetch : undefined,
}: VersionServiceDependencies) {
  const rendererDataClient = client ?? createRendererDataClient({ electronAPI, fetchImpl });

  return {
    async loadVersionDetails(
      context: WizardSearchContext,
      record: SearchResult
    ): Promise<VersionDetails> {
      if (context.packageType === 'yum' || context.packageType === 'apt' || context.packageType === 'apk') {
        const versions = record.versions && record.versions.length > 0
          ? record.versions
          : [record.version];

        return {
          versions,
          selectedVersion: versions[0],
          usedIndexUrl: undefined,
          isNativeLibrary: false,
          availableClassifiers: [],
        };
      }

      const versionOptions = buildVersionOptions(context);
      const versionLookup = await rendererDataClient.getVersionsWithSource(
        context.packageType,
        record.name,
        versionOptions,
        record.versions || [record.version]
      );
      const versions = versionLookup.versions;

      const selectedVersion = context.packageType === 'docker' && versions.includes('latest')
        ? 'latest'
        : versions[0] || record.version;

      const mavenDetails = context.packageType === 'maven'
        ? await loadMavenClassifierDetails(rendererDataClient, record)
        : {
            isNativeLibrary: false,
            availableClassifiers: [],
          };

      return {
        versions,
        selectedVersion,
        usedIndexUrl:
          versionLookup.source === 'electron' &&
          context.packageType === 'pip' &&
          versionOptions?.indexUrl
            ? versionOptions.indexUrl
            : undefined,
        ...mavenDetails,
      };
    },
  };
}
