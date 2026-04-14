import type { OSPackageInfo } from '../../../core/downloaders/os-shared/types';
import type { Architecture, PackageType } from '../../stores/cart-store';

export type CategoryType = 'library' | 'os' | 'container';

export interface SearchResult {
  name: string;
  version: string;
  description?: string;
  versions?: string[];
  downloadUrl?: string;
  repository?: { baseUrl: string; name?: string };
  location?: string;
  architecture?: string;
  osPackageInfo?: OSPackageInfo;
  registry?: string;
  isOfficial?: boolean;
  pullCount?: number;
  popularityCount?: number;
  groupId?: string;
  artifactId?: string;
}

export interface OSCartContextSnapshot {
  distributionId: string;
  architecture: Architecture;
  packageManager: 'yum' | 'apt' | 'apk';
}

export const LIBRARY_PACKAGE_TYPES: PackageType[] = ['pip', 'conda', 'maven', 'npm'];
export const OS_PACKAGE_TYPES: PackageType[] = ['yum', 'apt', 'apk'];

export const PACKAGE_TYPE_TO_CATEGORY: Record<PackageType, CategoryType> = {
  pip: 'library',
  conda: 'library',
  maven: 'library',
  npm: 'library',
  yum: 'os',
  apt: 'os',
  apk: 'os',
  docker: 'container',
};

export function isPackageType(value: string): value is PackageType {
  return Object.prototype.hasOwnProperty.call(PACKAGE_TYPE_TO_CATEGORY, value);
}
