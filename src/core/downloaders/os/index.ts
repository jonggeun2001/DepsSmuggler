/**
 * OS Package Downloader Module
 * OS 패키지(yum/rpm, apt/deb, apk) 다운로드 모듈
 */

// Types
export type {
  OSPackageManager,
  OSArchitecture,
  ChecksumType,
  VersionOperator,
  OSErrorAction,
  OutputType,
  ArchiveFormat,
  ScriptType,
  MatchType,
  CacheMode,
  Repository,
  OSDistribution,
  PackageDependency,
  Checksum,
  OSPackageInfo,
  OSPackageSearchOptions,
  OSPackageSearchResult,
  OSDownloadProgress,
  OSDownloadError,
  OSPackageDownloadOptions,
  OSPackageOutputOptions,
  DependencyResolutionResult,
  MetadataParser,
  DependencyResolver,
  CacheManager,
  GPGVerifier as IGPGVerifier,
  ScriptGenerator,
  OutputPackager,
  OSPackageDownloader as IOSPackageDownloader,
  UseCaseRecommendation,
} from './types';

// Repository Presets
export {
  OS_DISTRIBUTIONS,
  USE_CASE_RECOMMENDATIONS,
  getDistributionById,
  getDistributionsByPackageManager,
  getRecommendedDistributions,
  normalizeArchitecture,
  isArchitectureCompatible,
  resolveRepoUrl,
  createCustomRepository,
} from './repositories';

// Dependency Tree
export { OSDependencyTree } from './dependency-tree';
export type {
  DependencyNode,
  DependencyEdge,
  MissingDependency,
  VersionConflict,
  VisualizationData,
} from './dependency-tree';

// Base Classes
export { BaseOSDependencyResolver } from './base-resolver';
export type { DependencyResolverOptions, PackageMetadataCache } from './base-resolver';
export { BaseOSDownloader } from './base-downloader';
export type { DownloadResult, BaseDownloaderOptions } from './base-downloader';

// Downloaders
export { OSPackageDownloader } from './downloader';
export type {
  OSDownloaderOptions,
  OSPackageSearchResponse as SearchResult,
  OSPackageDownloadResult,
} from './downloader';

// Utilities
export { OSCacheManager, GPGVerifier, OSScriptGenerator } from './utils';
export type {
  OSCacheConfig,
  CacheStats,
  GPGKey,
  VerificationResult,
  GPGVerifierConfig,
  GeneratedScripts,
  ScriptGeneratorOptions,
} from './utils';

// YUM/RPM
export { YumMetadataParser, YumDependencyResolver, YumDownloader } from './yum';

// APT/DEB
export { AptMetadataParser, AptDependencyResolver, AptDownloader } from './apt';

// APK
export { ApkMetadataParser, ApkDependencyResolver, ApkDownloader } from './apk';

// Packagers
export { OSArchivePackager, OSRepoPackager } from './packager';
export type { ArchiveOptions, RepoOptions, RepoResult } from './packager';

// Distribution Fetcher (인터넷에서 배포판 목록 가져오기)
export {
  fetchAllDistributions,
  getSimplifiedDistributions,
  convertToOSDistributions,
  invalidateDistributionCache,
  getDistributionsByPackageManager as fetchDistributionsByPackageManager,
} from './distribution-fetcher';
export type {
  DistributionVersion,
  DistributionFamily,
} from './distribution-fetcher';
