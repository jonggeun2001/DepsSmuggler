/**
 * 설정 관련 IPC 핸들러
 */

import { ipcMain } from 'electron';
import * as path from 'path';
import * as os from 'os';
import * as fse from 'fs-extra';
import { createScopedLogger } from './utils/logger';

const log = createScopedLogger('Config');

// 설정 파일 경로 (Windows, macOS, Linux 모두 지원)
// Windows: C:\Users\{username}\.depssmuggler\settings.json
// macOS/Linux: ~/.depssmuggler/settings.json
export const getSettingsPath = (): string => {
  const homeDir = os.homedir();
  const configDir = path.join(homeDir, '.depssmuggler');
  return path.join(configDir, 'settings.json');
};

const ensureSettingsDir = async (): Promise<string> => {
  const settingsPath = getSettingsPath();
  const dir = path.dirname(settingsPath);
  await fse.ensureDir(dir);
  return settingsPath;
};

/**
 * 설정 관련 IPC 핸들러 등록
 */
export function registerConfigHandlers(): void {
  // 설정 로드 IPC
  ipcMain.handle('config:get', async () => {
    try {
      const settingsPath = getSettingsPath();
      if (await fse.pathExists(settingsPath)) {
        const data = await fse.readFile(settingsPath, 'utf-8');
        return JSON.parse(data);
      }
      return null; // 파일이 없으면 null 반환 (기본값 사용)
    } catch (error) {
      log.error('설정 로드 실패:', error);
      return null;
    }
  });

  // 설정 저장 IPC
  ipcMain.handle('config:set', async (_event, config: unknown) => {
    try {
      const settingsPath = await ensureSettingsDir();
      await fse.writeFile(settingsPath, JSON.stringify(config, null, 2), 'utf-8');
      log.info('설정 저장 완료:', settingsPath);
      return { success: true };
    } catch (error) {
      log.error('설정 저장 실패:', error);
      return { success: false, error: String(error) };
    }
  });

  // 설정 초기화 IPC
  ipcMain.handle('config:reset', async () => {
    try {
      const settingsPath = getSettingsPath();
      if (await fse.pathExists(settingsPath)) {
        await fse.remove(settingsPath);
      }
      log.info('설정 초기화 완료');
      return { success: true };
    } catch (error) {
      log.error('설정 초기화 실패:', error);
      return { success: false, error: String(error) };
    }
  });

  // 설정 경로 반환 IPC
  ipcMain.handle('config:getPath', () => {
    return getSettingsPath();
  });

  log.info('설정 핸들러 등록 완료');
}
