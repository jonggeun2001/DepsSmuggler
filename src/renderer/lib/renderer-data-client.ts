import type { DownloadHistory } from '../../types';
import type { OSPackageInfo } from '../../core/downloaders/os-shared/types';
import type { SearchResult } from '../pages/wizard-page/types';
import type { PackageType } from '../stores/cart-store';

export interface RendererSearchOptions {
  channel?: string;
  registry?: string;
  indexUrl?: string;
}

export interface RendererOSSearchDistribution {
  id: string;
  name: string;
  osType: string;
  packageManager: string;
}

export interface RendererOSSearchRequest {
  query: string;
  distribution: RendererOSSearchDistribution;
  architecture: string;
  matchType?: string;
  limit?: number;
}

interface RendererDataClientElectronAPI {
  search?: {
    packages?: (
      type: string,
      query: string,
      options?: RendererSearchOptions
    ) => Promise<{ results: SearchResult[] }>;
    versions?: (
      type: string,
      packageName: string,
      options?: RendererSearchOptions
    ) => Promise<{ versions: string[] }>;
  };
  os?: {
    search?: (options: RendererOSSearchRequest) => Promise<{ packages: unknown[]; totalCount: number }>;
  };
  maven?: {
    isNativeArtifact?: (groupId: string, artifactId: string, version?: string) => Promise<boolean>;
    getAvailableClassifiers?: (
      groupId: string,
      artifactId: string,
      version?: string
    ) => Promise<string[]>;
  };
  history?: {
    load?: () => Promise<unknown[]>;
    add?: (history: unknown) => Promise<{ success: boolean }>;
    delete?: (id: string) => Promise<{ success: boolean }>;
    clear?: () => Promise<{ success: boolean }>;
  };
}

export interface RendererDataClientDependencies {
  electronAPI?: RendererDataClientElectronAPI;
  fetchImpl?: typeof fetch;
}

export interface HistoryPersistenceClient {
  load: () => Promise<DownloadHistory[]>;
  add: (history: DownloadHistory) => Promise<{ success: boolean }>;
  delete: (id: string) => Promise<{ success: boolean }>;
  clear: () => Promise<{ success: boolean }>;
}

export interface RendererDataClient {
  searchPackages: (
    type: PackageType,
    query: string,
    options?: RendererSearchOptions
  ) => Promise<SearchResult[]>;
  searchOSPackages: (request: RendererOSSearchRequest) => Promise<SearchResult[]>;
  getVersions: (
    type: PackageType,
    packageName: string,
    options?: RendererSearchOptions,
    fallbackVersions?: string[]
  ) => Promise<string[]>;
  getLatestVersion: (
    type: PackageType,
    packageName: string,
    options?: RendererSearchOptions
  ) => Promise<string | null>;
  isNativeMavenArtifact: (groupId: string, artifactId: string, version?: string) => Promise<boolean>;
  getAvailableMavenClassifiers: (
    groupId: string,
    artifactId: string,
    version?: string
  ) => Promise<string[]>;
  history: HistoryPersistenceClient;
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

  return right.localeCompare(left);
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
  type: PackageType,
  query: string,
  options?: RendererSearchOptions
): Promise<SearchResult[]> {
  switch (type) {
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
      const registry = options?.registry || 'docker.io';
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

async function getVersionsViaHttp(
  fetchImpl: typeof fetch,
  type: PackageType,
  packageName: string,
  options?: RendererSearchOptions,
  fallbackVersions: string[] = []
): Promise<string[]> {
  switch (type) {
    case 'pip':
    case 'conda': {
      const response = await fetchImpl(`/api/pypi/pypi/${encodeURIComponent(packageName)}/json`);
      if (!response.ok) {
        return fallbackVersions;
      }
      const data = await response.json() as { releases: Record<string, unknown> };
      return Object.keys(data.releases).sort(compareVersionsDescending);
    }
    case 'maven': {
      const response = await fetchImpl(
        `/api/maven/versions?package=${encodeURIComponent(packageName)}`
      );
      if (!response.ok) {
        return fallbackVersions;
      }
      const data = await response.json() as { versions?: string[] };
      return data.versions && data.versions.length > 0 ? data.versions : fallbackVersions;
    }
    case 'npm': {
      const response = await fetchImpl(`/api/npm/${encodeURIComponent(packageName)}`);
      if (!response.ok) {
        return fallbackVersions;
      }
      const data = await response.json() as {
        versions?: Record<string, unknown>;
        'dist-tags'?: Record<string, string>;
      };
      const versions = Object.keys(data.versions || {}).sort(compareVersionsDescending);
      if (data['dist-tags']?.latest) {
        return [
          data['dist-tags'].latest,
          ...versions.filter((version) => version !== data['dist-tags']?.latest),
        ];
      }
      return versions.length > 0 ? versions : fallbackVersions;
    }
    case 'docker': {
      const registry = options?.registry || 'docker.io';
      const response = await fetchImpl(
        `/api/docker/tags?image=${encodeURIComponent(packageName)}&registry=${encodeURIComponent(registry)}`
      );
      if (!response.ok) {
        return fallbackVersions.length > 0 ? fallbackVersions : ['latest'];
      }
      const data = await response.json() as { tags?: string[] };
      return data.tags && data.tags.length > 0
        ? data.tags
        : (fallbackVersions.length > 0 ? fallbackVersions : ['latest']);
    }
    default:
      return fallbackVersions;
  }
}

let defaultRendererDataClient: RendererDataClient | null = null;

export function createRendererDataClient({
  electronAPI,
  fetchImpl = typeof fetch === 'function' ? fetch : undefined,
}: RendererDataClientDependencies = {}): RendererDataClient {
  const history: HistoryPersistenceClient = {
    load: async () => {
      if (!electronAPI?.history?.load) {
        return [];
      }
      return (await electronAPI.history.load()) as DownloadHistory[];
    },
    add: async (entry) => {
      if (!electronAPI?.history?.add) {
        return { success: false };
      }
      return electronAPI.history.add(entry);
    },
    delete: async (id) => {
      if (!electronAPI?.history?.delete) {
        return { success: false };
      }
      return electronAPI.history.delete(id);
    },
    clear: async () => {
      if (!electronAPI?.history?.clear) {
        return { success: false };
      }
      return electronAPI.history.clear();
    },
  };

  return {
    async searchPackages(type, query, options) {
      if (electronAPI?.search?.packages) {
        const response = await electronAPI.search.packages(type, query, options);
        return response.results || [];
      }

      if (!fetchImpl) {
        return [];
      }

      return searchViaHttp(fetchImpl, type, query, options);
    },

    async searchOSPackages(request) {
      if (!electronAPI?.os?.search) {
        return [];
      }

      const response = await electronAPI.os.search(request);
      return mapOSPackages((response.packages || []) as OSPackageInfo[]);
    },

    async getVersions(type, packageName, options, fallbackVersions) {
      if (electronAPI?.search?.versions) {
        const response = await electronAPI.search.versions(type, packageName, options);
        if (response.versions && response.versions.length > 0) {
          return response.versions;
        }
      }

      if (!fetchImpl) {
        return fallbackVersions || [];
      }

      return getVersionsViaHttp(fetchImpl, type, packageName, options, fallbackVersions);
    },

    async getLatestVersion(type, packageName, options) {
      const versions = await this.getVersions(type, packageName, options);
      return versions[0] || null;
    },

    async isNativeMavenArtifact(groupId, artifactId, version) {
      if (!electronAPI?.maven?.isNativeArtifact) {
        return false;
      }
      return electronAPI.maven.isNativeArtifact(groupId, artifactId, version);
    },

    async getAvailableMavenClassifiers(groupId, artifactId, version) {
      if (!electronAPI?.maven?.getAvailableClassifiers) {
        return [];
      }
      return electronAPI.maven.getAvailableClassifiers(groupId, artifactId, version);
    },

    history,
  };
}

export function getRendererDataClient(): RendererDataClient {
  if (!defaultRendererDataClient) {
    defaultRendererDataClient = createRendererDataClient({
      electronAPI: typeof window !== 'undefined' ? window.electronAPI : undefined,
      fetchImpl: typeof fetch === 'function' ? fetch : undefined,
    });
  }

  return defaultRendererDataClient;
}
