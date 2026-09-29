// Actual streaming downloader + progress emitter; only the send boundary is stubbed.
// Usage: node scripts/profile-os-progress.mjs [baseline git ref]; no app build/network.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(script), '..');
const baseline = process.argv[2] || 'e15fddf';
const mode = process.argv[3];
if (!mode) {
  for (const variant of ['baseline', 'candidate']) {
    console.log(
      execFileSync(process.execPath, [script, baseline, variant], {
        cwd: root,
        encoding: 'utf8',
        env: process.env,
      }).trim()
    );
  }
} else {
  assert(['baseline', 'candidate'].includes(mode));
  const require = createRequire(import.meta.url);
  const ts = require('typescript');
  const emitterPath = 'electron/services/download-progress.ts';
  const oldSource =
    mode === 'baseline'
      ? execFileSync('git', ['show', `${baseline}:${emitterPath}`], { cwd: root, encoding: 'utf8' })
      : undefined;
  require.extensions['.ts'] = (module, filename) => {
    if (filename === path.join(root, 'electron/utils/logger.ts')) {
      module.exports = { createScopedLogger: () => ({ warn() {} }) };
      return;
    }
    const source =
      filename === path.join(root, emitterPath) && oldSource !== undefined
        ? oldSource
        : fs.readFileSync(filename, 'utf8');
    module._compile(
      ts.transpileModule(source, {
        fileName: filename,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
          esModuleInterop: true,
        },
      }).outputText,
      filename
    );
  };
  const { createDownloadProgressEmitter } = require(path.join(root, emitterPath));
  const { BaseOSDownloader } = require(
    path.join(root, 'src/core/downloaders/os-shared/base-downloader.ts')
  );
  const size = 256 * 1024 * 1024;
  let sourceBytes = 0;
  let callbacks = 0;
  let sends = 0;
  let last;
  const emitter = createDownloadProgressEmitter(() => ({
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send(_channel, value) {
        sends++;
        last = value;
      },
    },
  }));
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        async pull(controller) {
          if (sourceBytes === size) {
            controller.close();
            return;
          }
          await new Promise(setImmediate);
          const chunk = new Uint8Array(64 * 1024).fill(0x6a);
          sourceBytes += chunk.byteLength;
          controller.enqueue(chunk);
        },
      }),
      { headers: { 'content-length': String(size) } }
    );
  class Downloader extends BaseOSDownloader {
    getDownloadUrl() {
      return 'https://fixture.invalid/package';
    }
    getFilename() {
      return 'package.rpm';
    }
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'os-progress-profile-'));
  try {
    const downloader = new Downloader({
      outputDir: directory,
      concurrency: 1,
      repositories: [],
      architecture: 'x86_64',
      distribution: {},
      onProgress(value) {
        callbacks++;
        emitter.emitOSProgress(value);
      },
    });
    const start = performance.now();
    const result = await downloader.downloadPackage({ name: 'fixture', version: '1', size });
    emitter.flushOSProgress?.();
    const elapsedMs = performance.now() - start;
    assert(result.success, result.error?.message);
    assert.equal(fs.statSync(result.filePath).size, size);
    assert.equal(callbacks, 4096);
    assert.equal(last.bytesDownloaded, size);
    assert.equal(last.totalBytes, size);
    const countAtEnd = sends;
    emitter.clearOSProgress?.();
    await new Promise((resolve) => setTimeout(resolve, 180));
    assert.equal(sends, countAtEnd);
    console.log(
      JSON.stringify({
        mode,
        baseline,
        sizeMiB: 256,
        chunkKiB: 64,
        node: process.version,
        electron: process.versions.electron,
        sourceCallbacks: callbacks,
        sendBoundaryCalls: sends,
        elapsedMs,
        finalBytes: last.bytesDownloaded,
        scope: 'send invocations only; excludes actual Electron IPC and React commits',
      })
    );
  } finally {
    emitter.clearOSProgress?.();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
