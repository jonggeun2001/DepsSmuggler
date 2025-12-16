/**
 * Docker Manifest Service
 *
 * Docker Registry에서 매니페스트 조회 담당
 */

import axios from 'axios';
import { DockerManifest, DockerManifestEntry } from './docker-types';
import { DockerAuthClient } from './docker-auth-client';

/**
 * Docker 매니페스트 서비스
 *
 * 레지스트리에서 매니페스트 조회 및 아키텍처별 매니페스트 선택
 */
export class DockerManifestService {
  constructor(private authClient: DockerAuthClient) {}

  /**
   * 매니페스트 조회
   *
   * @param repository 저장소 (예: library/nginx)
   * @param reference 태그 또는 다이제스트
   * @param token 인증 토큰
   * @param registry 레지스트리 (기본값: docker.io)
   */
  async getManifest(
    repository: string,
    reference: string,
    token: string,
    registry: string = 'docker.io'
  ): Promise<DockerManifest> {
    const config = this.authClient.getRegistryConfig(registry);
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
   * 멀티 아키텍처 매니페스트에서 특정 아키텍처 매니페스트 찾기
   *
   * @param manifest 원본 매니페스트
   * @param arch 아키텍처 (예: amd64, arm64)
   * @param variant 변형 (예: v7, v8)
   */
  findArchitectureManifest(
    manifest: DockerManifest,
    arch: string,
    variant?: string
  ): DockerManifestEntry | undefined {
    if (!manifest.manifests) return undefined;

    return manifest.manifests.find((m) => {
      const archMatch = m.platform.architecture === arch;
      const osMatch = m.platform.os === 'linux';
      const variantMatch = !variant || m.platform.variant === variant;
      return archMatch && osMatch && variantMatch;
    });
  }

  /**
   * 특정 아키텍처의 매니페스트 조회
   *
   * 멀티 아키텍처 이미지인 경우 해당 아키텍처의 매니페스트를 자동으로 선택
   *
   * @param repository 저장소
   * @param reference 태그 또는 다이제스트
   * @param token 인증 토큰
   * @param registry 레지스트리
   * @param arch 아키텍처
   * @param variant 변형 (optional)
   */
  async getManifestForArchitecture(
    repository: string,
    reference: string,
    token: string,
    registry: string,
    arch: string,
    variant?: string
  ): Promise<DockerManifest> {
    let manifest = await this.getManifest(repository, reference, token, registry);

    // 멀티 아키텍처인 경우 해당 아키텍처 매니페스트 찾기
    if (manifest.manifests) {
      const archManifest = this.findArchitectureManifest(manifest, arch, variant);

      if (!archManifest) {
        const available = manifest.manifests.map(
          (m) => `${m.platform.os}/${m.platform.architecture}${m.platform.variant ? `/${m.platform.variant}` : ''}`
        );
        throw new Error(
          `아키텍처 ${arch}${variant ? `/${variant}` : ''}를 지원하지 않습니다. 지원 아키텍처: ${available.join(', ')}`
        );
      }

      manifest = await this.getManifest(repository, archManifest.digest, token, registry);
    }

    return manifest;
  }
}
