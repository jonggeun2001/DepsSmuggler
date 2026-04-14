/**
 * 패키지 검색 및 의존성 해결 관련 IPC 핸들러
 */

import { ipcMain } from 'electron';
import { createScopedLogger } from './utils/logger';
import { createSearchOrchestrator } from './services/search-orchestrator';
import { createDependencyResolveService } from './services/dependency-resolve-service';
import { createOSSearchService } from './services/os-search-service';

const log = createScopedLogger('Search');

export function registerSearchHandlers(): void {
  const searchOrchestrator = createSearchOrchestrator();
  const dependencyResolveService = createDependencyResolveService();
  const osSearchService = createOSSearchService();

  void searchOrchestrator.prime();

  ipcMain.handle('search:packages', async (_event, type: string, query: string, options) => {
    return searchOrchestrator.searchPackages(type, query, options);
  });

  ipcMain.handle('search:versions', async (_event, type: string, packageName: string, options) => {
    return searchOrchestrator.getVersions(type, packageName, options);
  });

  ipcMain.handle('search:suggest', async (_event, type: string, query: string, options) => {
    return searchOrchestrator.suggest(type, query, options);
  });

  ipcMain.handle('dependency:resolve', async (event, data) => {
    return dependencyResolveService.resolveDependencies(
      data.packages,
      data.options,
      event.sender
    );
  });

  ipcMain.handle('os:getDistributions', async (_event, osType) => {
    return osSearchService.getDistributions(osType);
  });

  ipcMain.handle('os:getAllDistributions', async (_event, options) => {
    return osSearchService.getAllDistributions(options);
  });

  ipcMain.handle('os:getDistribution', async (_event, distributionId: string) => {
    return osSearchService.getDistribution(distributionId);
  });

  ipcMain.handle('os:search', async (_event, options) => {
    return osSearchService.searchPackages(options);
  });

  ipcMain.handle(
    'maven:isNativeArtifact',
    async (_event, groupId: string, artifactId: string, version?: string) => {
      return searchOrchestrator.isNativeArtifact(groupId, artifactId, version);
    }
  );

  ipcMain.handle(
    'maven:getAvailableClassifiers',
    async (_event, groupId: string, artifactId: string, version?: string) => {
      return searchOrchestrator.getAvailableClassifiers(groupId, artifactId, version);
    }
  );

  log.info('검색 핸들러 등록 완료');
}
