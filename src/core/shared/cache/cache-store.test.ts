import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheStore } from './cache-store';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
  rmSync: vi.fn(),
  readdirSync: vi.fn(),
}));
vi.mock('../../../utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const createStore = () =>
  new CacheStore<unknown>({
    name: 'test',
    ttlMs: 1000,
    diskTtlMs: 2000,
    diskCachePath: 'test-cache',
  });
const denied = () => {
  throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('공유 캐시 경계와 오류 복구', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(10000);
  });
  afterEach(() => vi.useRealTimers());

  it.each([false, 0, '', []])('빈 키와 falsy 값 %j도 캐시 히트로 처리한다', async (value) => {
    const cache = createStore();
    cache.set('', value);
    const fetcher = vi.fn();
    await expect(cache.getOrFetch('', fetcher)).resolves.toEqual({
      data: value,
      fromCache: true,
      cacheType: 'memory',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('TTL 경계 바로 전에는 유효하고 경계에서는 만료된다', () => {
    const cache = createStore();
    cache.set('key', 'value');
    vi.setSystemTime(10999);
    expect(cache.has('key')).toBe(true);
    vi.setSystemTime(11000);
    expect(cache.get('key')).toBeUndefined();
    expect(cache.size).toBe(0);
    expect(cache.getStats()).toMatchObject({ evictions: 1, misses: 1 });
  });

  it('동시 요청이 함께 실패해도 대기 상태를 해제하고 재시도할 수 있다', async () => {
    const cache = createStore();
    const first = deferred<string>();
    const fetcher = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce('recovered');
    const original = cache.getOrFetch('key', fetcher);
    const joined = cache.getOrFetch('key', fetcher);
    const results = Promise.allSettled([original, joined]);
    const failure = new Error('registry unavailable');
    first.reject(failure);
    const settled = await results;
    expect(settled[0]).toEqual({ status: 'rejected', reason: failure });
    expect(settled[1]).toMatchObject({ status: 'rejected' });
    expect(cache.getStats().pendingRequests).toBe(0);
    expect(cache.has('key')).toBe(false);
    await expect(cache.getOrFetch('key', fetcher)).resolves.toEqual({
      data: 'recovered',
      fromCache: false,
      cacheType: 'network',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('dedupeFetch의 null 결과는 저장하지 않고 다음 요청에서 다시 조회한다', async () => {
    const cache = createStore();
    const fetcher = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('found');
    await expect(cache.dedupeFetch('key', fetcher)).resolves.toBeNull();
    expect(cache.has('key')).toBe(false);
    expect(cache.getStats().pendingRequests).toBe(0);
    await expect(cache.dedupeFetch('key', fetcher)).resolves.toBe('found');
    expect(cache.get('key')).toBe('found');
  });

  it('dedupeFetch는 진행 중인 실패를 모든 호출자에게 전달하고 대기를 해제한다', async () => {
    const cache = createStore();
    const deferredRequest = deferred<string>();
    const fetcher = vi.fn(() => deferredRequest.promise);
    const first = cache.dedupeFetch('key', fetcher);
    const second = cache.dedupeFetch('key', fetcher);
    const results = Promise.allSettled([first, second]);
    const failure = new Error('timeout');
    deferredRequest.reject(failure);
    expect(await results).toEqual([
      { status: 'rejected', reason: failure },
      { status: 'rejected', reason: failure },
    ]);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(cache.getStats().pendingRequests).toBe(0);
  });

  it('디스크 읽기 권한 오류는 네트워크 조회로 복구한다', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(denied);
    const cache = createStore();
    const fetcher = vi.fn().mockResolvedValue({ name: 'requests' });
    await expect(cache.getOrFetch('requests', fetcher)).resolves.toEqual({
      data: { name: 'requests' },
      fromCache: false,
      cacheType: 'network',
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each(['mkdirSync', 'writeFileSync'] as const)(
    '디스크 %s 권한 오류가 메모리 캐시를 손상시키지 않는다',
    (operation) => {
      vi.mocked(fs[operation]).mockImplementation(denied);
      const cache = createStore();
      expect(() => cache.set('key', 'value')).not.toThrow();
      expect(cache.get('key')).toBe('value');
    }
  );

  it.each(['', '{invalid'])('손상된 디스크 JSON %j는 메모리에 저장하지 않는다', (content) => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(content);
    const cache = createStore();
    expect(cache.getFromDisk('key')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('디스크 TTL이 끝나면 파일을 제거하고 네트워크에서 다시 조회한다', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ data: JSON.stringify('stale'), cachedAt: 8000 })
    );
    const cache = createStore();
    const fetcher = vi.fn().mockResolvedValue('fresh');
    await expect(cache.getOrFetch('key', fetcher)).resolves.toMatchObject({
      data: 'fresh',
      fromCache: false,
    });
    expect(fs.unlinkSync).toHaveBeenCalledWith(path.join('test-cache', 'key.json'));
  });

  it('사용자 역직렬화 실패를 캐시 미스로 처리한다', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ data: 'bad', cachedAt: 10000 }));
    const cache = new CacheStore({
      name: 'custom',
      ttlMs: 1000,
      diskCachePath: 'test-cache',
      deserialize: () => {
        throw new Error('invalid format');
      },
    });
    expect(cache.getFromDisk('key')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('파일 삭제 권한이 없어도 메모리 삭제와 초기화를 완료한다', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.unlinkSync).mockImplementation(denied);
    vi.mocked(fs.rmSync).mockImplementation(denied);
    const cache = createStore();
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.delete('a')).toBe(true);
    expect(cache.has('a')).toBe(false);
    expect(() => cache.clear()).not.toThrow();
    expect(cache.size).toBe(0);
  });

  it('prune은 손상되거나 만료된 JSON만 지우고 다른 파일은 보존한다', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([
      'fresh.json',
      'expired.json',
      'broken.json',
      'README.txt',
    ] as never);
    vi.mocked(fs.readFileSync).mockImplementation((target) => {
      if (String(target).endsWith('broken.json')) return '{broken';
      return JSON.stringify({
        data: JSON.stringify('data'),
        cachedAt: String(target).endsWith('expired.json') ? 8000 : 10000,
      });
    });
    const cache = createStore();
    expect(cache.prune()).toBe(2);
    expect(
      vi.mocked(fs.unlinkSync).mock.calls.map(([target]) => path.basename(String(target)))
    ).toEqual(['expired.json', 'broken.json']);
    expect(cache.getStats().evictions).toBe(2);
  });
});
