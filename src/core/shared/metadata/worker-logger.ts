import { isMainThread, parentPort } from 'worker_threads';
import logger from '../../../utils/logger';

type Level = 'debug' | 'info' | 'warn' | 'error';
function write(level: Level, message: string, meta?: Record<string, unknown>): void {
  if (isMainThread) logger[level](message, meta);
  else parentPort?.postMessage({ kind: 'log', level, message, meta });
}
export const metadataLogger = {
  debug: (message: string, meta?: Record<string, unknown>) => write('debug', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => write('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write('error', message, meta),
};
