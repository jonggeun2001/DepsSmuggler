import { describe, expect, it } from 'vitest';
import { getDownloadedFileKey } from './package-file-utils';
import type { OSPackageInfo } from './types';

function createPackage(
  name: string,
  version: string,
  release = '',
  architecture: OSPackageInfo['architecture'] = 'amd64'
): OSPackageInfo {
  return {
    name,
    version,
    release: release || undefined,
    architecture,
    size: 1,
    checksum: {
      type: 'sha256',
      value: `${name}-${version}`,
    },
    location: `${name}.pkg`,
    repository: {
      id: 'repo',
      name: 'Repo',
      baseUrl: 'https://example.test/repo',
      enabled: true,
      gpgCheck: false,
      isOfficial: true,
    },
    dependencies: [],
  };
}

describe('package-file-utils', () => {
  it('구조화된 다운로드 키로 필드 경계 충돌을 피한다', () => {
    const first = createPackage('foo-1', '2');
    const second = createPackage('foo', '1-2');

    expect(getDownloadedFileKey(first)).not.toBe(getDownloadedFileKey(second));
  });
});
