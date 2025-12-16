/**
 * Docker Downloader (Facade)
 *
 * Docker 이미지 다운로드를 위한 Facade 클래스
 * 실제 로직은 분리된 서비스 클래스에 위임
 *
 * 서비스 구조:
 * - DockerAuthClient: 인증 관리
 * - DockerManifestService: 매니페스트 조회
 * - DockerBlobDownloader: Blob 다운로드
 * - DockerSearchService: 검색 및 메타데이터
 * - DockerCatalogCache: 카탈로그 캐싱
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import {
  IDownloader,
  PackageInfo,
  DownloadProgressEvent,
  Architecture,
} from '../../types';
import logger from '../../utils/logger';
import { sanitizeDockerTag } from '../shared/filename-utils';
import { sanitizePath } from '../shared/path-utils';
import { ARCH_MAP, extractRegistry, parseImageName } from './docker-utils';
import { DockerAuthClient } from './docker-auth-client';
import { DockerCatalogCache, CatalogCacheStatus } from './docker-catalog-cache';
import { DockerManifestService } from './docker-manifest-service';
import { DockerBlobDownloader } from './docker-blob-downloader';
import { DockerSearchService } from './docker-search-service';

// Re-export for backward compatibility
export { RegistryType, RegistryConfig } from './docker-utils';
export { CatalogCacheStatus } from './docker-catalog-cache';

/**
 * 진행률 추적 상태
 */
interface ProgressTracker {
  totalSize: number;
  downloadedSize: number;
  lastBytes: number;
  lastTime: number;
  currentSpeed: number;
  update: (bytes: number) => void;
}

/**
 * 다운로드 컨텍스트 (메서드 간 공유 데이터)
 */
interface DownloadContext {
  fullName: string;
  token: string;
  registry: string;
  repository: string;
  tag: string;
  imageDir: string;
  safeRepo: string;
  safeTag: string;
}

/**
 * Docker Downloader (Facade Pattern)
 *
 * IDownloader 인터페이스 구현
 * 각 책임은 별도 서비스 클래스에 위임
 */
export class DockerDownloader implements IDownloader {
  readonly type = 'docker' as const;

  // 서비스 인스턴스
  private authClient: DockerAuthClient;
  private catalogCache: DockerCatalogCache;
  private manifestService: DockerManifestService;
  private blobDownloader: DockerBlobDownloader;
  private searchService: DockerSearchService;

  constructor() {
    // 서비스 초기화 (의존성 주입)
    this.authClient = new DockerAuthClient();
    this.catalogCache = new DockerCatalogCache(this.authClient);
    this.manifestService = new DockerManifestService(this.authClient);
    this.blobDownloader = new DockerBlobDownloader(this.authClient);
    this.searchService = new DockerSearchService(
      this.authClient,
      this.catalogCache,
      this.manifestService
    );
  }

  /**
   * 이미지 검색
   */
  async searchPackages(query: string, registry: string = 'docker.io'): Promise<PackageInfo[]> {
    return this.searchService.searchPackages(query, registry);
  }

  /**
   * 태그 목록 조회
   */
  async getVersions(packageName: string, registry: string = 'docker.io'): Promise<string[]> {
    return this.searchService.getVersions(packageName, registry);
  }

  /**
   * 이미지 메타데이터 조회
   */
  async getPackageMetadata(name: string, version: string): Promise<PackageInfo> {
    return this.searchService.getPackageMetadata(name, version);
  }

  /**
   * 이미지 다운로드
   */
  async downloadPackage(
    info: PackageInfo,
    destPath: string,
    onProgress?: (progress: DownloadProgressEvent) => void
  ): Promise<string> {
    const extracted = extractRegistry(info.name);
    const registry = extracted.registry || (info.metadata?.registry as string) || 'docker.io';

    return this.downloadImage(
      info.name,
      info.version,
      info.arch || 'amd64',
      destPath,
      onProgress,
      registry
    );
  }

  /**
   * 이미지 다운로드 (전체 과정)
   */
  async downloadImage(
    repository: string,
    tag: string,
    arch: Architecture,
    destPath: string,
    onProgress?: (progress: DownloadProgressEvent) => void,
    registry: string = 'docker.io'
  ): Promise<string> {
    try {
      // 1. 준비: 토큰 획득 및 매니페스트 조회
      const ctx = await this.prepareDownload(repository, tag, arch, destPath, registry);
      const manifest = await this.fetchManifest(ctx, arch);

      // 2. 진행률 추적 설정
      const progressTracker = this.createProgressTracker(
        manifest.layers,
        ctx,
        onProgress
      );

      // 3. Config 및 레이어 다운로드
      await this.downloadConfig(ctx, manifest.config.digest);
      const layerPaths = await this.downloadAllLayers(ctx, manifest.layers, progressTracker);

      // 4. 패키징 및 정리
      const tarPath = await this.packageAndCleanup(ctx, destPath, layerPaths);

      logger.info('Docker 이미지 다운로드 완료', {
        repository,
        tag,
        arch,
        registry,
        tarPath,
      });

      return tarPath;
    } catch (error) {
      this.logDownloadError(error, repository, tag, arch, registry);
      throw error;
    }
  }

  /**
   * 다운로드 준비 (토큰 획득, 컨텍스트 생성)
   */
  private async prepareDownload(
    repository: string,
    tag: string,
    arch: Architecture,
    destPath: string,
    registry: string
  ): Promise<DownloadContext> {
    const [namespace, repo] = parseImageName(repository);
    const fullName = `${namespace}/${repo}`;
    const token = await this.authClient.getTokenForRegistry(registry, fullName);

    const safeTag = sanitizeDockerTag(tag);
    const safeRepo = sanitizePath(repo);
    const imageDir = path.join(destPath, `${safeRepo}-${safeTag}`);
    await fs.ensureDir(imageDir);

    return {
      fullName,
      token,
      registry,
      repository,
      tag,
      imageDir,
      safeRepo,
      safeTag,
    };
  }

  /**
   * 매니페스트 조회
   */
  private async fetchManifest(
    ctx: DownloadContext,
    arch: Architecture
  ): Promise<{ config: { digest: string }; layers: Array<{ digest: string; size: number }> }> {
    const dockerPlatform = ARCH_MAP[arch] || { architecture: 'amd64' };

    const manifest = await this.manifestService.getManifestForArchitecture(
      ctx.fullName,
      ctx.tag,
      ctx.token,
      ctx.registry,
      dockerPlatform.architecture,
      dockerPlatform.variant
    );

    if (!manifest.layers || !manifest.config) {
      throw new Error('유효하지 않은 이미지 매니페스트입니다');
    }

    return {
      config: manifest.config,
      layers: manifest.layers,
    };
  }

  /**
   * 진행률 추적 생성
   */
  private createProgressTracker(
    layers: Array<{ size: number }>,
    ctx: DownloadContext,
    onProgress?: (progress: DownloadProgressEvent) => void
  ): ProgressTracker {
    const totalSize = layers.reduce((sum, layer) => sum + layer.size, 0);
    const tracker: ProgressTracker = {
      totalSize,
      downloadedSize: 0,
      lastBytes: 0,
      lastTime: Date.now(),
      currentSpeed: 0,
      update: (bytes: number) => {
        tracker.downloadedSize += bytes;

        const now = Date.now();
        const elapsed = (now - tracker.lastTime) / 1000;
        if (elapsed >= 0.3) {
          tracker.currentSpeed = (tracker.downloadedSize - tracker.lastBytes) / elapsed;
          tracker.lastBytes = tracker.downloadedSize;
          tracker.lastTime = now;
        }

        if (onProgress) {
          onProgress({
            itemId: `${ctx.registry}/${ctx.repository}:${ctx.tag}`,
            progress: (tracker.downloadedSize / tracker.totalSize) * 100,
            downloadedBytes: tracker.downloadedSize,
            totalBytes: tracker.totalSize,
            speed: tracker.currentSpeed,
          });
        }
      },
    };
    return tracker;
  }

  /**
   * Config blob 다운로드
   */
  private async downloadConfig(ctx: DownloadContext, configDigest: string): Promise<void> {
    const configPath = path.join(ctx.imageDir, 'config.json');
    await this.blobDownloader.downloadBlob(
      ctx.fullName,
      configDigest,
      configPath,
      ctx.token,
      ctx.registry
    );
  }

  /**
   * 모든 레이어 다운로드
   */
  private async downloadAllLayers(
    ctx: DownloadContext,
    layers: Array<{ digest: string; size: number }>,
    progressTracker: ProgressTracker
  ): Promise<string[]> {
    const layerPaths: string[] = [];

    for (const layer of layers) {
      const layerFileName = layer.digest.replace('sha256:', '') + '.tar.gz';
      const layerPath = path.join(ctx.imageDir, layerFileName);

      await this.blobDownloader.downloadBlob(
        ctx.fullName,
        layer.digest,
        layerPath,
        ctx.token,
        ctx.registry,
        progressTracker.update
      );

      layerPaths.push(layerPath);
    }

    return layerPaths;
  }

  /**
   * 패키징 및 정리
   */
  private async packageAndCleanup(
    ctx: DownloadContext,
    destPath: string,
    layerPaths: string[]
  ): Promise<string> {
    // manifest.json 생성 (docker load 형식)
    const repoTagPrefix = ctx.registry === 'docker.io' ? '' : `${ctx.registry}/`;
    const repoTag = `${repoTagPrefix}${ctx.fullName}:${ctx.tag}`;
    const manifestJson = [
      {
        Config: 'config.json',
        RepoTags: [repoTag],
        Layers: layerPaths.map((p) => path.basename(p)),
      },
    ];

    await fs.writeJson(path.join(ctx.imageDir, 'manifest.json'), manifestJson);

    // tar 파일로 패키징
    const tarPath = path.join(destPath, `${ctx.safeRepo}-${ctx.safeTag}.tar`);
    await this.blobDownloader.createImageTar(ctx.imageDir, tarPath);

    // 임시 디렉토리 삭제
    await fs.remove(ctx.imageDir);

    return tarPath;
  }

  /**
   * 다운로드 에러 로깅
   */
  private logDownloadError(
    error: unknown,
    repository: string,
    tag: string,
    arch: Architecture,
    registry: string
  ): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error('Docker 이미지 다운로드 실패', {
      repository,
      tag,
      arch,
      registry,
      errorMessage,
      errorStack,
    });
  }

  /**
   * 체크섬 검증
   */
  async verifyChecksum(filePath: string, expected: string): Promise<boolean> {
    return this.blobDownloader.verifyChecksum(filePath, expected);
  }

  // ===== 카탈로그 캐시 위임 메서드 =====

  /**
   * 특정 레지스트리의 카탈로그 캐시 새로고침
   */
  async refreshCatalogCache(registry: string): Promise<string[]> {
    return this.catalogCache.refreshCatalogCache(registry);
  }

  /**
   * 모든 카탈로그 캐시 삭제
   */
  clearCatalogCache(): void {
    this.catalogCache.clearCatalogCache();
  }

  /**
   * 카탈로그 캐시 TTL 설정
   */
  setCatalogCacheTTL(ttlMs: number): void {
    this.catalogCache.setCatalogCacheTTL(ttlMs);
  }

  /**
   * 카탈로그 캐시 상태 조회
   */
  getCatalogCacheStatus(): CatalogCacheStatus[] {
    return this.catalogCache.getCatalogCacheStatus();
  }
}

// 싱글톤 인스턴스
let dockerDownloaderInstance: DockerDownloader | null = null;

export function getDockerDownloader(): DockerDownloader {
  if (!dockerDownloaderInstance) {
    dockerDownloaderInstance = new DockerDownloader();
  }
  return dockerDownloaderInstance;
}
