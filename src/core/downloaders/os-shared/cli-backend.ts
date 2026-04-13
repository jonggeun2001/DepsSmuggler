import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AptDownloader } from '../apt';
import { ApkDownloader } from '../apk';
import { YumDownloader } from '../yum';
import { AptDependencyResolver } from '../../resolver/apt-resolver';
import { ApkDependencyResolver } from '../../resolver/apk-resolver';
import { YumDependencyResolver } from '../../resolver/yum-resolver';
import { OSArchivePackager } from './archive-packager';
import { OSCacheManager } from './cache-manager';
import { getDownloadedFileKey } from './package-file-utils';
import { OSRepoPackager } from './repo-packager';
import { OSScriptGenerator } from './script-generator';
import type { BaseOSDownloader, BaseDownloaderOptions } from './base-downloader';
import type { BaseOSDependencyResolver } from './base-resolver';
import type {
  ArchiveFormat,
  DependencyResolutionResult,
  MatchType,
  OSArchitecture,
  OSDistribution,
  OSPackageInfo,
  OSPackageSearchResult,
  OutputType,
  PackageDependency,
  Repository,
} from './types';

export interface SearchOSPackagesOptions {
  distribution: OSDistribution;
  architecture: OSArchitecture;
  query: string;
  limit?: number;
  matchType?: MatchType;
  cacheDirectory: string;
  cacheEnabled: boolean;
}

export interface DownloadOSPackagesOptions {
  distribution: OSDistribution;
  architecture: OSArchitecture;
  packageNames: string[];
  outputPath: string;
  outputType: OutputType;
  archiveFormat: ArchiveFormat;
  resolveDependencies: boolean;
  includeScripts: boolean;
  concurrency: number;
  cacheDirectory: string;
  cacheEnabled: boolean;
}

export interface OSDownloadArtifact {
  type: 'archive' | 'repository';
  path: string;
}

export interface DownloadOSPackagesResult {
  requestedPackages: OSPackageInfo[];
  packages: OSPackageInfo[];
  artifacts: OSDownloadArtifact[];
  warnings: string[];
  unresolved: PackageDependency[];
  conflicts: DependencyResolutionResult['conflicts'];
}

export interface OSPackageCacheStats {
  directory: string;
  exists: boolean;
  entryCount: number;
  totalSize: number;
}

export interface ClearOSPackageCacheResult extends OSPackageCacheStats {
  clearedEntries: number;
  clearedSize: number;
}

type ResolverSearchable = BaseOSDependencyResolver & {
  searchPackages(query: string, matchType?: MatchType): Promise<OSPackageSearchResult[]>;
};

function getActiveRepositories(distribution: OSDistribution): Repository[] {
  return [...distribution.defaultRepos, ...distribution.extendedRepos].filter((repo) => repo.enabled);
}

function createCacheManager(directory: string, enabled: boolean): OSCacheManager {
  return new OSCacheManager({
    type: enabled ? 'persistent' : 'none',
    directory,
  });
}

function createResolver(
  distribution: OSDistribution,
  architecture: OSArchitecture,
  cacheManager: OSCacheManager
): ResolverSearchable {
  const options = {
    distribution,
    repositories: getActiveRepositories(distribution),
    architecture,
    cacheManager,
    includeOptional: false,
    includeRecommends: false,
  };

  switch (distribution.packageManager) {
    case 'yum':
      return new YumDependencyResolver(options);
    case 'apt':
      return new AptDependencyResolver(options);
    case 'apk':
      return new ApkDependencyResolver(options);
    default:
      throw new Error(`지원하지 않는 패키지 관리자: ${distribution.packageManager}`);
  }
}

function createDownloader(
  distribution: OSDistribution,
  architecture: OSArchitecture,
  outputDir: string,
  concurrency: number
): BaseOSDownloader {
  const options: BaseDownloaderOptions = {
    outputDir,
    distribution,
    architecture,
    repositories: getActiveRepositories(distribution),
    concurrency,
  };

  switch (distribution.packageManager) {
    case 'yum':
      return new YumDownloader(options);
    case 'apt':
      return new AptDownloader(options);
    case 'apk':
      return new ApkDownloader(options);
    default:
      throw new Error(`지원하지 않는 패키지 관리자: ${distribution.packageManager}`);
  }
}

function dedupePackages(packages: OSPackageInfo[]): OSPackageInfo[] {
  const unique = new Map<string, OSPackageInfo>();

  for (const pkg of packages) {
    unique.set(getDownloadedFileKey(pkg), pkg);
  }

  return Array.from(unique.values());
}

function normalizePackagesToDownload(
  resolution: DependencyResolutionResult
): OSPackageInfo[] {
  const packages = [...resolution.packages];

  for (const conflict of resolution.conflicts) {
    packages.push(...conflict.versions);
  }

  return dedupePackages(packages);
}

function getOutputPaths(
  outputPath: string,
  outputType: OutputType,
  archiveFormat: ArchiveFormat
): { archivePath?: string; repositoryPath?: string } {
  const absoluteOutputPath = path.resolve(outputPath);
  const archiveExt = archiveFormat === 'zip' ? '.zip' : '.tar.gz';

  if (outputType === 'archive') {
    return { archivePath: absoluteOutputPath };
  }

  if (outputType === 'repository') {
    return { repositoryPath: absoluteOutputPath };
  }

  let repositoryPath = absoluteOutputPath;
  if (absoluteOutputPath.endsWith('.zip')) {
    repositoryPath = absoluteOutputPath.slice(0, -4);
  } else if (absoluteOutputPath.endsWith('.tar.gz')) {
    repositoryPath = absoluteOutputPath.slice(0, -7);
  }

  const archivePath = absoluteOutputPath.endsWith(archiveExt)
    ? absoluteOutputPath
    : `${absoluteOutputPath}${archiveExt}`;

  return { archivePath, repositoryPath };
}

function ensureDirectory(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeRepositoryInstallScripts(
  repoPath: string,
  packages: OSPackageInfo[],
  distribution: OSDistribution
): void {
  const generator = new OSScriptGenerator();
  const packageDir = distribution.packageManager === 'yum' ? './Packages' : '.';
  const scripts = generator.generateDependencyOrderScript(packages, distribution.packageManager, {
    packageDir,
    repoName: `depssmuggler-${distribution.id}`,
  });

  const bashPath = path.join(repoPath, 'install.sh');
  fs.writeFileSync(bashPath, scripts.bash);
  fs.chmodSync(bashPath, 0o755);
  fs.writeFileSync(path.join(repoPath, 'install.ps1'), scripts.powershell);
}

export async function searchOSPackages(
  options: SearchOSPackagesOptions
): Promise<OSPackageSearchResult[]> {
  const cacheManager = createCacheManager(options.cacheDirectory, options.cacheEnabled);
  const resolver = createResolver(options.distribution, options.architecture, cacheManager);
  const results = await resolver.searchPackages(options.query, options.matchType ?? 'partial');

  if (typeof options.limit === 'number' && options.limit >= 0) {
    return results.slice(0, options.limit);
  }

  return results;
}

async function resolveRequestedPackages(
  packageNames: string[],
  resolver: ResolverSearchable
): Promise<OSPackageInfo[]> {
  const requestedPackages: OSPackageInfo[] = [];

  for (const packageName of packageNames) {
    const searchResults = await resolver.searchPackages(packageName, 'exact');
    const exactMatch = searchResults.find((result) => result.name === packageName);

    if (!exactMatch) {
      throw new Error(`패키지를 찾을 수 없습니다: ${packageName}`);
    }

    requestedPackages.push(exactMatch.latest);
  }

  return requestedPackages;
}

export async function downloadOSPackages(
  options: DownloadOSPackagesOptions
): Promise<DownloadOSPackagesResult> {
  const cacheManager = createCacheManager(options.cacheDirectory, options.cacheEnabled);
  const resolver = createResolver(options.distribution, options.architecture, cacheManager);
  const requestedPackages = await resolveRequestedPackages(options.packageNames, resolver);

  const resolution = options.resolveDependencies
    ? await resolver.resolveDependencies(requestedPackages)
    : {
        packages: requestedPackages,
        unresolved: [],
        conflicts: [],
        warnings: [],
      };

  const packagesToDownload = normalizePackagesToDownload(resolution);
  const warnings = [...resolution.warnings];
  const shouldGenerateScripts =
    options.includeScripts && resolution.conflicts.length === 0;

  if (options.includeScripts && resolution.conflicts.length > 0) {
    warnings.push(
      '버전 충돌이 감지되어 자동 설치 스크립트 생성을 생략했습니다. 필요한 버전을 수동으로 선택해 설치하세요.'
    );
  }

  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'depssmuggler-os-download-'));
  const downloader = createDownloader(
    options.distribution,
    options.architecture,
    stagingDir,
    options.concurrency
  );

  try {
    const downloadResult = await downloader.downloadPackages(packagesToDownload);
    if (downloadResult.failed.length > 0) {
      const failedNames = downloadResult.failed
        .map((item) => item.package.name)
        .join(', ');
      throw new Error(`일부 패키지 다운로드에 실패했습니다: ${failedNames}`);
    }

    const outputPaths = getOutputPaths(
      options.outputPath,
      options.outputType,
      options.archiveFormat
    );
    const artifacts: OSDownloadArtifact[] = [];

    if (outputPaths.archivePath) {
      const archivePackager = new OSArchivePackager();
      const archivePath = await archivePackager.createArchive(
        packagesToDownload,
        downloadResult.downloadedFiles,
        {
          format: options.archiveFormat,
          outputPath: outputPaths.archivePath,
          includeScripts: shouldGenerateScripts,
          scriptTypes: shouldGenerateScripts
            ? ['dependency-order', 'local-repo']
            : [],
          packageManager: options.distribution.packageManager,
          repoName: `depssmuggler-${options.distribution.id}`,
        }
      );
      artifacts.push({ type: 'archive', path: archivePath });
    }

    if (outputPaths.repositoryPath) {
      ensureDirectory(outputPaths.repositoryPath);

      const repoPackager = new OSRepoPackager();
      const repoResult = await repoPackager.createLocalRepo(
        packagesToDownload,
        downloadResult.downloadedFiles,
        {
          packageManager: options.distribution.packageManager,
          outputPath: outputPaths.repositoryPath,
          repoName: `depssmuggler-${options.distribution.id}`,
          includeSetupScript: shouldGenerateScripts,
        }
      );

      if (shouldGenerateScripts) {
        ensureDirectory(repoResult.repoPath);
        writeRepositoryInstallScripts(
          repoResult.repoPath,
          packagesToDownload,
          options.distribution
        );
      }

      artifacts.push({ type: 'repository', path: repoResult.repoPath });
    }

    return {
      requestedPackages,
      packages: packagesToDownload,
      artifacts,
      warnings,
      unresolved: resolution.unresolved,
      conflicts: resolution.conflicts,
    };
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

export async function getOSPackageCacheStats(
  directory: string
): Promise<OSPackageCacheStats> {
  if (!fs.existsSync(directory)) {
    return {
      directory,
      exists: false,
      entryCount: 0,
      totalSize: 0,
    };
  }

  const files = fs.readdirSync(directory).filter((file) => file.endsWith('.json'));
  const totalSize = files.reduce((sum, file) => {
    const stats = fs.statSync(path.join(directory, file));
    return sum + stats.size;
  }, 0);

  return {
    directory,
    exists: true,
    entryCount: files.length,
    totalSize,
  };
}

export async function clearOSPackageCache(
  directory: string
): Promise<ClearOSPackageCacheResult> {
  const before = await getOSPackageCacheStats(directory);

  if (before.exists) {
    const files = fs.readdirSync(directory).filter((file) => file.endsWith('.json'));
    for (const file of files) {
      fs.unlinkSync(path.join(directory, file));
    }
  }

  const after = await getOSPackageCacheStats(directory);

  return {
    ...after,
    clearedEntries: before.entryCount,
    clearedSize: before.totalSize,
  };
}
