// Isolated production store + browser storage; no app build, React subscription or network.
// node scripts/profile-cart-bulk-add.mjs [baseline ref]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = process.argv[2] ?? '7657543';
const fixture = `
import { useCartStore as store } from './src/renderer/stores/cart-store';
window.run = (mode, count) => {
  store.getState().clearCart();
  const input = Array.from({length: count}, (_, i) => ({type: 'npm', name: 'package-' + i, version: '1.0.0'}));
  const original = Storage.prototype.setItem;
  let writes = 0, characters = 0;
  Storage.prototype.setItem = function(key, value) {
    if (this === localStorage && key === 'depssmuggler-cart') { writes++; characters += value.length; }
    return original.call(this, key, value);
  };
  let result;
  try {
    const started = performance.now();
    const added = mode === 'baseline'
      ? (input.forEach(item => store.getState().addItem(item)), store.getState().items.length)
      : store.getState().addItems(input);
    const elapsedMs = performance.now() - started;
    result = { elapsedMs, writes, characters, added,
      finalCharacters: localStorage.getItem('depssmuggler-cart').length,
      ordered: store.getState().items.every((item, i) => item.name === input[i].name && item.version === input[i].version) };
    writes = 0;
    if (mode === 'candidate') { store.getState().addItems([]); store.getState().addItems(input); }
    else input.forEach(item => store.getState().addItem(item));
    result.duplicateWrites = writes;
  } finally { Storage.prototype.setItem = original; }
  return result;
};
window.ready = true;
`;
const bundles = {};
for (const mode of ['baseline', 'candidate']) {
  const result = await build({
    stdin: { contents: fixture, resolveDir: root, sourcefile: 'cart-fixture.ts', loader: 'ts' },
    absWorkingDir: root,
    bundle: true,
    write: false,
    minify: true,
    platform: 'browser',
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins:
      mode === 'baseline'
        ? [
            {
              name: 'baseline-cart-store',
              setup(builder) {
                builder.onLoad({ filter: /cart-store\.ts$/ }, ({ path: filename }) => ({
                  contents: execFileSync(
                    'git',
                    ['show', baseline + ':' + path.relative(root, filename)],
                    { cwd: root, encoding: 'utf8' }
                  ),
                  loader: 'ts',
                  resolveDir: path.dirname(filename),
                }));
              },
            },
          ]
        : [],
  });
  bundles[mode] = result.outputFiles[0].text;
}
const server = createServer((request, response) => {
  const mode = request.url.includes('baseline') ? 'baseline' : 'candidate';
  response.setHeader('Cache-Control', 'no-store');
  if (request.url.endsWith('.js')) {
    response.setHeader('Content-Type', 'application/javascript');
    response.end(bundles[mode]);
  } else {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><script src="/${mode}.js"></script>`);
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
try {
  for (let run = 0; run < 3; run++) {
    for (const mode of ['baseline', 'candidate']) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}/${mode}`);
        await page.waitForFunction(() => window.ready);
        const result = await page.evaluate((mode) => window.run(mode, 2000), mode);
        assert.deepEqual(errors, []);
        assert.equal(result.added, 2000);
        assert.equal(result.ordered, true);
        assert.equal(result.writes, mode === 'baseline' ? 2000 : 1);
        assert.equal(result.duplicateWrites, 0);
        console.log(
          JSON.stringify({
            mode,
            baseline,
            run,
            count: 2000,
            browser: browser.version(),
            ...result,
          })
        );
      } finally {
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
