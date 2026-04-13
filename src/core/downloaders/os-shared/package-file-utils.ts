import type { OSPackageInfo, OSPackageManager } from './types';

export function getDownloadedFileKey(pkg: OSPackageInfo): string {
  return JSON.stringify([
    pkg.name,
    pkg.version,
    pkg.release ?? '',
    pkg.architecture,
  ]);
}

export function getPackageFilename(
  pkg: OSPackageInfo,
  packageManager: OSPackageManager
): string {
  switch (packageManager) {
    case 'yum': {
      const release = pkg.release ? `-${pkg.release}` : '';
      return `${pkg.name}-${pkg.version}${release}.${pkg.architecture}.rpm`;
    }
    case 'apt': {
      const arch = pkg.architecture === 'x86_64' ? 'amd64' : pkg.architecture;
      return `${pkg.name}_${pkg.version}_${arch}.deb`;
    }
    case 'apk':
      return `${pkg.name}-${pkg.version}.apk`;
    default:
      return `${pkg.name}-${pkg.version}`;
  }
}
