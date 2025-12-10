/**
 * pip-cache.ts 단위 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import axios from 'axios';
import {
  fetchPackageMetadata,
  clearMemoryCache,
  clearDiskCache,
  clearAllCache,
  getCacheStats,
  pruneExpiredCache,
  PyPIResponse,
} from './pip-cache';

// axios 모킹
vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

// 테스트용 PyPI 응답 생성
function createMockPyPIResponse(name: string, version: string): { data: PyPIResponse } {
  return {
    data: {
      info: {
        name,
        version,
        requires_dist: ['urllib3>=1.21.1', 'certifi>=2017.4.17'],
        requires_python: '>=3.7',
      },
      releases: {
        [version]: [
          {
            filename: `${name}-${version}.tar.gz`,
            url: `https://files.pythonhosted.org/packages/${name}-${version}.tar.gz`,
            packagetype: 'sdist',
            python_version: 'source',
            digests: { sha256: 'abc123' },
            size: 1024,
          },
        ],
        '2.27.0': [
          {
            filename: `${name}-2.27.0.tar.gz`,
            url: `https://files.pythonhosted.org/packages/${name}-2.27.0.tar.gz`,
            packagetype: 'sdist',
            python_version: 'source',
            digests: { sha256: 'def456' },
            size: 1000,
          },
        ],
      },
    },
  };
}

describe('pip-cache', () => {
  const testCacheDir = path.join(os.tmpdir(), 'pip-cache-test-' + Date.now());

  beforeEach(() => {
    clearMemoryCache();
    vi.clearAllMocks();
    // 테스트 캐시 디렉토리 생성
    if (!fs.existsSync(testCacheDir)) {
      fs.mkdirSync(testCacheDir, { recursive: true });
    }
  });

  afterEach(() => {
    clearMemoryCache();
    // 테스트 캐시 디렉토리 정리
    if (fs.existsSync(testCacheDir)) {
      fs.rmSync(testCacheDir, { recursive: true });
    }
  });

  describe('fetchPackageMetadata', () => {
    it('API 호출 후 결과를 반환해야 함', async () => {
      const mockResponse = createMockPyPIResponse('requests', '2.28.0');
      mockedAxios.get.mockResolvedValueOnce(mockResponse);

      const result = await fetchPackageMetadata('requests', undefined, {
        cacheDir: testCacheDir,
        useDiskCache: false,
      });

      expect(result).not.toBeNull();
      expect(result?.data.info.name).toBe('requests');
      expect(result?.data.info.version).toBe('2.28.0');
      expect(result?.fromCache).toBe(false);
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it('동일 패키지 재요청 시 메모리 캐시를 사용해야 함', async () => {
      const mockResponse = createMockPyPIResponse('requests', '2.28.0');
      mockedAxios.get.mockResolvedValueOnce(mockResponse);

      // 첫 번째 요청
      const result1 = await fetchPackageMetadata('requests', undefined, {
        cacheDir: testCacheDir,
        useDiskCache: false,
      });

      // 두 번째 요청 (캐시 히트)
      const result2 = await fetchPackageMetadata('requests', undefined, {
        cacheDir: testCacheDir,
        useDiskCache: false,
      });

      expect(result1?.fromCache).toBe(false);
      expect(result2?.fromCache).toBe(true);
      expect(result2?.cacheType).toBe('memory');
      expect(mockedAxios.get).toHaveBeenCalledTimes(1); // API는 1회만 호출
    });

    it('특정 버전 요청 시 해당 버전 URL을 호출해야 함', async () => {
      const mockResponse = createMockPyPIResponse('requests', '2.28.0');
      mockedAxios.get.mockResolvedValueOnce(mockResponse);

      await fetchPackageMetadata('requests', '2.28.0', {
        cacheDir: testCacheDir,
        useDiskCache: false,
      });

      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('/requests/2.28.0/json'),
        expect.any(Object)
      );
    });

    it('디스크 캐시가 활성화되면 파일에 저장해야 함', async () => {
      const mockResponse = createMockPyPIResponse('requests', '2.28.0');
      mockedAxios.get.mockResolvedValueOnce(mockResponse);

      await fetchPackageMetadata('requests', undefined, {
        cacheDir: testCacheDir,
        useDiskCache: true,
      });

      const cachePath = path.join(testCacheDir, 'requests', 'latest.json');
      expect(fs.existsSync(cachePath)).toBe(true);
    });

    it('메모리 캐시 초기화 후 디스크 캐시를 사용해야 함', async () => {
      const mockResponse = createMockPyPIResponse('requests', '2.28.0');
      mockedAxios.get.mockResolvedValueOnce(mockResponse);

      // 첫 번째 요청 (디스크에 저장)
      await fetchPackageMetadata('requests', undefined, {
        cacheDir: testCacheDir,
        useDiskCache: true,
      });

      // 메모리 캐시 초기화
      clearMemoryCache();

      // 두 번째 요청 (디스크 캐시 사용)
      const result = await fetchPackageMetadata('requests', undefined, {
        cacheDir: testCacheDir,
        useDiskCache: true,
      });

      expect(result?.fromCache).toBe(true);
      expect(result?.cacheType).toBe('disk');
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it('forceRefresh 옵션 시 캐시를 무시해야 함', async () => {
      const mockResponse = createMockPyPIResponse('requests', '2.28.0');
      mockedAxios.get.mockResolvedValue(mockResponse);

      // 첫 번째 요청
      await fetchPackageMetadata('requests', undefined, {
        cacheDir: testCacheDir,
        useDiskCache: false,
      });

      // 강제 새로고침
      const result = await fetchPackageMetadata('requests', undefined, {
        cacheDir: testCacheDir,
        useDiskCache: false,
        forceRefresh: true,
      });

      expect(result?.fromCache).toBe(false);
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });

    it('404 에러 시 null을 반환해야 함', async () => {
      const error = { isAxiosError: true, response: { status: 404 } };
      mockedAxios.get.mockRejectedValueOnce(error);
      mockedAxios.isAxiosError.mockReturnValue(true);

      const result = await fetchPackageMetadata('nonexistent-package', undefined, {
        cacheDir: testCacheDir,
        useDiskCache: false,
      });

      expect(result).toBeNull();
    });

    it('패키지명 정규화 (대소문자, 하이픈/언더스코어)', async () => {
      const mockResponse = createMockPyPIResponse('my-package', '1.0.0');
      mockedAxios.get.mockResolvedValueOnce(mockResponse);

      // 첫 번째 요청 (대문자 + 언더스코어)
      await fetchPackageMetadata('My_Package', undefined, {
        cacheDir: testCacheDir,
        useDiskCache: false,
      });

      // 두 번째 요청 (소문자 + 하이픈) - 같은 캐시 사용
      const result = await fetchPackageMetadata('my-package', undefined, {
        cacheDir: testCacheDir,
        useDiskCache: false,
      });

      expect(result?.fromCache).toBe(true);
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('getCacheStats', () => {
    it('캐시 통계를 반환해야 함', async () => {
      const mockResponse = createMockPyPIResponse('requests', '2.28.0');
      mockedAxios.get.mockResolvedValueOnce(mockResponse);

      await fetchPackageMetadata('requests', undefined, {
        cacheDir: testCacheDir,
        useDiskCache: true,
      });

      const stats = getCacheStats(testCacheDir);

      expect(stats.memoryEntries).toBe(1);
      expect(stats.diskEntries).toBe(1);
      expect(stats.diskSize).toBeGreaterThan(0);
    });
  });

  describe('clearAllCache', () => {
    it('메모리와 디스크 캐시를 모두 초기화해야 함', async () => {
      const mockResponse = createMockPyPIResponse('requests', '2.28.0');
      mockedAxios.get.mockResolvedValueOnce(mockResponse);

      await fetchPackageMetadata('requests', undefined, {
        cacheDir: testCacheDir,
        useDiskCache: true,
      });

      clearAllCache(testCacheDir);

      const stats = getCacheStats(testCacheDir);
      expect(stats.memoryEntries).toBe(0);
      expect(stats.diskEntries).toBe(0);
    });
  });

  describe('중복 요청 방지', () => {
    it('동시에 동일 패키지 요청 시 API를 1회만 호출해야 함', async () => {
      const mockResponse = createMockPyPIResponse('requests', '2.28.0');

      // 지연된 응답 시뮬레이션
      mockedAxios.get.mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve(mockResponse), 100))
      );

      // 동시에 여러 요청
      const promises = [
        fetchPackageMetadata('requests', undefined, { cacheDir: testCacheDir, useDiskCache: false }),
        fetchPackageMetadata('requests', undefined, { cacheDir: testCacheDir, useDiskCache: false }),
        fetchPackageMetadata('requests', undefined, { cacheDir: testCacheDir, useDiskCache: false }),
      ];

      const results = await Promise.all(promises);

      // 모든 결과가 동일해야 함
      expect(results[0]?.data.info.name).toBe('requests');
      expect(results[1]?.data.info.name).toBe('requests');
      expect(results[2]?.data.info.name).toBe('requests');

      // API는 1회만 호출
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });
  });
});
