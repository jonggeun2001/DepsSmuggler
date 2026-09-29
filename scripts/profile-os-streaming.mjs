// Runs source through an in-memory TypeScript loader; no application build or network.
// Usage: node scripts/profile-os-streaming.mjs [baseline git ref]
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
const baseline = process.argv[2] || '693b151';
const mode = process.argv[3];
const mib = 1024 * 1024;

if (!mode) {
  const results = [];
  for (const size of [64, 256]) {
    for (const variant of ['baseline', 'candidate']) {
      const output = execFileSync(
        process.execPath,
        ['--expose-gc', script, baseline, variant, String(size)],
        {
          cwd: root,
          encoding: 'utf8',
          env: process.env,
        }
      );
      const result = JSON.parse(output);
      results.push(result);
      console.log(JSON.stringify(result));
    }
  }
  assert(
    results
      .filter((result) => result.mode === 'candidate')
      .every((result) => result.syncWrites === 0)
  );
} else {
  assert(['baseline', 'candidate'].includes(mode));
  const require = createRequire(import.meta.url);
  const ts = require('typescript');
  const modulePath = 'src/core/downloaders/os-shared/base-downloader.ts';
  const baselineSource =
    mode === 'baseline'
      ? execFileSync('git', ['show', `${baseline}:${modulePath}`], { cwd: root, encoding: 'utf8' })
      : null;
  require.extensions['.ts'] = (module, filename) => {
    const input =
      filename === path.join(root, modulePath) && baselineSource !== null
        ? baselineSource
        : fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(input, {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    });
    module._compile(output.outputText, filename);
  };
  const { BaseOSDownloader } = require(path.join(root, modulePath));
  const size = Number(process.argv[4]) * mib;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'os-stream-profile-'));
  let sent = 0;
  let progressEvents = 0;
  let peakRSS = 0;
  let peakExternal = 0;
  let syncWrites = 0;
  let syncWriteMs = 0;
  let maxTimerGapMs = 0;
  const sample = () => {
    const memory = process.memoryUsage();
    peakRSS = Math.max(peakRSS, memory.rss);
    peakExternal = Math.max(peakExternal, memory.external);
  };
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        async pull(controller) {
          if (sent === size) {
            controller.close();
            return;
          }
          await new Promise(setImmediate);
          const chunk = new Uint8Array(Math.min(64 * 1024, size - sent)).fill(0x6a);
          sent += chunk.length;
          controller.enqueue(chunk);
          sample();
        },
      }),
      { headers: { 'content-length': String(size) } }
    );
  const originalConcat = Buffer.concat;
  Buffer.concat = function (...args) {
    sample();
    const result = originalConcat.apply(this, args);
    sample();
    return result;
  };
  const originalWrite = fs.writeFileSync;
  fs.writeFileSync = function (...args) {
    const start = performance.now();
    const result = originalWrite.apply(this, args);
    syncWriteMs += performance.now() - start;
    syncWrites++;
    sample();
    return result;
  };
  class Downloader extends BaseOSDownloader {
    getDownloadUrl() {
      return 'https://example.invalid/package';
    }
    getFilename() {
      return 'package.rpm';
    }
  }
  const downloader = new Downloader({
    outputDir: directory,
    concurrency: 1,
    repositories: [],
    architecture: 'x86_64',
    distribution: {},
    onProgress: () => {
      progressEvents++;
    },
  });
  globalThis.gc();
  const before = process.memoryUsage();
  sample();
  const cpuStart = process.cpuUsage();
  const start = performance.now();
  let lastTick = start;
  const timer = setInterval(() => {
    const now = performance.now();
    maxTimerGapMs = Math.max(maxTimerGapMs, now - lastTick);
    lastTick = now;
    sample();
  }, 1);
  try {
    const result = await downloader.downloadPackage({ name: 'fixture', version: '1', size });
    const elapsedMs = performance.now() - start;
    const cpu = process.cpuUsage(cpuStart);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert(result.success, result.error?.message);
    assert.equal(fs.statSync(result.filePath).size, size);
    console.log(
      JSON.stringify({
        mode,
        baseline,
        sizeMiB: size / mib,
        node: process.version,
        electron: process.versions.electron,
        elapsedMs,
        cpuMs: (cpu.user + cpu.system) / 1000,
        maxTimerGapMs,
        peakRSSDeltaMiB: (peakRSS - before.rss) / mib,
        peakExternalDeltaMiB: (peakExternal - before.external) / mib,
        syncWrites,
        syncWriteMs,
        progressEvents,
      })
    );
  } finally {
    clearInterval(timer);
    Buffer.concat = originalConcat;
    fs.writeFileSync = originalWrite;
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
