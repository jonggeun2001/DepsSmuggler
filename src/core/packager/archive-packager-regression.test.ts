import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import * as tar from 'tar';
import { getArchivePackager } from './archive-packager';
import type { PackageInfo } from '../../types';

describe('ArchivePackager regression', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `archive-packager-regression-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.ensureDir(tempDir);
  });

  afterEach(async () => {
    if (await fs.pathExists(tempDir)) {
      await fs.remove(tempDir);
    }
  });

  it('준비된 다운로드 디렉터리에서 tar.gz를 만들 때 scripts/packages/manifest/readme를 모두 포함해야 함', async () => {
    const sourceDir = path.join(tempDir, 'download-output');
    const packagesDir = path.join(sourceDir, 'packages');
    await fs.ensureDir(packagesDir);
    await fs.writeFile(path.join(packagesDir, 'requests-2.28.0.whl'), 'wheel-content');
    await fs.writeFile(path.join(sourceDir, 'install.sh'), '#!/bin/sh\necho install\n');

    const outputPath = path.join(tempDir, 'download-output.tar.gz');
    const packages: PackageInfo[] = [
      { type: 'pip', name: 'requests', version: '2.28.0' },
    ];

    const result = await getArchivePackager().createArchiveFromDirectory(
      sourceDir,
      outputPath,
      packages,
      { format: 'tar.gz' }
    );

    expect(result).toBe(outputPath);
    expect(await fs.pathExists(outputPath)).toBe(true);

    const entries: string[] = [];
    await tar.t({
      file: outputPath,
      onentry: (entry) => {
        entries.push(entry.path);
      },
    });

    expect(entries).toEqual(
      expect.arrayContaining([
        'packages/',
        'packages/requests-2.28.0.whl',
        'install.sh',
        'manifest.json',
        'README.txt',
      ])
    );
  });

  it.each(['manifest.json', 'README.txt', 'packages'])('루트 파일 %s가 기본 압축 경로를 덮어쓰지 못한다', async (filename) => {
    const source = path.join(tempDir, filename);
    const output = path.join(tempDir, 'bundle.zip');
    await fs.writeFile(source, 'conflicting content');
    await expect(getArchivePackager().createArchive([], output, [], {
      format: 'zip', rootFiles: [source],
    })).rejects.toThrow('압축 루트 파일 이름이 중복됩니다');
    expect(await fs.pathExists(output)).toBe(false);
  });

  it('서로 다른 디렉터리의 같은 루트 파일 이름을 거부한다', async () => {
    const first = path.join(tempDir, 'one/install.sh');
    const second = path.join(tempDir, 'two/install.sh');
    await fs.outputFile(first, 'first');
    await fs.outputFile(second, 'second');
    const output = path.join(tempDir, 'bundle.tar.gz');
    await expect(getArchivePackager().createArchive([], output, [], {
      format: 'tar.gz', rootFiles: [first, second],
    })).rejects.toThrow('압축 루트 파일 이름이 중복됩니다');
    expect(await fs.pathExists(output)).toBe(false);
  });

  it('필수 루트 파일이 없으면 압축물을 만들지 않는다', async () => {
    const output = path.join(tempDir, 'bundle.zip');
    await expect(getArchivePackager().createArchive([], output, [], {
      format: 'zip', rootFiles: [path.join(tempDir, 'install.sh')],
    })).rejects.toThrow();
    expect(await fs.pathExists(output)).toBe(false);
  });

});
