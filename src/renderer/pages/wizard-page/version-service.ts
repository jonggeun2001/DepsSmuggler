import type { SearchResult } from './types';
import type { WizardSearchContext } from './search-service';

interface VersionServiceElectronAPI {
  search?: {
    versions?: (
      type: string,
      packageName: string,
      options?: { channel?: string; registry?: string; indexUrl?: string }
    ) => Promise<{ versions: string[] }>;
  };
  maven?: {
    isNativeArtifact?: (groupId: string, artifactId: string, version?: string) => Promise<boolean>;
    getAvailableClassifiers?: (
      groupId: string,
      artifactId: string,
      version?: string
    ) => Promise<string[]>;
  };
}

interface VersionServiceDependencies {
  electronAPI?: VersionServiceElectronAPI;
  fetchImpl?: typeof fetch;
}

export interface VersionDetails {
  versions: string[];
  selectedVersion: string;
  usedIndexUrl?: string;
  isNativeLibrary: boolean;
  availableClassifiers: string[];
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

async function loadVersionsViaHttp(
  fetchImpl: typeof fetch,
  context: WizardSearchContext,
  record: SearchResult
): Promise<string[]> {
  switch (context.packageType) {
    case 'pip':
    case 'conda': {
      const response = await fetchImpl(`/api/pypi/pypi/${encodeURIComponent(record.name)}/json`);
      if (!response.ok) {
        return record.versions || [record.version];
      }
      const data = await response.json() as { releases: Record<string, unknown> };
      return Object.keys(data.releases).sort(compareVersionsDescending);
    }
    case 'maven': {
      const response = await fetchImpl(
        `/api/maven/versions?package=${encodeURIComponent(record.name)}`
      );
      if (!response.ok) {
        return record.versions || [record.version];
      }
      const data = await response.json() as { versions?: string[] };
      return data.versions && data.versions.length > 0 ? data.versions : record.versions || [record.version];
    }
    case 'docker': {
      const registry =
        context.dockerRegistry === 'custom' && context.customRegistryUrl
          ? context.customRegistryUrl
          : context.dockerRegistry;
      const response = await fetchImpl(
        `/api/docker/tags?image=${encodeURIComponent(record.name)}&registry=${encodeURIComponent(registry)}`
      );
      if (!response.ok) {
        return ['latest'];
      }
      const data = await response.json() as { tags?: string[] };
      return data.tags && data.tags.length > 0 ? data.tags : ['latest'];
    }
    default:
      return record.versions || [record.version];
  }
}

async function loadMavenClassifierDetails(
  electronAPI: VersionServiceElectronAPI | undefined,
  record: SearchResult
): Promise<Pick<VersionDetails, 'isNativeLibrary' | 'availableClassifiers'>> {
  if (!electronAPI?.maven?.isNativeArtifact || !electronAPI.maven.getAvailableClassifiers) {
    return {
      isNativeLibrary: false,
      availableClassifiers: [],
    };
  }

  const groupId = record.groupId || record.name.split(':')[0];
  const artifactId = record.artifactId || record.name.split(':')[1] || record.name;
  const isNativeLibrary = await electronAPI.maven.isNativeArtifact(groupId, artifactId, record.version);

  return {
    isNativeLibrary,
    availableClassifiers: isNativeLibrary
      ? await electronAPI.maven.getAvailableClassifiers(groupId, artifactId, record.version)
      : [],
  };
}

export function createVersionService({
  electronAPI,
  fetchImpl = fetch,
}: VersionServiceDependencies) {
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
      let versions: string[];
      const electronVersionLookup = electronAPI?.search?.versions;
      const usedElectronVersionLookup = Boolean(electronVersionLookup);

      if (electronVersionLookup) {
        const response = await electronVersionLookup(
          context.packageType,
          record.name,
          versionOptions
        );
        versions = response.versions && response.versions.length > 0
          ? response.versions
          : record.versions || [record.version];
      } else {
        versions = await loadVersionsViaHttp(fetchImpl, context, record);
      }

      const selectedVersion = context.packageType === 'docker' && versions.includes('latest')
        ? 'latest'
        : versions[0] || record.version;

      const mavenDetails = context.packageType === 'maven'
        ? await loadMavenClassifierDetails(electronAPI, record)
        : {
            isNativeLibrary: false,
            availableClassifiers: [],
          };

      return {
        versions,
        selectedVersion,
        usedIndexUrl:
          usedElectronVersionLookup &&
          context.packageType === 'pip' &&
          versionOptions?.indexUrl
            ? versionOptions.indexUrl
            : undefined,
        ...mavenDetails,
      };
    },
  };
}
