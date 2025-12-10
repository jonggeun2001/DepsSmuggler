// Core module exports for DepsSmuggler

// Downloaders
export { PipDownloader, getPipDownloader } from './downloaders/pip';
export { MavenDownloader, getMavenDownloader } from './downloaders/maven';
export { CondaDownloader, getCondaDownloader } from './downloaders/conda';
export { YumDownloader, getYumDownloader } from './downloaders/yum';
export { DockerDownloader, getDockerDownloader } from './downloaders/docker';
export { NpmDownloader, getNpmDownloader } from './downloaders/npm';

// Packager
export { ArchivePackager, getArchivePackager } from './packager/archivePackager';
export type { ArchiveOptions, ArchiveProgress, PackageManifest } from './packager/archivePackager';

export { ScriptGenerator, getScriptGenerator } from './packager/scriptGenerator';
export type { ScriptOptions, GeneratedScript } from './packager/scriptGenerator';

export { FileSplitter, getFileSplitter } from './packager/fileSplitter';

// Download Manager
export { DownloadManager, getDownloadManager } from './downloadManager';
export type { DownloadItem, DownloadOptions, DownloadResult, OverallProgress, DownloadManagerEvents } from './downloadManager';

// Resolvers
export { PipResolver, getPipResolver } from './resolver/pipResolver';
export { MavenResolver, getMavenResolver } from './resolver/mavenResolver';
export { CondaResolver, getCondaResolver } from './resolver/condaResolver';
export { YumResolver, getYumResolver } from './resolver/yumResolver';
export { NpmResolver, getNpmResolver } from './resolver/npmResolver';

// Cache Manager
export { CacheManager, getCacheManager } from './cacheManager';

// Config
export { ConfigManager, getConfigManager } from './config';
export type { Config, CLIConfig } from './config';

// Shared utilities
export * from './shared';
