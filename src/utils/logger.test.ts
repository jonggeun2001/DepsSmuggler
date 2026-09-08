import { afterEach, describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import * as winston from 'winston';
import { Logger } from './logger';

describe('Logger failure isolation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('로거 호출 자체가 실패해도 마스킹한 원래 오류를 콘솔에 보존한다', () => {
    const logger = new Logger();
    const internal = (logger as unknown as { logger: winston.Logger }).logger;
    const fallback = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(internal, 'error').mockImplementation(() => { throw new Error('sink failed'); });
    logger.error('download failed', { error: new Error('network failed'), password: 'private-value' });
    expect(fallback).toHaveBeenCalledWith(expect.any(String), expect.anything(), expect.objectContaining({
      error: expect.objectContaining({ message: 'network failed' }), password: '***MASKED***',
    }));
    internal.close();
  });

  it('BigInt와 실패하는 getter를 가진 오류 메타데이터도 마스킹하여 기록한다', () => {
    const logger = new Logger();
    const internal = (logger as unknown as { logger: winston.Logger }).logger;
    const output: string[] = [];
    const stream = new PassThrough();
    stream.on('data', chunk => output.push(chunk.toString()));
    internal.clear().add(new winston.transports.Stream({ stream }));
    try {
      expect(() => logger.error('download failed', {
        bytes: 42n, password: 'private-value',
        get response() { throw new Error('getter failed'); },
      })).not.toThrow();
      const text = output.join('');
      expect(text).toContain('download failed');
      expect(text).toContain('42');
      expect(text).toContain('MASKED');
      expect(text).not.toContain('private-value');
    } finally {
      internal.close();
      stream.destroy();
    }
  });

  it('로깅 오류 이벤트는 프로세스로 전파하지 않고 콘솔에 원인을 남긴다', () => {
    const logger = new Logger();
    const internal = (logger as unknown as { logger: winston.Logger }).logger;
    const fallback = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() => internal.emit('error', new Error('ENOSPC'))).not.toThrow();
      expect(fallback).toHaveBeenCalled();
    } finally {
      internal.close();
    }
  });
});
