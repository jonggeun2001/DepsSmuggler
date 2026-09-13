#!/usr/bin/env node
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dump, load } from 'js-yaml';

try {
  const buildDir = path.resolve(process.argv[2] || 'build');
  const policy = JSON.parse(await readFile(new URL('./macos-update-policy.json', import.meta.url), 'utf8'));
  const feeds = (await readdir(buildDir)).filter(name => name.endsWith('-mac.yml')).sort();
  if (feeds.length === 0) throw new Error('macOS update metadata (*-mac.yml) is missing');
  for (const name of feeds) {
    const file = path.join(buildDir, name);
    const feed = load(await readFile(file, 'utf8'));
    if (!feed || typeof feed !== 'object' || !Array.isArray(feed.files)) {
      throw new Error(`${name}: invalid update metadata`);
    }
    feed.minimumSystemVersion = policy.minimumDarwinVersion;
    await writeFile(file, dump(feed, { lineWidth: -1 }));
  }
} catch (error) {
  console.error(`macOS update metadata preparation failed: ${error.message}`);
  process.exitCode = 1;
}
