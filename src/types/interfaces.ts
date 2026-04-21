import type { DownloadProgressEvent, DownloadItem } from './download/item';
import type { PackageInfo } from './package-manager/metadata';
import type { PackageType } from './package-manager/package-manager';
import type { PackagingOptions, PackagingResult } from './packaging';
import type { DependencyResolutionResult, ResolverOptions } from './resolver/dependency-graph';

export interface IDownloader {
  readonly type: PackageType;

  searchPackages(query: string): Promise<PackageInfo[]>;
  getVersions(packageName: string): Promise<string[]>;
  getPackageMetadata(name: string, version: string): Promise<PackageInfo>;
  downloadPackage(
    info: PackageInfo,
    destPath: string,
    onProgress?: (progress: DownloadProgressEvent) => void
  ): Promise<string>;
  verifyChecksum?(filePath: string, expected: string): Promise<boolean>;
}

export interface IResolver {
  readonly type: PackageType;

  resolveDependencies(
    packageName: string,
    version: string,
    options?: ResolverOptions
  ): Promise<DependencyResolutionResult>;
  parseFromText?(content: string): Promise<PackageInfo[]>;
}

export interface IPackager {
  package(
    items: DownloadItem[],
    options: PackagingOptions
  ): Promise<PackagingResult>;
}

export type ErrorAction = 'retry' | 'skip' | 'cancel';

export interface UserPrompt {
  type: 'error' | 'confirm' | 'select';
  title: string;
  message: string;
  options?: ErrorAction[];
}

export type EventCallback<T = unknown> = (data: T) => void;

export interface IEventEmitter<Events extends Record<string, unknown>> {
  on<K extends keyof Events>(event: K, callback: EventCallback<Events[K]>): void;
  off<K extends keyof Events>(event: K, callback: EventCallback<Events[K]>): void;
  emit<K extends keyof Events>(event: K, data: Events[K]): void;
}
