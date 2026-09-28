// Bundle only a standalone test fixture in memory; no application build or installation.
// node scripts/profile-dependency-tree.mjs [baseline ref] [artifact directory]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = process.argv[2] ?? 'a54f96c';
const artifactDirectory = process.argv[3];
const component = path.join(root, 'src/renderer/components/DependencyTree.tsx');
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import DependencyTree from ${JSON.stringify(component)};
const root = createRoot(document.getElementById('root'));
const node = (name, dependencies = []) => ({ package: { type: 'maven', name: 'org:' + name, version: '1.0.0' }, dependencies });
window.runTree = (layers) => {
  const all = []; let next = [];
  for (let depth = layers - 1; depth >= 0; depth--) { const left = node('left-' + depth, next); const right = node('right-' + depth, next); all.push(left, right); next = [left, right]; }
  const source = node('root', next);
  const data = { root: source, flatList: [source.package, ...all.map(item => item.package)], conflicts: [] };
  const started = performance.now();
  flushSync(() => root.render(<DependencyTree data={data} />));
  const renderMs = performance.now() - started;
  const layoutStarted = performance.now(); document.body.getBoundingClientRect();
  return { layers, unique: all.length + 1, renderMs, layoutMs: performance.now() - layoutStarted, svgNodes: document.querySelectorAll('.rd3t-node,.rd3t-leaf-node').length, domNodes: document.querySelectorAll('*').length };
};
window.ready = true;
`;
const bundles = {};
for (const mode of ['baseline', 'candidate']) {
  const result = await build({
    stdin: {
      contents: fixture,
      resolveDir: root,
      sourcefile: 'dependency-tree-fixture.tsx',
      loader: 'tsx',
    },
    absWorkingDir: root,
    bundle: true,
    write: false,
    outdir: 'fixture-in-memory',
    minify: true,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins:
      mode === 'baseline'
        ? [
            {
              name: 'baseline-component',
              setup(builder) {
                builder.onLoad({ filter: /DependencyTree\.tsx$/ }, () => ({
                  contents: execFileSync(
                    'git',
                    ['show', baseline + ':src/renderer/components/DependencyTree.tsx'],
                    { cwd: root, encoding: 'utf8' }
                  ),
                  loader: 'tsx',
                  resolveDir: path.dirname(component),
                }));
              },
            },
          ]
        : [],
  });
  bundles[mode] = {
    js: result.outputFiles.find((file) => file.path.endsWith('.js')).text,
    css: result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '',
  };
}
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const mode =
    url.pathname.includes('baseline') || url.searchParams.get('mode') === 'baseline'
      ? 'baseline'
      : 'candidate';
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname.endsWith('.js')) {
    response.setHeader('Content-Type', 'application/javascript');
    response.end(bundles[mode].js);
  } else if (url.pathname.endsWith('.css')) {
    response.setHeader('Content-Type', 'text/css');
    response.end(bundles[mode].css);
  } else {
    response.setHeader('Content-Type', 'text/html');
    response.end(
      '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/' +
        mode +
        '.css"><div id="root"></div><script src="/' +
        mode +
        '.js"></script>'
    );
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (let run = 0; run < 3; run++)
    for (const mode of ['baseline', 'candidate']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/?mode=${mode}`);
      await page.waitForFunction(() => window.ready);
      const result = {
        mode,
        run,
        browser: browser.version(),
        ...(await page.evaluate(() => window.runTree(10))),
      };
      assert.deepEqual(errors, []);
      assert.equal(result.svgNodes, mode === 'baseline' ? 2047 : 39);
      results.push(result);
      console.log(JSON.stringify(result));
      if (artifactDirectory && run === 0 && mode === 'candidate') {
        await mkdir(artifactDirectory, { recursive: true });
        // Timing above measures the first commit; wait for the existing 300 ms animation only for visual QA.
        await page.waitForTimeout(400);
        await page.screenshot({
          path: path.join(artifactDirectory, 'dependency-tree.png'),
          fullPage: true,
        });
        for (const extension of ['png', 'svg']) {
          const downloaded = page.waitForEvent('download');
          await page.getByRole('button', { name: `${extension.toUpperCase()} 저장` }).click();
          const download = await downloaded;
          const destination = path.join(artifactDirectory, `export.${extension}`);
          await download.saveAs(destination);
          const bytes = await readFile(destination);
          assert.ok(bytes.length > 1000);
          if (extension === 'svg') {
            assert.ok(bytes.toString().includes('↗ 참조'));
            assert.ok(bytes.toString().includes('표시 항목 39/39개'));
          } else {
            assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
          }
        }
        assert.deepEqual(errors, []);
      }
      await page.close();
    }
  if (artifactDirectory)
    await writeFile(path.join(artifactDirectory, 'results.json'), JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
