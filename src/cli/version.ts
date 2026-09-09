import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

interface PackageMetadata {
  version?: unknown;
}

/**
 * Finds the package metadata that belongs to this CLI installation.
 *
 * The Electron build creates a `dist/package.json` containing only the module
 * type, so metadata lookup must continue upward until it finds a real version.
 * Starting from `__dirname` keeps this independent of the caller's cwd.
 */
export function getPackageVersion(startDirectory = __dirname): string {
  let directory = startDirectory;

  while (directory.length > 0) {
    const metadataPath = join(directory, 'package.json');
    try {
      const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as PackageMetadata;
      if (typeof metadata.version === 'string' && metadata.version.length > 0) {
        return metadata.version;
      }
    } catch {
      // Continue searching parent directories when this is not package metadata.
    }

    const parentDirectory = dirname(directory);
    if (parentDirectory === directory) {
      break;
    }
    directory = parentDirectory;
  }

  throw new Error(`패키지 버전 정보를 찾을 수 없습니다: ${startDirectory}`);
}
