import type { DownloadHistory } from '../../types';
import type { OSPackageInfo } from '../../core/downloaders/os-shared/types';
import type { SearchResult } from '../pages/wizard-page/types';
import type { PackageType } from '../stores/cart-store';
import type { QueryFailure } from '../../types/query-error';
import { QueryRequestError } from '../../utils/query-error';
import { requestQueryJson } from './query-http';

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
    ) => Promise<{ results: SearchResult[]; error?: QueryFailure }>;
    versions?: (
      type: string,
      packageName: string,
      options?: RendererSearchOptions
    ) => Promise<{ versions: string[]; error?: QueryFailure }>;
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
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}

export interface HistoryPersistenceClient {
  load: () => Promise<DownloadHistory[]>;
  add: (history: DownloadHistory) => Promise<{ success: boolean }>;
  delete: (id: string) => Promise<{ success: boolean }>;
  clear: () => Promise<{ success: boolean }>;
}

export interface RendererVersionLookupResult {
  versions: string[];
  source: 'electron' | 'http' | 'fallback';
}

export interface RendererDataClient {
  searchPackages: (
    type: PackageType,
    query: string,
    options?: RendererSearchOptions
  ) => Promise<SearchResult[]>;
  searchOSPackages: (request: RendererOSSearchRequest) => Promise<SearchResult[]>;
  getVersionsWithSource: (
    type: PackageType,
    packageName: string,
    options?: RendererSearchOptions,
    fallbackVersions?: string[]
  ) => Promise<RendererVersionLookupResult>;
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

const HISTORY_STORAGE_KEY = 'depssmuggler-history';
const MAX_BROWSER_HISTORIES = 100;

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
      const data = await requestQueryJson(fetchImpl, `/api/pypi/pypi/${encodeURIComponent(query)}/json`);
      if (!isRecord(data.info) || typeof data.info.name !== 'string' || typeof data.info.version !== 'string' || !isRecord(data.releases)) throw new QueryRequestError('INVALID_RESPONSE');

      return [
        {
          name: data.info.name,
          version: data.info.version,
          description: typeof data.info.summary === 'string' ? data.info.summary : '',
          versions: Object.keys(data.releases).sort(compareVersionsDescending).slice(0, 20),
        },
      ];
    }
    case 'maven': {
      const data = await requestQueryJson(fetchImpl, `/api/maven/search?q=${encodeURIComponent(query)}`);
      return readSearchResults(data.results);
    }
    case 'npm': {
      const data = await requestQueryJson(fetchImpl, `/api/npm/search?q=${encodeURIComponent(query)}`);
      return readSearchResults(data.results);
    }
    case 'docker': {
      const registry = options?.registry || 'docker.io';
      const data = await requestQueryJson(fetchImpl,
        `/api/docker/search?q=${encodeURIComponent(query)}&registry=${encodeURIComponent(registry)}`
      );
      return readSearchResults(data.results).map((item) => ({
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
      const data = await requestQueryJson(fetchImpl, `/api/pypi/pypi/${encodeURIComponent(packageName)}/json`);
      if (!isRecord(data.releases)) throw new QueryRequestError('INVALID_RESPONSE');
      return Object.keys(data.releases).sort(compareVersionsDescending);
    }
    case 'maven': {
      const data = await requestQueryJson(fetchImpl,
        `/api/maven/versions?package=${encodeURIComponent(packageName)}`
      );
      const versions = readVersions(data.versions);
      return versions.length > 0 ? versions : fallbackVersions;
    }
    case 'npm': {
      const data = await requestQueryJson(fetchImpl, `/api/npm/${encodeURIComponent(packageName)}`);
      if (!isRecord(data.versions)) throw new QueryRequestError('INVALID_RESPONSE');
      const versions = Object.keys(data.versions).sort(compareVersionsDescending);
      const latest = isRecord(data['dist-tags']) ? data['dist-tags'].latest : undefined;
      if (typeof latest === 'string' && latest) {
        return [
          latest,
          ...versions.filter((version) => version !== latest),
        ];
      }
      return versions.length > 0 ? versions : fallbackVersions;
    }
    case 'docker': {
      const registry = options?.registry || 'docker.io';
      const data = await requestQueryJson(fetchImpl,
        `/api/docker/tags?image=${encodeURIComponent(packageName)}&registry=${encodeURIComponent(registry)}`
      );
      const tags = readVersions(data.tags);
      return tags.length > 0
        ? tags
        : (fallbackVersions.length > 0 ? fallbackVersions : ['latest']);
    }
    default:
      return fallbackVersions;
  }
}

let defaultRendererDataClient: RendererDataClient | null = null;

function getHistoryStorage(
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  if (storage) {
    return storage;
  }

  if (typeof localStorage !== 'undefined') {
    return localStorage;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSearchResults(value: unknown): SearchResult[] {
  if (!Array.isArray(value) || value.some((item) => !isRecord(item) || typeof item.name !== 'string' || typeof item.version !== 'string')) throw new QueryRequestError('INVALID_RESPONSE');
  return value as SearchResult[];
}

function readVersions(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((version) => typeof version !== 'string')) throw new QueryRequestError('INVALID_RESPONSE');
  return value;
}

function normalizeStoredHistories(parsed: unknown): {
  histories: DownloadHistory[];
  requiresMigration: boolean;
} {
  if (Array.isArray(parsed)) {
    return {
      histories: parsed.slice(0, MAX_BROWSER_HISTORIES) as DownloadHistory[],
      requiresMigration: false,
    };
  }

  if (isRecord(parsed) && isRecord(parsed.state) && Array.isArray(parsed.state.histories)) {
    return {
      histories: parsed.state.histories.slice(0, MAX_BROWSER_HISTORIES) as DownloadHistory[],
      requiresMigration: true,
    };
  }

  return {
    histories: [],
    requiresMigration: false,
  };
}

function readStoredHistories(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
): DownloadHistory[] {
  if (!storage) {
    return [];
  }

  try {
    const rawValue = storage.getItem(HISTORY_STORAGE_KEY);
    if (!rawValue) {
      return [];
    }

    const parsed = JSON.parse(rawValue);
    const { histories, requiresMigration } = normalizeStoredHistories(parsed);

    if (requiresMigration) {
      storage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(histories));
    }

    return histories;
  } catch (error) {
    console.error('브라우저 히스토리 로드 실패:', error);
    return [];
  }
}

function writeStoredHistories(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null,
  histories: DownloadHistory[]
): { success: boolean } {
  if (!storage) {
    return { success: false };
  }

  try {
    storage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(histories.slice(0, MAX_BROWSER_HISTORIES)));
    return { success: true };
  } catch (error) {
    console.error('브라우저 히스토리 저장 실패:', error);
    return { success: false };
  }
}

export function createRendererDataClient({
  electronAPI,
  fetchImpl = typeof fetch === 'function' ? fetch : undefined,
  storage,
}: RendererDataClientDependencies = {}): RendererDataClient {
  const electronHistory = electronAPI?.history;
  const hasElectronHistoryClient =
    Boolean(electronHistory?.load)
    && Boolean(electronHistory?.add)
    && Boolean(electronHistory?.delete)
    && Boolean(electronHistory?.clear);
  const historyStorage = getHistoryStorage(storage);
  const history: HistoryPersistenceClient = hasElectronHistoryClient
    ? {
        load: async () => (await electronHistory!.load!()) as DownloadHistory[],
        add: async (entry) => electronHistory!.add!(entry),
        delete: async (id) => electronHistory!.delete!(id),
        clear: async () => electronHistory!.clear!(),
      }
    : {
        load: async () => readStoredHistories(historyStorage),
        add: async (entry) => {
          const updatedHistories = [entry, ...readStoredHistories(historyStorage)];
          return writeStoredHistories(historyStorage, updatedHistories);
        },
        delete: async (id) => {
          const updatedHistories = readStoredHistories(historyStorage).filter(
            (historyEntry) => historyEntry.id !== id
          );
          return writeStoredHistories(historyStorage, updatedHistories);
        },
        clear: async () => {
          if (!historyStorage) {
            return { success: false };
          }

          try {
            historyStorage.removeItem(HISTORY_STORAGE_KEY);
            return { success: true };
          } catch (error) {
            console.error('브라우저 히스토리 삭제 실패:', error);
            return { success: false };
          }
        },
      };

  return {
    async searchPackages(type, query, options) {
      if (electronAPI?.search?.packages) {
        const response = await electronAPI.search.packages(type, query, options);
        if (response.error) throw new QueryRequestError(response.error.code, response.error.status);
        return readSearchResults(response.results);
      }

      if (!fetchImpl) {
        throw new QueryRequestError('UNAVAILABLE');
      }

      return searchViaHttp(fetchImpl, type, query, options);
    },

    async searchOSPackages(request) {
      if (!electronAPI?.os?.search) {
        throw new QueryRequestError('UNAVAILABLE');
      }

      const response = await electronAPI.os.search(request);
      return mapOSPackages((response.packages || []) as OSPackageInfo[]);
    },

    async getVersions(type, packageName, options, fallbackVersions) {
      const result = await this.getVersionsWithSource(type, packageName, options, fallbackVersions);
      return result.versions;
    },

    async getVersionsWithSource(type, packageName, options, fallbackVersions) {
      if (electronAPI?.search?.versions) {
        const response = await electronAPI.search.versions(type, packageName, options);
        if (response.error) throw new QueryRequestError(response.error.code, response.error.status);
        const versions = readVersions(response.versions);
        return {
          versions:
            versions.length > 0
              ? versions
              : (fallbackVersions || []),
          source: 'electron',
        };
      }

      if (!fetchImpl) {
        throw new QueryRequestError('UNAVAILABLE');
      }

      return {
        versions: await getVersionsViaHttp(fetchImpl, type, packageName, options, fallbackVersions),
        source: 'http',
      };
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
