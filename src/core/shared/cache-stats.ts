import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export function isMissingCachePath(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** Share scans and retain only results that were not invalidated during a scan. */
export function createCacheStatsReader<T>(scan: (directory: string) => Promise<T>) {
  let generation = 0;
  const values = new Map<string, { value: T }>();
  const pending = new Map<string, Promise<T>>();

  return {
    invalidate(): void {
      generation++;
      values.clear();
    },
    get(directory: string, forceRefresh = false): Promise<T> {
      const key = path.resolve(directory);
      if (forceRefresh) values.delete(key);
      const active = pending.get(key);
      if (active) return active;
      const cached = values.get(key);
      if (cached) return Promise.resolve(cached.value);

      const request = Promise.resolve()
        .then(async () => {
          for (;;) {
            const startedGeneration = generation;
            const result = await scan(key);
            if (startedGeneration !== generation) continue;
            values.set(key, { value: result });
            return result;
          }
        })
        .finally(() => pending.delete(key));
      pending.set(key, request);
      return request;
    },
  };
}

/** Iterate in bounded directory batches; every file stat yields to the event loop. */
export async function getDirectoryStats(
  directory: string,
  include: (name: string) => boolean = () => true
): Promise<{ size: number; fileCount: number }> {
  const result = { size: 0, fileCount: 0 };
  async function visit(dir: string): Promise<void> {
    try {
      const entries = await fs.opendir(dir);
      for await (const entry of entries) {
        const filename = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await visit(filename);
        } else if (entry.isFile() && include(entry.name)) {
          try {
            result.size += (await fs.stat(filename)).size;
            result.fileCount++;
          } catch (error) {
            if (!isMissingCachePath(error)) throw error;
          }
        }
      }
    } catch (error) {
      if (!isMissingCachePath(error)) throw error;
    }
  }
  await visit(directory);
  return result;
}
