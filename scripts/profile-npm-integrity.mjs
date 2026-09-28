// Verify real saved files through source loaded in memory; no app build or network.
// node scripts/profile-npm-integrity.mjs [baseline git ref]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(script), '..');
const baseline = process.argv[2] || 'cf10291';
const mode = process.argv[3];
const mib = 1024 * 1024;
if (!mode) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-sri-profile-'));
  try {
    for (const sizeMiB of [64, 256]) {
      const filename = path.join(directory, `fixture-${sizeMiB}.tgz`);
      const chunk = Buffer.alloc(mib, 0x6a);
      const hash = createHash('sha512');
      const fd = fs.openSync(filename, 'w');
      try {
        for (let i = 0; i < sizeMiB; i++) {
          fs.writeSync(fd, chunk);
          hash.update(chunk);
        }
      } finally {
        fs.closeSync(fd);
      }
      const integrity = 'sha512-' + hash.digest('base64');
      for (const variant of ['baseline', 'candidate'])
        console.log(
          execFileSync(
            process.execPath,
            ['--expose-gc', script, baseline, variant, filename, integrity],
            { cwd: root, env: process.env, encoding: 'utf8' }
          ).trim()
        );
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
} else {
  assert(['baseline', 'candidate'].includes(mode));
  const filename = process.argv[4];
  const integrity = process.argv[5];
  const require = createRequire(import.meta.url);
  const ts = require('typescript');
  const sourcePath = 'src/core/downloaders/npm.ts';
  const oldSource =
    mode === 'baseline'
      ? execFileSync('git', ['show', `${baseline}:${sourcePath}`], { cwd: root, encoding: 'utf8' })
      : undefined;
  require.extensions['.ts'] = (module, filename) => {
    if (filename === path.join(root, 'src/utils/logger.ts')) {
      module.exports = { info() {}, error() {}, warn() {}, debug() {} };
      return;
    }
    const source =
      filename === path.join(root, sourcePath) && oldSource !== undefined
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
  let peakRSS = 0;
  let peakExternal = 0;
  const sample = () => {
    const value = process.memoryUsage();
    peakRSS = Math.max(peakRSS, value.rss);
    peakExternal = Math.max(peakExternal, value.external);
  };
  const ssri = require('ssri');
  const fsExtra = require('fs-extra');
  const originalRead = fsExtra.readFile;
  const originalCheck = ssri.checkData;
  let fullReads = 0;
  let checkDataCalls = 0;
  let maxSyncHashMs = 0;
  fsExtra.readFile = function (...args) {
    fullReads++;
    return originalRead.apply(this, args);
  };
  ssri.checkData = function (...args) {
    sample();
    const started = performance.now();
    const result = originalCheck.apply(this, args);
    maxSyncHashMs = Math.max(maxSyncHashMs, performance.now() - started);
    checkDataCalls++;
    sample();
    return result;
  };
  const { NpmDownloader } = require(path.join(root, sourcePath));
  const downloader = new NpmDownloader();
  globalThis.gc();
  fullReads = 0;
  const before = process.memoryUsage();
  sample();
  const start = performance.now();
  let lastTick = start;
  let maxTimerGapMs = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maxTimerGapMs = Math.max(maxTimerGapMs, now - lastTick);
    lastTick = now;
    sample();
  }, 1);
  const cpuStart = process.cpuUsage();
  try {
    const verified = await downloader.verifyIntegrity(filename, integrity);
    const elapsedMs = performance.now() - start;
    const cpu = process.cpuUsage(cpuStart);
    sample();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(verified, true);
    assert.equal(fullReads, mode === 'baseline' ? 1 : 0);
    assert.equal(checkDataCalls, mode === 'baseline' ? 1 : 0);
    console.log(
      JSON.stringify({
        mode,
        baseline,
        sizeMiB: fs.statSync(filename).size / mib,
        node: process.version,
        electron: process.versions.electron,
        elapsedMs,
        cpuMs: (cpu.user + cpu.system) / 1000,
        maxTimerGapMs,
        peakRSSDeltaMiB: (peakRSS - before.rss) / mib,
        peakExternalDeltaMiB: (peakExternal - before.external) / mib,
        fullReads,
        checkDataCalls,
        maxSyncHashMs,
        verified,
      })
    );
  } finally {
    clearInterval(timer);
    fsExtra.readFile = originalRead;
    ssri.checkData = originalCheck;
  }
}
