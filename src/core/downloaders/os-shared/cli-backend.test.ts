import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OSDistribution, OSPackageInfo } from './types';
import { getDownloadedFileKey } from './package-file-utils';
import {
  clearOSPackageCache,
  downloadOSPackages,
  getOSPackageCacheStats,
} from './cli-backend';

const {
  searchPackages,
  resolveDependencies,
  downloadPackages,
  createArchive,
  createLocalRepo,
  generateDependencyOrderScript,
} = vi.hoisted(() => ({
  searchPackages: vi.fn(),
  resolveDependencies: vi.fn(),
  downloadPackages: vi.fn(),
  createArchive: vi.fn(),
  createLocalRepo: vi.fn(),
  generateDependencyOrderScript: vi.fn(),
}));

vi.mock('../../resolver/yum-resolver', () => ({
  YumDependencyResolver: vi.fn().mockImplementation(() => ({
    searchPackages,
    resolveDependencies,
  })),
}));

vi.mock('../../downloaders/yum', () => ({
  YumDownloader: vi.fn().mockImplementation(() => ({
    downloadPackages,
  })),
}));

vi.mock('./archive-packager', () => ({
  OSArchivePackager: vi.fn().mockImplementation(() => ({
    createArchive,
  })),
}));

vi.mock('./repo-packager', () => ({
  OSRepoPackager: vi.fn().mockImplementation(() => ({
    createLocalRepo,
  })),
}));

vi.mock('./script-generator', () => ({
  OSScriptGenerator: vi.fn().mockImplementation(() => ({
    generateDependencyOrderScript,
  })),
}));

function createPackage(
  name: string,
  version: string,
  overrides: Partial<OSPackageInfo> = {}
): OSPackageInfo {
  return {
    name,
    version,
    architecture: 'x86_64',
    size: 1024,
    checksum: {
      type: 'sha256',
      value: `${name}-${version}`,
    },
    location: `${name}-${version}.rpm`,
    repository: {
      id: 'baseos',
      name: 'BaseOS',
      baseUrl: 'https://example.test/baseos',
      enabled: true,
      gpgCheck: false,
      isOfficial: true,
    },
    dependencies: [],
    ...overrides,
  };
}

describe('OS CLI backend', () => {
  let tempDir: string;
  let distro: OSDistribution;

  beforeEach(() => {
    vi.clearAllMocks();

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'depssmuggler-os-cli-'));
    distro = {
      id: 'rocky-9',
      name: 'Rocky Linux 9',
      version: '9',
      packageManager: 'yum',
      architectures: ['x86_64'],
      defaultRepos: [
        {
          id: 'baseos',
          name: 'BaseOS',
          baseUrl: 'https://example.test/baseos',
          enabled: true,
          gpgCheck: false,
          isOfficial: true,
        },
      ],
      extendedRepos: [],
    };
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('both 출력일 때 다운로드 후 아카이브와 로컬 저장소를 모두 생성한다', async () => {
    const httpd = createPackage('httpd', '2.4.57');
    const apr = createPackage('apr', '1.7.0');
    const aprUtilOld = createPackage('apr-util', '1.6.1');
    const aprUtilNew = createPackage('apr-util', '1.7.0');

    searchPackages.mockResolvedValue([
      { name: 'httpd', latest: httpd, versions: [httpd] },
    ]);
    resolveDependencies.mockResolvedValue({
      packages: [httpd, apr],
      unresolved: [],
      conflicts: [
        {
          package: 'apr-util',
          versions: [aprUtilOld, aprUtilNew],
        },
      ],
      warnings: ['version conflict'],
    });
    downloadPackages.mockResolvedValue({
      success: [httpd, apr, aprUtilOld, aprUtilNew],
      failed: [],
      downloadedFiles: new Map([
        [getDownloadedFileKey(httpd), path.join(tempDir, 'httpd.rpm')],
        [getDownloadedFileKey(apr), path.join(tempDir, 'apr.rpm')],
        [getDownloadedFileKey(aprUtilOld), path.join(tempDir, 'apr-util-1.6.1.rpm')],
        [getDownloadedFileKey(aprUtilNew), path.join(tempDir, 'apr-util-1.7.0.rpm')],
      ]),
    });
    createArchive.mockResolvedValue(path.join(tempDir, 'bundle.zip'));
    createLocalRepo.mockResolvedValue({
      repoPath: path.join(tempDir, 'repo'),
      packageCount: 4,
      totalSize: 4096,
      metadataFiles: [path.join(tempDir, 'repo', 'repodata', 'repomd.xml')],
    });
    generateDependencyOrderScript.mockReturnValue({
      bash: '#!/bin/bash\necho install\n',
      powershell: 'Write-Host "install"\n',
    });

    const result = await downloadOSPackages({
      distribution: distro,
      architecture: 'x86_64',
      packageNames: ['httpd'],
      outputPath: path.join(tempDir, 'artifacts'),
      outputType: 'both',
      archiveFormat: 'zip',
      resolveDependencies: true,
      includeScripts: true,
      concurrency: 3,
      cacheDirectory: path.join(tempDir, 'cache'),
      cacheEnabled: true,
    });

    expect(searchPackages).toHaveBeenCalledWith('httpd', 'exact');
    expect(resolveDependencies).toHaveBeenCalledWith([httpd]);
    expect(downloadPackages).toHaveBeenCalledWith([
      httpd,
      apr,
      aprUtilOld,
      aprUtilNew,
    ]);
    expect(createArchive).toHaveBeenCalled();
    expect(createLocalRepo).toHaveBeenCalled();
    expect(generateDependencyOrderScript).toHaveBeenCalledWith(
      [httpd, apr, aprUtilOld, aprUtilNew],
      'yum',
      expect.any(Object)
    );
    expect(result.artifacts).toEqual([
      { type: 'archive', path: path.join(tempDir, 'bundle.zip') },
      { type: 'repository', path: path.join(tempDir, 'repo') },
    ]);
    expect(result.warnings).toEqual(['version conflict']);
  });

  it('OS 메타데이터 캐시 통계와 삭제를 실제 디렉토리에 반영한다', async () => {
    const cacheDir = path.join(tempDir, 'cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'entry-a.json'), '{"key":"a"}');
    fs.writeFileSync(path.join(cacheDir, 'entry-b.json'), '{"key":"bb"}');
    fs.writeFileSync(path.join(cacheDir, 'ignore.txt'), 'ignore');

    const before = await getOSPackageCacheStats(cacheDir);
    expect(before.entryCount).toBe(2);
    expect(before.totalSize).toBeGreaterThan(0);

    const cleared = await clearOSPackageCache(cacheDir);
    expect(cleared.clearedEntries).toBe(2);

    const after = await getOSPackageCacheStats(cacheDir);
    expect(after.entryCount).toBe(0);
  });
});
