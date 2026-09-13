/**
 * 설정 관련 IPC 핸들러
 */

import { ipcMain } from 'electron';
import * as path from 'path';
import * as os from 'os';
import * as fse from 'fs-extra';
import { createScopedLogger } from './utils/logger';
import { withSerializedFile, writeJsonAtomically } from '../src/core/shared/atomic-json-store';
import { validateSettingsForWrite } from '../src/core/shared/settings-validation';

const log = createScopedLogger('Config');

// 설정 파일 경로 (Windows, macOS, Linux 모두 지원)
// Windows: C:\Users\{username}\.depssmuggler\settings.json
// macOS/Linux: ~/.depssmuggler/settings.json
export const getSettingsPath = (): string => {
  const homeDir = os.homedir();
  const configDir = path.join(homeDir, '.depssmuggler');
  return path.join(configDir, 'settings.json');
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isEnoent = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';

/**
 * 설정 관련 IPC 핸들러 등록
 */
export function registerConfigHandlers(): void {
  // 설정 로드 IPC
  ipcMain.handle('config:get', async () => {
    const settingsPath = getSettingsPath();
    return withSerializedFile(settingsPath, async () => {
      try {
        const data = await fse.readFile(settingsPath, 'utf-8');
        const parsed = JSON.parse(data);
        if (isRecord(parsed)) return parsed;
        log.error('설정 로드 실패: 설정은 객체여야 합니다');
        return null;
      } catch (error) {
        if (isEnoent(error)) return null; // 파일이 없으면 null 반환 (기본값 사용)
        log.error('설정 로드 실패:', error);
        return null;
      }
    });
  });

  // 설정 저장 IPC
  ipcMain.handle('config:set', async (_event, config: unknown) => {
    const validation = validateSettingsForWrite(config);
    if ('error' in validation) {
      log.error('설정 저장 실패:', validation.error);
      return { success: false, error: validation.error };
    }
    try {
      const settingsPath = getSettingsPath();
      await withSerializedFile(settingsPath, async () => {
        await fse.ensureDir(path.dirname(settingsPath));
        await writeJsonAtomically(settingsPath, validation.config);
      });
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
      await withSerializedFile(settingsPath, () => fse.remove(settingsPath));
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
