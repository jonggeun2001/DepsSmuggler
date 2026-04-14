import * as path from 'path';
import * as fse from 'fs-extra';
import { dialog } from 'electron';
import {
  getYumDownloader,
  getAptDownloader,
  getApkDownloader,
  getYumResolver,
  getAptResolver,
  getApkResolver,
} from '../../src/core';
import { OSScriptGenerator } from '../../src/core/downloaders/os-shared/script-generator';
import type {
  OSErrorAction,
  OSArchitecture,
  OSDistribution,
  OSDownloadProgress,
  OSPackageInfo,
  OSPackageOutputOptions,
  PackageDependency,
} from '../../src/core/downloaders/os-shared/types';
import type { DownloadProgressEmitter } from './download-progress';

export interface OSDownloadStartOptions {
  packages: OSPackageInfo[];
  outputDir: string;
  distribution: OSDistribution;
  architecture: OSArchitecture;
  resolveDependencies?: boolean;
  includeOptionalDeps?: boolean;
  verifyGPG?: boolean;
  concurrency?: number;
  outputOptions?: OSPackageOutputOptions;
}

export interface OSGeneratedOutput {
  type: 'archive' | 'repository';
  path: string;
  label: string;
}

export interface OSDownloadFailure {
  package: OSPackageInfo;
  error: string;
}

export interface OSDownloadStartResult {
  success: OSPackageInfo[];
  failed: OSDownloadFailure[];
  skipped: OSPackageInfo[];
  outputPath: string;
  packageManager: OSDistribution['packageManager'];
  outputOptions: OSPackageOutputOptions;
  generatedOutputs: OSGeneratedOutput[];
  warnings: string[];
  unresolved: PackageDependency[];
  conflicts: Array<{
    package: string;
    versions: OSPackageInfo[];
  }>;
  cancelled: boolean;
}

export const DEFAULT_OS_OUTPUT_OPTIONS: OSPackageOutputOptions = {
  type: 'archive',
  archiveFormat: 'zip',
  generateScripts: true,
  scriptTypes: ['dependency-order'],
};

export function createOSDownloadErrorHandler(
  mainWindow: Electron.BrowserWindow | null,
  onCancel: () => void
): (error: { package?: OSPackageInfo; message: string }) => Promise<OSErrorAction> {
  return async (error) => {
    const packageName = error.package?.name || '알 수 없는 패키지';
    const result = await dialog.showMessageBox(mainWindow!, {
      type: 'error',
      title: '다운로드 오류',
      message: `패키지 다운로드 중 오류가 발생했습니다.\n\n${packageName}: ${error.message}`,
      buttons: ['재시도', '건너뛰기', '취소'],
      defaultId: 0,
      cancelId: 2,
    });

    switch (result.response) {
      case 0:
        return 'retry';
      case 1:
        return 'skip';
      default:
        onCancel();
        return 'skip';
    }
  };
}

export function createOSResolverForDistribution(params: {
  distribution: OSDistribution;
  architecture: OSArchitecture;
  includeOptional: boolean;
  includeRecommends: boolean;
  progressEmitter: DownloadProgressEmitter;
  abortSignal?: AbortSignal;
}) {
  const {
    distribution,
    architecture,
    includeOptional,
    includeRecommends,
    progressEmitter,
    abortSignal,
  } = params;

  const onProgress = (message: string, current: number, total: number) => {
    progressEmitter.emitOSProgress({
      currentPackage: message,
      currentIndex: current,
      totalPackages: total,
      bytesDownloaded: 0,
      totalBytes: 0,
      speed: 0,
      phase: 'resolving',
    });
    progressEmitter.emitOSResolveDependenciesProgress({ message, current, total });
  };

  switch (distribution.packageManager) {
    case 'yum':
      return getYumResolver({
        repositories: distribution.defaultRepos,
        architecture,
        includeOptional,
        includeRecommends,
        distribution,
        onProgress,
        abortSignal,
      });
    case 'apt':
      return getAptResolver({
        repositories: distribution.defaultRepos,
        architecture,
        includeOptional,
        includeRecommends,
        distribution,
        onProgress,
        abortSignal,
      });
    case 'apk':
      return getApkResolver({
        repositories: distribution.defaultRepos,
        architecture,
        includeOptional,
        includeRecommends,
        distribution,
        onProgress,
        abortSignal,
      });
    default:
      throw new Error(`Unsupported package manager: ${distribution.packageManager}`);
  }
}

export function createOSDownloaderForDistribution(params: {
  distribution: OSDistribution;
  architecture: OSArchitecture;
  outputDir: string;
  concurrency: number;
  progressEmitter: DownloadProgressEmitter;
  abortSignal?: AbortSignal;
  onCancel: () => void;
  mainWindow: Electron.BrowserWindow | null;
}) {
  const {
    distribution,
    architecture,
    outputDir,
    concurrency,
    progressEmitter,
    abortSignal,
    onCancel,
    mainWindow,
  } = params;
  const onError = createOSDownloadErrorHandler(mainWindow, onCancel);

  const downloaderOptions = {
    distribution,
    architecture,
    repositories: distribution.defaultRepos,
    outputDir,
    concurrency,
    abortSignal,
    onProgress: (progress: OSDownloadProgress) => {
      progressEmitter.emitOSProgress(progress);
    },
    onError,
  };

  switch (distribution.packageManager) {
    case 'yum':
      return getYumDownloader(downloaderOptions);
    case 'apt':
      return getAptDownloader(downloaderOptions);
    case 'apk':
      return getApkDownloader(downloaderOptions);
    default:
      throw new Error(`Unsupported package manager: ${distribution.packageManager}`);
  }
}

export function buildOSDownloadStartResult(params: {
  success?: OSPackageInfo[];
  failed?: OSDownloadFailure[];
  skipped?: OSPackageInfo[];
  outputDir: string;
  distribution: OSDistribution;
  outputOptions: OSPackageOutputOptions;
  generatedOutputs?: OSGeneratedOutput[];
  warnings?: string[];
  unresolved?: PackageDependency[];
  conflicts?: Array<{
    package: string;
    versions: OSPackageInfo[];
  }>;
  cancelled?: boolean;
}): OSDownloadStartResult {
  return {
    success: params.success ?? [],
    failed: params.failed ?? [],
    skipped: params.skipped ?? [],
    outputPath: params.outputDir,
    packageManager: params.distribution.packageManager,
    outputOptions: params.outputOptions,
    generatedOutputs: params.generatedOutputs ?? [],
    warnings: params.warnings ?? [],
    unresolved: params.unresolved ?? [],
    conflicts: params.conflicts ?? [],
    cancelled: params.cancelled ?? false,
  };
}

export async function writeRepositoryScripts(
  outputDir: string,
  packages: OSPackageInfo[],
  packageManager: OSDistribution['packageManager'],
  scriptTypes: OSPackageOutputOptions['scriptTypes']
): Promise<void> {
  const scriptGenerator = new OSScriptGenerator();
  if (!scriptTypes.includes('dependency-order')) {
    return;
  }

  const scripts = scriptGenerator.generateDependencyOrderScript(
    packages,
    packageManager,
    { packageDir: packageManager === 'yum' ? './Packages' : '.' }
  );
  await fse.writeFile(path.join(outputDir, 'install.sh'), scripts.bash);
  await fse.writeFile(path.join(outputDir, 'install.ps1'), scripts.powershell);
}

export async function cleanupGeneratedOutputs(outputs: OSGeneratedOutput[]): Promise<void> {
  await Promise.all(outputs.map((output) => fse.remove(output.path)));
}
