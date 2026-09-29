import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
// Initialize the public entry first; the internal packagers have circular imports.
import 'app-builder-lib';
import { computeSafeArtifactNameIfNeeded } from 'app-builder-lib/out/platformPackager';
import { dump } from 'js-yaml';
import { afterEach, describe, expect, it } from 'vitest';

const script = path.resolve('scripts/verify-update-artifacts.mjs');
const directories: string[] = [];
const bytes = 'real artifact bytes';

async function runVerifier(directory: string, platform = 'windows') {
  return new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [script, directory, platform]);
    let stderr = '';
    child.stdout.resume();
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stderr }));
  });
}

async function fixture(platform = 'windows', feedName = 'latest.yml') {
  const directory = await mkdtemp(path.join(tmpdir(), 'depssmuggler-update-'));
  directories.push(directory);
  const name =
    platform === 'windows' ? 'DepsSmuggler-Setup-0.2.31.exe' : 'DepsSmuggler-0.2.31.AppImage';
  await writeFile(path.join(directory, name), bytes);
  if (platform === 'windows') await writeFile(path.join(directory, `${name}.blockmap`), 'blockmap');
  const sha512 = createHash('sha512').update(bytes).digest('base64');
  const feed = {
    version: '0.2.31',
    files: [{ url: name, size: Buffer.byteLength(bytes), sha512 }],
    path: name,
    sha512,
  };
  const feedPath = path.join(directory, feedName);
  await writeFile(feedPath, dump(feed));
  return { directory, name, feed, feedPath };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('Windows/Linux update artifacts', () => {
  it('uses the same NSIS basename locally and on GitHub without publisher renaming', async () => {
    const config = JSON.parse(await readFile('package.json', 'utf8'));
    const pattern: string = config.build.win.artifactName;
    const name = pattern.replace('${version}', '0.2.31').replace('${ext}', 'exe');
    expect(name).toBe('DepsSmuggler-Setup-0.2.31.exe');
    expect(computeSafeArtifactNameIfNeeded(name, () => 'different.exe')).toBeNull();
    expect(
      computeSafeArtifactNameIfNeeded(`${name}.blockmap`, () => 'different.blockmap')
    ).toBeNull();
    expect(
      computeSafeArtifactNameIfNeeded('DepsSmuggler Setup 0.2.31.exe', () => 'different.exe')
    ).not.toBeNull();
  });

  it.each([
    ['windows', 'latest.yml'],
    ['windows', 'beta.yml'],
    ['linux', 'latest-linux.yml'],
  ])('accepts matching names, sizes and hashes in %s %s', async (platform, feedName) => {
    const { directory } = await fixture(platform, feedName);
    expect(await runVerifier(directory, platform)).toMatchObject({ code: 0 });
  });

  it.each(['DepsSmuggler Setup 0.2.31.exe', 'depssmuggler-setup-0.2.31.exe'])(
    'rejects a local filename mismatch: %s',
    async (localName) => {
      const { directory, name } = await fixture();
      await rename(path.join(directory, name), path.join(directory, localName));
      const result = await runVerifier(directory);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('Missing or unsafe artifact basename');
    }
  );

  it('rejects a missing installer blockmap', async () => {
    const { directory, name } = await fixture();
    await unlink(path.join(directory, `${name}.blockmap`));
    const result = await runVerifier(directory);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('.exe.blockmap');
  });

  it('rejects corrupted bytes even when the artifact size is unchanged', async () => {
    const { directory, name } = await fixture();
    await writeFile(path.join(directory, name), 'x'.repeat(bytes.length));
    const result = await runVerifier(directory);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('sha512 mismatch');
  });

  it('rejects a legacy download path that is absent from files', async () => {
    const { directory, feed, feedPath } = await fixture();
    await writeFile(feedPath, dump({ ...feed, path: 'other.exe' }));
    const result = await runVerifier(directory);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('legacy path/sha512');
  });

  it('rejects feed paths outside the upload directory', async () => {
    const { directory, feed, feedPath } = await fixture();
    feed.files[0].url = '../outside.exe';
    await writeFile(feedPath, dump(feed));
    const result = await runVerifier(directory);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('unsafe artifact basename');
  });

  it('does not treat the builder debug log as an update feed', async () => {
    const { directory, feedPath } = await fixture();
    await rename(feedPath, path.join(directory, 'builder-debug.yml'));
    expect((await runVerifier(directory)).stderr).toContain('Update metadata is missing');
  });
});
