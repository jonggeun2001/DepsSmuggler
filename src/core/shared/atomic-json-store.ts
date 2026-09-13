import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { open, rename, unlink } from 'node:fs/promises';
import * as path from 'node:path';

const serializedFileQueues = new Map<string, Promise<void>>();

function serializeJson(value: unknown): string {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value, null, 2);
  } catch (error) {
    throw new TypeError(`Value cannot be serialized as JSON: ${String(error)}`);
  }

  if (serialized === undefined) {
    throw new TypeError('Value cannot be serialized as JSON');
  }
  return `${serialized}\n`;
}

function temporaryPath(filePath: string): string {
  const absolutePath = path.resolve(filePath);
  return path.join(
    path.dirname(absolutePath),
    `.${path.basename(absolutePath)}.${process.pid}.${randomUUID()}.tmp`
  );
}

export async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const serialized = serializeJson(value);
  const targetPath = path.resolve(filePath);
  const tempPath = temporaryPath(targetPath);
  let fileHandle: Awaited<ReturnType<typeof open>> | undefined;
  let tempCreated = false;
  let renameCompleted = false;

  try {
    fileHandle = await open(tempPath, 'wx', 0o600);
    tempCreated = true;
    await fileHandle.writeFile(serialized, 'utf8');
    await fileHandle.sync();
    await fileHandle.close();
    fileHandle = undefined;
    await rename(tempPath, targetPath);
    renameCompleted = true;
  } finally {
    if (fileHandle) {
      await fileHandle.close().catch(() => undefined);
    }
    if (tempCreated && !renameCompleted) {
      await unlink(tempPath).catch(() => undefined);
    }
  }
}

export function writeJsonAtomicallySync(filePath: string, value: unknown): void {
  const serialized = serializeJson(value);
  const targetPath = path.resolve(filePath);
  const tempPath = temporaryPath(targetPath);
  let descriptor: number | undefined;
  let tempCreated = false;
  let renameCompleted = false;

  try {
    descriptor = fs.openSync(tempPath, 'wx', 0o600);
    tempCreated = true;
    fs.writeFileSync(descriptor, serialized, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(tempPath, targetPath);
    renameCompleted = true;
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Preserve the original write or rename error.
      }
    }
    if (tempCreated && !renameCompleted) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // Preserve the original write or rename error.
      }
    }
  }
}

export function withSerializedFile<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const normalizedPath = path.resolve(filePath);
  const previousTail = serializedFileQueues.get(normalizedPath) ?? Promise.resolve();
  const currentOperation = previousTail.catch(() => undefined).then(operation);
  const currentTail = currentOperation.then(() => undefined, () => undefined);
  serializedFileQueues.set(normalizedPath, currentTail);

  return currentOperation.finally(() => {
    if (serializedFileQueues.get(normalizedPath) === currentTail) {
      serializedFileQueues.delete(normalizedPath);
    }
  });
}
