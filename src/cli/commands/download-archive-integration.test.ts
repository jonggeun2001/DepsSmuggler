import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';
import * as tar from 'tar';
import { downloadCommand } from './download';

const require = createRequire(import.meta.url);
const yauzl = require('yauzl') as {
  open: (
    filePath: string,
    options: { lazyEntries: boolean },
    callback: (error: Error | null, zipFile?: {
      readEntry: () => void;
      on: (event: string, listener: (...args: any[]) => void) => void;
      openReadStream: (entry: any, callback: (error: Error | null, stream?: NodeJS.ReadableStream) => void) => void;
      close: () => void;
    }) => void,
  ) => void;
};

const {
  reset,
  addToQueue,
  on,
  startDownload,
  generateAllScripts,
  create,
  stop,
  resolveAllDependencies,
} = vi.hoisted(() => ({
  reset: vi.fn(),
  addToQueue: vi.fn(),
  on: vi.fn(),
  startDownload: vi.fn(),
  generateAllScripts: vi.fn(),
  create: vi.fn(() => ({ update: vi.fn() })),
  stop: vi.fn(),
  resolveAllDependencies: vi.fn(),
}));

vi.mock('cli-progress', () => ({
  default: {
    MultiBar: vi.fn(function MultiBarMock() {
      return { create, stop };
    }),
    Presets: { shades_classic: {} },
  },
}));

vi.mock('./download-runner', () => ({
  DownloadManager: vi.fn(function DownloadManagerMock() {
    return { reset, addToQueue, on, startDownload };
  }),
}));

vi.mock('../../core/shared', () => ({
  resolveAllDependencies,
}));

vi.mock('../../core/packager/script-generator', () => ({
  getScriptGenerator: vi.fn(() => ({ generateAllScripts })),
}));

interface ArchiveContents {
  names: string[];
  text: Map<string, string>;
}

async function readZip(filePath: string): Promise<ArchiveContents> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (error, zipFile) => {
      if (error || !zipFile) {
        reject(error ?? new Error('ZIP 열기 실패'));
        return;
      }

      const names: string[] = [];
      const text = new Map<string, string>();
      zipFile.on('error', reject);
      zipFile.on('end', () => resolve({ names, text }));
      zipFile.on('entry', (entry: { fileName: string }) => {
        names.push(entry.fileName);
        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            reject(streamError ?? new Error(`ZIP entry 열기 실패: ${entry.fileName}`));
            zipFile.close();
            return;
          }
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('error', reject);
          stream.on('end', () => {
            text.set(entry.fileName, Buffer.concat(chunks).toString('utf8'));
            zipFile.readEntry();
          });
        });
      });
      zipFile.readEntry();
    });
  });
}

async function readTarGz(filePath: string): Promise<ArchiveContents> {
  const names: string[] = [];
  const text = new Map<string, string>();
  await tar.t({
    file: filePath,
    onentry: (entry) => {
      names.push(entry.path);
      if (entry.type === 'File') {
        const chunks: Buffer[] = [];
        entry.on('data', (chunk: Buffer) => chunks.push(chunk));
        entry.on('end', () => {
          text.set(entry.path, Buffer.concat(chunks).toString('utf8'));
        });
      } else {
        entry.resume();
      }
    },
  });
  return { names, text };
}

describe('downloadCommand Maven archive integration', () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-issue-67-'));
    generateAllScripts.mockResolvedValue(undefined);
    resolveAllDependencies.mockResolvedValue({
      originalPackages: [
        { type: 'maven', name: 'com.example:demo', version: '1.0.0' },
        { type: 'maven', name: 'org.example:parent', version: '1.0.0' },
      ],
      allPackages: [
        { type: 'maven', name: 'com.example:demo', version: '1.0.0' },
        { type: 'maven', name: 'org.example:parent', version: '1.0.0' },
      ],
      dependencyTrees: [],
      failedPackages: [],
    });
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  it.each(['zip', 'tar.gz'] as const)('최종 %s에 완료 Maven artifact와 companion POM/checksum만 넣는다', async (format) => {
    const outputDir = path.join(tempDir, format);
    await fs.ensureDir(outputDir);

    const demoDir = path.join(outputDir, 'com/example/demo/1.0.0');
    const parentDir = path.join(outputDir, 'org/example/parent/1.0.0');
    await fs.ensureDir(demoDir);
    await fs.ensureDir(parentDir);

    const demoJar = path.join(demoDir, 'demo-1.0.0.jar');
    const demoJarSha = `${demoJar}.sha1`;
    const demoPom = path.join(demoDir, 'demo-1.0.0.pom');
    const demoPomSha = `${demoPom}.sha1`;
    const parentPom = path.join(parentDir, 'parent-1.0.0.pom');
    const parentPomSha = `${parentPom}.sha1`;
    const stalePath = path.join(outputDir, 'stale-archive.zip');

    await Promise.all([
      fs.writeFile(demoJar, 'jar'),
      fs.writeFile(demoJarSha, 'jar-sha'),
      fs.writeFile(demoPom, '<project/>'),
      fs.writeFile(demoPomSha, 'pom-sha'),
      fs.writeFile(parentPom, '<project/>'),
      fs.writeFile(parentPomSha, 'parent-sha'),
      fs.writeFile(stalePath, 'must not be archived'),
    ]);

    startDownload.mockResolvedValueOnce({
      success: true,
      totalSize: 42,
      duration: 1,
      items: [
        {
          id: 'maven-demo-1.0.0',
          package: { type: 'maven', name: 'com.example:demo', version: '1.0.0' },
          status: 'completed',
          progress: 100,
          filePath: demoJar,
          filePaths: [demoJar, demoJarSha, demoPom, demoPom, demoPomSha],
        },
        {
          id: 'maven-parent-1.0.0',
          package: { type: 'maven', name: 'org.example:parent', version: '1.0.0' },
          status: 'completed',
          progress: 100,
          filePath: parentPom,
          filePaths: [parentPom, parentPom, parentPomSha],
        },
        {
          id: 'maven-failed-1.0.0',
          package: { type: 'maven', name: 'com.example:failed', version: '1.0.0' },
          status: 'failed',
          progress: 0,
          filePath: stalePath,
          filePaths: [stalePath],
        },
      ],
    });

    await downloadCommand({
      type: 'maven',
      package: 'com.example:demo',
      pkgVersion: '1.0.0',
      arch: 'x86_64',
      targetOS: 'any',
      condaChannel: 'conda-forge',
      output: outputDir,
      format,
      deps: true,
      concurrency: '1',
    } as Parameters<typeof downloadCommand>[0]);

    const archivePath = (await fs.readdir(outputDir))
      .filter((entry) => entry.startsWith('packages-') && entry.endsWith(format === 'zip' ? '.zip' : '.tar.gz'))
      .map((entry) => path.join(outputDir, entry))[0];
    expect(archivePath).toBeDefined();

    const archive = format === 'zip'
      ? await readZip(archivePath)
      : await readTarGz(archivePath);
    const expectedNames = [
      'packages/com/example/demo/1.0.0/demo-1.0.0.jar',
      'packages/com/example/demo/1.0.0/demo-1.0.0.jar.sha1',
      'packages/com/example/demo/1.0.0/demo-1.0.0.pom',
      'packages/com/example/demo/1.0.0/demo-1.0.0.pom.sha1',
      'packages/org/example/parent/1.0.0/parent-1.0.0.pom',
      'packages/org/example/parent/1.0.0/parent-1.0.0.pom.sha1',
      'manifest.json',
      'README.txt',
    ];

    expect([...archive.names].sort()).toEqual([...expectedNames].sort());
    expect(archive.names.filter((name) => name === 'packages/com/example/demo/1.0.0/demo-1.0.0.pom'))
      .toHaveLength(1);
    expect(JSON.parse(archive.text.get('manifest.json') ?? '{}').packages).toHaveLength(2);
  });
});
