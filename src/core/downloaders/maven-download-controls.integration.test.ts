import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMavenDownloader } from '../index';
import { createDownloadOrchestrator, type DownloadOrchestrator } from '../../../electron/services/download-orchestrator';
import { createDownloadProgressEmitter } from '../../../electron/services/download-progress';

vi.mock('../../../electron/utils/logger', () => ({
  createScopedLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

const coordinate = 'com.example.controls:stream-fixture';
const artifact = 'com/example/controls/stream-fixture/1.0.0/stream-fixture-1.0.0';
const jarBytes = Buffer.alloc(4 * 1024 * 1024, 0x5a);
const pomBytes = Buffer.from(`<project><!--${'x'.repeat(1024 * 1024)}--><modelVersion>4.0.0</modelVersion></project>`);
const checksum = (bytes: Buffer) => createHash('sha1').update(bytes).digest('hex');
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for real download state');
    await sleep(10);
  }
}

describe('Maven controls through the real orchestrator, session, router and HTTP stream', () => {
  let directory: string;
  let output: string;
  let server: http.Server;
  let requests: string[];
  let wireBytes: number;
  let closedArtifacts: Set<string>;
  let previousRepositoryUrl: unknown;
  let orchestrator: DownloadOrchestrator;
  let task: Promise<void> | undefined;
  let events: Array<{ channel: string; payload: Record<string, unknown> }>;
  let sessionId: number;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-maven-controls-'));
    output = path.join(directory, 'output');
    requests = [];
    wireBytes = 0;
    closedArtifacts = new Set();
    events = [];
    sessionId = 0;
    task = undefined;
    server = http.createServer((request, response) => {
      const requestPath = request.url?.replace(/^\//, '') || '';
      requests.push(requestPath);
      const basePath = requestPath.replace(/\.sha1$/, '');
      const bytes = basePath === `${artifact}.jar` ? jarBytes
        : basePath === `${artifact}.pom` ? pomBytes : undefined;
      if (!bytes) { response.writeHead(404); response.end(); return; }
      if (requestPath.endsWith('.sha1')) { response.end(checksum(bytes)); return; }
      response.writeHead(200, { 'content-length': bytes.length });
      let offset = 0;
      let timer: NodeJS.Timeout | undefined;
      const send = () => {
        if (offset >= bytes.length) { response.end(); return; }
        const next = Math.min(offset + 64 * 1024, bytes.length);
        response.write(bytes.subarray(offset, next));
        wireBytes += next - offset;
        offset = next;
        timer = setTimeout(send, 20);
      };
      response.on('close', () => {
        if (timer) clearTimeout(timer);
        closedArtifacts.add(basePath);
      });
      send();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind');
    previousRepositoryUrl = Reflect.get(getMavenDownloader(), 'repoUrl');
    Reflect.set(getMavenDownloader(), 'repoUrl', `http://127.0.0.1:${address.port}`);
    // Only the Electron window endpoint is replaced; all transfer and delivery code is real.
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
    await task;
    await new Promise<void>(resolve => server.close(() => resolve()));
    Reflect.set(getMavenDownloader(), 'repoUrl', previousRepositoryUrl);
    await fs.rm(directory, { recursive: true, force: true });
  });

  function completions() {
    return events.filter(event => event.channel === 'download:all-complete').map(event => event.payload);
  }
  function progress() {
    return events.filter(event => event.channel === 'download:progress').map(event => event.payload);
  }
  const fileSize = async (file: string) => (await fs.stat(file).catch(() => ({ size: 0 }))).size;
  const artifactFile = (type = 'jar') => path.join(output, 'packages', 'm2repo', `${artifact}.${type}`);
  async function archivedChecksum(type: string): Promise<string> {
    const python = process.platform === 'win32' ? 'py' : 'python3';
    const args = process.platform === 'win32' ? ['-3', '-c'] : ['-c'];
    args.push(
      'import sys,zipfile,hashlib; print(hashlib.sha1(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2])).hexdigest())',
      `${output}.zip`, `packages/m2repo/${artifact}.${type}`,
    );
    return (await promisify(execFile)(python, args, { timeout: 10000 })).stdout.trim();
  }
  async function start(type = 'jar') {
    sessionId += 1;
    await orchestrator.startDownload({
      sessionId,
      packages: [{ id: 'maven-fixture', type: 'maven', name: coordinate, version: '1.0.0', metadata: { packaging: type } }],
      options: { outputDir: output, outputFormat: 'zip', includeScripts: false, deliveryMethod: 'local', concurrency: 1 },
    });
    await until(async () => (await fileSize(artifactFile(type))) >= 128 * 1024);
  }

  it.each([1, 2])('cancels active JAR transfer and then retries successfully (iteration %d)', async () => {
    await start();
    await orchestrator.cancelDownload();
    await task;
    await until(() => closedArtifacts.has(`${artifact}.jar`));
    const stoppedAt = wireBytes;
    await sleep(150);
    expect(wireBytes).toBe(stoppedAt);
    expect(stoppedAt).toBeLessThan(jarBytes.length);
    expect(requests).toEqual([`${artifact}.jar.sha1`, `${artifact}.jar`]);
    expect(await fileSize(artifactFile())).toBe(0);
    expect(await fs.access(artifactFile()).then(() => true, () => false)).toBe(false);
    expect(await fs.access(`${output}.zip`).then(() => true, () => false)).toBe(false);
    expect(completions()).toEqual([expect.objectContaining({ sessionId: 1, success: false, cancelled: true })]);

    // The same orchestrator and destination exercise retry after cleanup and session event isolation.
    await start();
    await task;
    expect(completions()).toEqual([
      expect.objectContaining({ sessionId: 1, success: false, cancelled: true }),
      expect.objectContaining({ sessionId: 2, success: true, artifactPaths: [`${output}.zip`] }),
    ]);
    expect(checksum(await fs.readFile(artifactFile()))).toBe(checksum(jarBytes));
    expect(await archivedChecksum('jar')).toBe(checksum(jarBytes));
    expect(await fileSize(`${output}.zip`)).toBeGreaterThan(0);
  }, 15000);

  it.each(['jar', 'jar', 'pom'])('holds disk and progress while paused, then resumes %s with intact checksums', async type => {
    await start(type);
    await orchestrator.pauseDownload();
    await sleep(50); // Allow the chunk already handed to the filesystem to drain.
    const sizeBefore = await fileSize(artifactFile(type));
    const progressBefore = progress();
    const wireBefore = wireBytes;
    await sleep(150);
    expect(await fileSize(artifactFile(type))).toBe(sizeBefore);
    expect(progress()).toEqual(progressBefore);
    expect(wireBytes).toBeGreaterThan(wireBefore); // The producer has data available during the pause.
    expect(completions()).toEqual([]);
    expect(await fs.access(`${output}.zip`).then(() => true, () => false)).toBe(false);
    await orchestrator.resumeDownload();
    await task;
    expect(completions()).toEqual([expect.objectContaining({ sessionId: 1, success: true, artifactPaths: [`${output}.zip`] })]);
    const expectedBytes = type === 'jar' ? jarBytes : pomBytes;
    expect(checksum(await fs.readFile(artifactFile(type)))).toBe(checksum(expectedBytes));
    expect(await fs.readFile(`${artifactFile(type)}.sha1`, 'utf8')).toBe(checksum(expectedBytes));
    expect(await archivedChecksum(type)).toBe(checksum(expectedBytes));
    expect(await fileSize(`${output}.zip`)).toBeGreaterThan(0);
  }, 15000);

  it.each(['jar', 'pom'])('cancels a paused active %s without another artifact request or completion', async type => {
    await start(type);
    await orchestrator.pauseDownload();
    await sleep(150);
    expect(completions()).toEqual([]);
    await orchestrator.cancelDownload();
    await task;
    await until(() => closedArtifacts.has(`${artifact}.${type}`));
    expect(requests).toEqual([`${artifact}.${type}.sha1`, `${artifact}.${type}`]);
    expect(await fs.access(artifactFile(type)).then(() => true, () => false)).toBe(false);
    expect(await fs.access(`${output}.zip`).then(() => true, () => false)).toBe(false);
    expect(completions()).toEqual([expect.objectContaining({ sessionId: 1, success: false, cancelled: true })]);
    const count = events.length;
    await sleep(150);
    expect(events).toHaveLength(count);
  }, 10000);
});
