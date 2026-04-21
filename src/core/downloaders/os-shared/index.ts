/**
 * OS Package Shared Utilities
 * OS 패키지 다운로더들이 공유하는 유틸리티 모듈
 */

// Base classes
export { BaseOSDownloader } from './base-downloader';
export type { BaseDownloaderOptions, OSPackageDownloadResult } from './base-downloader';
export { BaseOSDependencyResolver } from './base-resolver';
export type { DependencyResolverOptions, PackageMetadataCache } from './base-resolver';

// Types
export * from './types';

// Utilities
export { OsPackageCache, OSCacheManager } from './cache-manager';
export { GPGVerifier } from './gpg-verifier';
export { OSScriptGenerator } from './script-generator';
export type { GeneratedScripts, ScriptGeneratorOptions } from './script-generator';
export { OSDependencyTree } from './dependency-tree';
export type { DependencyNode, DependencyEdge, MissingDependency, VersionConflict, VisualizationData } from './dependency-tree';

// Packagers
export { OSArchivePackager } from './archive-packager';
export type { ArchiveOptions } from './archive-packager';
export { OSRepoPackager } from './repo-packager';
export type { RepoOptions, RepoResult } from './repo-packager';

// Repositories - re-export from repositories.ts which re-exports from ./repos
export * from './repositories';
// Distribution fetcher functions
export { convertToOSDistributions, invalidateDistributionCache } from './distribution-fetcher';
export type { DistributionVersion, DistributionFamily } from './distribution-fetcher';
