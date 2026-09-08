import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Command } from 'commander';

const mocks = vi.hoisted(() => ({ initialize: vi.fn(), error: vi.fn(), warn: vi.fn(), action: vi.fn() }));
vi.mock('../utils/logger', () => ({ logger: mocks }));
vi.mock('./commands/os', () => ({
  registerOSCommands: (program: Command) => {
    program.command('boundary-test').action(mocks.action);
  },
}));

describe('CLI async command boundary', () => {
  const exitCode = process.exitCode;
  const argv = process.argv;
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.exitCode = undefined;
    process.argv = ['node', 'depssmuggler', 'boundary-test'];
    mocks.initialize.mockResolvedValue(undefined);
  });
  afterEach(() => {
    process.exitCode = exitCode;
    process.argv = argv;
    vi.restoreAllMocks();
  });

  it('비동기 명령 예외를 기록하고 실패 종료 코드로 마무리한다', async () => {
    const failure = new Error('command failed');
    mocks.action.mockRejectedValue(failure);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await import('./index');
    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('CLI'), expect.objectContaining({ error: failure }));
  });

  it('파일 로거 초기화 실패 시 경고를 남기되 정상 명령은 계속한다', async () => {
    mocks.initialize.mockRejectedValue(new Error('EACCES'));
    mocks.action.mockResolvedValue(undefined);
    await import('./index');
    await vi.waitFor(() => expect(mocks.action).toHaveBeenCalled());
    expect(mocks.warn).toHaveBeenCalled();
    expect(process.exitCode).not.toBe(1);
  });
});
