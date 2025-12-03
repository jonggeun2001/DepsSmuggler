import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';
import * as tar from 'tar';
import {
  IDownloader,
  PackageInfo,
  PackageMetadata,
  DownloadProgressEvent,
  Architecture,
} from '../../types';
import logger from '../../utils/logger';

// Docker Hub 검색 응답
interface DockerSearchResponse {
  count: number;
  results: DockerSearchResult[];
}

interface DockerSearchResult {
  repo_name: string;
  short_description: string;
  star_count: number;
  is_official: boolean;
  is_automated: boolean;
}

// Docker Hub 태그 응답
interface DockerTagsResponse {
  count: number;
  results: DockerTag[];
}

interface DockerTag {
  name: string;
  full_size: number;
  images: {
    architecture: string;
    os: string;
    digest: string;
    size: number;
  }[];
}

// Docker Registry 토큰 응답
interface TokenResponse {
  token: string;
  expires_in: number;
}

// Docker 매니페스트
interface DockerManifest {
  schemaVersion: number;
  mediaType: string;
  config?: {
    mediaType: string;
    size: number;
    digest: string;
  };
  layers?: {
    mediaType: string;
    size: number;
    digest: string;
  }[];
  manifests?: {
    mediaType: string;
    size: number;
    digest: string;
    platform: {
      architecture: string;
      os: string;
    };
  }[];
}

// 아키텍처 매핑
const ARCH_MAP: Record<Architecture, string> = {
  x86_64: 'amd64',
  amd64: 'amd64',
  arm64: 'arm64',
  aarch64: 'arm64',
  i386: '386',
  i686: '386',
  noarch: 'amd64',
  all: 'amd64',
};

export class DockerDownloader implements IDownloader {
  readonly type = 'docker' as const;
  private hubClient: AxiosInstance;
  private registryClient: AxiosInstance;
  private tokenCache: Map<string, { token: string; expires: number }> = new Map();

  private readonly hubUrl = 'https://hub.docker.com/v2';
  private readonly authUrl = 'https://auth.docker.io';
  private readonly registryUrl = 'https://registry-1.docker.io/v2';

  constructor() {
    this.hubClient = axios.create({
      baseURL: this.hubUrl,
      timeout: 30000,
    });

    this.registryClient = axios.create({
      baseURL: this.registryUrl,
      timeout: 60000,
    });
  }

  /**
   * 이미지 검색
   */
  async searchPackages(query: string): Promise<PackageInfo[]> {
    try {
      const response = await this.hubClient.get<DockerSearchResponse>(
        '/search/repositories/',
        {
          params: { query, page_size: 50 },
        }
      );

      return response.data.results.map((result) => ({
        type: 'docker',
        name: result.repo_name,
        version: 'latest',
        metadata: {
          description: result.short_description,
          registry: 'docker.io',
        },
      }));
    } catch (error) {
      logger.error('Docker 이미지 검색 실패', { query, error });
      throw error;
    }
  }

  /**
   * 태그 목록 조회
   */
  async getVersions(packageName: string): Promise<string[]> {
    try {
      const [namespace, repo] = this.parseImageName(packageName);
      const response = await this.hubClient.get<DockerTagsResponse>(
        `/repositories/${namespace}/${repo}/tags`,
        {
          params: { page_size: 100 },
        }
      );

      return response.data.results.map((tag) => tag.name);
    } catch (error) {
      logger.error('Docker 태그 목록 조회 실패', { packageName, error });
      throw error;
    }
  }

  /**
   * 이미지 메타데이터 조회
   */
  async getPackageMetadata(name: string, version: string): Promise<PackageInfo> {
    try {
      const [namespace, repo] = this.parseImageName(name);
      const tag = version || 'latest';

      // 토큰 획득
      const token = await this.getToken(`${namespace}/${repo}`);

      // 매니페스트 조회
      const manifest = await this.getManifest(`${namespace}/${repo}`, tag, token);

      const metadata: PackageMetadata = {
        registry: 'docker.io',
        tag,
        digest: manifest.config?.digest,
      };

      // 이미지 크기 계산
      if (manifest.layers) {
        metadata.size = manifest.layers.reduce((sum, layer) => sum + layer.size, 0);
      }

      return {
        type: 'docker',
        name: `${namespace}/${repo}`,
        version: tag,
        metadata,
      };
    } catch (error) {
      logger.error('Docker 메타데이터 조회 실패', { name, version, error });
      throw error;
    }
  }

  /**
   * 이미지 다운로드
   */
  async downloadPackage(
    info: PackageInfo,
    destPath: string,
    onProgress?: (progress: DownloadProgressEvent) => void
  ): Promise<string> {
    return this.downloadImage(
      info.name,
      info.version,
      info.arch || 'amd64',
      destPath,
      onProgress
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
    onProgress?: (progress: DownloadProgressEvent) => void
  ): Promise<string> {
    try {
      const [namespace, repo] = this.parseImageName(repository);
      const fullName = `${namespace}/${repo}`;
      const dockerArch = ARCH_MAP[arch] || 'amd64';

      // 토큰 획득
      const token = await this.getToken(fullName);

      // 매니페스트 조회
      let manifest = await this.getManifest(fullName, tag, token);

      // 멀티 아키텍처인 경우 해당 아키텍처 매니페스트 찾기
      if (manifest.manifests) {
        const archManifest = manifest.manifests.find(
          (m) => m.platform.architecture === dockerArch && m.platform.os === 'linux'
        );

        if (!archManifest) {
          throw new Error(`아키텍처 ${arch}를 지원하지 않습니다`);
        }

        manifest = await this.getManifest(fullName, archManifest.digest, token);
      }

      if (!manifest.layers || !manifest.config) {
        throw new Error('유효하지 않은 이미지 매니페스트입니다');
      }

      // 디렉토리 생성
      const imageDir = path.join(destPath, `${repo}-${tag}`);
      await fs.ensureDir(imageDir);

      // 전체 크기 계산
      const totalSize = manifest.layers.reduce((sum, layer) => sum + layer.size, 0);
      let downloadedSize = 0;

      // Config blob 다운로드
      const configPath = path.join(imageDir, 'config.json');
      await this.downloadBlob(fullName, manifest.config.digest, configPath, token);

      // 레이어 다운로드
      const layerPaths: string[] = [];

      for (const layer of manifest.layers) {
        const layerFileName = layer.digest.replace('sha256:', '') + '.tar.gz';
        const layerPath = path.join(imageDir, layerFileName);

        await this.downloadBlob(
          fullName,
          layer.digest,
          layerPath,
          token,
          (bytes) => {
            downloadedSize += bytes;
            if (onProgress) {
              onProgress({
                itemId: `${repository}:${tag}`,
                progress: (downloadedSize / totalSize) * 100,
                downloadedBytes: downloadedSize,
                totalBytes: totalSize,
                speed: 0,
              });
            }
          }
        );

        layerPaths.push(layerPath);
      }

      // manifest.json 생성 (docker load 형식)
      const manifestJson = [
        {
          Config: 'config.json',
          RepoTags: [`${fullName}:${tag}`],
          Layers: layerPaths.map((p) => path.basename(p)),
        },
      ];

      await fs.writeJson(path.join(imageDir, 'manifest.json'), manifestJson);

      // tar 파일로 패키징
      const tarPath = path.join(destPath, `${repo}-${tag}.tar`);
      await this.createImageTar(imageDir, tarPath);

      // 임시 디렉토리 삭제
      await fs.remove(imageDir);

      logger.info('Docker 이미지 다운로드 완료', {
        repository,
        tag,
        arch,
        tarPath,
      });

      return tarPath;
    } catch (error) {
      logger.error('Docker 이미지 다운로드 실패', { repository, tag, arch, error });
      throw error;
    }
  }

  /**
   * 인증 토큰 획득
   */
  private async getToken(repository: string): Promise<string> {
    const cacheKey = repository;
    const cached = this.tokenCache.get(cacheKey);

    if (cached && cached.expires > Date.now()) {
      return cached.token;
    }

    try {
      const response = await axios.get<TokenResponse>(`${this.authUrl}/token`, {
        params: {
          service: 'registry.docker.io',
          scope: `repository:${repository}:pull`,
        },
      });

      const token = response.data.token;
      const expires = Date.now() + (response.data.expires_in - 60) * 1000;

      this.tokenCache.set(cacheKey, { token, expires });

      return token;
    } catch (error) {
      logger.error('Docker 토큰 획득 실패', { repository, error });
      throw error;
    }
  }

  /**
   * 매니페스트 조회
   */
  private async getManifest(
    repository: string,
    reference: string,
    token: string
  ): Promise<DockerManifest> {
    const response = await this.registryClient.get<DockerManifest>(
      `/${repository}/manifests/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: [
            'application/vnd.docker.distribution.manifest.v2+json',
            'application/vnd.docker.distribution.manifest.list.v2+json',
            'application/vnd.oci.image.manifest.v1+json',
            'application/vnd.oci.image.index.v1+json',
          ].join(', '),
        },
      }
    );

    return response.data;
  }

  /**
   * Blob 다운로드
   */
  private async downloadBlob(
    repository: string,
    digest: string,
    destPath: string,
    token: string,
    onChunk?: (bytes: number) => void
  ): Promise<void> {
    const response = await axios({
      method: 'GET',
      url: `${this.registryUrl}/${repository}/blobs/${digest}`,
      responseType: 'stream',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const writer = fs.createWriteStream(destPath);

    response.data.on('data', (chunk: Buffer) => {
      if (onChunk) onChunk(chunk.length);
    });

    response.data.pipe(writer);

    await new Promise<void>((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    // 체크섬 검증
    const expectedHash = digest.replace('sha256:', '');
    const actualHash = await this.calculateSha256(destPath);

    if (actualHash !== expectedHash) {
      await fs.remove(destPath);
      throw new Error('Blob 체크섬 검증 실패');
    }
  }

  /**
   * SHA256 계산
   */
  private calculateSha256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * 이미지 tar 파일 생성
   */
  private async createImageTar(sourceDir: string, tarPath: string): Promise<void> {
    await tar.create(
      {
        file: tarPath,
        cwd: sourceDir,
      },
      await fs.readdir(sourceDir)
    );
  }

  /**
   * 이미지 이름 파싱
   */
  private parseImageName(name: string): [string, string] {
    if (name.includes('/')) {
      const parts = name.split('/');
      if (parts.length === 2) {
        return [parts[0], parts[1]];
      }
      // 레지스트리 포함된 경우 (예: gcr.io/project/image)
      return [parts.slice(0, -1).join('/'), parts[parts.length - 1]];
    }
    // library 이미지 (예: nginx, ubuntu)
    return ['library', name];
  }

  /**
   * 체크섬 검증
   */
  async verifyChecksum(filePath: string, expected: string): Promise<boolean> {
    const actual = await this.calculateSha256(filePath);
    return actual === expected;
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
