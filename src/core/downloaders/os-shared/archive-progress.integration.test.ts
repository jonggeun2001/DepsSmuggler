import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OSArchivePackager } from './archive-packager';
import { getDownloadedFileKey } from './package-file-utils';
import type { OSPackageInfo } from './types';
import type { ArchiveProgress } from '../../../types/packaging';

describe('OS archive progress', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'os-archive-progress-'));
  });
  afterEach(async () => {
    await fs.remove(directory);
  });

  it.each(['zip', 'tar.gz'] as const)(
    '%s 파일의 실제 크기를 사용하며 저장이 끝나면 완료한다',
    async (format) => {
      const pkg: OSPackageInfo = {
        name: 'example',
        version: '1.0',
        architecture: 'amd64',
        size: 999,
        location: 'example.deb',
        dependencies: [],
        checksum: { type: 'sha256', value: '' },
        repository: {
          id: 'main',
          name: 'main',
          baseUrl: '',
          enabled: true,
          gpgCheck: false,
          isOfficial: true,
        },
      };
      const source = path.join(directory, 'example.deb');
      await fs.writeFile(source, 'content');
      const output = path.join(directory, `bundle.${format}`);
      const updates: ArchiveProgress[] = [];
      await new OSArchivePackager().createArchive(
        [pkg],
        new Map([[getDownloadedFileKey(pkg), source]]),
        {
          format,
          outputPath: output,
          includeScripts: true,
          scriptTypes: ['dependency-order'],
          packageManager: 'apt',
          onProgress: (progress) => {
            updates.push(progress);
            if (progress.percentage === 100)
              expect(progress.outputBytes).toBe(fs.statSync(output).size);
          },
        }
      );
      expect(updates[0]).toMatchObject({ percentage: 0, processedFiles: 0, totalBytes: 7 });
      expect(updates.at(-1)).toMatchObject({
        percentage: 100,
        processedFiles: 1,
        totalFiles: 1,
        processedBytes: 7,
      });
    }
  );
});
