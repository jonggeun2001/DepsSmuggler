/**
 * Docker Search Service
 *
 * Docker Registry에서 이미지 검색 및 태그 조회 담당
 */

import axios, { AxiosInstance } from 'axios';
import { PackageInfo, PackageMetadata } from '../../types';
import logger from '../../utils/logger';
import { DockerSearchResponse, DockerTagsResponse, QuaySearchResponse, DockerManifest } from './docker-types';
import { getRegistryType, extractRegistry, parseImageName } from './docker-utils';
import { DockerAuthClient } from './docker-auth-client';
import { DockerCatalogCache } from './docker-catalog-cache';
import { DockerManifestService } from './docker-manifest-service';
import { DOCKER_CONSTANTS } from '../constants/docker';

/**
 * Docker 검색 서비스
 *
 * 이미지 검색, 태그 목록 조회, 메타데이터 조회
 */
export class DockerSearchService {
  private hubClient: AxiosInstance;

  constructor(
    private authClient: DockerAuthClient,
    private catalogCache: DockerCatalogCache,
    private manifestService: DockerManifestService
  ) {
    this.hubClient = axios.create({
      baseURL: DOCKER_CONSTANTS.HUB_API_URL,
      timeout: DOCKER_CONSTANTS.API_TIMEOUT_MS,
    });
  }

  /**
   * 이미지 검색
   *
   * @param query 검색어
   * @param registry 레지스트리 (기본값: docker.io)
   */
  async searchPackages(query: string, registry: string = 'docker.io'): Promise<PackageInfo[]> {
    try {
      const registryType = getRegistryType(registry);

      // Docker Hub 검색 API
      if (registryType === 'docker.io') {
        return this.searchDockerHub(query);
      }

      // Quay.io 검색 API
      if (registryType === 'quay.io') {
        return this.searchQuay(query);
      }

      // ghcr.io, ECR 등은 공개 검색 API가 없음
      if (registryType === 'ghcr.io' || registryType === 'ecr') {
        logger.info(`${registry}는 검색 API를 지원하지 않습니다. 이미지 이름을 직접 입력해주세요.`);
        return [
          {
            type: 'docker',
            name: `${registry}/${query}`,
            version: 'latest',
            metadata: {
              description: `"${query}" 이미지를 ${registry}에서 가져옵니다. (검색 미지원 - 정확한 이미지명 입력 필요)`,
              registry,
            },
          },
        ];
      }

      // 커스텀 레지스트리는 캐시된 카탈로그 사용 시도
      return this.searchCustomRegistry(query, registry);
    } catch (error) {
      logger.error('Docker 이미지 검색 실패', { query, registry, error });
      throw error;
    }
  }

  /**
   * Docker Hub 검색
   */
  private async searchDockerHub(query: string): Promise<PackageInfo[]> {
    const response = await this.hubClient.get<DockerSearchResponse>('/search/repositories/', {
      params: { query, page_size: 50 },
    });

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

  /**
   * Quay.io 검색
   */
  private async searchQuay(query: string): Promise<PackageInfo[]> {
    const response = await axios.get<QuaySearchResponse>('https://quay.io/api/v1/find/repositories', {
      params: { query },
      timeout: 30000,
    });

    return response.data.results
      .filter((repo) => repo.is_public)
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

  /**
   * 커스텀 레지스트리 검색 (캐시 기반)
   */
  private async searchCustomRegistry(query: string, registry: string): Promise<PackageInfo[]> {
    const repositories = await this.catalogCache.getCachedCatalog(registry);
    const filtered = repositories.filter((name) => name.toLowerCase().includes(query.toLowerCase()));

    return filtered.slice(0, 50).map((name) => ({
      type: 'docker',
      name: `${registry}/${name}`,
      version: 'latest',
      metadata: {
        registry,
      },
    }));
  }

  /**
   * 태그 목록 조회
   *
   * @param packageName 패키지 이름 (레지스트리 포함 가능: docker.io/library/nginx)
   * @param registry 레지스트리 (기본값: docker.io, 이름에 레지스트리가 포함되면 무시됨)
   */
  async getVersions(packageName: string, registry: string = 'docker.io'): Promise<string[]> {
    const extracted = extractRegistry(packageName);
    const effectiveRegistry = extracted.registry || registry;

    try {
      const [namespace, repo] = parseImageName(packageName);
      const registryType = getRegistryType(effectiveRegistry);

      // Docker Hub의 경우 Hub API 사용
      if (registryType === 'docker.io') {
        const response = await this.hubClient.get<DockerTagsResponse>(
          `/repositories/${namespace}/${repo}/tags`,
          { params: { page_size: 100 } }
        );
        return response.data.results.map((tag) => tag.name);
      }

      // 다른 레지스트리는 Registry API 사용
      const config = this.authClient.getRegistryConfig(effectiveRegistry);
      const fullName = `${namespace}/${repo}`;
      const token = await this.authClient.getTokenForRegistry(effectiveRegistry, fullName);

      const response = await axios.get(`${config.registryUrl}/${fullName}/tags/list`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      return response.data.tags || [];
    } catch (error) {
      logger.error('Docker 태그 목록 조회 실패', {
        packageName,
        registry: effectiveRegistry,
        error,
      });
      throw error;
    }
  }

  /**
   * 이미지 메타데이터 조회
   */
  async getPackageMetadata(name: string, version: string): Promise<PackageInfo> {
    try {
      const [namespace, repo] = parseImageName(name);
      const tag = version || 'latest';

      // 토큰 획득
      const token = await this.authClient.getToken(`${namespace}/${repo}`);

      // 매니페스트 조회
      const manifest = await this.manifestService.getManifest(`${namespace}/${repo}`, tag, token);

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
}
