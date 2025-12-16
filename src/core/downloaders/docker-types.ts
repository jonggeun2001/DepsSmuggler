/**
 * Docker 관련 공통 타입 정의
 *
 * DockerDownloader 모듈에서 사용되는 인터페이스와 타입들
 */

// Docker Hub 검색 응답
export interface DockerSearchResponse {
  count: number;
  results: DockerSearchResult[];
}

export interface DockerSearchResult {
  repo_name: string;
  short_description: string;
  star_count: number;
  is_official: boolean;
  is_automated: boolean;
}

// Docker Hub 태그 응답
export interface DockerTagsResponse {
  count: number;
  results: DockerTag[];
}

export interface DockerTag {
  name: string;
  full_size: number;
  images: {
    architecture: string;
    os: string;
    digest: string;
    size: number;
  }[];
}

// Docker 매니페스트 엔트리 (멀티 아키텍처용)
export interface DockerManifestEntry {
  mediaType: string;
  size: number;
  digest: string;
  platform: {
    architecture: string;
    os: string;
    variant?: string;
  };
}

// Docker 매니페스트
export interface DockerManifest {
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
  manifests?: DockerManifestEntry[];
}

// Quay.io 검색 응답
export interface QuaySearchResponse {
  results: Array<{
    namespace: { name: string };
    name: string;
    description: string | null;
    is_public: boolean;
  }>;
}
