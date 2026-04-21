import type { PackageType } from './package-manager';
import type { Architecture } from '../platform/architecture';

export interface PackageMetadata {
  description?: string;
  author?: string;
  license?: string;
  homepage?: string;
  repository?: string;
  size?: number;
  checksum?: {
    md5?: string;
    sha1?: string;
    sha256?: string;
    sha512?: string;
  };
  downloadUrl?: string;
  groupId?: string;
  artifactId?: string;
  registry?: string;
  tag?: string;
  digest?: string;
  pythonVersion?: string;
  wheelTags?: string[];
  [key: string]: unknown;
}

export interface PackageInfo {
  type: PackageType;
  name: string;
  version: string;
  arch?: Architecture;
  metadata?: PackageMetadata;
}
