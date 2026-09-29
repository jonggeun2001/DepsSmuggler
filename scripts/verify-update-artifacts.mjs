#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'js-yaml';

const directory = path.resolve(process.argv[2] || 'build');
const platform = process.argv[3];

async function sha512(file) {
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('base64');
}

try {
  if (!['windows', 'linux'].includes(platform)) throw new Error('Specify windows or linux');
  const names = new Set(await readdir(directory));
  const feeds = [...names].filter((name) => name.endsWith('.yml') && name !== 'builder-debug.yml');
  if (feeds.length === 0) throw new Error('Update metadata is missing');

  const artifact = async (name) => {
    // Exact case and GitHub-safe names: the final publisher must not rename the file.
    if (typeof name !== 'string' || !/^[A-Za-z0-9._-]+$/.test(name) || !names.has(name)) {
      throw new Error(`Missing or unsafe artifact basename: ${name}`);
    }
    const info = await lstat(path.join(directory, name));
    if (!info.isFile() || info.size === 0) throw new Error(`Invalid artifact: ${name}`);
    return info;
  };

  for (const feedName of feeds) {
    const feed = load(await readFile(path.join(directory, feedName), 'utf8'));
    if (!feed || !Array.isArray(feed.files) || feed.files.length === 0) {
      throw new Error(`${feedName}: nonempty files array is required`);
    }
    const extension = platform === 'windows' ? '.exe' : '.AppImage';
    if (
      !feed.files.some((entry) => typeof entry?.url === 'string' && entry.url.endsWith(extension))
    ) {
      throw new Error(`${feedName}: ${extension} update artifact is required`);
    }
    for (const entry of feed.files) {
      const info = await artifact(entry?.url);
      if (info.size !== entry.size) throw new Error(`${feedName}: ${entry.url} size mismatch`);
      if ((await sha512(path.join(directory, entry.url))) !== entry.sha512) {
        throw new Error(`${feedName}: ${entry.url} sha512 mismatch`);
      }
      if (entry.url.endsWith('.exe')) await artifact(`${entry.url}.blockmap`);
    }
    if (feed.path != null) {
      const legacy = feed.files.find((entry) => entry.url === feed.path);
      if (!legacy || feed.sha512 !== legacy.sha512) {
        throw new Error(`${feedName}: legacy path/sha512 does not match files`);
      }
    }
    process.stdout.write(`Validated ${feedName}: artifact names, sizes, hashes and blockmaps\n`);
  }
} catch (error) {
  console.error(`Update artifact validation failed: ${error.message}`);
  process.exitCode = 1;
}
