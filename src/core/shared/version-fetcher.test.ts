import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

class MemoryStorage {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

describe('version-fetcher', () => {
  const fetchMock = vi.fn();
  let storage: MemoryStorage;
  let tempDir: string;

  beforeEach(() => {
    storage = new MemoryStorage();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'depssmuggler-version-fetcher-'));
    fetchMock.mockReset();
    vi.resetModules();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('Python 버전은 유효한 로컬 스토리지 캐시를 우선 사용한다', async () => {
    storage.setItem('python_versions_cache', JSON.stringify(['3.13', '3.12']));
    storage.setItem('python_versions_cache_timestamp', String(Date.now()));
    const { fetchPythonVersions } = await import('./version-fetcher');

    const versions = await fetchPythonVersions();

    expect(versions).toEqual(['3.13', '3.12']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Python 버전 응답을 필터링·중복 제거·정렬하고 캐시에 저장한다', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify([
          { name: 'Python 3.12.1', version: 3, pre_release: false, release_date: '2025-01-01', is_published: true },
          { name: 'Python 3.13.0', version: 3, pre_release: false, release_date: '2025-10-01', is_published: true },
          { name: 'Python 3.12.0', version: 3, pre_release: false, release_date: '2024-10-01', is_published: true },
          { name: 'Python 3.8.18', version: 3, pre_release: false, release_date: '2024-01-01', is_published: true },
          { name: 'Python 3.14.0b1', version: 3, pre_release: true, release_date: '2025-02-01', is_published: true },
        ]),
        { status: 200 }
      )
    );
    const { fetchPythonVersions } = await import('./version-fetcher');

    const versions = await fetchPythonVersions();

    expect(versions).toEqual(['3.13', '3.12']);
    expect(JSON.parse(storage.getItem('python_versions_cache') || '[]')).toEqual(['3.13', '3.12']);
    expect(storage.getItem('python_versions_cache_timestamp')).not.toBeNull();
  });

  it('Python API 실패 시 만료된 캐시로 폴백한다', async () => {
    storage.setItem('python_versions_cache', JSON.stringify(['3.11', '3.10']));
    storage.setItem(
      'python_versions_cache_timestamp',
      String(Date.now() - (25 * 60 * 60 * 1000))
    );
    fetchMock.mockRejectedValue(new Error('offline'));
    const { fetchPythonVersions } = await import('./version-fetcher');

    const versions = await fetchPythonVersions();

    expect(versions).toEqual(['3.11', '3.10']);
  });

  it('CUDA 버전은 conda repodata에서 추출 후 파일 캐시에 저장한다', async () => {
    const axios = (await import('axios')).default;
    vi.doMock('os', async () => {
      const actual = await vi.importActual<typeof import('os')>('os');
      return {
        ...actual,
        homedir: () => tempDir,
      };
    });
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        packages: {
          a: { name: 'cuda-toolkit', version: '12.6.68' },
          b: { name: 'cuda-runtime', version: '11.8.0' },
        },
        'packages.conda': {
          c: { name: 'cuda-cudart', version: '12.4.1' },
          d: { name: 'ignored', version: '1.0.0' },
        },
      },
    } as never);
    const { fetchCudaVersions } = await import('./version-fetcher');

    const versions = await fetchCudaVersions();

    expect(versions).toEqual(['12.6', '12.4', '11.8']);
    const cachePath = path.join(tempDir, '.depssmuggler', 'cache', 'cuda-versions.json');
    expect(JSON.parse(fs.readFileSync(cachePath, 'utf-8')).versions).toEqual(['12.6', '12.4', '11.8']);
  });

  it('CUDA API 실패 시 만료된 파일 캐시로 폴백한다', async () => {
    const axios = (await import('axios')).default;
    vi.doMock('os', async () => {
      const actual = await vi.importActual<typeof import('os')>('os');
      return {
        ...actual,
        homedir: () => tempDir,
      };
    });
    const cacheDir = path.join(tempDir, '.depssmuggler', 'cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      path.join(cacheDir, 'cuda-versions.json'),
      JSON.stringify({
        versions: ['12.2', '11.8'],
        timestamp: Date.now() - (8 * 24 * 60 * 60 * 1000),
      })
    );
    vi.mocked(axios.get).mockRejectedValue(new Error('nvidia offline'));
    const { fetchCudaVersions } = await import('./version-fetcher');

    const versions = await fetchCudaVersions();

    expect(versions).toEqual(['12.2', '11.8']);
  });
});
