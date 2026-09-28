// Reuse an existing production renderer; execute main-process TS in a temporary test harness.
// Usage: node scripts/profile-settings-cache.mjs <baseline-repo> <renderer-directory>
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const candidate = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [baselineArg, rendererArg] = process.argv.slice(2);
if (!baselineArg || !rendererArg)
  throw new Error('Provide baseline repo and existing renderer directory');
const baseline = path.resolve(baselineArg);
const renderer = path.resolve(rendererArg, 'index.html');
if (!fs.existsSync(renderer)) throw new Error(`Renderer not found: ${renderer}`);
if (
  !fs
    .readFileSync(path.join(baseline, 'package-lock.json'))
    .equals(fs.readFileSync(path.join(candidate, 'package-lock.json')))
) {
  throw new Error('Baseline and candidate must use the same lockfile');
}
const require = createRequire(path.join(candidate, 'package.json'));
const { _electron } = require('playwright');
const ts = require('typescript');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'depssmuggler-settings-profile-'));
const home = path.join(work, 'home');
const cache = path.join(home, '.depssmuggler', 'cache');
const json = JSON.stringify({ data: {}, meta: { cachedAt: Date.now(), ttl: 3600 } });
for (let group = 0; group < 200; group++) {
  const dir = path.join(cache, 'pip', `package-${group}`);
  fs.mkdirSync(dir, { recursive: true });
  for (let file = 0; file < 60; file++) fs.writeFileSync(path.join(dir, `${file}.json`), json);
}
for (let artifact = 0; artifact < 500; artifact++) {
  const dir = path.join(cache, 'maven', 'org', 'example', `artifact-${artifact}`, '1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'artifact.pom'), '<project/>');
  fs.writeFileSync(path.join(dir, 'cache-meta.json'), json);
}
for (const subdir of ['linux-64', 'noarch']) {
  const dir = path.join(cache, 'conda', 'conda-forge', subdir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'repodata.json'), '{"packages":{}}');
  fs.writeFileSync(
    path.join(dir, 'repodata.meta.json'),
    JSON.stringify({
      cachedAt: Date.now(),
      maxAge: 86400,
      fileSize: 15,
      packageCount: 0,
      compressed: false,
    })
  );
}

const compilerOptions = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
  esModuleInterop: true,
};
const results = [];
console.log(JSON.stringify({ work, cacheFiles: { pip: 12000, maven: 1000, conda: 4 }, renderer }));
for (const [variant, source] of [
  ['baseline', baseline],
  ['candidate', candidate],
]) {
  const preload = path.join(work, `${variant}-preload.cjs`);
  fs.writeFileSync(
    preload,
    ts.transpileModule(fs.readFileSync(path.join(source, 'electron/preload.ts'), 'utf8'), {
      compilerOptions,
    }).outputText
  );
  const bootstrap = path.join(work, `${variant}-bootstrap.cjs`);
  fs.writeFileSync(
    bootstrap,
    `
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const {app, ipcMain, BrowserWindow} = require('electron');
const dependencyRequire = Module.createRequire(${JSON.stringify(path.join(candidate, 'package.json'))});
const ts = dependencyRequire('typescript');
const resolve = Module._resolveFilename;
let resolvingDependency = false;
Module._resolveFilename = function(request, parent, ...rest) {
  if (!resolvingDependency && !request.startsWith('.') && !path.isAbsolute(request) && !Module.isBuiltin(request) && request !== 'electron' && parent?.filename?.startsWith(${JSON.stringify(source + path.sep)}) && !parent.filename.includes('node_modules')) {
    resolvingDependency = true;
    try { return dependencyRequire.resolve(request); } finally { resolvingDependency = false; }
  }
  return resolve.call(this, request, parent, ...rest);
};
require.extensions['.ts'] = (module, filename) => {
  let source = fs.readFileSync(filename, 'utf8');
  if (filename === ${JSON.stringify(path.join(source, 'electron/main.ts'))}) source = source.replace("path.join(__dirname, 'preload.js')", ${JSON.stringify(JSON.stringify(preload))}).replace('await waitForViteServer(VITE_DEV_SERVER_URL)', 'true');
  module._compile(ts.transpileModule(source, {compilerOptions: ${JSON.stringify(compilerOptions)}}).outputText, filename);
};
require('node:os').homedir = () => ${JSON.stringify(home)};
app.setPath('userData', ${JSON.stringify(path.join(home, variant))});
BrowserWindow.prototype.loadURL = function() { return this.loadFile(${JSON.stringify(renderer)}); };
app.on('web-contents-created', (_, contents) => { contents.openDevTools = () => {}; });
global.__profile = {ipc: [], io: {sync: 0, async: 0}, maxGapMs: 0};
const relevant = file => /[/]cache[/](pip|maven|conda)([/]|$)/.test(String(file).split(path.sep).join('/'));
for (const name of ['readdirSync', 'statSync']) {
  const original = fs[name];
  fs[name] = function(file, ...args) { if (relevant(file)) global.__profile.io.sync++; return original.call(this, file, ...args); };
}
for (const name of ['opendir', 'readdir', 'stat', 'readFile']) {
  const original = fs.promises[name];
  fs.promises[name] = function(file, ...args) { if (relevant(file)) global.__profile.io.async++; return original.call(this, file, ...args); };
}
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => handle(channel, async (...args) => {
  const started = performance.now();
  const value = handler(...args);
  const syncMs = performance.now() - started;
  const response = await value;
  global.__profile.ipc.push({channel, syncMs, totalMs: performance.now() - started});
  return response;
});
let last = performance.now();
setInterval(() => { const now = performance.now(); global.__profile.maxGapMs = Math.max(global.__profile.maxGapMs, now-last); last = now; }, 1).unref();
require(${JSON.stringify(path.join(source, 'electron/main.ts'))});
`
  );
  const app = await _electron.launch({
    executablePath: require('electron'),
    args: [bootstrap],
    timeout: 60000,
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() =>
      Boolean(window.electronAPI && document.querySelector('.ant-layout'))
    );
    await page.waitForTimeout(3000);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const metrics = async () =>
      Object.fromEntries(
        (await cdp.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value])
      );
    for (const entry of ['first', 'reentry', 'reentry-2']) {
      const before = await metrics();
      await app.evaluate(() => {
        global.__profile = { ipc: [], io: { sync: 0, async: 0 }, maxGapMs: 0 };
        global.__cpu = process.cpuUsage();
      });
      await page.evaluate(() => {
        location.hash = '/settings';
      });
      await page.waitForTimeout(3000);
      const after = await metrics();
      const main = await app.evaluate(() => ({
        ...global.__profile,
        cpu: process.cpuUsage(global.__cpu),
        versions: process.versions,
      }));
      if (!main.ipc.some(({ channel }) => channel === 'cache:stats'))
        throw new Error('No cache statistics IPC observed');
      if (
        variant === 'candidate' &&
        (main.io.sync !== 0 || (entry !== 'first' && main.io.async !== 0))
      )
        throw new Error('Unexpected repeated or synchronous cache scan');
      const row = {
        variant,
        entry,
        rendererTaskMs: (after.TaskDuration - before.TaskDuration) * 1000,
        main,
      };
      results.push(row);
      console.log(JSON.stringify(row));
      await page.evaluate(() => {
        location.hash = '/';
      });
      await page.waitForTimeout(1000);
    }
  } finally {
    await app.close();
  }
}
fs.writeFileSync(path.join(work, 'results.json'), JSON.stringify(results, null, 2));
console.log(`Results retained at ${path.join(work, 'results.json')}`);
