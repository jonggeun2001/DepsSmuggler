/**
 * Electron Backend Logger
 * electron-log 기반 파일 로깅 시스템
 */

import log from 'electron-log';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';

// 로그 디렉토리 설정 (앱 실행 디렉토리/logs)
const getLogPath = (): string => {
  const isDev = !app.isPackaged;
  if (isDev) {
    // 개발 환경: 프로젝트 루트/logs
    return path.join(process.cwd(), 'logs');
  } else {
    // 프로덕션: 앱 실행 디렉토리/logs
    return path.join(path.dirname(app.getPath('exe')), 'logs');
  }
};

// 로그 디렉토리 생성
const ensureLogDirectory = (logPath: string): void => {
  if (!fs.existsSync(logPath)) {
    fs.mkdirSync(logPath, { recursive: true });
  }
};

// 로거 초기화
const initLogger = (): typeof log => {
  const logPath = getLogPath();
  ensureLogDirectory(logPath);

  // 파일 전송 설정
  log.transports.file.resolvePathFn = () => {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return path.join(logPath, `depssmuggler-${date}.log`);
  };

  // 파일 로그 설정
  log.transports.file.level = 'debug';
  log.transports.file.maxSize = 10 * 1024 * 1024; // 10MB per file
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';

  // 콘솔 로그 설정 (개발 환경에서만 상세 출력)
  log.transports.console.level = app.isPackaged ? 'warn' : 'debug';
  log.transports.console.format = '[{h}:{i}:{s}] [{level}] {text}';

  // 오래된 로그 자동 정리 (7일)
  cleanOldLogs(logPath, 7);

  log.info('='.repeat(60));
  log.info(`DepsSmuggler started - ${new Date().toISOString()}`);
  log.info(`Log path: ${logPath}`);
  log.info(`Environment: ${app.isPackaged ? 'production' : 'development'}`);
  log.info('='.repeat(60));

  return log;
};

// 오래된 로그 파일 정리
const cleanOldLogs = (logPath: string, retentionDays: number): void => {
  try {
    const files = fs.readdirSync(logPath);
    const now = Date.now();
    const retentionMs = retentionDays * 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (!file.startsWith('depssmuggler-') || !file.endsWith('.log')) {
        continue;
      }

      const filePath = path.join(logPath, file);
      const stats = fs.statSync(filePath);
      const age = now - stats.mtime.getTime();

      if (age > retentionMs) {
        fs.unlinkSync(filePath);
        log.info(`Deleted old log file: ${file}`);
      }
    }
  } catch (error) {
    console.error('Failed to clean old logs:', error);
  }
};

// 로거 인스턴스 생성
let logger: typeof log;

export const getLogger = (): typeof log => {
  if (!logger) {
    logger = initLogger();
  }
  return logger;
};

// 편의 메서드 export
export const logDebug = (message: string, ...args: unknown[]): void => {
  getLogger().debug(message, ...args);
};

export const logInfo = (message: string, ...args: unknown[]): void => {
  getLogger().info(message, ...args);
};

export const logWarn = (message: string, ...args: unknown[]): void => {
  getLogger().warn(message, ...args);
};

export const logError = (message: string, ...args: unknown[]): void => {
  getLogger().error(message, ...args);
};

// 특정 모듈용 스코프 로거 생성
export const createScopedLogger = (scope: string) => {
  return {
    debug: (message: string, ...args: unknown[]) => logDebug(`[${scope}] ${message}`, ...args),
    info: (message: string, ...args: unknown[]) => logInfo(`[${scope}] ${message}`, ...args),
    warn: (message: string, ...args: unknown[]) => logWarn(`[${scope}] ${message}`, ...args),
    error: (message: string, ...args: unknown[]) => logError(`[${scope}] ${message}`, ...args),
  };
};

export default log;
