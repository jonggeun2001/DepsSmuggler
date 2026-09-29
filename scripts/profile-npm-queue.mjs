// Actual public resolver, with metadata/version services fixed; no app build or network.
// node scripts/profile-npm-queue.mjs [baseline ref]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(script), '..');
const baseline = process.argv[2] ?? '93c25d6';
const mode = process.argv[3];
if (!mode) {
  for (const count of [100, 1000, 10000]) {
    const results = ['baseline', 'candidate'].map((variant) =>
      JSON.parse(
        execFileSync(process.execPath, ['--expose-gc', script, baseline, variant, String(count)], {
          cwd: root,
          env: process.env,
          encoding: 'utf8',
        })
      )
    );
    assert.equal(results[0].resultDigest, results[1].resultDigest);
    for (const result of results) console.log(JSON.stringify(result));
  }
} else {
  assert(['baseline', 'candidate'].includes(mode));
  const count = Number(process.argv[4]);
  const require = createRequire(import.meta.url);
  const ts = require('typescript');
  const sourcePath = 'src/core/resolver/npm-resolver.ts';
  const oldSource =
    mode === 'baseline'
      ? execFileSync('git', ['show', `${baseline}:${sourcePath}`], { cwd: root, encoding: 'utf8' })
      : undefined;
  require.extensions['.ts'] = (module, filename) => {
    if (filename === path.join(root, 'src/utils/logger.ts')) {
      module.exports = { info() {}, debug() {}, warn() {}, error() {} };
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
  const { NpmResolver } = require(path.join(root, sourcePath));
  const resolver = new NpmResolver();
  const names = Array.from({ length: count }, (_, i) => `package-${String(i).padStart(6, '0')}`);
  const dependencies = Object.fromEntries(names.map((name) => [name, '1.0.0']));
  resolver.versionResolver = {
    fetchPackument: async (name) => ({
      name,
      versions: {
        '1.0.0': {
          name,
          version: '1.0.0',
          dist: { tarball: `https://fixture.invalid/${name}.tgz`, shasum: name, unpackedSize: 10 },
          ...(name === 'root' ? { dependencies } : {}),
        },
      },
    }),
    resolveVersionForRequest: async () => '1.0.0',
  };
  let comparisons = 0;
  let wholeQueueSorts = 0;
  const originalSort = Array.prototype.sort;
  if (mode === 'baseline') {
    Array.prototype.sort = function (compare) {
      if (this.length && this[0]?.edge && this[0]?.spec) {
        wholeQueueSorts++;
        return originalSort.call(this, (a, b) => {
          comparisons++;
          return compare(a, b);
        });
      }
      return originalSort.call(this, compare);
    };
  } else {
    const queue = resolver.depsQueue;
    const originalCompare = queue.compare;
    queue.compare = function (a, b) {
      comparisons++;
      return originalCompare.call(this, a, b);
    };
  }
  globalThis.gc();
  await new Promise(setImmediate);
  const start = performance.now();
  const cpuStart = process.cpuUsage();
  let timerDelayMs;
  const tick = new Promise((resolve) =>
    setTimeout(() => {
      timerDelayMs = performance.now() - start;
      resolve();
    }, 0)
  );
  try {
    const result = await resolver.resolveDependencies('root', '1.0.0');
    const elapsedMs = performance.now() - start;
    const cpu = process.cpuUsage(cpuStart);
    await tick;
    assert.equal(result.totalPackages, count);
    assert.deepEqual(
      result.flatList.map(({ name }) => name),
      names
    );
    assert(
      result.flatList.every(
        (item) => item.version === '1.0.0' && item.hoistedPath === `node_modules/${item.name}`
      )
    );
    assert.deepEqual(result.conflicts, []);
    // V8 may perform extra comparisons on small arrays before optimization.
    if (mode === 'baseline') assert(comparisons >= (count * (count - 1)) / 2);
    else assert(comparisons < count * 40);
    console.log(
      JSON.stringify({
        mode,
        baseline,
        count,
        node: process.version,
        electron: process.versions.electron,
        comparisons,
        wholeQueueSorts,
        elapsedMs,
        timerDelayMs,
        cpuMs: (cpu.user + cpu.system) / 1000,
        totalPackages: result.totalPackages,
        resultDigest: createHash('sha256').update(JSON.stringify(result)).digest('hex'),
      })
    );
  } finally {
    Array.prototype.sort = originalSort;
  }
}
