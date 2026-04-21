// Core module exports for DepsSmuggler

// Downloaders
export { PipDownloader, getPipDownloader } from './downloaders/pip';
export { MavenDownloader, getMavenDownloader } from './downloaders/maven';
export { CondaDownloader, getCondaDownloader } from './downloaders/conda';
export { YumDownloader, getYumDownloader } from './downloaders/yum';
export { AptDownloader, getAptDownloader } from './downloaders/apt';
export { ApkDownloader, getApkDownloader } from './downloaders/apk';
export { DockerDownloader, getDockerDownloader } from './downloaders/docker';
export { NpmDownloader, getNpmDownloader } from './downloaders/npm';

// Packager
export { ArchivePackager, getArchivePackager } from './packager/archive-packager';
export type { ArchiveOptions, ArchiveProgress, PackageManifest } from './packager/archive-packager';
export type { ArchivePackageManifest } from '../types/manifest/package-manifest';

export { ScriptGenerator, getScriptGenerator } from './packager/script-generator';
export type { ScriptOptions, GeneratedScript } from './packager/script-generator';

export { FileSplitter, getFileSplitter } from './packager/file-splitter';

// Download Manager
export { DownloadManager, getDownloadManager } from './download-manager';
export type {
  DownloadManagerItem,
  DownloadManagerItemStatus,
  DownloadManagerOptions,
  DownloadManagerResult,
  OverallProgress,
  DownloadManagerEvents,
} from './download-manager';
export type { DownloadItem, DownloadItemStatus, DownloadOptions, DownloadResult } from './download-manager';

// Resolvers
export { PipResolver, getPipResolver } from './resolver/pip-resolver';
export { MavenResolver, getMavenResolver } from './resolver/maven-resolver';
export { CondaResolver, getCondaResolver } from './resolver/conda-resolver';
export { YumResolver, getYumResolver } from './resolver/yum-resolver';
export { AptResolver, getAptResolver } from './resolver/apt-resolver';
export { ApkResolver, getApkResolver } from './resolver/apk-resolver';
export { NpmResolver, getNpmResolver } from './resolver/npm-resolver';

// Cache Manager
export { ArtifactCacheManager, CacheManager, getCacheManager } from './cache-manager';

// Config
export { ConfigManager, getConfigManager } from './config';
export type { Config, CLIConfig } from './config';

// Ports
export * from './ports';

// Shared utilities
export * from './shared';
