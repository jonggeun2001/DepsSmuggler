import axios from 'axios';
import { createScopedLogger } from '../utils/logger';
import { sortByRelevance } from '../../src/core/shared';
import {
  getPipDownloader,
  getCondaDownloader,
  getMavenDownloader,
  getDockerDownloader,
  getNpmDownloader,
} from '../../src/core';

const log = createScopedLogger('SearchPackageRouter');
const SEARCH_TIMEOUT = 5000;
const CACHE_TTL = 60000;

export interface SearchPackageResult {
  name: string;
  version: string;
  description: string;
  registry?: string;
  [key: string]: unknown;
}

export interface SearchPackageRouter {
  prime(): Promise<void>;
  searchPackages(
    type: string,
    query: string,
    options?: { channel?: string; registry?: string; indexUrl?: string }
  ): Promise<SearchPackageResult[]>;
  getVersions(
    type: string,
    packageName: string,
    options?: { channel?: string; registry?: string; indexUrl?: string }
  ): Promise<string[]>;
  suggest(
    type: string,
    query: string,
    options?: { channel?: string }
  ): Promise<string[]>;
}

export function createSearchPackageRouter(): SearchPackageRouter {
  let pypiPackageCache: string[] = [];
  let pypiCacheLoading = false;
  let pypiCacheLoaded = false;
  const suggestionCache = new Map<string, { results: string[]; timestamp: number }>();

  return {
    async prime() {
      if (pypiCacheLoaded || pypiCacheLoading) {
        return;
      }

      pypiCacheLoading = true;
      try {
        const response = await axios.get('https://pypi.org/simple/', {
          timeout: 30000,
          headers: {
            Accept: 'text/html',
            'User-Agent': 'DepsSmuggler/1.0',
          },
        });

        const html = response.data as string;
        const packageRegex = /<a[^>]*>([^<]+)<\/a>/g;
        let match: RegExpExecArray | null;
        while ((match = packageRegex.exec(html)) !== null) {
          pypiPackageCache.push(match[1].toLowerCase());
        }
        pypiCacheLoaded = true;
      } catch (error) {
        log.error('Failed to load PyPI package list:', error);
      } finally {
        pypiCacheLoading = false;
      }
    },

    async searchPackages(type, query, options) {
      switch (type) {
        case 'pip':
          return sortByRelevance(await searchPyPI(query, options?.indexUrl), query, 'pip');
        case 'conda': {
          const channel = normalizeCondaChannel(options?.channel);
          const condaResults = await getCondaDownloader().searchPackages(query, channel);
          return sortByRelevance(
            condaResults.map((pkg) => ({
              name: pkg.name,
              version: pkg.version,
              description: pkg.metadata?.description || '',
            })),
            query,
            'conda'
          );
        }
        case 'maven':
          return sortByRelevance(await searchMaven(query), query, 'maven');
        case 'npm': {
          const npmResults = await getNpmDownloader().searchPackages(query);
          return sortByRelevance(
            npmResults.map((pkg) => ({
              name: pkg.name,
              version: pkg.version,
              description: pkg.metadata?.description || '',
            })),
            query,
            'npm'
          );
        }
        case 'docker': {
          const dockerRegistry = options?.registry || 'docker.io';
          const dockerResults = await getDockerDownloader().searchPackages(query, dockerRegistry);
          return dockerResults.map((pkg) => ({
            name: pkg.name,
            version: pkg.version || 'latest',
            description: pkg.metadata?.description || '',
            registry: dockerRegistry,
          }));
        }
        default:
          return [];
      }
    },

    async getVersions(type, packageName, options) {
      switch (type) {
        case 'pip':
          return getPyPIVersions(packageName, options?.indexUrl);
        case 'conda':
          return getCondaDownloader().getVersions(
            packageName,
            normalizeCondaChannel(options?.channel)
          );
        case 'maven':
          return getMavenVersions(packageName);
        case 'npm':
          return getNpmDownloader().getVersions(packageName);
        case 'docker':
          return getDockerDownloader().getVersions(
            packageName,
            options?.registry || 'docker.io'
          );
        default:
          return [];
      }
    },

    async suggest(type, query, options) {
      if (!query || query.trim().length < 2) {
        return [];
      }

      const channelKey = type === 'conda' ? `:${options?.channel || 'conda-forge'}` : '';
      const cacheKey = `${type}${channelKey}:${query.toLowerCase()}`;
      const cached = suggestionCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.results;
      }

      try {
        let searchPromise: Promise<{ name: string }[]>;
        switch (type) {
          case 'pip':
            searchPromise = getPipDownloader().searchPackages(query);
            break;
          case 'conda':
            searchPromise = getCondaDownloader().searchPackages(
              query,
              normalizeCondaChannel(options?.channel)
            );
            break;
          case 'maven':
            searchPromise = getMavenDownloader().searchPackages(query);
            break;
          case 'docker':
            searchPromise = getDockerDownloader().searchPackages(query);
            break;
          case 'npm':
            searchPromise = getNpmDownloader().searchPackages(query);
            break;
          case 'yum':
          case 'apt':
          case 'apk':
            return [];
          default:
            return [];
        }

        const timeoutPromise = new Promise<{ name: string }[]>((_, reject) => {
          setTimeout(() => reject(new Error('Search timeout')), SEARCH_TIMEOUT);
        });

        const results = await Promise.race([searchPromise, timeoutPromise]);
        const suggestions = results
          .map((pkg) => pkg.name)
          .filter((name, index, arr) => arr.indexOf(name) === index)
          .slice(0, 10);
        suggestionCache.set(cacheKey, { results: suggestions, timestamp: Date.now() });
        return suggestions;
      } catch (error) {
        if (error instanceof Error && error.message === 'Search timeout') {
          log.warn(`Search timeout for ${type}: ${query}`);
          return [];
        }
        log.error(`Package suggestion failed for ${type}:`, error);
        return [];
      }
    },
  };

  async function searchPyPI(query: string, indexUrl?: string): Promise<SearchPackageResult[]> {
    const results: SearchPackageResult[] = [];
    const lowerQuery = query.toLowerCase();

    if (indexUrl) {
      const indexResults = await getPipDownloader().searchPackages(query, indexUrl);
      return indexResults.map((pkg) => ({
        name: pkg.name,
        version: pkg.version,
        description: pkg.metadata?.description || `커스텀 인덱스: ${new URL(indexUrl).hostname}`,
      }));
    }

    if (pypiCacheLoaded && pypiPackageCache.length > 0) {
      const matchedPackages = pypiPackageCache
        .filter((pkg) => pkg.startsWith(lowerQuery))
        .slice(0, 20);
      const detailPromises = matchedPackages.map(async (packageName) => {
        try {
          const response = await axios.get(`https://pypi.org/pypi/${packageName}/json`, {
            timeout: 5000,
          });
          return {
            name: response.data.info.name,
            version: response.data.info.version,
            description: response.data.info.summary || '',
          };
        } catch {
          return null;
        }
      });
      const details = await Promise.all(detailPromises);
      results.push(...details.filter((value): value is SearchPackageResult => value !== null));
    }

    if (results.length === 0) {
      try {
        const exactResponse = await axios.get(`https://pypi.org/pypi/${query}/json`, {
          timeout: 10000,
        });
        results.push({
          name: exactResponse.data.info.name,
          version: exactResponse.data.info.version,
          description: exactResponse.data.info.summary || '',
        });
      } catch {
        return results;
      }
    }

    return results;
  }

  async function getPyPIVersions(packageName: string, indexUrl?: string): Promise<string[]> {
    if (indexUrl) {
      return getPipDownloader().getVersions(packageName, indexUrl);
    }

    const response = await axios.get(`https://pypi.org/pypi/${packageName}/json`, {
      timeout: 10000,
    });
    return Object.keys(response.data.releases).sort((a, b) => compareVersions(b, a));
  }
}

function compareVersions(a: string, b: string): number {
  const partsA = a.split(/[.-]/);
  const partsB = b.split(/[.-]/);
  const maxLength = Math.max(partsA.length, partsB.length);
  for (let index = 0; index < maxLength; index += 1) {
    const partA = partsA[index] || '0';
    const partB = partsB[index] || '0';
    const numberA = parseInt(partA, 10);
    const numberB = parseInt(partB, 10);
    if (!Number.isNaN(numberA) && !Number.isNaN(numberB)) {
      if (numberA !== numberB) {
        return numberA - numberB;
      }
      continue;
    }

    const compared = partA.localeCompare(partB);
    if (compared !== 0) {
      return compared;
    }
  }

  return 0;
}

async function searchMaven(query: string): Promise<SearchPackageResult[]> {
  try {
    const results = await getMavenDownloader().searchPackages(query);
    return results.map((pkg) => {
      const [groupId = '', artifactId = pkg.name] = pkg.name.split(':');
      return {
        name: pkg.name,
        version: pkg.version,
        description: `Maven artifact: ${pkg.name}`,
        popularityCount: pkg.metadata?.popularityCount,
        groupId,
        artifactId,
      };
    });
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
        : 'Maven 검색 중 알 수 없는 오류가 발생했습니다.'
    );
  }
}

async function getMavenVersions(packageName: string): Promise<string[]> {
  const [groupId, artifactId] = packageName.split(':');

  try {
    return await getMavenVersionsFromMetadata(groupId, artifactId);
  } catch (metadataError) {
    log.warn('maven-metadata.xml 조회 실패, 폴백 API 사용:', metadataError);
    return getMavenVersionsFromSearchApi(groupId, artifactId);
  }
}

async function getMavenVersionsFromMetadata(
  groupId: string,
  artifactId: string
): Promise<string[]> {
  const groupPath = groupId.replace(/\./g, '/');
  const response = await axios.get(
    `https://repo1.maven.org/maven2/${groupPath}/${artifactId}/maven-metadata.xml`,
    {
      responseType: 'text',
      timeout: 10000,
    }
  );
  const versions: string[] = [];
  const versionRegex = /<version>([^<]+)<\/version>/g;
  let match: RegExpExecArray | null;
  while ((match = versionRegex.exec(response.data)) !== null) {
    versions.push(match[1]);
  }
  return versions.sort((a: string, b: string) => compareVersions(b, a));
}

async function getMavenVersionsFromSearchApi(
  groupId: string,
  artifactId: string
): Promise<string[]> {
  const response = await axios.get('https://search.maven.org/solrsearch/select', {
    params: {
      q: `g:"${groupId}" AND a:"${artifactId}"`,
      core: 'gav',
      rows: 100,
      wt: 'json',
    },
    timeout: 10000,
  });
  const versions = response.data.response.docs.map((doc: { v: string }) => doc.v);
  return versions.sort((a: string, b: string) => compareVersions(b, a));
}

function normalizeCondaChannel(
  channel?: string
): 'conda-forge' | 'anaconda' | 'bioconda' | 'pytorch' | 'all' {
  return (channel || 'conda-forge') as
    | 'conda-forge'
    | 'anaconda'
    | 'bioconda'
    | 'pytorch'
    | 'all';
}
