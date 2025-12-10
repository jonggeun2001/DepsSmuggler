/**
 * npm-cache.ts 단위 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import {
  fetchPackument,
  fetchPackumentWithCacheInfo,
  clearNpmCache,
  getNpmCacheStats,
  isPackumentCached,
  getPackumentFromCache,
} from './npm-cache';
import { NpmPackument } from './npm-types';

// axios 모킹
vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

// 테스트용 packument 생성
function createMockPackument(name: string, version: string): NpmPackument {
  return {
    _id: name,
    name,
    'dist-tags': { latest: version },
    versions: {
      [version]: {
        name,
        version,
        dist: {
          tarball: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`,
          shasum: 'abc123',
        },
      },
    },
  };
}

// mock axios client
const mockGet = vi.fn();
const mockClient = {
  get: mockGet,
  defaults: { baseURL: 'https://registry.npmjs.org' },
};

describe('npm-cache', () => {
  beforeEach(() => {
    clearNpmCache();
    vi.clearAllMocks();
    mockedAxios.create.mockReturnValue(mockClient as never);
  });

  afterEach(() => {
    clearNpmCache();
  });

  describe('fetchPackument', () => {
    it('API 호출 후 packument를 반환해야 함', async () => {
      const mockPackument = createMockPackument('express', '4.18.0');
      mockGet.mockResolvedValueOnce({ data: mockPackument });

      const result = await fetchPackument('express');

      expect(result.name).toBe('express');
      expect(result['dist-tags'].latest).toBe('4.18.0');
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it('동일 패키지 재요청 시 캐시를 사용해야 함', async () => {
      const mockPackument = createMockPackument('express', '4.18.0');
      mockGet.mockResolvedValueOnce({ data: mockPackument });

      // 첫 번째 요청
      await fetchPackument('express');

      // 두 번째 요청 (캐시 히트)
      const result = await fetchPackument('express');

      expect(result.name).toBe('express');
      expect(mockGet).toHaveBeenCalledTimes(1); // API는 1회만 호출
    });

    it('scoped 패키지를 올바르게 인코딩해야 함', async () => {
      const mockPackument = createMockPackument('@types/node', '18.0.0');
      mockGet.mockResolvedValueOnce({ data: mockPackument });

      await fetchPackument('@types/node');

      // @ 기호는 그대로 두고 / 만 인코딩
      expect(mockGet).toHaveBeenCalledWith('/@types%2Fnode');
    });

    it('404 에러 시 적절한 에러 메시지를 던져야 함', async () => {
      const error = { response: { status: 404 } };
      mockGet.mockRejectedValueOnce(error);
      mockedAxios.isAxiosError.mockReturnValue(true);

      await expect(fetchPackument('nonexistent')).rejects.toThrow('패키지를 찾을 수 없습니다');
    });

    it('forceRefresh 옵션 시 캐시를 무시해야 함', async () => {
      const mockPackument = createMockPackument('express', '4.18.0');
      mockGet.mockResolvedValue({ data: mockPackument });

      // 첫 번째 요청
      await fetchPackument('express');

      // 강제 새로고침
      await fetchPackument('express', { forceRefresh: true });

      expect(mockGet).toHaveBeenCalledTimes(2);
    });
  });

  describe('fetchPackumentWithCacheInfo', () => {
    it('캐시 히트 시 fromCache: true를 반환해야 함', async () => {
      const mockPackument = createMockPackument('lodash', '4.17.21');
      mockGet.mockResolvedValueOnce({ data: mockPackument });

      // 첫 번째 요청
      const result1 = await fetchPackumentWithCacheInfo('lodash');
      expect(result1.fromCache).toBe(false);

      // 두 번째 요청
      const result2 = await fetchPackumentWithCacheInfo('lodash');
      expect(result2.fromCache).toBe(true);
    });
  });

  describe('중복 요청 방지', () => {
    it('동시에 동일 패키지 요청 시 API를 1회만 호출해야 함', async () => {
      const mockPackument = createMockPackument('react', '18.0.0');

      // 지연된 응답 시뮬레이션
      mockGet.mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve({ data: mockPackument }), 50))
      );

      // 동시에 여러 요청
      const promises = [
        fetchPackument('react'),
        fetchPackument('react'),
        fetchPackument('react'),
      ];

      const results = await Promise.all(promises);

      // 모든 결과가 동일해야 함
      expect(results[0].name).toBe('react');
      expect(results[1].name).toBe('react');
      expect(results[2].name).toBe('react');

      // API는 1회만 호출
      expect(mockGet).toHaveBeenCalledTimes(1);
    });
  });

  describe('getNpmCacheStats', () => {
    it('캐시 통계를 반환해야 함', async () => {
      const mockPackument = createMockPackument('express', '4.18.0');
      mockGet.mockResolvedValueOnce({ data: mockPackument });

      await fetchPackument('express');

      const stats = getNpmCacheStats();

      expect(stats.entries).toBe(1);
      expect(stats.oldestEntry).not.toBeNull();
      expect(stats.newestEntry).not.toBeNull();
    });
  });

  describe('isPackumentCached', () => {
    it('캐시된 패키지에 대해 true를 반환해야 함', async () => {
      const mockPackument = createMockPackument('express', '4.18.0');
      mockGet.mockResolvedValueOnce({ data: mockPackument });

      expect(isPackumentCached('express')).toBe(false);

      await fetchPackument('express');

      expect(isPackumentCached('express')).toBe(true);
    });
  });

  describe('getPackumentFromCache', () => {
    it('캐시된 패키지를 직접 조회해야 함', async () => {
      const mockPackument = createMockPackument('express', '4.18.0');
      mockGet.mockResolvedValueOnce({ data: mockPackument });

      expect(getPackumentFromCache('express')).toBeNull();

      await fetchPackument('express');

      const cached = getPackumentFromCache('express');
      expect(cached).not.toBeNull();
      expect(cached?.name).toBe('express');
    });
  });

  describe('clearNpmCache', () => {
    it('모든 캐시를 초기화해야 함', async () => {
      const mockPackument = createMockPackument('express', '4.18.0');
      mockGet.mockResolvedValueOnce({ data: mockPackument });

      await fetchPackument('express');
      expect(getNpmCacheStats().entries).toBe(1);

      clearNpmCache();

      expect(getNpmCacheStats().entries).toBe(0);
    });
  });
});
