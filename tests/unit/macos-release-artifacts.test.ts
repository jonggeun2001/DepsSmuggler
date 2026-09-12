import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findFile, parseUpdateInfo, resolveFiles } from 'electron-updater/out/providers/Provider';
import { afterEach, describe, expect, it } from 'vitest';

const script = path.resolve('scripts/verify-macos-update.mjs');

async function runVerifier(directory: string) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [script, directory]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const temporaryDirectories: string[] = [];

async function fixture(entries: Array<{ name: string; contents: string }>, feedName = 'latest-mac.yml') {
  const directory = await mkdtemp(path.join(tmpdir(), 'depssmuggler-mac-release-'));
  temporaryDirectories.push(directory);
  const build = path.join(directory, 'build');
  await mkdir(build);
  const files = [];
  for (const entry of entries) {
    await writeFile(path.join(build, entry.name), entry.contents);
    files.push({
      url: entry.name,
      size: Buffer.byteLength(entry.contents),
      sha512: createHash('sha512').update(entry.contents).digest('base64'),
    });
  }
  await writeFile(path.join(build, feedName), `version: 0.2.27\nfiles:\n${files.map((file) => `  - url: ${file.url}\n    size: ${file.size}\n    sha512: ${file.sha512}`).join('\n')}\n`);
  return build;
}

describe('macOS release artifact verifier', () => {
  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it('requires electron-builder to produce both DMG and ZIP targets', async () => {
    const packageJson = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'));
    expect(packageJson.build.mac.target).toEqual(expect.arrayContaining(['dmg', 'zip']));
  });

  it('rejects a feed containing only a DMG because updater needs a ZIP', async () => {
    const build = await fixture([{ name: 'DepsSmuggler-0.2.27-arm64.dmg', contents: 'dmg' }]);
    await writeFile(path.join(build, 'latest-mac.yml'), [
      'version: 0.2.27',
      'files:',
      '  - url: DepsSmuggler-0.2.27-arm64.dmg',
      '    sha512: invalid',
      '    size: 3',
    ].join('\n'));

    const result = await runVerifier(build);
    expect(result.code).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/ZIP artifact|ZIP.*required|required.*ZIP/i);
  });

  it('accepts matching DMG and ZIP files with real size and SHA512 values', async () => {
    const build = await fixture([
      { name: 'DepsSmuggler-0.2.27-arm64.dmg', contents: 'dmg-bytes' },
      { name: 'DepsSmuggler-0.2.27-arm64.zip', contents: 'zip-bytes' },
    ]);
    const result = await runVerifier(build);
    expect(result).toMatchObject({ code: 0 });
    const feedUrl = new URL('https://example.invalid/latest-mac.yml');
    const info = parseUpdateInfo(await readFile(path.join(build, 'latest-mac.yml'), 'utf8'), 'latest-mac.yml', feedUrl);
    const selected = findFile(resolveFiles(info, feedUrl), 'zip', ['pkg', 'dmg']);
    expect(selected?.url.pathname).toBe('/DepsSmuggler-0.2.27-arm64.zip');
  });

  it('discovers and validates a beta channel feed', async () => {
    const build = await fixture([
      { name: 'DepsSmuggler-0.2.28-arm64.dmg', contents: 'dmg-beta' },
      { name: 'DepsSmuggler-0.2.28-arm64.zip', contents: 'zip-beta' },
    ], 'beta-mac.yml');
    const result = await runVerifier(build);
    expect(result.code).toBe(0);
  });

  it.each([
    ['missing size', (feed: string) => feed.replace(/\s{4}size: \d+\n/g, '')],
    ['missing hash', (feed: string) => feed.replace(/\s{4}sha512: [^\n]+\n/g, '')],
    ['wrong size', (feed: string) => feed.replace(/\s{4}size: \d+/, '    size: 999')],
    ['wrong hash', (feed: string) => feed.replace(/\s{4}sha512: [^\n]+/, '    sha512: invalid')],
    ['malformed YAML', () => 'files: ['],
    ['missing files', () => 'version: 0.2.27'],
  ])('rejects %s feed metadata', async (_label, mutate) => {
    const build = await fixture([
      { name: 'DepsSmuggler-0.2.27-arm64.dmg', contents: 'dmg-bytes' },
      { name: 'DepsSmuggler-0.2.27-arm64.zip', contents: 'zip-bytes' },
    ]);
    const feedPath = path.join(build, 'latest-mac.yml');
    await writeFile(feedPath, mutate(await readFile(feedPath, 'utf8')));
    const result = await runVerifier(build);
    expect(result.code).toBe(1);
  });

  it.each([
    ['deleted file', async (build: string, zip: string) => unlink(path.join(build, zip))],
    ['same-size tamper', async (build: string, zip: string) => writeFile(path.join(build, zip), 'T'.repeat(9))],
  ])('rejects %s artifact', async (_label, mutate) => {
    const build = await fixture([
      { name: 'DepsSmuggler-0.2.27-arm64.dmg', contents: 'dmg-bytes' },
      { name: 'DepsSmuggler-0.2.27-arm64.zip', contents: 'zip-bytes' },
    ]);
    await mutate(build, 'DepsSmuggler-0.2.27-arm64.zip');
    const result = await runVerifier(build);
    expect(result.code).toBe(1);
  });

  it('rejects traversal-referenced feed entries', async () => {
    const build = await fixture([
      { name: 'DepsSmuggler-0.2.27-arm64.dmg', contents: 'dmg-bytes' },
      { name: 'DepsSmuggler-0.2.27-arm64.zip', contents: 'zip-bytes' },
    ]);
    const feedPath = path.join(build, 'latest-mac.yml');
    const feed = await readFile(feedPath, 'utf8');
    await writeFile(feedPath, feed.replace('DepsSmuggler-0.2.27-arm64.zip', '../outside.zip'));
    const traversal = await runVerifier(build);
    expect(traversal.code).toBe(1);
    expect(`${traversal.stdout}\n${traversal.stderr}`).toMatch(/sha512|unsafe|ZIP|artifact/i);
  });
});
