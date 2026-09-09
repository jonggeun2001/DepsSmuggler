import * as path from 'path';
import * as fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cacheClear, cacheList, cacheSize } from './cache';

const prompt = vi.hoisted(() => ({ createInterface: vi.fn(), question: vi.fn(), close: vi.fn() }));
const pathExists = vi.hoisted(() => vi.fn<(target: string) => Promise<boolean>>());
vi.mock('readline', () => ({ createInterface: prompt.createInterface }));
vi.mock('fs-extra', () => ({
  pathExists,
  readdir: vi.fn(),
  stat: vi.fn(),
  readJson: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('../../core/config', () => ({
  getConfigManager: () => ({ getConfig: () => ({ cachePath: 'test-cache', maxCacheSize: 4096 }) }),
}));

const failure = (code: string) => Object.assign(new Error(`${code}: cache denied`), { code });
const fileStat = (size: number, directory = false) => ({
  size,
  isDirectory: () => directory,
  mtime: new Date('2026-01-01T00:00:00Z'),
});
const dirent = (name: string, directory: boolean) => ({
  name,
  isDirectory: () => directory,
});
const output = () => vi.mocked(console.log).mock.calls.flat().join('\n');
const errors = () => vi.mocked(console.error).mock.calls.flat().join('\n');

describe('CLI 캐시 명령', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    pathExists.mockResolvedValue(true);
    vi.mocked(fs.readdir).mockResolvedValue([] as never);
    prompt.createInterface.mockReturnValue(prompt);
  });
  afterEach(() => vi.restoreAllMocks());

  it('하위 디렉토리까지 합산하여 크기와 사용률을 출력한다', async () => {
    vi.mocked(fs.readdir).mockImplementation(
      async (dir) =>
        (String(dir) === 'test-cache' ? ['direct.whl', 'nested'] : ['dependency.whl']) as never
    );
    vi.mocked(fs.stat).mockImplementation(
      async (target) =>
        fileStat(
          String(target).endsWith('direct.whl') ? 1024 : 1024,
          String(target).endsWith('nested')
        ) as never
    );
    await cacheSize();
    expect(output()).toContain('크기: 2 KB');
    expect(output()).toContain('최대 크기: 4 KB');
    expect(output()).toContain('사용률: 50.0%');
    expect(fs.stat).toHaveBeenCalledWith(path.join('test-cache', 'nested', 'dependency.whl'));
  });

  it('캐시가 없으면 0바이트를 출력한다', async () => {
    pathExists.mockResolvedValue(false);
    await cacheSize();
    expect(output()).toContain('크기: 0 B');
    expect(output()).toContain('사용률: 0.0%');
    expect(fs.readdir).not.toHaveBeenCalled();
  });

  it.each(['EACCES', 'EPERM'])('크기 조회 권한 오류를 출력한다: %s', async (code) => {
    vi.mocked(fs.readdir).mockRejectedValue(failure(code));
    await cacheSize();
    expect(errors()).toContain(`캐시 크기 확인 실패: ${code}`);
    expect(output()).not.toContain('사용률');
  });

  it('조회 중 디렉토리가 사라지면 없음 안내를 표시한다', async () => {
    vi.mocked(fs.readdir).mockRejectedValue(failure('ENOENT'));
    await cacheSize();
    expect(output()).toContain('캐시 디렉토리가 존재하지 않습니다');
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each(['', 'n', 'no', 'unexpected'])(
    '삭제 확인에서 %j를 입력하면 파일을 조회하거나 삭제하지 않는다',
    async (answer) => {
      prompt.question.mockImplementation((_question, respond) => respond(answer));
      await cacheClear({});
      expect(prompt.close).toHaveBeenCalledOnce();
      expect(fs.pathExists).not.toHaveBeenCalled();
      expect(fs.remove).not.toHaveBeenCalled();
      expect(output()).toContain('캐시 삭제가 취소되었습니다');
    }
  );

  it.each(['y', 'Y', 'yes', 'YES'])('삭제 확인 %j를 받으면 캐시만 삭제한다', async (answer) => {
    prompt.question.mockImplementation((_question, respond) => respond(answer));
    await cacheClear({});
    expect(prompt.close).toHaveBeenCalledOnce();
    expect(fs.remove).toHaveBeenCalledExactlyOnceWith('test-cache');
    expect(output()).toContain('캐시가 삭제되었습니다');
  });

  it('강제 삭제는 입력을 기다리지 않는다', async () => {
    await cacheClear({ force: true });
    expect(prompt.createInterface).not.toHaveBeenCalled();
    expect(fs.remove).toHaveBeenCalledExactlyOnceWith('test-cache');
  });

  it('캐시 크기 조회 실패 후 삭제를 진행하지 않는다', async () => {
    vi.mocked(fs.readdir).mockRejectedValue(failure('EACCES'));
    await cacheClear({ force: true });
    expect(fs.remove).not.toHaveBeenCalled();
    expect(errors()).toContain('캐시 삭제 실패: EACCES');
  });

  it('삭제 권한 거부를 실패로 출력한다', async () => {
    vi.mocked(fs.remove).mockRejectedValue(failure('EPERM'));
    await cacheClear({ force: true });
    expect(errors()).toContain('캐시 삭제 실패: EPERM');
    expect(output()).not.toContain('삭제되었습니다');
  });

  it('삭제 직전 디렉토리가 사라지면 삭제할 캐시가 없음을 알린다', async () => {
    vi.mocked(fs.remove).mockRejectedValue(failure('ENOENT'));
    await cacheClear({ force: true });
    expect(output()).toContain('삭제할 캐시가 없습니다');
  });

  it.each([true, false])('비어 있거나 없는 캐시 목록을 안내한다 (존재=%s)', async (exists) => {
    pathExists.mockResolvedValue(exists);
    await cacheList();
    expect(output()).toContain('캐시된 패키지가 없습니다');
    expect(fs.readJson).not.toHaveBeenCalled();
  });

  it('매니페스트가 있는 항목과 손상된 항목을 함께 표시한다', async () => {
    vi.mocked(fs.readdir).mockImplementation(
      async (dir) => (
        String(dir) === 'test-cache'
          ? [dirent('valid', true), dirent('broken', true)]
          : []
      ) as never
    );
    vi.mocked(fs.stat).mockResolvedValue(fileStat(0, true) as never);
    vi.mocked(fs.readJson).mockImplementation(async (target) => {
      if (String(target).includes('broken')) throw new SyntaxError('invalid JSON');
      return { name: 'requests', version: '2.32.0', type: 'pip' };
    });
    await cacheList();
    expect(output()).toContain('requests');
    expect(output()).toContain('2.32.0');
    expect(output()).toContain('broken');
    expect(output()).toContain('총 2개 패키지');
    expect(console.error).not.toHaveBeenCalled();
  });

  it('빈 매니페스트의 이름과 버전은 대체값을 표시한다', async () => {
    vi.mocked(fs.readdir).mockImplementation(
      async (dir) => (
        String(dir) === 'test-cache'
          ? [dirent('unnamed-cache', true)]
          : []
      ) as never
    );
    vi.mocked(fs.readJson).mockResolvedValue({});
    vi.mocked(fs.stat).mockResolvedValue(fileStat(0, true) as never);
    await cacheList();
    expect(output()).toContain('unnamed-cache');
    expect(output()).toContain('0 B');
    expect(output()).toContain('총 1개 패키지');
  });

  it('root regular file과 symlink를 건너뛰고 유효한 디렉터리만 표시한다', async () => {
    vi.mocked(fs.readdir).mockImplementation(
      async (dir) => {
        if (String(dir) === 'test-cache') {
          return [
            dirent('valid', true),
            dirent('loose-cache-entry.json', false),
            dirent('linked-cache', false),
          ] as never;
        }
        return [] as never;
      }
    );
    vi.mocked(fs.readJson).mockResolvedValue({ name: 'requests', version: '2.32.0', type: 'pip' });
    vi.mocked(fs.stat).mockResolvedValue(fileStat(0, true) as never);

    await cacheList();

    expect(output()).toContain('requests');
    expect(output()).toContain('총 1개 패키지');
    expect(output()).not.toContain('loose-cache-entry.json');
    expect(output()).not.toContain('linked-cache');
    expect(console.error).not.toHaveBeenCalled();
  });

  it('root에 파일과 symlink만 있으면 캐시 없음으로 안내한다', async () => {
    vi.mocked(fs.readdir).mockImplementation(
      async (dir) => (
        String(dir) === 'test-cache'
          ? [dirent('cache-manifest.json', false), dirent('linked-cache', false)]
          : []
      ) as never
    );

    await cacheList();

    expect(output()).toContain('캐시된 패키지가 없습니다');
    expect(fs.readJson).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('목록 읽기 권한이 없으면 오류만 표시한다', async () => {
    vi.mocked(fs.readdir).mockRejectedValue(failure('EACCES'));
    await cacheList();
    expect(errors()).toContain('캐시 목록 조회 실패: EACCES');
    expect(fs.readJson).not.toHaveBeenCalled();
    expect(output()).not.toContain('총');
  });
});
