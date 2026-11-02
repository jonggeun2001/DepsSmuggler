import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import satisfies from 'semver/functions/satisfies';

interface PackageMetadata {
  version?: unknown;
  engines?: { node?: unknown };
}

/**
 * Finds the package metadata that belongs to this CLI installation.
 *
 * The Electron build creates a `dist/package.json` containing only the module
 * type, so metadata lookup must continue upward until it finds a real version.
 * Starting from `__dirname` keeps this independent of the caller's cwd.
 */
function getPackageMetadata(startDirectory = __dirname): PackageMetadata & { version: string } {
  let directory = startDirectory;

  while (directory.length > 0) {
    const metadataPath = join(directory, 'package.json');
    try {
      const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as PackageMetadata;
      if (typeof metadata.version === 'string' && metadata.version.length > 0) {
        return { ...metadata, version: metadata.version };
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

export function getPackageVersion(startDirectory = __dirname): string {
  return getPackageMetadata(startDirectory).version;
}

/** Keep help/version available, but reject command execution on unpatched runtimes. */
export function assertSupportedNodeVersion(version = process.versions.node): void {
  const range = getPackageMetadata().engines?.node;
  if (typeof range !== 'string' || !satisfies(version, range)) {
    throw new Error(
      `지원하지 않는 Node.js ${version}입니다. 보안 패치가 포함된 Node.js ${String(range)}를 사용하세요.`
    );
  }
}
