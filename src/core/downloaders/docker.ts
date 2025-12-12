import axios, { AxiosInstance } from 'axios';
import * as fsNative from 'fs';
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
import { sanitizeDockerTag } from '../shared/filename-utils';

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
      variant?: string;
    };
  }[];
}

// 아키텍처 매핑 (Docker manifest의 platform.architecture 값으로 변환)
interface DockerPlatform {
  architecture: string;
  variant?: string;
}

const ARCH_MAP: Record<Architecture, DockerPlatform> = {
  x86_64: { architecture: 'amd64' },
  amd64: { architecture: 'amd64' },
  arm64: { architecture: 'arm64' },
  aarch64: { architecture: 'arm64' },
  i386: { architecture: '386' },
  i686: { architecture: '386' },
  '386': { architecture: '386' },
  'arm/v7': { architecture: 'arm', variant: 'v7' },
  noarch: { architecture: 'amd64' },
  all: { architecture: 'amd64' },
};

// 지원하는 레지스트리 타입
export type RegistryType = 'docker.io' | 'ghcr.io' | 'ecr' | 'quay.io' | 'custom';

// 레지스트리 설정 인터페이스
export interface RegistryConfig {
  authUrl: string;
  registryUrl: string;
  service: string;
  hubUrl?: string; // 검색용 Hub URL (Docker Hub만 해당)
}

// 레지스트리별 설정
const REGISTRY_CONFIGS: Record<string, RegistryConfig> = {
  'docker.io': {
    authUrl: 'https://auth.docker.io',
    registryUrl: 'https://registry-1.docker.io/v2',
    service: 'registry.docker.io',
    hubUrl: 'https://hub.docker.com/v2',
  },
  'ghcr.io': {
    authUrl: 'https://ghcr.io/token',
    registryUrl: 'https://ghcr.io/v2',
    service: 'ghcr.io',
  },
  'ecr': {
    authUrl: 'https://public.ecr.aws/token',
    registryUrl: 'https://public.ecr.aws/v2',
    service: 'public.ecr.aws',
  },
  'quay.io': {
    authUrl: 'https://quay.io/v2/auth',
    registryUrl: 'https://quay.io/v2',
    service: 'quay.io',
  },
};

// 레지스트리 URL에서 타입 추출
function getRegistryType(registry: string): RegistryType {
  if (registry === 'docker.io' || registry === 'registry-1.docker.io') {
    return 'docker.io';
  }
  if (registry === 'ghcr.io') {
    return 'ghcr.io';
  }
  if (registry === 'public.ecr.aws' || registry === 'ecr') {
    return 'ecr';
  }
  if (registry === 'quay.io') {
    return 'quay.io';
  }
  return 'custom';
}

// 커스텀 레지스트리 설정 생성
function createCustomRegistryConfig(registryUrl: string): RegistryConfig {
  const url = registryUrl.startsWith('http') ? registryUrl : `https://${registryUrl}`;
  const baseUrl = url.replace(/\/v2\/?$/, '');
  return {
    authUrl: `${baseUrl}/v2/auth`,
    registryUrl: `${baseUrl}/v2`,
    service: new URL(baseUrl).hostname,
  };
}

// 카탈로그 캐시 인터페이스
interface CatalogCache {
  registry: string;
  repositories: string[];
  fetchedAt: number;
  expiresAt: number;
}

// 기본 캐시 TTL (1시간)
const DEFAULT_CATALOG_CACHE_TTL = 60 * 60 * 1000;

export class DockerDownloader implements IDownloader {
  readonly type = 'docker' as const;
  private hubClient: AxiosInstance;
  private tokenCache: Map<string, { token: string; expires: number }> = new Map();
  private registryConfigCache: Map<string, RegistryConfig> = new Map();
  private catalogCache: Map<string, CatalogCache> = new Map();
  private catalogCacheTTL: number = DEFAULT_CATALOG_CACHE_TTL;

  private readonly defaultHubUrl = 'https://hub.docker.com/v2';

  constructor() {
    this.hubClient = axios.create({
      baseURL: this.defaultHubUrl,
      timeout: 30000,
    });
  }

  /**
   * 레지스트리 설정 가져오기
   */
  private getRegistryConfig(registry: string): RegistryConfig {
    // 캐시 확인
    const cached = this.registryConfigCache.get(registry);
    if (cached) return cached;

    const registryType = getRegistryType(registry);
    let config: RegistryConfig;

    if (registryType === 'custom') {
      config = createCustomRegistryConfig(registry);
    } else {
      config = REGISTRY_CONFIGS[registryType];
    }

    this.registryConfigCache.set(registry, config);
    return config;
  }

  /**
   * 이미지 검색
   * @param query 검색어
   * @param registry 레지스트리 (기본값: docker.io)
   */
  async searchPackages(query: string, registry: string = 'docker.io'): Promise<PackageInfo[]> {
    try {
      const registryType = getRegistryType(registry);

      // Docker Hub 검색 API
      if (registryType === 'docker.io') {
        const response = await this.hubClient.get<DockerSearchResponse>(
          '/search/repositories/',
          {
            params: { query, page_size: 50 },
          }
        );

        return response.data.results.map((result) => ({
          type: 'docker',
          name: `docker.io/${result.repo_name}`,
          version: 'latest',
          metadata: {
            description: result.short_description,
            registry: 'docker.io',
          },
        }));
      }

      // Quay.io 검색 API (인증 불필요)
      if (registryType === 'quay.io') {
        const response = await axios.get<{
          results: Array<{
            namespace: { name: string };
            name: string;
            description: string | null;
            is_public: boolean;
          }>;
        }>('https://quay.io/api/v1/find/repositories', {
          params: { query },
          timeout: 30000,
        });

        return response.data.results
          .filter(repo => repo.is_public)
          .slice(0, 50)
          .map((repo) => ({
            type: 'docker',
            name: `quay.io/${repo.namespace.name}/${repo.name}`,
            version: 'latest',
            metadata: {
              description: repo.description || '',
              registry: 'quay.io',
            },
          }));
      }

      // ghcr.io, ECR 등은 공개 검색 API가 없음
      // 검색 대신 직접 이미지 이름 입력 안내
      if (registryType === 'ghcr.io' || registryType === 'ecr') {
        logger.info(`${registry}는 검색 API를 지원하지 않습니다. 이미지 이름을 직접 입력해주세요.`);
        // 입력한 검색어를 그대로 이미지 이름으로 사용할 수 있도록 제안
        return [{
          type: 'docker',
          name: `${registry}/${query}`,
          version: 'latest',
          metadata: {
            description: `"${query}" 이미지를 ${registry}에서 가져옵니다. (검색 미지원 - 정확한 이미지명 입력 필요)`,
            registry,
          },
        }];
      }

      // 커스텀 레지스트리는 캐시된 카탈로그 사용 시도
      const repositories = await this.getCachedCatalog(registry);
      const filtered = repositories.filter(name =>
        name.toLowerCase().includes(query.toLowerCase())
      );

      return filtered.slice(0, 50).map((name) => ({
        type: 'docker',
        name: `${registry}/${name}`,
        version: 'latest',
        metadata: {
          registry,
        },
      }));
    } catch (error) {
      logger.error('Docker 이미지 검색 실패', { query, registry, error });
      throw error;
    }
  }

  /**
   * 태그 목록 조회
   * @param packageName 패키지 이름 (레지스트리 포함 가능: docker.io/library/nginx)
   * @param registry 레지스트리 (기본값: docker.io, 이름에 레지스트리가 포함되면 무시됨)
   */
  async getVersions(packageName: string, registry: string = 'docker.io'): Promise<string[]> {
    // 이름에서 레지스트리 추출 (포함된 경우)
    const extracted = this.extractRegistry(packageName);
    const effectiveRegistry = extracted.registry || registry;

    try {
      const [namespace, repo] = this.parseImageName(packageName);
      const registryType = getRegistryType(effectiveRegistry);

      // Docker Hub의 경우 Hub API 사용
      if (registryType === 'docker.io') {
        const response = await this.hubClient.get<DockerTagsResponse>(
          `/repositories/${namespace}/${repo}/tags`,
          {
            params: { page_size: 100 },
          }
        );
        return response.data.results.map((tag) => tag.name);
      }

      // 다른 레지스트리는 Registry API 사용
      const config = this.getRegistryConfig(effectiveRegistry);
      const fullName = `${namespace}/${repo}`;
      const token = await this.getTokenForRegistry(effectiveRegistry, fullName);

      const response = await axios.get(
        `${config.registryUrl}/${fullName}/tags/list`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      return response.data.tags || [];
    } catch (error) {
      logger.error('Docker 태그 목록 조회 실패', { packageName, registry: effectiveRegistry, error });
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
    // 이름에서 레지스트리 추출 (포함된 경우)
    const extracted = this.extractRegistry(info.name);
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
   * @param repository 저장소 (예: nginx, library/nginx)
   * @param tag 태그 (예: latest, alpine)
   * @param arch 아키텍처
   * @param destPath 저장 경로
   * @param onProgress 진행률 콜백
   * @param registry 레지스트리 (기본값: docker.io)
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
      const [namespace, repo] = this.parseImageName(repository);
      const fullName = `${namespace}/${repo}`;
      const dockerPlatform = ARCH_MAP[arch] || { architecture: 'amd64' };

      // 토큰 획득
      const token = await this.getTokenForRegistry(registry, fullName);

      // 매니페스트 조회
      let manifest = await this.getManifest(fullName, tag, token, registry);

      // 멀티 아키텍처인 경우 해당 아키텍처 매니페스트 찾기
      if (manifest.manifests) {
        const archManifest = manifest.manifests.find((m) => {
          const archMatch = m.platform.architecture === dockerPlatform.architecture;
          const osMatch = m.platform.os === 'linux';
          // variant가 지정된 경우 (arm/v7 등) variant도 일치해야 함
          const variantMatch = !dockerPlatform.variant || m.platform.variant === dockerPlatform.variant;
          return archMatch && osMatch && variantMatch;
        });

        if (!archManifest) {
          throw new Error(`아키텍처 ${arch}를 지원하지 않습니다`);
        }

        manifest = await this.getManifest(fullName, archManifest.digest, token, registry);
      }

      if (!manifest.layers || !manifest.config) {
        throw new Error('유효하지 않은 이미지 매니페스트입니다');
      }

      // 디렉토리 생성
      const safeTag = sanitizeDockerTag(tag);
      const imageDir = path.join(destPath, `${repo}-${safeTag}`);
      await fs.ensureDir(imageDir);

      // 전체 크기 계산
      const totalSize = manifest.layers.reduce((sum, layer) => sum + layer.size, 0);
      let downloadedSize = 0;
      let lastBytes = 0;
      let lastTime = Date.now();
      let currentSpeed = 0;

      // Config blob 다운로드
      const configPath = path.join(imageDir, 'config.json');
      await this.downloadBlob(fullName, manifest.config.digest, configPath, token, registry);

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
          registry,
          (bytes) => {
            downloadedSize += bytes;

            // 속도 계산 (0.3초마다)
            const now = Date.now();
            const elapsed = (now - lastTime) / 1000;
            if (elapsed >= 0.3) {
              currentSpeed = (downloadedSize - lastBytes) / elapsed;
              lastBytes = downloadedSize;
              lastTime = now;
            }

            if (onProgress) {
              onProgress({
                itemId: `${registry}/${repository}:${tag}`,
                progress: (downloadedSize / totalSize) * 100,
                downloadedBytes: downloadedSize,
                totalBytes: totalSize,
                speed: currentSpeed,
              });
            }
          }
        );

        layerPaths.push(layerPath);
      }

      // RepoTag 생성 (레지스트리 포함)
      const repoTagPrefix = registry === 'docker.io' ? '' : `${registry}/`;
      const repoTag = `${repoTagPrefix}${fullName}:${tag}`;

      // manifest.json 생성 (docker load 형식)
      const manifestJson = [
        {
          Config: 'config.json',
          RepoTags: [repoTag],
          Layers: layerPaths.map((p) => path.basename(p)),
        },
      ];

      await fs.writeJson(path.join(imageDir, 'manifest.json'), manifestJson);

      // tar 파일로 패키징
      const tarPath = path.join(destPath, `${repo}-${safeTag}.tar`);
      await this.createImageTar(imageDir, tarPath);

      // 임시 디렉토리 삭제
      await fs.remove(imageDir);

      logger.info('Docker 이미지 다운로드 완료', {
        repository,
        tag,
        arch,
        registry,
        tarPath,
      });

      return tarPath;
    } catch (error) {
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
      throw error;
    }
  }

  /**
   * 레지스트리별 인증 토큰 획득
   * @param registry 레지스트리
   * @param repository 저장소 (예: library/nginx)
   */
  private async getTokenForRegistry(registry: string, repository: string): Promise<string> {
    const cacheKey = `${registry}:${repository}`;
    const cached = this.tokenCache.get(cacheKey);

    if (cached && cached.expires > Date.now()) {
      return cached.token;
    }

    const config = this.getRegistryConfig(registry);
    const registryType = getRegistryType(registry);

    try {
      let token: string;
      let expiresIn = 300; // 기본 5분

      if (registryType === 'docker.io') {
        // Docker Hub 인증
        const response = await axios.get<TokenResponse>(`${config.authUrl}/token`, {
          params: {
            service: config.service,
            scope: repository ? `repository:${repository}:pull` : '',
          },
        });
        token = response.data.token;
        expiresIn = response.data.expires_in || 300;
      } else if (registryType === 'ghcr.io') {
        // GitHub Container Registry - Anonymous 토큰
        const response = await axios.get<TokenResponse>(`${config.authUrl}`, {
          params: {
            service: config.service,
            scope: repository ? `repository:${repository}:pull` : '',
          },
        });
        token = response.data.token;
        expiresIn = response.data.expires_in || 300;
      } else if (registryType === 'ecr') {
        // AWS ECR Public - 기본 토큰 없이 시도
        const response = await axios.get<TokenResponse>(`${config.authUrl}`, {
          params: {
            service: config.service,
            scope: repository ? `repository:${repository}:pull` : '',
          },
        });
        token = response.data.token;
        expiresIn = response.data.expires_in || 300;
      } else if (registryType === 'quay.io') {
        // Quay.io - Anonymous 접근
        // Quay.io는 public 이미지에 대해 토큰 없이 접근 가능
        // WWW-Authenticate 헤더에서 토큰 URL 파싱 필요
        try {
          const authResponse = await axios.get(`${config.registryUrl}/`, {
            validateStatus: (status) => status === 401,
          });
          const wwwAuth = authResponse.headers['www-authenticate'];
          if (wwwAuth) {
            const realmMatch = wwwAuth.match(/realm="([^"]+)"/);
            const serviceMatch = wwwAuth.match(/service="([^"]+)"/);
            if (realmMatch) {
              const realm = realmMatch[1];
              const service = serviceMatch?.[1] || config.service;
              const tokenResponse = await axios.get<TokenResponse>(realm, {
                params: {
                  service,
                  scope: repository ? `repository:${repository}:pull` : '',
                },
              });
              token = tokenResponse.data.token;
              expiresIn = tokenResponse.data.expires_in || 300;
            } else {
              token = '';
            }
          } else {
            token = '';
          }
        } catch {
          token = '';
        }
      } else {
        // 커스텀 레지스트리 - 기본 토큰 요청 시도
        try {
          const response = await axios.get<TokenResponse>(`${config.authUrl}`, {
            params: {
              service: config.service,
              scope: repository ? `repository:${repository}:pull` : '',
            },
          });
          token = response.data.token;
          expiresIn = response.data.expires_in || 300;
        } catch {
          // 인증 없이 접근 시도
          token = '';
        }
      }

      const expires = Date.now() + (expiresIn - 60) * 1000;
      this.tokenCache.set(cacheKey, { token, expires });

      return token;
    } catch (error) {
      logger.error('Docker 토큰 획득 실패', { registry, repository, error });
      throw error;
    }
  }

  /**
   * 인증 토큰 획득 (Docker Hub 기본)
   * @deprecated getTokenForRegistry 사용 권장
   */
  private async getToken(repository: string): Promise<string> {
    return this.getTokenForRegistry('docker.io', repository);
  }

  /**
   * 매니페스트 조회
   * @param repository 저장소 (예: library/nginx)
   * @param reference 태그 또는 다이제스트
   * @param token 인증 토큰
   * @param registry 레지스트리 (기본값: docker.io)
   */
  private async getManifest(
    repository: string,
    reference: string,
    token: string,
    registry: string = 'docker.io'
  ): Promise<DockerManifest> {
    const config = this.getRegistryConfig(registry);
    const headers: Record<string, string> = {
      Accept: [
        'application/vnd.docker.distribution.manifest.v2+json',
        'application/vnd.docker.distribution.manifest.list.v2+json',
        'application/vnd.oci.image.manifest.v1+json',
        'application/vnd.oci.image.index.v1+json',
      ].join(', '),
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await axios.get<DockerManifest>(
      `${config.registryUrl}/${repository}/manifests/${reference}`,
      { headers }
    );

    return response.data;
  }

  /**
   * Blob 다운로드
   * @param repository 저장소 (예: library/nginx)
   * @param digest 다이제스트 (sha256:xxx)
   * @param destPath 저장 경로
   * @param token 인증 토큰
   * @param registry 레지스트리 (기본값: docker.io)
   * @param onChunk 청크 콜백
   */
  private async downloadBlob(
    repository: string,
    digest: string,
    destPath: string,
    token: string,
    registry: string = 'docker.io',
    onChunk?: (bytes: number) => void
  ): Promise<void> {
    const config = this.getRegistryConfig(registry);
    const headers: Record<string, string> = {};

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await axios({
      method: 'GET',
      url: `${config.registryUrl}/${repository}/blobs/${digest}`,
      responseType: 'stream',
      headers,
    });

    const writer = fsNative.createWriteStream(destPath);

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
      const stream = fsNative.createReadStream(filePath);

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
   * 이름에서 레지스트리 분리 (레지스트리가 포함된 경우)
   * 예: docker.io/library/nginx -> { registry: docker.io, imageName: library/nginx }
   *     quay.io/coreos/etcd -> { registry: quay.io, imageName: coreos/etcd }
   *     nginx -> { registry: null, imageName: nginx }
   */
  private extractRegistry(fullName: string): { registry: string | null; imageName: string } {
    const knownRegistries = ['docker.io', 'quay.io', 'ghcr.io', 'gcr.io', 'public.ecr.aws'];
    const parts = fullName.split('/');

    if (parts.length > 1) {
      const firstPart = parts[0];
      // 알려진 레지스트리거나 점이 포함된 경우 레지스트리로 간주
      if (knownRegistries.includes(firstPart) || firstPart.includes('.')) {
        return {
          registry: firstPart,
          imageName: parts.slice(1).join('/'),
        };
      }
    }

    return { registry: null, imageName: fullName };
  }

  /**
   * 이미지 이름 파싱 (레지스트리 제외 후 namespace/repo 분리)
   */
  private parseImageName(name: string): [string, string] {
    // 먼저 레지스트리 제거
    const { imageName } = this.extractRegistry(name);

    if (imageName.includes('/')) {
      const parts = imageName.split('/');
      if (parts.length === 2) {
        return [parts[0], parts[1]];
      }
      // 여러 depth인 경우 (예: coreos/etcd/subpath)
      return [parts.slice(0, -1).join('/'), parts[parts.length - 1]];
    }
    // library 이미지 (예: nginx, ubuntu)
    return ['library', imageName];
  }

  /**
   * 체크섬 검증
   */
  async verifyChecksum(filePath: string, expected: string): Promise<boolean> {
    const actual = await this.calculateSha256(filePath);
    return actual.toLowerCase() === expected.toLowerCase();
  }


  /**
   * 캐시된 카탈로그 가져오기
   */
  private async getCachedCatalog(registry: string): Promise<string[]> {
    const cached = this.catalogCache.get(registry);
    
    // 캐시가 유효한 경우 반환
    if (cached && cached.expiresAt > Date.now()) {
      logger.info(`카탈로그 캐시 히트: ${registry} (${cached.repositories.length}개 저장소)`);
      return cached.repositories;
    }

    // 캐시 미스 또는 만료 - API 호출 후 캐싱
    try {
      const repositories = await this.fetchCatalog(registry);
      const now = Date.now();
      
      this.catalogCache.set(registry, {
        registry,
        repositories,
        fetchedAt: now,
        expiresAt: now + this.catalogCacheTTL,
      });
      
      logger.info(`카탈로그 캐시 저장: ${registry} (${repositories.length}개 저장소, TTL: ${this.catalogCacheTTL / 1000}초)`);
      return repositories;
    } catch (error) {
      // 네트워크 오류 시 만료된 캐시라도 사용 (graceful degradation)
      if (cached) {
        logger.warn(`카탈로그 조회 실패, 만료된 캐시 사용: ${registry}`, { error });
        return cached.repositories;
      }
      logger.error(`레지스트리 ${registry}에서 카탈로그 조회 실패`, { error });
      return [];
    }
  }

  /**
   * 카탈로그 API 호출
   */
  private async fetchCatalog(registry: string): Promise<string[]> {
    const config = this.getRegistryConfig(registry);
    const token = await this.getTokenForRegistry(registry, '');

    const response = await axios.get(`${config.registryUrl}/_catalog`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { n: 1000 }, // 최대 1000개 저장소 조회
      timeout: 30000,
    });

    return response.data.repositories || [];
  }

  /**
   * 특정 레지스트리의 카탈로그 캐시 새로고침
   */
  async refreshCatalogCache(registry: string): Promise<string[]> {
    // 기존 캐시 삭제
    this.catalogCache.delete(registry);
    // 새로 조회
    return this.getCachedCatalog(registry);
  }

  /**
   * 모든 카탈로그 캐시 삭제
   */
  clearCatalogCache(): void {
    this.catalogCache.clear();
    logger.info('모든 카탈로그 캐시 삭제됨');
  }

  /**
   * 카탈로그 캐시 TTL 설정
   */
  setCatalogCacheTTL(ttlMs: number): void {
    this.catalogCacheTTL = ttlMs;
    logger.info(`카탈로그 캐시 TTL 설정: ${ttlMs / 1000}초`);
  }

  /**
   * 카탈로그 캐시 상태 조회
   */
  getCatalogCacheStatus(): Array<{ registry: string; repositoryCount: number; fetchedAt: number; expiresAt: number; isExpired: boolean }> {
    const now = Date.now();
    const status: Array<{ registry: string; repositoryCount: number; fetchedAt: number; expiresAt: number; isExpired: boolean }> = [];
    
    this.catalogCache.forEach((cache) => {
      status.push({
        registry: cache.registry,
        repositoryCount: cache.repositories.length,
        fetchedAt: cache.fetchedAt,
        expiresAt: cache.expiresAt,
        isExpired: cache.expiresAt <= now,
      });
    });
    
    return status;
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
