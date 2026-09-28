import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  home: '',
  handle: vi.fn(),
  fetch: vi.fn(),
  get: vi.fn(),
  log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }));
vi.mock('axios', () => ({ default: { get: mocks.get } }));
vi.mock('../src/utils/logger', () => ({ default: mocks.log }));
vi.mock('./utils/logger', () => ({ createScopedLogger: () => mocks.log }));
vi.mock('os', async () => ({
  ...(await vi.importActual<typeof import('os')>('os')),
  homedir: () => mocks.home,
}));

const pythonData = [
  {
    name: 'Python 3.14.0',
    version: 3,
    pre_release: false,
    is_published: true,
    release_date: '2026-01-01',
  },
];
const cudaData = {
  data: { packages: { 'cuda-toolkit.tar.bz2': { name: 'cuda-toolkit', version: '13.0.1' } } },
};
const expected = { python: ['3.14'], cuda: ['13.0'] };
const fallback = {
  python: ['3.13', '3.12', '3.11', '3.10', '3.9'],
  cuda: ['12.6', '12.5', '12.4', '12.1', '12.0', '11.8'],
};
const day = 24 * 60 * 60 * 1000;
let storage: Map<string, string>;

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function transport(gate = Promise.resolve()) {
  // 각 transport 호출은 독립 응답 body를 가진다. 실제 요청 중복은 호출 수로 센다.
  mocks.fetch.mockImplementation(() => gate.then(() => new Response(JSON.stringify(pythonData))));
  mocks.get.mockImplementation(() => gate.then(() => cudaData));
}
function invoke(channel: string): Promise<string[]> {
  const entry = mocks.handle.mock.calls.find(([name]) => name === channel);
  if (!entry) throw new Error(`missing handler ${channel}`);
  return entry[1]();
}
async function load() {
  const fetcher = await import('../src/core/shared/version-fetcher');
  const preloader = await import('../src/core/shared/version-preloader');
  const handlers = await import('./version-handlers');
  return { ...fetcher, ...preloader, ...handlers };
}
async function seedCache(timestamp: number) {
  storage.set('python_versions_cache', JSON.stringify(['3.10']));
  storage.set('python_versions_cache_timestamp', String(timestamp));
  const directory = path.join(mocks.home, '.depssmuggler', 'cache');
  await fs.promises.mkdir(directory, { recursive: true });
  await fs.promises.writeFile(
    path.join(directory, 'cuda-versions.json'),
    JSON.stringify({ versions: ['11.8'], timestamp })
  );
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.home = fs.mkdtempSync(path.join(os.tmpdir(), 'depssmuggler-version-sharing-'));
  storage = new Map();
  vi.stubGlobal('fetch', mocks.fetch);
  vi.stubGlobal('window', undefined); // Electron main의 preloader 캐시/상태 집계 경로
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  transport();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  fs.rmSync(mocks.home, { recursive: true, force: true });
});

describe('actual version startup paths share pending requests', () => {
  it('cold start 두 경로와 조기 IPC가 겹쳐도 종류별 transport 1회이며 완료 캐시를 재사용한다', async () => {
    const gate = deferred();
    transport(gate.promise);
    const api = await load();
    api.registerVersionHandlers();
    const preloaded = api.preloadAllVersions();
    await settle();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledTimes(1);
    const python = invoke('versions:python');
    const cuda = invoke('versions:cuda');
    const directPython = api.fetchPythonVersions();
    expect(api.fetchPythonVersions()).toBe(directPython);
    const directCuda = api.fetchCudaVersions();
    expect(api.fetchCudaVersions()).toBe(directCuda);
    await settle();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledTimes(1);
    gate.resolve();
    expect(await preloaded).toMatchObject({
      success: true,
      status: { python: 'success', cuda: 'success' },
      errors: [],
    });
    expect(await Promise.all([python, cuda, directPython, directCuda])).toEqual([
      expected.python,
      expected.cuda,
      expected.python,
      expected.cuda,
    ]);
    expect(mocks.fetch.mock.calls[0][0]).toBe('https://www.python.org/api/v2/downloads/release/');
    expect(mocks.get.mock.calls[0][0]).toBe(
      'https://conda.anaconda.org/nvidia/linux-64/repodata.json'
    );
    await api.preloadAllVersions();
    expect(await invoke('versions:python')).toEqual(expected.python);
    expect(await invoke('versions:cuda')).toEqual(expected.cuda);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    'fallback resolve 후 fetcher는 재조회하고 IPC 세션 정책은 보존한다 (만료 캐시=%s)',
    async (expired) => {
      if (expired) await seedCache(Date.now() - 8 * day);
      const gate = deferred();
      transport(gate.promise);
      const api = await load();
      api.registerVersionHandlers();
      const preloaded = api.preloadAllVersions();
      const python = invoke('versions:python');
      const cuda = invoke('versions:cuda');
      await settle();
      await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(1));
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
      gate.reject(new Error('fixture offline'));
      const oldPython = expired ? ['3.10'] : fallback.python;
      const oldCuda = expired ? ['11.8'] : fallback.cuda;
      expect(await Promise.all([python, cuda])).toEqual([oldPython, oldCuda]);
      expect(await preloaded).toMatchObject({
        success: true,
        status: { python: 'success', cuda: 'success' },
      });
      transport();
      const pythonRetry = api.fetchPythonVersions();
      const cudaRetry = api.fetchCudaVersions();
      expect(api.fetchPythonVersions()).toBe(pythonRetry);
      expect(api.fetchCudaVersions()).toBe(cudaRetry);
      expect(await Promise.all([pythonRetry, cudaRetry])).toEqual([expected.python, expected.cuda]);
      expect(mocks.fetch).toHaveBeenCalledTimes(2);
      expect(mocks.get).toHaveBeenCalledTimes(2);
      // 네트워크 회복과 IPC fallback 자동 회복은 별도 계약이다.
      expect(await invoke('versions:python')).toEqual(oldPython);
      expect(await invoke('versions:cuda')).toEqual(oldCuda);
      expect(mocks.fetch).toHaveBeenCalledTimes(2);
      expect(mocks.get).toHaveBeenCalledTimes(2);
    }
  );

  it.each(['python', 'cuda'] as const)(
    '%s의 예외 reject도 pending을 해제하여 후속 호출을 허용한다',
    async (kind) => {
      const api = await load();
      const fetchVersions = kind === 'python' ? api.fetchPythonVersions : api.fetchCudaVersions;
      const gate = deferred();
      transport(gate.promise);
      const error = new Error('fixture logger failure');
      mocks.log.error.mockImplementation(() => {
        throw error;
      });
      const first = fetchVersions();
      const second = fetchVersions();
      expect(second).toBe(first);
      const settled = Promise.allSettled([first, second]);
      gate.reject(new Error('fixture transport failure'));
      expect(await settled).toEqual([
        { status: 'rejected', reason: error },
        { status: 'rejected', reason: error },
      ]);
      mocks.log.error.mockReset();
      transport();
      await expect(fetchVersions()).resolves.toEqual(expected[kind]);
      expect(kind === 'python' ? mocks.fetch : mocks.get).toHaveBeenCalledTimes(2);
    }
  );

  it.each(['python', 'cuda'] as const)(
    '%s 정상 완료 뒤에도 기존 TTL 만료 시 새 공유 요청을 만든다',
    async (kind) => {
      const now = 1_800_000_000_000;
      const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
      const api = await load();
      const fetchVersions = kind === 'python' ? api.fetchPythonVersions : api.fetchCudaVersions;
      expect(await fetchVersions()).toEqual(expected[kind]);
      expect(await fetchVersions()).toEqual(expected[kind]);
      const called = kind === 'python' ? mocks.fetch : mocks.get;
      expect(called).toHaveBeenCalledTimes(1);
      clock.mockReturnValue(now + (kind === 'python' ? day : 7 * day) + 1);
      const first = fetchVersions();
      expect(fetchVersions()).toBe(first);
      expect(await first).toEqual(expected[kind]);
      expect(called).toHaveBeenCalledTimes(2);
    }
  );

  it('유효한 저장 캐시를 보존하고 동시 CUDA 파일 읽기도 한 번만 실행한다', async () => {
    await seedCache(Date.now());
    const reader = vi.spyOn(fs.promises, 'readFile');
    const api = await load();
    const first = api.fetchCudaVersions();
    expect(api.fetchCudaVersions()).toBe(first);
    expect(await Promise.all([api.fetchPythonVersions(), first])).toEqual([['3.10'], ['11.8']]);
    expect(
      reader.mock.calls.filter(([filename]) => String(filename).endsWith('cuda-versions.json'))
    ).toHaveLength(1);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
