// Source-only profile, no build/network. Optional real Conda fixture: REPODATA_FIXTURE=/path/repodata.json
// node scripts/profile-metadata-workers.mjs [baseline ref]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
const script = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(script), '..');
const baseline = process.argv[2] ?? '325d52a';
const mode = process.argv[3];
const kind = process.argv[4];
if (!mode) {
  const metrics = [];
  for (const kind of ['conda', 'yum'])
    for (const mode of ['baseline', 'candidate']) {
      const output = execFileSync(process.execPath, ['--expose-gc', script, baseline, mode, kind], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
      });
      const metric = JSON.parse(
        output
          .split('\n')
          .find((line) => line.startsWith('METRIC '))
          .slice(7)
      );
      metrics.push(metric);
      console.log(JSON.stringify(metric));
    }
  assert.deepEqual(metrics[0].candidates, metrics[1].candidates);
  assert.equal(metrics[2].packages, metrics[3].packages);
} else {
  const require = createRequire(import.meta.url);
  const ts = require('typescript');
  const oldFiles = new Set([
    'src/core/shared/conda-cache.ts',
    'src/core/resolver/conda-repodata-processor.ts',
    'src/core/downloaders/yum.ts',
  ]);
  require.extensions['.ts'] = (module, filename) => {
    const relative = path.relative(root, filename).split(path.sep).join('/');
    const source =
      mode === 'baseline' && oldFiles.has(relative)
        ? execFileSync('git', ['show', `${baseline}:${relative}`], { cwd: root, encoding: 'utf8' })
        : fs.readFileSync(filename, 'utf8');
    module._compile(
      ts.transpileModule(source, {
        fileName: filename,
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020,
          esModuleInterop: true,
        },
      }).outputText,
      filename
    );
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'metadata-profile-'));
  let run;
  let release = async () => {};
  let fixtureBytes;
  let expectedCount;
  if (kind === 'conda') {
    const cache = require(path.join(root, 'src/core/shared/conda-cache.ts'));
    const { CondaRepoDataProcessor } = require(
      path.join(root, 'src/core/resolver/conda-repodata-processor.ts')
    );
    const processor = new CondaRepoDataProcessor({
      condaUrl: 'https://invalid.test',
      targetSubdir: 'noarch',
      targetArchitecture: null,
      pythonVersion: null,
      cudaVersion: null,
    });
    const folder = path.join(directory, 'fixture', 'noarch');
    fs.mkdirSync(folder, { recursive: true });
    let name;
    if (process.env.REPODATA_FIXTURE) {
      fs.copyFileSync(process.env.REPODATA_FIXTURE, path.join(folder, 'repodata.json'));
      name = 'six';
    } else {
      const data = { info: { subdir: 'noarch' }, packages: {} };
      for (let index = 0; index < 100_000; index++)
        data.packages[`package-${index}.tar.bz2`] = {
          name: `package-${index}`,
          version: '1.0',
          build: '0',
          build_number: 0,
          depends: [],
          subdir: 'noarch',
          size: 4096,
        };
      fs.writeFileSync(path.join(folder, 'repodata.json'), JSON.stringify(data));
      name = 'package-100';
    }
    fixtureBytes = fs.statSync(path.join(folder, 'repodata.json')).size;
    fs.writeFileSync(
      path.join(folder, 'repodata.meta.json'),
      JSON.stringify({
        url: 'https://invalid.test',
        maxAge: 86400,
        cachedAt: Date.now(),
        fileSize: fixtureBytes,
        packageCount: 0,
        compressed: false,
      })
    );
    run = async () => {
      const loaded = await cache.fetchRepodata('fixture', 'noarch', { cacheDir: directory });
      assert(loaded);
      let data = loaded.data;
      if (mode === 'baseline')
        processor.packageIndex.set(
          'fixture/noarch',
          processor.buildPackageIndex('fixture/noarch', data)
        );
      else data = await cache.queryRepodata(data, name);
      const candidates = processor.findPackageCandidates(data, name, undefined, 'fixture/noarch');
      assert(candidates.length > 0);
      return {
        candidates: candidates.map((candidate) => candidate.filename),
        replyBytes: mode === 'candidate' ? JSON.stringify(data).length : null,
      };
    };
    if (mode === 'candidate') release = cache.closeRepodataWorker;
  } else {
    const { YumMetadataParser, closeYumMetadataWorker } = require(
      path.join(root, 'src/core/downloaders/yum.ts')
    );
    const repo = {
      id: 'fixture',
      name: 'Fixture',
      baseUrl: 'https://invalid.test',
      enabled: true,
      gpgCheck: false,
      isOfficial: true,
    };
    expectedCount = 20_000;
    const xml =
      '<metadata>' +
      Array.from(
        { length: expectedCount },
        (_, index) =>
          `<package><name>pkg-${index}</name><arch>x86_64</arch><version epoch="0" ver="01.02" rel="1.el9"/><checksum type="sha256">${'f'.repeat(64)}</checksum><summary>Fixture</summary><description>${'metadata '.repeat(45)}</description><size package="4096" installed="8192"/><location href="Packages/pkg-${index}.rpm"/><format><rpm:requires><rpm:entry name="dependency" flags="GE" ver="1.0"/></rpm:requires></format></package>`
      ).join('') +
      '</metadata>';
    const bytes = Uint8Array.from(gzipSync(xml));
    fixtureBytes = Buffer.byteLength(xml);
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => bytes.buffer.slice(0),
    });
    const parser = new YumMetadataParser(repo);
    run = async () => {
      const packages = await parser.parsePrimary('primary.xml.gz');
      assert.equal(packages.length, expectedCount);
      assert.equal(packages[0].version, '01.02');
      return { packages: packages.length, first: packages[0].name, last: packages.at(-1).name };
    };
    if (mode === 'candidate') release = closeYumMetadataWorker;
  }
  global.gc?.();
  const initial = process.memoryUsage();
  let peakRSS = initial.rss;
  let peakMainHeap = initial.heapUsed;
  let maxGap = 0;
  let last = performance.now();
  let beats = 0;
  const sample = () => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
    beats++;
    const memory = process.memoryUsage();
    peakRSS = Math.max(peakRSS, memory.rss);
    peakMainHeap = Math.max(peakMainHeap, memory.heapUsed);
  };
  const timer = setInterval(sample, 10);
  const cpu = process.cpuUsage();
  const start = performance.now();
  const result = await run();
  const elapsedMs = performance.now() - start;
  const used = process.cpuUsage(cpu);
  sample();
  await new Promise((resolve) => setTimeout(resolve, 20));
  clearInterval(timer);
  await release();
  global.gc?.();
  console.log(
    'METRIC ' +
      JSON.stringify({
        mode,
        kind,
        fixtureBytes,
        elapsedMs,
        cpuMs: (used.user + used.system) / 1000,
        maxHeartbeatGapMs: maxGap,
        heartbeats: beats,
        rssDeltaMiB: (peakRSS - initial.rss) / 1048576,
        mainHeapDeltaMiB: (peakMainHeap - initial.heapUsed) / 1048576,
        rssAfterReleaseMiB: process.memoryUsage().rss / 1048576,
        ...result,
      })
  );
  fs.rmSync(directory, { recursive: true, force: true });
}
