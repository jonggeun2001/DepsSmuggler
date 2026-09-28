import { parentPort } from 'worker_threads';
import {
  fetchRepodataInWorker,
  repodataCacheVersion,
  type RepodataReference,
  type RepodataCacheMeta,
} from '../conda-cache';
import type { RepoData } from '../conda-types';

interface Entry {
  index: Map<string, RepoData>;
  meta: RepodataCacheMeta;
  version: string;
  bytes: number;
  info: RepoData['info'];
}
// Retained index budget is measured by source JSON bytes, not a promise about JS heap size.
const MAX_BYTES = 256 * 1024 * 1024;
const MAX_ENTRIES = 2;
const entries = new Map<string, Entry>();

function keyOf(reference: RepodataReference): string {
  const { forceRefresh: _refresh, ...options } = reference.options;
  return JSON.stringify([reference.channel, reference.subdir, options]);
}

async function load(
  reference: RepodataReference,
  refresh: boolean
): Promise<{ entry: Entry; fromCache: boolean } | null> {
  const key = keyOf(reference);
  const { channel, subdir, options } = reference;
  const version = repodataCacheVersion(channel, subdir, options);
  let previous = entries.get(key);
  entries.delete(key);
  if (
    !refresh &&
    previous &&
    previous.version === version &&
    Date.now() - previous.meta.cachedAt < previous.meta.maxAge * 1000
  ) {
    entries.set(key, previous);
    return { entry: previous, fromCache: true };
  }
  previous = undefined;
  // Release old indexes before the next large parse, limiting peak retained payloads.
  if (
    entries.size >= MAX_ENTRIES ||
    [...entries.values()].reduce((sum, item) => sum + item.bytes, 0) > MAX_BYTES / 2
  )
    entries.clear();
  const result = await fetchRepodataInWorker(channel, subdir, {
    ...options,
    forceRefresh: refresh,
  });
  if (!result) return null;
  const loadedVersion = repodataCacheVersion(channel, subdir, options);
  const bytes = result.dataSize;
  const index = new Map<string, RepoData>();
  for (const format of ['packages', 'packages.conda'] as const) {
    const records = result.data[format] ?? {};
    for (const filename in records) {
      if (!Object.prototype.hasOwnProperty.call(records, filename)) continue;
      const pkg = records[filename];
      if (typeof pkg.name !== 'string') continue;
      const name = pkg.name.toLowerCase();
      let subset = index.get(name);
      if (!subset) {
        subset = {
          info: result.data.info,
          packages: Object.create(null),
          'packages.conda': Object.create(null),
        };
        index.set(name, subset);
      }
      subset[format]![filename] = pkg;
    }
  }
  const entry: Entry = {
    index,
    meta: result.meta,
    version: loadedVersion,
    bytes,
    info: result.data.info,
  };
  if (bytes <= MAX_BYTES) {
    entries.set(key, entry);
    while (
      entries.size > MAX_ENTRIES ||
      [...entries.values()].reduce((sum, item) => sum + item.bytes, 0) > MAX_BYTES
    ) {
      entries.delete(entries.keys().next().value!);
    }
  }
  return { entry, fromCache: result.fromCache };
}

parentPort!.on(
  'message',
  async (message: { kind: string; reference: RepodataReference; name?: string }) => {
    if (message.kind !== 'load' && message.kind !== 'query') return;
    try {
      const loaded = await load(
        message.reference,
        message.kind === 'load' && !!message.reference.options.forceRefresh
      );
      if (message.kind === 'load') {
        parentPort!.postMessage({
          kind: 'result',
          result: loaded
            ? {
                data: {
                  ...message.reference,
                  options: { ...message.reference.options, forceRefresh: false },
                  info: loaded.entry.info,
                },
                meta: loaded.entry.meta,
                fromCache: loaded.fromCache,
              }
            : null,
        });
      } else {
        if (!loaded)
          throw new Error(
            `Repodata reload failed: ${message.reference.channel}/${message.reference.subdir}`
          );
        parentPort!.postMessage({
          kind: 'result',
          result: loaded.entry.index.get(message.name!.toLowerCase()) ?? {
            info: loaded.entry.info,
            packages: {},
          },
        });
      }
    } catch (error) {
      const caught = error as Error;
      parentPort!.postMessage({
        kind: 'result',
        error: { name: caught.name, message: caught.message },
      });
    }
  }
);
