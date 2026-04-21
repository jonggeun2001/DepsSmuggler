export interface PackageChecksum {
  algorithm: string;
  digest: string;
}

export interface VersionInfo {
  version: string;
  publishedAt?: string;
  yanked?: boolean;
  metadata?: Record<string, unknown>;
}

export interface PackageArtifact {
  filename: string;
  url: string;
  kind: 'archive' | 'binary' | 'metadata' | 'package' | 'sdist' | 'wheel';
  size?: number;
  checksums?: PackageChecksum[];
  requiresPython?: string;
  yanked?: boolean;
  metadata?: Record<string, unknown>;
}

export interface PackageManifest {
  name: string;
  version: string;
  summary?: string;
  description?: string;
  author?: string;
  license?: string;
  homepage?: string;
  artifacts: PackageArtifact[];
  metadata?: Record<string, unknown>;
}

export interface PackageMetadataRequest {
  registryUrl?: string;
  indexUrl?: string;
  headers?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export interface PackageMetadataPort {
  fetchVersions(name: string, request?: PackageMetadataRequest): Promise<VersionInfo[]>;
  fetchManifest(
    name: string,
    version: string,
    request?: PackageMetadataRequest
  ): Promise<PackageManifest>;
}
