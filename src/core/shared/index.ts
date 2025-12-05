// 공통 모듈 진입점

// 타입
export * from './types';
export * from './conda-types';
export * from './pip-types';

// 버전 비교 유틸리티
export {
  compareVersions,
  isVersionCompatible,
  sortVersionsDescending,
  sortVersionsAscending,
  findLatestCompatibleVersion,
} from './version-utils';

// PyPI 유틸리티
export { getPyPIDownloadUrl } from './pypi-utils';

// Conda 유틸리티
export { getCondaDownloadUrl, getCondaSubdir } from './conda-utils';

// Conda MatchSpec 파서
export {
  parseMatchSpec,
  parseCondaVersion,
  compareCondaVersions,
  matchesVersionSpec,
  matchesBuildSpec,
  matchesSpec,
} from './conda-matchspec';
export type { MatchSpec } from './conda-matchspec';

// 파일 유틸리티
export { downloadFile, createZipArchive, createTarGzArchive } from './file-utils';
export type { ProgressCallback } from './file-utils';

// 스크립트 유틸리티
export { generateInstallScripts } from './script-utils';

// 의존성 해결 유틸리티
export {
  resolveAllDependencies,
  resolveSinglePackageDependencies,
} from './dependency-resolver';
export type {
  ResolvedPackageList,
  DependencyResolverOptions,
} from './dependency-resolver';

// PEP 425 호환성 태그 (pip-tags.ts)
export {
  tagToString,
  parseTag,
  versionToNodot,
  generateCPythonTags,
  generateCompatibleTags,
  getSupportedTags,
  tagsToIndexMap,
  generateLinuxPlatformTags,
  generateMacOSPlatformTags,
  generateWindowsPlatformTags,
  generatePlatformTags,
  normalizeArch,
  getFullSupportedTags,
  isTagCompatible,
  getTagPriority,
} from './pip-tags';
export type {
  PlatformTag,
  TargetPythonConfig,
  PlatformType,
  ArchType,
} from './pip-tags';

// Wheel 파일 파싱 (pip-wheel.ts)
export {
  normalizePackageName,
  parseWheelFilename,
  isWheelSupported,
  getWheelSupportIndex,
  getWheelTagPriority,
  isWheelFile,
  isSourceDist,
  getPackageFileType,
  getWheelPythonVersions,
  getWheelPlatformInfo,
  sortWheelsByPriority,
  filterCompatibleWheels,
  selectBestWheel,
} from './pip-wheel';
export type {
  WheelInfo,
  BuildTag,
  PackageFileType,
  WheelPlatformInfo,
} from './pip-wheel';

// CandidateEvaluator (pip-candidate.ts)
export {
  CandidateEvaluator,
  createCandidateFromRelease,
  selectBestCandidateFromReleases,
  selectBestCandidateFromAllVersions,
} from './pip-candidate';
export type {
  InstallationCandidate,
  CandidateSortingKey,
  CandidateEvaluatorConfig,
  BestCandidateResult,
  PyPIReleaseInfo,
} from './pip-candidate';

// PipProvider (pip-provider.ts)
export { PipProvider } from './pip-provider';
export type {
  Requirement,
  Candidate,
  Constraint,
  ProviderConfig,
  RequirementInformation,
  Preference,
  PackageInfoFetcher,
} from './pip-provider';

// BacktrackingResolver (pip-backtracking-resolver.ts)
export {
  BacktrackingResolver,
  resolveDependencies,
} from './pip-backtracking-resolver';
export type {
  ResolutionResult,
  ConflictInfo,
  ResolverConfig,
} from './pip-backtracking-resolver';

// Maven 타입 (maven-types.ts)
export {
  coordinateToString,
  coordinateToKey,
  parseCoordinate,
  exclusionKey,
  matchesExclusion,
  transitScope,
  SCOPE_TRANSITION_MATRIX,
} from './maven-types';
export type {
  PomProject,
  PomDependency,
  PomExclusion,
  PomPlugin,
  PomParent,
  MavenCoordinate,
  NodeCoordinate,
  DependencyProcessingContext,
  SkipResult,
  ConflictResolutionResult,
  ResolvedDependencyNode,
  ScopeTransitionKey,
  ScopeTransitionResult,
  PomCacheEntry,
  DependencyCacheKey,
  ResolvedDependencyCache,
  PomDownloadTask,
  ParallelDownloaderOptions,
} from './maven-types';

// Maven Skipper (maven-skipper.ts)
export {
  CoordinateManager,
  CacheManager,
  DependencyResolutionSkipper,
} from './maven-skipper';

// npm 타입 (npm-types.ts)
export type {
  NpmPackument,
  NpmPackageVersion,
  NpmDist,
  NpmSignature,
  NpmPerson,
  NpmRepository,
  PeerDependencyMeta,
  DependencyType,
  NpmEdge,
  NpmNode,
  PlacementResult,
  PlaceDepResult,
  NpmResolvedNode,
  NpmResolutionResult,
  NpmFlatPackage,
  NpmConflict,
  NpmResolverOptions,
  NpmLockfile,
  NpmLockfilePackage,
  NpmSearchResult,
  NpmSearchResponse,
  SemverRange,
  DepsQueueItem,
  PackumentCacheEntry,
  VersionCacheKey,
} from './npm-types';
