import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configGet, configList, configReset, configSet } from './config';

const manager = vi.hoisted(() => ({ getConfig: vi.fn(), set: vi.fn(), reset: vi.fn() }));
vi.mock('../../core/config', () => ({ getConfigManager: () => manager }));

describe('CLI 설정 명령', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    manager.getConfig.mockReturnValue({ concurrentDownloads: 5, cacheEnabled: false });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('키를 생략하면 전체 설정 JSON을 출력한다', async () => {
    await configGet();
    expect(console.log).toHaveBeenCalledWith(JSON.stringify(manager.getConfig(), null, 2));
  });

  it('false와 0인 설정도 존재하는 값으로 출력한다', async () => {
    manager.getConfig.mockReturnValue({ cacheEnabled: false, maxCacheSize: 0 });
    await configGet('cacheEnabled');
    await configGet('maxCacheSize');
    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('false');
    expect(output).toContain('0');
    expect(output).not.toContain('찾을 수 없습니다');
  });

  it('알 수 없는 키는 조회 실패 안내를 출력하고 설정을 바꾸지 않는다', async () => {
    await configGet('unknown');
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain(
      "설정 'unknown'를 찾을 수 없습니다"
    );
    expect(manager.set).not.toHaveBeenCalled();
  });

  it.each([
    ['cacheEnabled', 'true', true],
    ['cacheEnabled', 'false', false],
    ['concurrentDownloads', '5', 5],
    ['maxCacheSize', '1048576', 1048576],
    ['cachePath', '/tmp/package-cache', '/tmp/package-cache'],
    ['logLevel', 'debug', 'debug'],
  ])('%s=%s를 기존 CLI 변환 규칙으로 저장한다', async (key, input, expected) => {
    await configSet(key, input as string);
    expect(manager.set).toHaveBeenCalledExactlyOnceWith(key, expected);
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain('설정이 저장되었습니다');
    expect(process.exit).not.toHaveBeenCalled();
  });

  it.each(['EACCES: permission denied', '유효하지 않은 설정 키'])(
    '저장 오류를 출력하고 실패 코드로 종료한다: %s',
    async (message) => {
      manager.set.mockImplementation(() => {
        throw new Error(message);
      });
      await expect(configSet('cachePath', '/restricted')).rejects.toThrow('process.exit');
      expect(vi.mocked(console.error).mock.calls.flat().join('\n')).toContain(
        `설정 저장 실패: ${message}`
      );
      expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);
      expect(console.log).not.toHaveBeenCalled();
    }
  );

  it('설정 목록에서 기본 설명과 확장 설정을 표시한다', async () => {
    manager.getConfig.mockReturnValue({
      concurrentDownloads: 5,
      custom: 'value',
      nested: { enabled: true },
    });
    await configList();
    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('동시 다운로드 수');
    expect(output).toContain('custom');
    expect(output).toContain('value');
    expect(output).toContain('{"enabled":true}');
  });

  it('빈 설정 목록도 헤더와 함께 출력한다', async () => {
    manager.getConfig.mockReturnValue({});
    await expect(configList()).resolves.toBeUndefined();
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain('설정 목록');
    expect(console.error).not.toHaveBeenCalled();
  });

  it('기본값 초기화가 성공하면 성공 안내를 표시한다', async () => {
    await configReset();
    expect(manager.reset).toHaveBeenCalledOnce();
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain(
      '설정이 초기화되었습니다'
    );
  });

  it('초기화 권한 오류는 성공으로 표시하지 않는다', async () => {
    manager.reset.mockImplementation(() => {
      throw new Error('EACCES');
    });
    await expect(configReset()).rejects.toThrow('process.exit');
    expect(vi.mocked(console.error).mock.calls.flat().join('\n')).toContain(
      '설정 초기화 실패: EACCES'
    );
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(console.log).not.toHaveBeenCalled();
  });
});
