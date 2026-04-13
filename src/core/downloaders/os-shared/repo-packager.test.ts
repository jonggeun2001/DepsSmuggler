import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { gunzipSync } from 'zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OSRepoPackager } from './repo-packager';
import type { OSPackageInfo } from './types';
import { getDownloadedFileKey } from './package-file-utils';

function createRpmPackage(): OSPackageInfo {
  return {
    name: 'httpd',
    version: '2.4.57',
    release: '3.el9',
    architecture: 'x86_64',
    size: 1024,
    checksum: {
      type: 'sha256',
      value: 'checksum-httpd',
    },
    location: 'Packages/httpd-2.4.57-3.el9.x86_64.rpm',
    repository: {
      id: 'baseos',
      name: 'BaseOS',
      baseUrl: 'https://example.test/baseos',
      enabled: true,
      gpgCheck: false,
      isOfficial: true,
    },
    dependencies: [],
    summary: 'Apache HTTP Server',
    description: 'Apache HTTP Server',
  };
}

describe('OSRepoPackager', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'depssmuggler-repo-packager-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('YUM 메타데이터에 실제 RPM release와 파일명을 반영한다', async () => {
    const packager = new OSRepoPackager();
    const pkg = createRpmPackage();
    const downloadedFile = path.join(tempDir, 'httpd-2.4.57-3.el9.x86_64.rpm');
    fs.writeFileSync(downloadedFile, 'rpm');

    const result = await packager.createLocalRepo(
      [pkg],
      new Map([[getDownloadedFileKey(pkg), downloadedFile]]),
      {
        packageManager: 'yum',
        outputPath: path.join(tempDir, 'repo'),
        repoName: 'test-repo',
      }
    );

    const primaryXmlGz = result.metadataFiles.find((file) => file.endsWith('primary.xml.gz'));
    expect(primaryXmlGz).toBeTruthy();

    const content = gunzipSync(fs.readFileSync(primaryXmlGz!)).toString('utf8');
    expect(content).toContain('Packages/httpd-2.4.57-3.el9.x86_64.rpm');
    expect(content).toContain('rel="3.el9"');
  });
});
