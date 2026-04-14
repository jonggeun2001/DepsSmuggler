import { createScopedLogger } from '../utils/logger';
import { createSearchPackageRouter, type SearchPackageRouter } from './search-package-router';
import {
  getAvailableClassifiersAsync,
  isNativeArtifactFromApi,
} from '../../src/core/shared/maven-utils';

const log = createScopedLogger('SearchOrchestrator');

export interface SearchOrchestratorDeps {
  packageRouter?: SearchPackageRouter;
  mavenArtifactService?: {
    isNativeArtifact(
      groupId: string,
      artifactId: string,
      version?: string
    ): Promise<boolean>;
    getAvailableClassifiers(
      groupId: string,
      artifactId: string,
      version?: string
    ): Promise<string[]>;
  };
}

export function createSearchOrchestrator(deps: SearchOrchestratorDeps = {}) {
  const packageRouter = deps.packageRouter ?? createSearchPackageRouter();
  const mavenArtifactService = deps.mavenArtifactService ?? {
    isNativeArtifact: isNativeArtifactFromApi,
    getAvailableClassifiers: getAvailableClassifiersAsync,
  };

  return {
    async prime(): Promise<void> {
      await packageRouter.prime();
    },

    async searchPackages(
      type: string,
      query: string,
      options?: { channel?: string; registry?: string; indexUrl?: string }
    ): Promise<{ results: Awaited<ReturnType<SearchPackageRouter['searchPackages']>> }> {
      log.debug(`Searching ${type} packages: ${query}`, options);
      try {
        return { results: await packageRouter.searchPackages(type, query, options) };
      } catch (error) {
        log.error(`Search error for ${type}:`, error);
        return { results: [] };
      }
    },

    async getVersions(
      type: string,
      packageName: string,
      options?: { channel?: string; registry?: string; indexUrl?: string }
    ): Promise<{ versions: string[] }> {
      log.debug(`Getting versions for ${type} package: ${packageName}`, options);
      try {
        return { versions: await packageRouter.getVersions(type, packageName, options) };
      } catch (error) {
        log.error(`Version fetch error for ${type}/${packageName}:`, error);
        return { versions: [] };
      }
    },

    async suggest(
      type: string,
      query: string,
      options?: { channel?: string }
    ): Promise<string[]> {
      return packageRouter.suggest(type, query, options);
    },

    async isNativeArtifact(
      groupId: string,
      artifactId: string,
      version?: string
    ): Promise<boolean> {
      return mavenArtifactService.isNativeArtifact(groupId, artifactId, version);
    },

    async getAvailableClassifiers(
      groupId: string,
      artifactId: string,
      version?: string
    ): Promise<string[]> {
      return mavenArtifactService.getAvailableClassifiers(groupId, artifactId, version);
    },
  };
}
