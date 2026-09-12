import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import * as tar from 'tar';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as yauzl from 'yauzl';
import { createDownloadOrchestrator, type DownloadOrchestrator } from '../../../electron/services/download-orchestrator';
import { createDownloadProgressEmitter } from '../../../electron/services/download-progress';
import { getDockerDownloader } from '../index';

vi.mock('../../../electron/utils/logger', () => ({
  createScopedLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

const repository = 'fixture/image';
const registryName = 'fixture-registry';
const layer1 = Buffer.alloc(4 * 1024 * 1024, 0x61);
const layer2 = Buffer.from('second-layer\n');
const config = Buffer.from('{"architecture":"amd64","os":"linux"}\n');
const digest = (value: Buffer) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const layer1Digest = digest(layer1);
const layer2Digest = digest(layer2);
const configDigest = digest(config);
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function waitFor(predicate: () => boolean | Promise<boolean>, timeout = 5000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for Docker download state');
    await sleep(10);
  }
}

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(() => true, () => false);
}

async function findNamedFile(directory: string, filename: string): Promise<string | undefined> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findNamedFile(candidate, filename);
      if (nested) return nested;
    } else if (entry.name === filename) {
      return candidate;
    }
  }
  return undefined;
}

async function readZipEntry(archivePath: string, filename: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) { reject(error ?? new Error('ZIP could not be opened')); return; }
      zip.readEntry();
      zip.on('entry', entry => {
        if (entry.fileName !== filename) { zip.readEntry(); return; }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) { zip.close(); reject(streamError ?? new Error('ZIP entry could not be read')); return; }
          const chunks: Buffer[] = [];
          stream.on('data', chunk => chunks.push(Buffer.from(chunk)));
          stream.on('error', streamError2 => { zip.close(); reject(streamError2); });
          stream.on('end', () => { zip.close(); resolve(Buffer.concat(chunks)); });
        });
      });
      zip.on('end', () => { reject(new Error(`ZIP entry not found: ${filename}`)); });
      zip.on('error', reject);
    });
  });
}

describe('Docker controls through the real orchestrator, registry and image archive', () => {
  let root: string;
  let output: string;
  let server: http.Server;
  let port: number;
  let requests: string[];
  let authTokens: string[];
  let blobAuthorizations: Array<{ path: string; authorization?: string }>;
  let tokenExpiry: Map<string, number>;
  let producedBytes: number;
  let closedLayers: Set<string>;
  let prematureClose: boolean;
  let orchestrator: DownloadOrchestrator;
  let task: Promise<void> | undefined;
  let events: Array<{ channel: string; payload: Record<string, unknown> }>;
  let sessionId: number;
  let dateNowSpy: ReturnType<typeof vi.spyOn> | undefined;
  let previousConfig: unknown;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-docker-controls-'));
    output = path.join(root, 'delivery output');
    requests = [];
    authTokens = [];
    blobAuthorizations = [];
    tokenExpiry = new Map();
    producedBytes = 0;
    closedLayers = new Set();
    prematureClose = false;
    events = [];
    sessionId = 0;
    task = undefined;
    server = http.createServer((request, response) => {
      const requestPath = request.url?.split('?')[0] ?? '';
      requests.push(requestPath);
      if (requestPath === '/v2/auth') {
        const token = `token-${authTokens.length + 1}`;
        authTokens.push(token);
        tokenExpiry.set(`Bearer ${token}`, Date.now() + 300_000);
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ token, expires_in: 300 }));
        return;
      }
      const authorization = request.headers.authorization;
      if ((tokenExpiry.get(authorization ?? '') ?? 0) <= Date.now()) {
        response.writeHead(401);
        response.end('expired or unknown token');
        return;
      }
      if (requestPath === `/v2/${repository}/manifests/latest`) {
        response.setHeader('content-type', 'application/vnd.docker.distribution.manifest.v2+json');
        response.end(JSON.stringify({
          schemaVersion: 2,
          config: { mediaType: 'application/vnd.docker.container.image.v1+json', size: config.length, digest: configDigest },
          layers: [
            { mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip', size: layer1.length, digest: layer1Digest },
            { mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip', size: layer2.length, digest: layer2Digest },
          ],
        }));
        return;
      }
      const blobs: Record<string, Buffer> = {
        [`/v2/${repository}/blobs/${configDigest}`]: config,
        [`/v2/${repository}/blobs/${layer2Digest}`]: layer2,
        [`/v2/${repository}/blobs/${layer1Digest}`]: layer1,
      };
      const body = blobs[requestPath];
      if (!body) { response.writeHead(404); response.end(); return; }
      blobAuthorizations.push({ path: requestPath, authorization });
      response.writeHead(200, { 'content-length': body.length });
      const slow = requestPath.endsWith(layer1Digest);
      let offset = 0;
      let timer: NodeJS.Timeout | undefined;
      const send = () => {
        if (offset >= body.length) { response.end(); return; }
        if (slow && prematureClose && offset >= 128 * 1024) {
          response.destroy();
          return;
        }
        const next = Math.min(offset + (slow ? 64 * 1024 : body.length), body.length);
        response.write(body.subarray(offset, next));
        producedBytes += next - offset;
        offset = next;
        timer = setTimeout(send, slow ? 20 : 0);
      };
      response.on('close', () => {
        if (timer) clearTimeout(timer);
        if (slow) closedLayers.add(layer1Digest);
      });
      send();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('registry did not bind');
    port = address.port;

    const docker = getDockerDownloader() as unknown as { authClient: { registryConfigCache: Map<string, unknown>; clearTokenCache: () => void } };
    docker.authClient.clearTokenCache();
    previousConfig = docker.authClient.registryConfigCache.get(registryName);
    docker.authClient.registryConfigCache.set(registryName, {
      authUrl: `http://127.0.0.1:${port}/v2/auth`,
      registryUrl: `http://127.0.0.1:${port}/v2`,
      service: 'fixture-registry',
    });
    const window = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: (channel: string, payload: Record<string, unknown>) => events.push({ channel, payload }),
      },
    };
    orchestrator = createDownloadOrchestrator({
      getMainWindow: () => window as never,
      createProgressEmitter: getWindow => createDownloadProgressEmitter(getWindow, 0),
      scheduleTask: run => { task = run(); },
    });
  });

  afterEach(async () => {
    await orchestrator?.cancelDownload();
    server.closeAllConnections();
    await task?.catch(() => undefined);
    dateNowSpy?.mockRestore();
    dateNowSpy = undefined;
    await new Promise<void>(resolve => server.close(() => resolve()));
    const docker = getDockerDownloader() as unknown as { authClient: { registryConfigCache: Map<string, unknown>; clearTokenCache: () => void } };
    if (previousConfig === undefined) docker.authClient.registryConfigCache.delete(registryName);
    else docker.authClient.registryConfigCache.set(registryName, previousConfig);
    await fs.rm(root, { recursive: true, force: true });
  });

  function completions() {
    return events.filter(event => event.channel === 'download:all-complete').map(event => event.payload);
  }

  function progress() {
    return events.filter(event => event.channel === 'download:progress').map(event => event.payload);
  }

  const imageFiles = () => fs.readdir(path.join(output, 'packages')).catch(() => []);
  const activeLayerPath = () => findNamedFile(
    path.join(output, 'packages'),
    `${layer1Digest.slice(7)}.tar.gz`,
  );
  async function start(requireActiveFile = true) {
    sessionId += 1;
    await orchestrator.startDownload({
      sessionId,
      packages: [{ id: 'docker-fixture', type: 'docker', name: repository, version: 'latest', metadata: { registry: registryName } }],
      options: { outputDir: output, outputFormat: 'zip', includeScripts: false, deliveryMethod: 'local', concurrency: 1 },
    });
    await waitFor(async () => {
      if (producedBytes < 128 * 1024) return false;
      if (!requireActiveFile) return true;
      const layerPath = await activeLayerPath();
      if (!layerPath) return false;
      return (await fs.stat(layerPath).catch(() => ({ size: 0 }))).size >= 128 * 1024;
    });
  }

  async function imageTar(): Promise<string> {
    const files = await imageFiles();
    const match = files.find(file => file.endsWith('.tar'));
    if (!match) throw new Error(`image tar not found: ${files.join(', ')}`);
    return path.join(output, 'packages', match);
  }

  async function assertZipImagePayload(): Promise<void> {
    const tarPath = await imageTar();
    const archivedTar = await readZipEntry(`${output}.zip`, `packages/${path.basename(tarPath)}`);
    const extracted = path.join(root, `archive-check-${Date.now()}`);
    await fs.mkdir(extracted);
    const nestedTar = path.join(extracted, 'image.tar');
    try {
      await fs.writeFile(nestedTar, archivedTar);
      await tar.extract({ file: nestedTar, cwd: extracted });
      const manifest = JSON.parse(await fs.readFile(path.join(extracted, 'manifest.json'), 'utf8')) as [{ Config: string; RepoTags: string[]; Layers: string[] }];
      expect(manifest[0].Config).toBe('config.json');
      expect(manifest[0].RepoTags).toEqual([`${registryName}/${repository}:latest`]);
      expect(manifest[0].Layers).toEqual([`${layer1Digest.slice(7)}.tar.gz`, `${layer2Digest.slice(7)}.tar.gz`]);
      expect(createHash('sha256').update(await fs.readFile(path.join(extracted, 'config.json'))).digest('hex')).toBe(configDigest.slice(7));
      expect(createHash('sha256').update(await fs.readFile(path.join(extracted, manifest[0].Layers[0]))).digest('hex')).toBe(layer1Digest.slice(7));
      expect(createHash('sha256').update(await fs.readFile(path.join(extracted, manifest[0].Layers[1]))).digest('hex')).toBe(layer2Digest.slice(7));
    } finally {
      await fs.rm(extracted, { recursive: true, force: true });
    }
  }

  it('downloads both layers and emits a Docker transport tar inside the delivery ZIP', async () => {
    await start();
    await task;
    expect(completions()).toEqual([expect.objectContaining({ sessionId: 1, success: true })]);
    expect(requests).toContain(`/v2/${repository}/manifests/latest`);
    expect(requests).toContain(`/v2/${repository}/blobs/${layer1Digest}`);
    expect(requests).toContain(`/v2/${repository}/blobs/${layer2Digest}`);
    expect(await exists(`${output}.zip`)).toBe(true);
    await assertZipImagePayload();
  }, 15000);

  it.each([1, 2])('cancels an active layer without tar/ZIP, then retries in the same orchestrator (iteration %d)', async () => {
    await start();
    await orchestrator.cancelDownload();
    await task;
    await waitFor(() => closedLayers.has(layer1Digest));
    const stoppedAt = producedBytes;
    await sleep(150);
    expect(producedBytes).toBe(stoppedAt);
    expect(requests).toEqual([
      '/v2/auth',
      `/v2/${repository}/manifests/latest`,
      `/v2/${repository}/blobs/${configDigest}`,
      `/v2/${repository}/blobs/${layer1Digest}`,
    ]);
    expect(await imageFiles()).toEqual([]);
    expect(await exists(`${output}.zip`)).toBe(false);
    expect(completions()).toEqual([expect.objectContaining({ sessionId: 1, success: false, cancelled: true })]);
    await start();
    await task;
    expect(completions()).toEqual([
      expect.objectContaining({ sessionId: 1, success: false, cancelled: true }),
      expect.objectContaining({ sessionId: 2, success: true }),
    ]);
    await assertZipImagePayload();
  }, 20000);

  it.each([1, 2])('pauses the active layer while the producer advances, then resumes to a valid ZIP (iteration %d)', async () => {
    await start();
    await orchestrator.pauseDownload();
    await sleep(50);
    const layerPath = await activeLayerPath();
    if (!layerPath) throw new Error('active layer file not found');
    const firstSize = (await fs.stat(layerPath)).size;
    const firstProgress = progress();
    const firstWire = producedBytes;
    await sleep(150);
    expect((await fs.stat(layerPath)).size).toBe(firstSize);
    expect(progress()).toEqual(firstProgress);
    expect(producedBytes).toBeGreaterThan(firstWire);
    expect(completions()).toEqual([]);
    await orchestrator.resumeDownload();
    await task;
    expect(completions()).toEqual([expect.objectContaining({ sessionId: 1, success: true })]);
    expect(await exists(`${output}.zip`)).toBe(true);
    await assertZipImagePayload();
  }, 15000);

  it('cancels a paused layer without a second layer request or completion', async () => {
    await start();
    await orchestrator.pauseDownload();
    await sleep(150);
    await orchestrator.cancelDownload();
    await task;
    expect(requests).not.toContain(`/v2/${repository}/blobs/${layer2Digest}`);
    expect(await imageFiles()).toEqual([]);
    expect(await exists(`${output}.zip`)).toBe(false);
    expect(completions()).toEqual([expect.objectContaining({ sessionId: 1, success: false, cancelled: true })]);
  }, 10000);

  it('fails and cleans up when the first layer closes after a partial 128 KiB response', async () => {
    prematureClose = true;
    await start(false);
    await task;
    await waitFor(() => closedLayers.has(layer1Digest));
    expect(requests).not.toContain(`/v2/${repository}/blobs/${layer2Digest}`);
    expect(completions()).toEqual([expect.objectContaining({ sessionId: 1, success: false })]);
    expect(completions()[0]).not.toHaveProperty('cancelled', true);
    expect(await imageFiles()).toEqual([]);
    expect(await findNamedFile(output, `${layer1Digest.slice(7)}.tar.gz`)).toBeUndefined();
    expect(await findNamedFile(output, 'manifest.json')).toBeUndefined();
    expect(await exists(`${output}.zip`)).toBe(false);
  }, 10000);

  it('refreshes an expired registry token before the next layer and preserves the image archive', async () => {
    await start();
    await orchestrator.pauseDownload();
    await sleep(50);
    const realNow = Date.now.bind(Date);
    dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 301_000);
    await orchestrator.resumeDownload();
    await task;

    expect(authTokens).toEqual(['token-1', 'token-2']);
    expect(requests.filter(request => request === '/v2/auth')).toHaveLength(2);
    expect(requests).toContain(`/v2/${repository}/blobs/${layer2Digest}`);
    expect(blobAuthorizations.find(entry => entry.path.endsWith(layer2Digest))?.authorization).toBe('Bearer token-2');
    expect(completions()).toEqual([expect.objectContaining({ sessionId: 1, success: true })]);
    expect(await exists(`${output}.zip`)).toBe(true);
    await assertZipImagePayload();
  }, 15000);
});
