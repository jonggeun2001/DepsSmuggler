import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mkdir: vi.fn(),
  log: {
    transports: { file: { level: 'debug' }, console: { level: 'debug' } },
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  },
}));
vi.mock('electron', () => ({ app: { isPackaged: true } }));
vi.mock('electron-log', () => ({ default: mocks.log }));
vi.mock('fs', () => ({ default: { existsSync: () => false, mkdirSync: mocks.mkdir } }));

describe('Electron logger startup', () => {
  afterEach(() => vi.restoreAllMocks());
  it('로거 호출 실패 시에도 마스킹한 원래 오류를 콘솔에 남긴다', async () => {
    vi.resetModules();
    mocks.mkdir.mockImplementation(() => { throw new Error('EACCES'); });
    mocks.log.error.mockImplementationOnce(() => { throw new Error('sink failed'); });
    const fallback = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { createScopedLogger } = await import('./logger');
    createScopedLogger('Download').error('failed', { error: new Error('network failed'), password: 'private-value' });
    expect(fallback).toHaveBeenCalledWith(expect.any(String), expect.anything(), expect.objectContaining({
      error: expect.objectContaining({ message: 'network failed' }), password: '***MASKED***',
    }));
  });
  it('로그 디렉토리에 쓸 수 없어도 파일 로그만 끄고 콘솔로 계속 기록한다', async () => {
    vi.resetModules();
    mocks.mkdir.mockImplementation(() => { throw new Error('EACCES'); });
    const fallback = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { createScopedLogger } = await import('./logger');
    expect(() => createScopedLogger('Main').error('startup failure', { password: 'private-value' })).not.toThrow();
    expect(mocks.log.transports.file.level).toBe(false);
    expect(mocks.log.error).toHaveBeenCalledWith('[Main] startup failure', { password: '***MASKED***' });
    expect(fallback).toHaveBeenCalled();
  });
});
