// Actual handlers + preloader + fetchers with deferred transport; no app build/network.
// node scripts/profile-version-preload.mjs [baseline ref]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(script), '..');
const baseline = process.argv[2] ?? '9559d52';
const mode = process.argv[3];
if (!mode) {
  for (const variant of ['baseline', 'candidate'])
    console.log(
      execFileSync(process.execPath, [script, baseline, variant], {
        cwd: root,
        env: process.env,
        encoding: 'utf8',
      }).trim()
    );
} else {
  assert(['baseline', 'candidate'].includes(mode));
  const require = createRequire(import.meta.url);
  const ts = require('typescript');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'version-preload-profile-'));
  const sourcePath = 'src/core/shared/version-fetcher.ts';
  const oldSource =
    mode === 'baseline'
      ? execFileSync('git', ['show', `${baseline}:${sourcePath}`], { cwd: root, encoding: 'utf8' })
      : undefined;
  const log = { info() {}, debug() {}, warn() {}, error() {} };
  const handlers = new Map();
  const inFlight = [];
  const originalLoad = Module._load;
  const originalHome = os.homedir;
  const originalFetch = globalThis.fetch;
  const axios = require('axios');
  const originalGet = axios.get;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let pythonCalls = 0,
    cudaCalls = 0;
  const counts = () => ({ python: pythonCalls, cuda: cudaCalls });
  Module._load = function (request, ...args) {
    if (request === 'electron')
      return { ipcMain: { handle: (name, handler) => handlers.set(name, handler) } };
    return originalLoad.call(this, request, ...args);
  };
  os.homedir = () => temp;
  globalThis.fetch = async () => {
    pythonCalls++;
    await gate;
    return new Response(
      JSON.stringify([
        { name: 'Python 3.14.0', version: 3, pre_release: false, is_published: true },
      ])
    );
  };
  axios.get = async () => {
    cudaCalls++;
    await gate;
    return { data: { packages: { 'cuda.tar.bz2': { name: 'cuda-toolkit', version: '13.0.1' } } } };
  };
  require.extensions['.ts'] = (module, filename) => {
    if (filename === path.join(root, 'src/utils/logger.ts')) {
      module.exports = log;
      return;
    }
    if (filename === path.join(root, 'electron/utils/logger.ts')) {
      module.exports = { createScopedLogger: () => log };
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
  try {
    const fetchers = require(path.join(root, sourcePath));
    for (const name of ['fetchPythonVersions', 'fetchCudaVersions']) {
      const original = fetchers[name];
      fetchers[name] = () => {
        const pending = original();
        inFlight.push(pending);
        return pending;
      };
    }
    const { registerVersionHandlers } = require(path.join(root, 'electron/version-handlers.ts'));
    const { preloadAllVersions } = require(path.join(root, 'src/core/shared/version-preloader.ts'));
    registerVersionHandlers();
    const preloaded = preloadAllVersions();
    await new Promise(setImmediate);
    const startupCalls = counts();
    const python = handlers.get('versions:python')();
    const cuda = handlers.get('versions:cuda')();
    await new Promise(setImmediate);
    const earlyIpcCalls = counts();
    assert.deepEqual(startupCalls, {
      python: mode === 'baseline' ? 2 : 1,
      cuda: mode === 'baseline' ? 2 : 1,
    });
    assert.deepEqual(earlyIpcCalls, {
      python: mode === 'baseline' ? 3 : 1,
      cuda: mode === 'baseline' ? 3 : 1,
    });
    release();
    const [status, pythonVersions, cudaVersions] = await Promise.all([preloaded, python, cuda]);
    await Promise.all(inFlight);
    assert.equal(status.success, true);
    assert.deepEqual(pythonVersions, ['3.14']);
    assert.deepEqual(cudaVersions, ['13.0']);
    await preloadAllVersions();
    assert.deepEqual(await handlers.get('versions:python')(), pythonVersions);
    assert.deepEqual(await handlers.get('versions:cuda')(), cudaVersions);
    assert.deepEqual(counts(), earlyIpcCalls);
    console.log(
      JSON.stringify({
        mode,
        baseline,
        node: process.version,
        electron: process.versions.electron,
        startupCalls,
        earlyIpcCalls,
        warmCalls: counts(),
        pythonVersions,
        cudaVersions,
        status: status.status,
      })
    );
  } finally {
    release();
    await Promise.allSettled(inFlight);
    Module._load = originalLoad;
    os.homedir = originalHome;
    globalThis.fetch = originalFetch;
    axios.get = originalGet;
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
