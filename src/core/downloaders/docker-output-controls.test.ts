import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as tar from 'tar';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DockerDownloader } from './docker';

const roots: string[] = [];

type DockerInternals = {
  authClient: { getTokenForRegistry: (...args: unknown[]) => Promise<string> };
  manifestService: { getManifestForArchitecture: (...args: unknown[]) => Promise<unknown> };
  blobDownloader: {
    downloadBlob: (...args: unknown[]) => Promise<void>;
    createImageTar: (source: string, target: string) => Promise<void>;
  };
};

function internals(downloader: DockerDownloader): DockerInternals {
  return downloader as unknown as DockerInternals;
}

async function configureDownloader(downloader: DockerDownloader, imageDirs: string[]): Promise<void> {
  const { authClient, manifestService, blobDownloader } = internals(downloader);
  authClient.getTokenForRegistry = vi.fn().mockResolvedValue('fixture-token');
  manifestService.getManifestForArchitecture = vi.fn().mockResolvedValue({
    config: { digest: 'sha256:config' }, layers: [{ digest: 'sha256:layer', size: 16 }],
  });
  blobDownloader.downloadBlob = vi.fn(async (_repo: string, digest: string, destPath: string) => {
    imageDirs.push(path.dirname(destPath));
    await fs.writeFile(destPath, Buffer.from(`${digest}-fixture`));
  });
}

async function readDockerArchive(archivePath: string, root: string): Promise<{
  names: string[];
  manifest: Array<{ Config: string; Layers: string[] }>;
}> {
  const extractPath = path.join(root, 'archive-extracted');
  await fs.ensureDir(extractPath);
  const names: string[] = [];
  await tar.extract({ file: archivePath, cwd: extractPath, onentry: (entry) => names.push(entry.path) });
  return { names, manifest: await fs.readJson(path.join(extractPath, 'manifest.json')) as Array<{ Config: string; Layers: string[] }> };
}

describe('DockerDownloader output publication controls', () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.remove(root)));
  });

  it('removes the partial tar when abort occurs after real tar creation and before rename', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'docker-output-controls-'));
    roots.push(root);
    const downloader = new DockerDownloader();
    await configureDownloader(downloader, []);
    const controller = new AbortController();
    const { blobDownloader } = internals(downloader);
    const originalCreate = blobDownloader.createImageTar.bind(blobDownloader);
    let tarStarted = false;
    blobDownloader.createImageTar = async (source: string, target: string) => {
      await originalCreate(source, target); tarStarted = true; controller.abort();
    };

    const failure = await downloader.downloadImage('library/cancelled', 'latest', 'amd64', root, undefined, 'docker.io', {
      signal: controller.signal,
    }).then(() => undefined, (error: unknown) => error);
    expect(failure).toMatchObject({ name: 'AbortError' });
    expect(tarStarted).toBe(true);
    expect(await fs.pathExists(path.join(root, 'cancelled-latest.tar'))).toBe(false);
    expect((await fs.readdir(root)).filter((name) => name.endsWith('.partial'))).toEqual([]);
    expect((await fs.readdir(root)).filter((name) => name.startsWith('cancelled-latest-'))).toEqual([]);
  });

  it('preserves an existing directory and sentinel when final rename fails', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'docker-output-controls-'));
    roots.push(root);
    const downloader = new DockerDownloader();
    await configureDownloader(downloader, []);
    const finalPath = path.join(root, 'collision-v1.tar');
    await fs.ensureDir(finalPath);
    await fs.writeFile(path.join(finalPath, 'sentinel'), 'keep');

    let tarCreated = false;
    const { blobDownloader } = internals(downloader);
    const originalCreate = blobDownloader.createImageTar.bind(blobDownloader);
    blobDownloader.createImageTar = async (source: string, target: string) => {
      await originalCreate(source, target);
      tarCreated = true;
    };
    const failure = await downloader.downloadImage('library/collision', 'v1', 'amd64', root)
      .then(() => undefined, (error: unknown) => error);
    expect(tarCreated).toBe(true);
    expect(failure).toMatchObject({ code: expect.stringMatching(/^(ENOTDIR|EISDIR|EEXIST|EPERM)$/) });
    expect(await fs.readFile(path.join(finalPath, 'sentinel'), 'utf8')).toBe('keep');
    expect((await fs.readdir(root)).filter((name) => name.endsWith('.partial'))).toEqual([]);
    expect((await fs.readdir(root)).filter((name) => name.startsWith('collision-v1-'))).toEqual([]);
  });

  it('keeps concurrent same-image work directories independent after one cancellation', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'docker-output-controls-'));
    roots.push(root);
    const downloader = new DockerDownloader();
    const imageDirs: string[] = [];
    await configureDownloader(downloader, imageDirs);
    const firstController = new AbortController();
    const { blobDownloader } = internals(downloader);
    let releaseBoth: () => void = () => undefined;
    const bothReady = new Promise<void>((resolve) => { releaseBoth = resolve; });
    blobDownloader.downloadBlob = async (...args: [string, string, string, string, string, unknown, { signal?: AbortSignal }]) => {
      const dir = path.dirname(args[2]);
      if (!imageDirs.includes(dir)) imageDirs.push(dir);
      if (args[6]?.signal === firstController.signal) firstDir = dir;
      if (imageDirs.length === 2) releaseBoth();
      await bothReady;
      await fs.writeFile(args[2], Buffer.from(`${args[1]}-fixture`));
    };
    const originalCreate = blobDownloader.createImageTar.bind(blobDownloader);
    let firstDir: string | undefined;
    let tarCount = 0;
    blobDownloader.createImageTar = async (source: string, target: string) => {
      await originalCreate(source, target); tarCount += 1;
      if (source === firstDir) firstController.abort();
    };

    const [first, second] = await Promise.allSettled([
      downloader.downloadImage('library/same', 'v1', 'amd64', root, undefined, 'docker.io', { signal: firstController.signal }).then(
        (value) => value,
        (error) => { throw error; }
      ),
      downloader.downloadImage('library/same', 'v1', 'amd64', root),
    ]);
    // The two downloads have already reached their blob barrier before either tar is created.
    expect(imageDirs.length).toBe(2);
    expect(first.status).toBe('rejected');
    expect(second).toMatchObject({ status: 'fulfilled', value: path.join(root, 'same-v1.tar') });
    expect(tarCount).toBe(2);
    expect(new Set(imageDirs).size).toBe(2);
    const archivePath = path.join(root, 'same-v1.tar');
    expect(await fs.pathExists(archivePath)).toBe(true);
    const archive = await readDockerArchive(archivePath, root);
    expect(archive.names).toEqual(expect.arrayContaining(['config.json', 'manifest.json', 'layer.tar.gz']));
    expect(archive.manifest).toEqual([{ Config: 'config.json', RepoTags: ['library/same:v1'], Layers: ['layer.tar.gz'] }]);
    expect(await fs.readFile(path.join(root, 'archive-extracted', 'config.json'), 'utf8')).toContain('sha256:config');
    // Synthetic layer bytes are used only to exercise tar publication and manifest references.
    expect(await fs.readFile(path.join(root, 'archive-extracted', 'layer.tar.gz'), 'utf8')).toContain('sha256:layer-fixture');
    expect((await fs.readdir(root)).filter((name) => name.endsWith('.partial'))).toEqual([]);
    expect((await fs.readdir(root)).filter((name) => name.startsWith('same-v1-'))).toEqual([]);
  });
});
