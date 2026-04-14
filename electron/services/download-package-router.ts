import * as path from 'path';
import * as fse from 'fs-extra';
import { createScopedLogger } from '../utils/logger';
import { getPyPIDownloadUrl, downloadFile } from '../../src/core/shared';
import type {
  Architecture,
  DownloadOptions,
  DownloadPackage,
} from '../../src/core/shared';
import {
  getCondaDownloader,
  getDockerDownloader,
  getMavenDownloader,
  getNpmDownloader,
} from '../../src/core';
import type { DownloadProgressEmitter } from './download-progress';

const log = createScopedLogger('DownloadPackageRouter');

export interface DownloadPackageResult {
  id: string;
  success: boolean;
  error?: string;
}

export interface DownloadExecutionState {
  isCancelled(): boolean;
  isPaused(): boolean;
  waitWhilePaused(): Promise<void>;
  signal?: AbortSignal;
}

export interface DownloadPackageContext {
  packagesDir: string;
  options: DownloadOptions;
  progressEmitter: DownloadProgressEmitter;
  state: DownloadExecutionState;
}

export interface DownloadPackageRouter {
  downloadPackage(
    pkg: DownloadPackage,
    context: DownloadPackageContext
  ): Promise<DownloadPackageResult>;
}

export function createDownloadPackageRouter(): DownloadPackageRouter {
  return {
    async downloadPackage(pkg, context) {
      const { packagesDir, options, progressEmitter, state } = context;

      if (state.isCancelled()) {
        return { id: pkg.id, success: false, error: 'cancelled' };
      }

      await state.waitWhilePaused();
      if (state.isCancelled()) {
        return { id: pkg.id, success: false, error: 'cancelled' };
      }

      try {
        progressEmitter.emitPackageProgress(
          pkg.id,
          {
            status: 'downloading',
            progress: 0,
            downloadedBytes: 0,
            totalBytes: 0,
            speed: 0,
          },
          true
        );

        if (pkg.type === 'maven') {
          return await downloadMavenPackage(pkg, context);
        }

        if (pkg.type === 'docker') {
          return await downloadDockerImage(pkg, context);
        }

        const downloadTarget = await resolveDownloadTarget(pkg, options);
        if (!downloadTarget) {
          throw new Error(`다운로드 URL을 찾을 수 없습니다: ${pkg.name}@${pkg.version}`);
        }

        const destinationPath = path.join(packagesDir, downloadTarget.filename);
        let lastSpeedUpdate = Date.now();
        let lastBytes = 0;
        let finalTotalBytes = 0;
        let currentSpeed = 0;

        await downloadFile(
          downloadTarget.url,
          destinationPath,
          (downloaded, total) => {
            finalTotalBytes = total;
            const now = Date.now();
            const elapsed = (now - lastSpeedUpdate) / 1000;
            if (elapsed >= 0.3) {
              currentSpeed = (downloaded - lastBytes) / elapsed;
              lastSpeedUpdate = now;
              lastBytes = downloaded;
            }

            const progress = total > 0 ? Math.round((downloaded / total) * 100) : 0;
            if (state.isPaused()) {
              progressEmitter.emitPackageProgress(
                pkg.id,
                {
                  status: 'paused',
                  progress,
                  downloadedBytes: downloaded,
                  totalBytes: total,
                  speed: 0,
                },
                true
              );
              return;
            }

            progressEmitter.emitPackageProgress(pkg.id, {
              status: 'downloading',
              progress,
              downloadedBytes: downloaded,
              totalBytes: total,
              speed: currentSpeed,
            });
          },
          {
            signal: state.signal,
            shouldPause: () => state.isPaused(),
          }
        );

        progressEmitter.emitPackageProgress(
          pkg.id,
          {
            status: 'completed',
            progress: 100,
            downloadedBytes: finalTotalBytes,
            totalBytes: finalTotalBytes,
            speed: 0,
          },
          true
        );
        progressEmitter.clearPackageProgress(pkg.id);
        return { id: pkg.id, success: true };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error(`Download failed for ${pkg.name}:`, errorMessage);
        progressEmitter.emitPackageProgress(
          pkg.id,
          {
            status: 'failed',
            progress: 0,
            downloadedBytes: 0,
            totalBytes: 0,
            speed: 0,
            error: errorMessage,
          },
          true
        );
        progressEmitter.clearPackageProgress(pkg.id);
        return { id: pkg.id, success: false, error: errorMessage };
      }
    },
  };
}

async function resolveDownloadTarget(
  pkg: DownloadPackage,
  options: DownloadOptions
): Promise<{ url: string; filename: string } | null> {
  const { architecture, targetOS, pythonVersion } = options;

  if (pkg.type === 'pip') {
    return getPyPIDownloadUrl(
      pkg.name,
      pkg.version,
      architecture || pkg.architecture,
      targetOS,
      pythonVersion,
      pkg.indexUrl
    );
  }

  if (pkg.type === 'conda') {
    const condaDownloader = getCondaDownloader();
    const channel = (pkg.metadata?.repository as string)?.split('/')[0] || 'conda-forge';
    let condaDownloadUrl =
      pkg.downloadUrl || (pkg.metadata?.downloadUrl as string | undefined);

    if (!condaDownloadUrl) {
      const subdir = pkg.metadata?.subdir as string | undefined;
      const filename = pkg.metadata?.filename as string | undefined;
      if (subdir && filename) {
        condaDownloadUrl = `https://conda.anaconda.org/${channel}/${subdir}/${filename}`;
      } else {
        const arch = (pkg.architecture || architecture || 'x86_64') as Architecture;
        const metadata = await condaDownloader.getPackageMetadata(
          pkg.name,
          pkg.version,
          channel,
          arch
        );
        condaDownloadUrl = metadata.metadata?.downloadUrl as string | undefined;
      }
    }

    if (!condaDownloadUrl) {
      return null;
    }

    return {
      url: condaDownloadUrl,
      filename: path.basename(new URL(condaDownloadUrl).pathname),
    };
  }

  if (pkg.type === 'npm') {
    const npmDownloader = getNpmDownloader();
    const metadata = await npmDownloader.getPackageMetadata(pkg.name, pkg.version);
    const tarballUrl = metadata.metadata?.downloadUrl;
    if (!tarballUrl) {
      return null;
    }

    return {
      url: tarballUrl,
      filename: path.basename(new URL(tarballUrl).pathname),
    };
  }

  if (pkg.type === 'yum' || pkg.type === 'apt' || pkg.type === 'apk') {
    if (pkg.downloadUrl) {
      const ext = pkg.type === 'yum' ? 'rpm' : pkg.type === 'apt' ? 'deb' : 'apk';
      return {
        url: pkg.downloadUrl,
        filename: `${pkg.name}-${pkg.version}.${ext}`,
      };
    }

    if (pkg.repository?.baseUrl && pkg.location) {
      const arch = pkg.architecture || architecture || 'x86_64';
      const baseUrl = pkg.repository.baseUrl.replace(/\$basearch/g, arch);
      return {
        url: `${baseUrl}${pkg.location}`,
        filename: path.basename(pkg.location),
      };
    }
  }

  return null;
}

async function downloadMavenPackage(
  pkg: DownloadPackage,
  context: DownloadPackageContext
): Promise<DownloadPackageResult> {
  const { packagesDir, options, progressEmitter } = context;
  const mavenDownloader = getMavenDownloader();
  const parts = pkg.name.split(':');
  if (parts.length < 2) {
    throw new Error(`잘못된 Maven 좌표입니다: ${pkg.name}`);
  }

  const groupId = parts[0];
  const artifactId = parts[1];
  const classifier = pkg.classifier;
  let mavenTotalBytes = 0;
  const m2RepoDir = path.join(packagesDir, 'm2repo');
  await fse.ensureDir(m2RepoDir);

  const jarPath = await mavenDownloader.downloadPackage(
    {
      type: 'maven',
      name: pkg.name,
      version: pkg.version,
      metadata: {
        groupId,
        artifactId,
        classifier,
      },
    },
    m2RepoDir,
    (progress) => {
      mavenTotalBytes = progress.totalBytes;
      progressEmitter.emitPackageProgress(pkg.id, {
        status: 'downloading',
        progress: progress.progress,
        downloadedBytes: progress.downloadedBytes,
        totalBytes: progress.totalBytes,
        speed: progress.speed,
      });
    },
    {
      targetOS: options.targetOS,
      targetArchitecture: options.architecture,
    }
  );

  const flatFileName = classifier
    ? `${artifactId}-${pkg.version}-${classifier}.jar`
    : `${artifactId}-${pkg.version}.jar`;
  const flatDestinationPath = path.join(packagesDir, flatFileName);
  if (jarPath && (await fse.pathExists(jarPath))) {
    await fse.copy(jarPath, flatDestinationPath);
  }

  progressEmitter.emitPackageProgress(
    pkg.id,
    {
      status: 'completed',
      progress: 100,
      downloadedBytes: mavenTotalBytes,
      totalBytes: mavenTotalBytes,
      speed: 0,
    },
    true
  );
  progressEmitter.clearPackageProgress(pkg.id);
  return { id: pkg.id, success: true };
}

async function downloadDockerImage(
  pkg: DownloadPackage,
  context: DownloadPackageContext
): Promise<DownloadPackageResult> {
  const { packagesDir, progressEmitter } = context;
  const dockerDownloader = getDockerDownloader();
  const registry = (pkg.metadata?.registry as string) || 'docker.io';
  const architecture = (pkg.architecture || 'amd64') as Architecture;
  let dockerTotalBytes = 0;

  await dockerDownloader.downloadImage(
    pkg.name,
    pkg.version,
    architecture,
    packagesDir,
    (progress) => {
      dockerTotalBytes = progress.totalBytes;
      progressEmitter.emitPackageProgress(pkg.id, {
        status: 'downloading',
        progress: progress.progress,
        downloadedBytes: progress.downloadedBytes,
        totalBytes: progress.totalBytes,
        speed: progress.speed,
      });
    },
    registry
  );

  progressEmitter.emitPackageProgress(
    pkg.id,
    {
      status: 'completed',
      progress: 100,
      downloadedBytes: dockerTotalBytes,
      totalBytes: dockerTotalBytes,
      speed: 0,
    },
    true
  );
  progressEmitter.clearPackageProgress(pkg.id);
  return { id: pkg.id, success: true };
}
