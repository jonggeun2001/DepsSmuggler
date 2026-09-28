// Isolated production React fixture compiled in memory; no application build or installation.
// node scripts/profile-download-lists.mjs [baseline ref] [artifact directory]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = process.argv[2] ?? 'c72a765';
const artifactDirectory = process.argv[3];
const componentDirectory = 'src/renderer/pages/download-page/components/';
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { DownloadItemsTable } from ${JSON.stringify(path.join(root, componentDirectory, 'DownloadItemsTable.tsx'))};
import { DownloadLogsCard } from ${JSON.stringify(path.join(root, componentDirectory, 'DownloadLogsCard.tsx'))};
const root = createRoot(document.getElementById('root'));
const style = { marginTop: 16 };
const onRetry = (item) => { window.retried = item.id; };
let items, logs, kind;
const draw = () => root.render(kind === 'logs' ? <DownloadLogsCard logs={logs} style={style} /> :
  <DownloadItemsTable downloadItems={items} showDependenciesTree={kind === 'dependencies'} onRetry={onRetry} paginate={kind === 'progress-table'} />);
const measuredRender = () => {
  const started = performance.now(); flushSync(draw); const renderMs = performance.now() - started;
  const layoutStarted = performance.now(); document.body.getBoundingClientRect();
  return { renderMs, layoutMs: performance.now() - layoutStarted, domNodes: document.querySelectorAll('*').length,
    dependencyRows: document.querySelectorAll('.ant-list-item').length,
    tableRows: document.querySelectorAll('tr.ant-table-row').length,
    logRows: document.querySelectorAll('[data-log-id]').length };
};
window.setup = (nextKind, count) => {
  kind = nextKind;
  items = Array.from({length: count}, (_, i) => ({ id: 'item-' + i, name: 'package-' + i, version: '1.0', type: 'npm',
    status: i === count-1 ? 'failed' : 'downloading', progress: 25, downloadedBytes: 25, totalBytes: 100, speed: 1,
    error: i === count-1 ? 'fixture failure' : undefined, isDependency: i > 0, parentId: i > 0 ? 'item-0' : undefined }));
  logs = Array.from({length: count}, (_, i) => ({id: 'log-' + i, timestamp: 1000 + i, level: 'info', message: 'event-' + i, details: 'details-' + i}));
  return measuredRender();
};
window.update = () => {
  items = items.map((item, i) => i === 1 ? {...item, progress: 50, downloadedBytes: 50} : item);
  return measuredRender();
};
window.ready = true;
`;
const bundles = {};
for (const mode of ['baseline', 'candidate']) {
  const result = await build({
    stdin: {
      contents: fixture,
      resolveDir: root,
      sourcefile: 'download-lists-fixture.tsx',
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
              name: 'baseline-components',
              setup(builder) {
                builder.onLoad(
                  { filter: /Download(ItemsTable|LogsCard)\.tsx$/ },
                  ({ path: filename }) => ({
                    contents: execFileSync(
                      'git',
                      ['show', baseline + ':' + path.relative(root, filename)],
                      { cwd: root, encoding: 'utf8' }
                    ),
                    loader: 'tsx',
                    resolveDir: path.dirname(filename),
                  })
                );
              },
            },
          ]
        : [],
  });
  bundles[mode] = result.outputFiles.find((file) => file.path.endsWith('.js')).text;
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
    response.end(bundles[mode]);
  } else {
    response.setHeader('Content-Type', 'text/html');
    response.end(
      '<!doctype html><meta charset="utf-8"><style>body{margin:20px;background:#f5f5f5}</style><div id="root"></div><script src="/' +
        mode +
        '.js"></script>'
    );
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [kind, count] of [
    ['dependencies', 1000],
    ['progress-table', 1000],
    ['outcome-table', 1000],
    ['logs', 1000],
    ['logs', 5000],
  ]) {
    for (let run = 0; run < 3; run++)
      for (const mode of ['baseline', 'candidate']) {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/?mode=${mode}`);
        await page.waitForFunction(() => window.ready);
        const initial = await page.evaluate(
          ([kind, count]) => window.setup(kind, count),
          [kind, count]
        );
        await page.waitForTimeout(50); // settle effects before the single measured batch update
        const update = await page.evaluate(() => window.update());
        assert.deepEqual(errors, []);
        if (kind === 'dependencies')
          assert.equal(update.dependencyRows, mode === 'baseline' ? 999 : 10);
        if (kind === 'progress-table') assert.equal(update.tableRows, 10);
        if (kind === 'outcome-table') assert.equal(update.tableRows, 1000);
        if (kind === 'logs' && mode === 'candidate') assert.equal(update.logRows, 50);
        const result = {
          mode,
          baseline,
          kind,
          count,
          run,
          browser: browser.version(),
          initial,
          update,
        };
        results.push(result);
        console.log(JSON.stringify(result));
        if (artifactDirectory && run === 0 && mode === 'candidate' && kind !== 'outcome-table') {
          await mkdir(artifactDirectory, { recursive: true });
          await page.screenshot({
            path: path.join(artifactDirectory, `${kind}-${count}.png`),
            fullPage: true,
          });
          if (kind === 'dependencies') {
            const list = page.getByRole('region', { name: 'package-0 의존성 목록' });
            await list.getByTitle('100', { exact: true }).click();
            await list.getByRole('button', { name: '재시도' }).click();
            assert.equal(await page.evaluate(() => window.retried), 'item-999');
            await page.screenshot({
              path: path.join(artifactDirectory, 'dependency-last-page.png'),
              fullPage: true,
            });
          }
          if (kind === 'logs') {
            await page
              .getByRole('navigation', { name: '로그 페이지' })
              .getByTitle(String(count / 50), { exact: true })
              .click();
            assert.equal(
              await page.locator('[data-log-id]').last().getAttribute('data-log-id'),
              'log-' + (count - 1)
            );
          }
        }
        assert.deepEqual(errors, []);
        await page.close();
      }
  }
  if (artifactDirectory)
    await writeFile(path.join(artifactDirectory, 'results.json'), JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
