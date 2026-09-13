/**
 * 다운로드 히스토리 관련 IPC 핸들러
 */

import { ipcMain } from 'electron';
import * as path from 'path';
import * as os from 'os';
import * as fse from 'fs-extra';
import { createScopedLogger } from './utils/logger';
import { withSerializedFile, writeJsonAtomically } from '../src/core/shared/atomic-json-store';

const log = createScopedLogger('History');
const HISTORY_DIR = path.join(os.homedir(), '.depssmuggler');
const HISTORY_FILE = path.join(HISTORY_DIR, 'history.json');

type HistoryRecord = {
  id: string;
  [key: string]: unknown;
};

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function validateHistory(value: unknown): HistoryRecord[] {
  if (!Array.isArray(value) || value.some((item) =>
    Array.isArray(item) || typeof item !== 'object' || item === null ||
    typeof (item as { id?: unknown }).id !== 'string' ||
    !(item as { id: string }).id.trim()
  )) {
    throw new TypeError('History must be an array of records with non-empty string IDs');
  }
  return value as HistoryRecord[];
}

function validateRecord(value: unknown): HistoryRecord {
  validateHistory([value]);
  return value as HistoryRecord;
}

function validateId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError('History ID must be a non-empty string');
  }
}

async function ensureHistoryDirectory(): Promise<void> {
  await fse.ensureDir(HISTORY_DIR);
}

async function readHistory(): Promise<HistoryRecord[]> {
  try {
    return validateHistory(await fse.readJson(HISTORY_FILE));
  } catch (error) {
    if (isEnoent(error)) {
      await writeJsonAtomically(HISTORY_FILE, []);
      log.info(`Created history file: ${HISTORY_FILE}`);
      return [];
    }
    throw error;
  }
}

/**
 * 히스토리 관련 IPC 핸들러 등록
 */
export function registerHistoryHandlers(): void {
  // 히스토리 로드 (비동기)
  ipcMain.handle('history:load', async () => {
    log.info('Loading history...');
    try {
      const histories = await withSerializedFile(HISTORY_FILE, async () => {
        await ensureHistoryDirectory();
        return readHistory();
      });
      log.info(`Loaded ${histories.length} history items`);
      return histories;
    } catch (error) {
      log.error('Failed to load history:', error);
      return [];
    }
  });

  // 히스토리 저장 (전체 덮어쓰기, 비동기)
  ipcMain.handle('history:save', async (_, histories: unknown[]) => {
    const validHistories = validateHistory(histories);
    log.info(`Saving ${validHistories.length} history items...`);
    try {
      await withSerializedFile(HISTORY_FILE, async () => {
        await ensureHistoryDirectory();
        await writeJsonAtomically(HISTORY_FILE, validHistories);
      });
      log.info('History saved successfully');
      return { success: true };
    } catch (error) {
      log.error('Failed to save history:', error);
      throw error;
    }
  });

  // 히스토리 항목 추가 (비동기)
  ipcMain.handle('history:add', async (_, history: unknown) => {
    const validHistory = validateRecord(history);
    log.info('Adding new history item...');
    try {
      await withSerializedFile(HISTORY_FILE, async () => {
        await ensureHistoryDirectory();
        const histories = await readHistory();
        histories.unshift(validHistory); // 최신 항목을 앞에 추가
        // 최대 100개 유지
        if (histories.length > 100) {
          histories.splice(100);
        }
        await writeJsonAtomically(HISTORY_FILE, histories);
      });
      log.info('History item added successfully');
      return { success: true };
    } catch (error) {
      log.error('Failed to add history:', error);
      throw error;
    }
  });

  // 특정 히스토리 항목 삭제 (비동기)
  ipcMain.handle('history:delete', async (_, id: string) => {
    validateId(id);
    log.info(`Deleting history item: ${id}`);
    try {
      await withSerializedFile(HISTORY_FILE, async () => {
        await ensureHistoryDirectory();
        const histories = await readHistory();
        const filteredHistories = histories.filter((h) => h.id !== id);
        await writeJsonAtomically(HISTORY_FILE, filteredHistories);
      });
      log.info(`History item ${id} deleted successfully`);
      return { success: true };
    } catch (error) {
      log.error('Failed to delete history:', error);
      throw error;
    }
  });

  // 전체 히스토리 삭제 (비동기)
  ipcMain.handle('history:clear', async () => {
    log.info('Clearing all history...');
    try {
      await withSerializedFile(HISTORY_FILE, async () => {
        await ensureHistoryDirectory();
        await writeJsonAtomically(HISTORY_FILE, []);
      });
      log.info('All history cleared');
      return { success: true };
    } catch (error) {
      log.error('Failed to clear history:', error);
      throw error;
    }
  });

  log.info('히스토리 핸들러 등록 완료');
}
