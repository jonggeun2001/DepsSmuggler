import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import * as path from 'path';
import { getConfigManager } from '../core/config';

// 개발 모드 여부
const isDev = process.env.NODE_ENV === 'development';

// 로그 포맷 정의
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let log = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta)}`;
    }
    if (stack) {
      log += `\n${stack}`;
    }
    return log;
  })
);

// 콘솔용 컬러 포맷
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `[${timestamp}] ${level}: ${message}`;
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta)}`;
    }
    return log;
  })
);

class Logger {
  private logger: winston.Logger;
  private initialized = false;

  constructor() {
    // 기본 로거 생성 (초기화 전 사용)
    this.logger = winston.createLogger({
      level: 'info',
      format: logFormat,
      transports: [
        new winston.transports.Console({
          format: consoleFormat,
        }),
      ],
    });
  }

  /**
   * 로거를 초기화합니다. ConfigManager에서 로그 경로를 가져옵니다.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const configManager = getConfigManager();
    await configManager.ensureDirectories();
    const logsDir = configManager.getLogsDir();

    // 파일 로테이션 트랜스포트 설정
    const fileTransport = new DailyRotateFile({
      dirname: logsDir,
      filename: 'app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d', // 30일 보관
      format: logFormat,
    });

    // 에러 전용 파일 트랜스포트
    const errorFileTransport = new DailyRotateFile({
      dirname: logsDir,
      filename: 'error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',
      level: 'error',
      format: logFormat,
    });

    // 트랜스포트 배열 구성
    const transports: winston.transport[] = [fileTransport, errorFileTransport];

    // 개발 모드에서만 콘솔 로깅 추가
    if (isDev) {
      transports.push(
        new winston.transports.Console({
          format: consoleFormat,
        })
      );
    }

    // 로거 재설정
    this.logger = winston.createLogger({
      level: isDev ? 'debug' : 'info',
      format: logFormat,
      transports,
    });

    this.initialized = true;
    this.info('로거 초기화 완료', { logsDir });
  }

  /**
   * 에러 로그
   */
  error(message: string, meta?: Record<string, unknown>): void {
    this.logger.error(message, meta);
  }

  /**
   * 경고 로그
   */
  warn(message: string, meta?: Record<string, unknown>): void {
    this.logger.warn(message, meta);
  }

  /**
   * 정보 로그
   */
  info(message: string, meta?: Record<string, unknown>): void {
    this.logger.info(message, meta);
  }

  /**
   * 디버그 로그
   */
  debug(message: string, meta?: Record<string, unknown>): void {
    this.logger.debug(message, meta);
  }

  /**
   * 에러 객체를 로깅합니다.
   */
  logError(error: Error, context?: string): void {
    this.error(context ? `${context}: ${error.message}` : error.message, {
      stack: error.stack,
      name: error.name,
    });
  }
}

// 싱글톤 인스턴스
const logger = new Logger();

export { logger, Logger };
export default logger;
