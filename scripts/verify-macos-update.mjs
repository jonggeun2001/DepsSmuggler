#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'js-yaml';

const buildDir = path.resolve(process.argv[2] || 'build');

async function sha512(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512');
    const stream = createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(hash.digest('base64')));
  });
}

async function verifyFeed(feedName) {
  const feed = load(await readFile(path.join(buildDir, feedName), 'utf8'));
  if (!feed || !Array.isArray(feed.files) || feed.files.length === 0) {
    throw new Error(`${feedName} must contain a nonempty files array`);
  }
  for (const entry of feed.files) {
    if (!entry || typeof entry.url !== 'string' || !entry.url ||
        /[/\\?#\0]/.test(entry.url) || path.basename(entry.url) !== entry.url ||
        entry.url === '.' || entry.url === '..') {
      throw new Error(`${feedName}: unsafe artifact basename`);
    }
  }
  if (!feed.files.some(({ url }) => url.endsWith('.zip'))) {
    throw new Error(`${feedName}: ZIP artifact is required by MacUpdater`);
  }
  if (!feed.files.some(({ url }) => url.endsWith('.dmg'))) {
    throw new Error(`${feedName}: DMG entry is missing`);
  }
  for (const entry of feed.files) {
    const file = path.join(buildDir, entry.url);
    try {
      const information = await lstat(file);
      if (!information.isFile()) throw new Error('not a regular file');
      if (!Number.isSafeInteger(entry.size) || entry.size <= 0) {
        throw new Error('positive integer size is required');
      }
      if (information.size !== entry.size) {
        throw new Error(`size mismatch (feed ${entry.size}, actual ${information.size})`);
      }
      if (typeof entry.sha512 !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(entry.sha512)) {
        throw new Error('valid base64 sha512 is required');
      }
      if ((await sha512(file)) !== entry.sha512) {
        throw new Error('sha512 mismatch');
      }
    } catch (error) {
      throw new Error(`${feedName}: ${entry.url}: ${error.message}`);
    }
  }
  console.log(`Validated ${feedName} with DMG and ZIP (${feed.files.length} files)`);
}

try {
  const feeds = (await readdir(buildDir)).filter((name) => name.endsWith('-mac.yml')).sort();
  if (feeds.length === 0) throw new Error('macOS update metadata (*-mac.yml) is missing');
  for (const feedName of feeds) await verifyFeed(feedName);
} catch (error) {
  console.error(`macOS update artifact validation failed: ${error.message}`);
  process.exitCode = 1;
}
