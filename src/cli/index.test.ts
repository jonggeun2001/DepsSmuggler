import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Command } from 'commander';

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  action: vi.fn(),
  downloadCommand: vi.fn(),
}));
vi.mock('../utils/logger', () => ({ logger: mocks }));
vi.mock('./commands/download', () => ({ downloadCommand: mocks.downloadCommand }));
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
    mocks.downloadCommand.mockResolvedValue(undefined);
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
    expect(mocks.error).toHaveBeenCalledWith(
      expect.stringContaining('CLI'),
      expect.objectContaining({ error: failure })
    );
  });

  it('파일 로거 초기화 실패 시 경고를 남기되 정상 명령은 계속한다', async () => {
    mocks.initialize.mockRejectedValue(new Error('EACCES'));
    mocks.action.mockResolvedValue(undefined);
    await import('./index');
    await vi.waitFor(() => expect(mocks.action).toHaveBeenCalled());
    expect(mocks.warn).toHaveBeenCalled();
    expect(process.exitCode).not.toBe(1);
  });

  it.each(['linux', 'windows', 'macos'])(
    'download --target-os %s를 핸들러의 targetOS 계약으로 전달한다',
    async (targetOS) => {
      process.argv = [
        'node',
        'depssmuggler',
        'download',
        '--target-os',
        targetOS,
        '--type',
        'pip',
        '--package',
        'cryptography',
        '--python-version',
        '3.12',
        '--arch',
        'x86_64',
      ];

      await import('./index');
      await vi.waitFor(() => expect(mocks.downloadCommand).toHaveBeenCalled());

      expect(mocks.downloadCommand).toHaveBeenCalledWith(expect.objectContaining({ targetOS }));
    }
  );

  it.each([
    ['freebsd', 'pip'],
    ['linux', 'npm'],
  ])(
    '지원하지 않는 target-os/type 조합도 원래 값 그대로 핸들러에 전달한다: %s/%s',
    async (targetOS, type) => {
      process.argv = [
        'node',
        'depssmuggler',
        'download',
        '--target-os',
        targetOS,
        '--type',
        type,
        '--package',
        'example',
      ];

      await import('./index');
      await vi.waitFor(() => expect(mocks.downloadCommand).toHaveBeenCalled());

      expect(mocks.downloadCommand).toHaveBeenCalledWith(
        expect.objectContaining({ targetOS, type })
      );
    }
  );
});
