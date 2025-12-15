/**
 * 다운로드 히스토리 관련 IPC 핸들러
 */

import { ipcMain } from 'electron';
import * as path from 'path';
import * as os from 'os';
import * as fse from 'fs-extra';
import { createScopedLogger } from './utils/logger';

const log = createScopedLogger('History');
const HISTORY_DIR = path.join(os.homedir(), '.depssmuggler');
const HISTORY_FILE = path.join(HISTORY_DIR, 'history.json');

// 히스토리 디렉토리 및 파일 초기화 (비동기)
async function ensureHistoryFile(): Promise<void> {
  try {
    await fse.ensureDir(HISTORY_DIR);
    const exists = await fse.pathExists(HISTORY_FILE);
    if (!exists) {
      await fse.writeJson(HISTORY_FILE, [], { spaces: 2 });
      log.info(`Created history file: ${HISTORY_FILE}`);
    }
  } catch (error) {
    log.error('Failed to ensure history file:', error);
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
      await ensureHistoryFile();
      const histories = await fse.readJson(HISTORY_FILE);
      log.info(`Loaded ${histories.length} history items`);
      return histories;
    } catch (error) {
      log.error('Failed to load history:', error);
      return [];
    }
  });

  // 히스토리 저장 (전체 덮어쓰기, 비동기)
  ipcMain.handle('history:save', async (_, histories: unknown[]) => {
    log.info(`Saving ${histories.length} history items...`);
    try {
      await ensureHistoryFile();
      await fse.writeJson(HISTORY_FILE, histories, { spaces: 2 });
      log.info('History saved successfully');
      return { success: true };
    } catch (error) {
      log.error('Failed to save history:', error);
      throw error;
    }
  });

  // 히스토리 항목 추가 (비동기)
  ipcMain.handle('history:add', async (_, history: unknown) => {
    log.info('Adding new history item...');
    try {
      await ensureHistoryFile();
      const histories = await fse.readJson(HISTORY_FILE);
      histories.unshift(history); // 최신 항목을 앞에 추가
      // 최대 100개 유지
      if (histories.length > 100) {
        histories.splice(100);
      }
      await fse.writeJson(HISTORY_FILE, histories, { spaces: 2 });
      log.info('History item added successfully');
      return { success: true };
    } catch (error) {
      log.error('Failed to add history:', error);
      throw error;
    }
  });

  // 특정 히스토리 항목 삭제 (비동기)
  ipcMain.handle('history:delete', async (_, id: string) => {
    log.info(`Deleting history item: ${id}`);
    try {
      await ensureHistoryFile();
      const histories = await fse.readJson(HISTORY_FILE);
      const filteredHistories = histories.filter((h: { id: string }) => h.id !== id);
      await fse.writeJson(HISTORY_FILE, filteredHistories, { spaces: 2 });
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
      await ensureHistoryFile();
      await fse.writeJson(HISTORY_FILE, [], { spaces: 2 });
      log.info('All history cleared');
      return { success: true };
    } catch (error) {
      log.error('Failed to clear history:', error);
      throw error;
    }
  });

  log.info('히스토리 핸들러 등록 완료');
}
