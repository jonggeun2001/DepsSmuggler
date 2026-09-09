/**
 * 실제 Rocky Linux YUM metadata/API 통합 테스트
 *
 * 실행 방법:
 *   INTEGRATION_TEST=true npm test -- yum.integration.test.ts
 *
 * 기본 테스트에서는 네트워크를 사용하지 않도록 전체 suite를 skip한다.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import * as yauzl from 'yauzl';
import { downloadOSPackages, searchOSPackages } from './os-shared/cli-backend';
import { getDistributionById } from './os-shared/repositories';

const INTEGRATION_TEST = process.env.INTEGRATION_TEST === 'true';
const describeIntegration = INTEGRATION_TEST ? describe : describe.skip;

function listZipEntries(archivePath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true }, (error, zipFile) => {
      if (error || !zipFile) {
        reject(error ?? new Error('ZIP archive could not be opened'));
        return;
      }

      const entries: string[] = [];
      zipFile.readEntry();
      zipFile.on('entry', (entry) => {
        entries.push(entry.fileName);
        zipFile.readEntry();
      });
      zipFile.once('end', () => {
        zipFile.close();
        resolve(entries);
      });
      zipFile.once('error', (zipError) => {
        zipFile.close();
        reject(zipError);
      });
    });
  });
}

describeIntegration('Rocky Linux 9 YUM metadata and archive integration', () => {
  const distribution = getDistributionById('rocky-9');
  let tempDir: string;

  afterAll(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('finds zlib from real metadata with a bounded search result', async () => {
    if (!distribution) throw new Error('rocky-9 distribution is not configured');
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-yum-integration-'));

    const results = await searchOSPackages({
      distribution,
      architecture: 'x86_64',
      query: 'zlib',
      limit: 3,
      cacheDirectory: path.join(tempDir, 'cache'),
      cacheEnabled: true,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(3);
    const zlib = results.find((result) => result.name === 'zlib');
    expect(zlib).toBeDefined();
    expect(zlib?.latest.name).toBe('zlib');
    expect(zlib?.latest.architecture).toBe('x86_64');
    expect(zlib?.latest.version).toBeTruthy();
    expect(zlib?.latest.release).toBeTruthy();
    expect(zlib?.latest.checksum.value).toMatch(/^[a-f0-9]+$/i);
  }, 300_000);

  it('downloads the real zlib RPM into a ZIP without dependency expansion', async () => {
    if (!distribution) throw new Error('rocky-9 distribution is not configured');
    if (!tempDir) {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-yum-integration-'));
    }
    const outputPath = path.join(tempDir, 'download-output');

    const result = await downloadOSPackages({
      distribution,
      architecture: 'x86_64',
      packageNames: ['zlib'],
      outputPath,
      outputType: 'archive',
      archiveFormat: 'zip',
      resolveDependencies: false,
      includeScripts: false,
      concurrency: 1,
      cacheDirectory: path.join(tempDir, 'cache'),
      cacheEnabled: true,
    });

    expect(result.requestedPackages).toHaveLength(1);
    expect(result.requestedPackages[0].name).toBe('zlib');
    expect(result.requestedPackages[0].architecture).toBe('x86_64');
    expect(result.requestedPackages[0].version).toBeTruthy();
    expect(result.requestedPackages[0].release).toBeTruthy();
    expect(result.requestedPackages[0].checksum.value).toMatch(/^[a-f0-9]+$/i);
    expect(result.packages).toHaveLength(1);
    expect(result.packages[0].name).toBe('zlib');
    expect(result.unresolved).toEqual([]);
    expect(result.artifacts).toHaveLength(1);

    const archivePath = result.artifacts[0].path;
    const entries = await listZipEntries(archivePath);
    const rpmEntries = entries.filter((entry) => entry.toLowerCase().endsWith('.rpm'));
    expect(rpmEntries).toHaveLength(1);
    expect(rpmEntries[0]).toContain('zlib-');
    expect(rpmEntries[0]).toContain(result.packages[0].version);
    expect(rpmEntries[0]).toContain(result.packages[0].architecture);
    const archiveStats = await fs.stat(archivePath);
    expect(archiveStats.isFile()).toBe(true);
  }, 300_000);
});
