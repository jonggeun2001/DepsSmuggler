/**
 * maven-cache.ts 단위 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import {
  fetchPom,
  fetchPomWithCacheInfo,
  fetchPomsParallel,
  prefetchPomsParallel,
  clearMemoryCache,
  clearDiskCache,
  getMavenCacheStats,
  isPomCached,
  getPomFromCache,
} from './maven-cache';
import { MavenCoordinate, PomProject } from './maven-types';

// axios 모킹
vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

// 테스트용 POM 생성
function createMockPom(groupId: string, artifactId: string, version: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <groupId>${groupId}</groupId>
  <artifactId>${artifactId}</artifactId>
  <version>${version}</version>
</project>`;
}

// mock axios client
const mockGet = vi.fn();
const mockClient = {
  get: mockGet,
  defaults: { baseURL: 'https://repo1.maven.org/maven2' },
};

// 테스트용 캐시 디렉토리
const testCacheDir = path.join(os.tmpdir(), 'depssmuggler-test-maven-cache');

describe('maven-cache', () => {
  beforeEach(async () => {
    clearMemoryCache();
    vi.clearAllMocks();
    mockedAxios.create.mockReturnValue(mockClient as never);
    // 테스트 캐시 디렉토리 정리
    await fs.remove(testCacheDir);
  });

  afterEach(async () => {
    clearMemoryCache();
    await fs.remove(testCacheDir);
  });

  describe('fetchPom', () => {
    it('API 호출 후 POM을 반환해야 함', async () => {
      const coord: MavenCoordinate = {
        groupId: 'org.springframework',
        artifactId: 'spring-core',
        version: '5.3.0',
      };
      const mockPomXml = createMockPom(coord.groupId, coord.artifactId, coord.version);
      mockGet.mockResolvedValueOnce({ data: mockPomXml });

      const result = await fetchPom(coord, { useDiskCache: false });

      expect(result.groupId).toBe('org.springframework');
      expect(result.artifactId).toBe('spring-core');
      expect(result.version).toBe('5.3.0');
      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledWith(
        '/org/springframework/spring-core/5.3.0/spring-core-5.3.0.pom',
        { responseType: 'text' }
      );
    });

    it('동일 패키지 재요청 시 메모리 캐시를 사용해야 함', async () => {
      const coord: MavenCoordinate = {
        groupId: 'org.springframework',
        artifactId: 'spring-core',
        version: '5.3.0',
      };
      const mockPomXml = createMockPom(coord.groupId, coord.artifactId, coord.version);
      mockGet.mockResolvedValueOnce({ data: mockPomXml });

      // 첫 번째 요청
      await fetchPom(coord, { useDiskCache: false });

      // 두 번째 요청 (캐시 히트)
      const result = await fetchPom(coord, { useDiskCache: false });

      expect(result.groupId).toBe('org.springframework');
      expect(mockGet).toHaveBeenCalledTimes(1); // API는 1회만 호출
    });

    it('404 에러 시 적절한 에러 메시지를 던져야 함', async () => {
      const coord: MavenCoordinate = {
        groupId: 'com.nonexistent',
        artifactId: 'nonexistent',
        version: '1.0.0',
      };
      const error = { response: { status: 404 } };
      mockGet.mockRejectedValueOnce(error);
      mockedAxios.isAxiosError.mockReturnValue(true);

      await expect(fetchPom(coord, { useDiskCache: false })).rejects.toThrow('POM not found');
    });

    it('forceRefresh 옵션 시 캐시를 무시해야 함', async () => {
      const coord: MavenCoordinate = {
        groupId: 'org.springframework',
        artifactId: 'spring-core',
        version: '5.3.0',
      };
      const mockPomXml = createMockPom(coord.groupId, coord.artifactId, coord.version);
      mockGet.mockResolvedValue({ data: mockPomXml });

      // 첫 번째 요청
      await fetchPom(coord, { useDiskCache: false });

      // 강제 새로고침
      await fetchPom(coord, { forceRefresh: true, useDiskCache: false });

      expect(mockGet).toHaveBeenCalledTimes(2);
    });
  });

  describe('fetchPomWithCacheInfo', () => {
    it('캐시 히트 시 fromCache: memory를 반환해야 함', async () => {
      const coord: MavenCoordinate = {
        groupId: 'com.google.guava',
        artifactId: 'guava',
        version: '31.0-jre',
      };
      const mockPomXml = createMockPom(coord.groupId, coord.artifactId, coord.version);
      mockGet.mockResolvedValueOnce({ data: mockPomXml });

      // 첫 번째 요청
      const result1 = await fetchPomWithCacheInfo(coord, { useDiskCache: false });
      expect(result1.fromCache).toBe('network');

      // 두 번째 요청
      const result2 = await fetchPomWithCacheInfo(coord, { useDiskCache: false });
      expect(result2.fromCache).toBe('memory');
    });
  });

  describe('중복 요청 방지', () => {
    it('동시에 동일 POM 요청 시 API를 1회만 호출해야 함', async () => {
      const coord: MavenCoordinate = {
        groupId: 'org.apache.commons',
        artifactId: 'commons-lang3',
        version: '3.12.0',
      };
      const mockPomXml = createMockPom(coord.groupId, coord.artifactId, coord.version);

      // 지연된 응답 시뮬레이션
      mockGet.mockImplementation(
        () =>
          new Promise((resolve) => setTimeout(() => resolve({ data: mockPomXml }), 50))
      );

      // 동시에 여러 요청
      const promises = [
        fetchPom(coord, { useDiskCache: false }),
        fetchPom(coord, { useDiskCache: false }),
        fetchPom(coord, { useDiskCache: false }),
      ];

      const results = await Promise.all(promises);

      // 모든 결과가 동일해야 함
      expect(results[0].groupId).toBe('org.apache.commons');
      expect(results[1].groupId).toBe('org.apache.commons');
      expect(results[2].groupId).toBe('org.apache.commons');

      // API는 1회만 호출
      expect(mockGet).toHaveBeenCalledTimes(1);
    });
  });

  describe('fetchPomsParallel', () => {
    it('여러 POM을 병렬로 조회해야 함', async () => {
      const coords: MavenCoordinate[] = [
        { groupId: 'org.springframework', artifactId: 'spring-core', version: '5.3.0' },
        { groupId: 'com.google.guava', artifactId: 'guava', version: '31.0-jre' },
        { groupId: 'org.apache.commons', artifactId: 'commons-lang3', version: '3.12.0' },
      ];

      mockGet.mockImplementation((url: string) => {
        if (url.includes('spring-core')) {
          return Promise.resolve({
            data: createMockPom('org.springframework', 'spring-core', '5.3.0'),
          });
        }
        if (url.includes('guava')) {
          return Promise.resolve({
            data: createMockPom('com.google.guava', 'guava', '31.0-jre'),
          });
        }
        if (url.includes('commons-lang3')) {
          return Promise.resolve({
            data: createMockPom('org.apache.commons', 'commons-lang3', '3.12.0'),
          });
        }
        return Promise.reject(new Error('Unknown'));
      });

      const results = await fetchPomsParallel(coords, { useDiskCache: false, batchSize: 5 });

      expect(results.size).toBe(3);
      expect(results.get('org.springframework:spring-core:5.3.0')).toBeDefined();
      expect(results.get('com.google.guava:guava:31.0-jre')).toBeDefined();
      expect(results.get('org.apache.commons:commons-lang3:3.12.0')).toBeDefined();
    });

    it('일부 실패해도 성공한 것들은 반환해야 함', async () => {
      const coords: MavenCoordinate[] = [
        { groupId: 'org.springframework', artifactId: 'spring-core', version: '5.3.0' },
        { groupId: 'com.nonexistent', artifactId: 'nonexistent', version: '1.0.0' },
      ];

      mockGet.mockImplementation((url: string) => {
        if (url.includes('spring-core')) {
          return Promise.resolve({
            data: createMockPom('org.springframework', 'spring-core', '5.3.0'),
          });
        }
        return Promise.reject({ response: { status: 404 } });
      });
      mockedAxios.isAxiosError.mockReturnValue(true);

      const results = await fetchPomsParallel(coords, { useDiskCache: false });

      expect(results.size).toBe(1);
      expect(results.get('org.springframework:spring-core:5.3.0')).toBeDefined();
    });
  });

  describe('getMavenCacheStats', () => {
    it('캐시 통계를 반환해야 함', async () => {
      const coord: MavenCoordinate = {
        groupId: 'org.springframework',
        artifactId: 'spring-core',
        version: '5.3.0',
      };
      const mockPomXml = createMockPom(coord.groupId, coord.artifactId, coord.version);
      mockGet.mockResolvedValueOnce({ data: mockPomXml });

      await fetchPom(coord, { useDiskCache: false });

      const stats = getMavenCacheStats();

      expect(stats.memoryEntries).toBe(1);
      expect(stats.oldestEntry).not.toBeNull();
      expect(stats.newestEntry).not.toBeNull();
    });
  });

  describe('isPomCached', () => {
    it('캐시된 POM에 대해 true를 반환해야 함', async () => {
      const coord: MavenCoordinate = {
        groupId: 'org.springframework',
        artifactId: 'spring-core',
        version: '5.3.0',
      };
      const mockPomXml = createMockPom(coord.groupId, coord.artifactId, coord.version);
      mockGet.mockResolvedValueOnce({ data: mockPomXml });

      expect(isPomCached(coord)).toBe(false);

      await fetchPom(coord, { useDiskCache: false });

      expect(isPomCached(coord)).toBe(true);
    });
  });

  describe('getPomFromCache', () => {
    it('캐시된 POM을 직접 조회해야 함', async () => {
      const coord: MavenCoordinate = {
        groupId: 'org.springframework',
        artifactId: 'spring-core',
        version: '5.3.0',
      };
      const mockPomXml = createMockPom(coord.groupId, coord.artifactId, coord.version);
      mockGet.mockResolvedValueOnce({ data: mockPomXml });

      expect(getPomFromCache(coord)).toBeNull();

      await fetchPom(coord, { useDiskCache: false });

      const cached = getPomFromCache(coord);
      expect(cached).not.toBeNull();
      expect(cached?.groupId).toBe('org.springframework');
    });
  });

  describe('clearMemoryCache', () => {
    it('모든 메모리 캐시를 초기화해야 함', async () => {
      const coord: MavenCoordinate = {
        groupId: 'org.springframework',
        artifactId: 'spring-core',
        version: '5.3.0',
      };
      const mockPomXml = createMockPom(coord.groupId, coord.artifactId, coord.version);
      mockGet.mockResolvedValueOnce({ data: mockPomXml });

      await fetchPom(coord, { useDiskCache: false });
      expect(getMavenCacheStats().memoryEntries).toBe(1);

      clearMemoryCache();

      expect(getMavenCacheStats().memoryEntries).toBe(0);
    });
  });

  describe('디스크 캐시', () => {
    it('디스크 캐시에 저장하고 읽어야 함', async () => {
      const coord: MavenCoordinate = {
        groupId: 'org.springframework',
        artifactId: 'spring-core',
        version: '5.3.0',
      };
      const mockPomXml = createMockPom(coord.groupId, coord.artifactId, coord.version);
      mockGet.mockResolvedValueOnce({ data: mockPomXml });

      // 첫 번째 요청 - 네트워크에서 가져오고 디스크에 저장
      await fetchPom(coord, { useDiskCache: true, cacheDir: testCacheDir });

      // 디스크 캐시 저장은 비동기로 진행되므로 대기
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 메모리 캐시 클리어
      clearMemoryCache();

      // 두 번째 요청 - 디스크 캐시에서 읽어야 함
      const result = await fetchPomWithCacheInfo(coord, {
        useDiskCache: true,
        cacheDir: testCacheDir,
      });

      expect(result.fromCache).toBe('disk');
      expect(result.pom.groupId).toBe('org.springframework');
      expect(mockGet).toHaveBeenCalledTimes(1); // API는 1회만 호출
    });

    it('clearDiskCache가 디스크 캐시를 삭제해야 함', async () => {
      const coord: MavenCoordinate = {
        groupId: 'org.springframework',
        artifactId: 'spring-core',
        version: '5.3.0',
      };
      const mockPomXml = createMockPom(coord.groupId, coord.artifactId, coord.version);
      mockGet.mockResolvedValue({ data: mockPomXml });

      // 캐시에 저장
      await fetchPom(coord, { useDiskCache: true, cacheDir: testCacheDir });

      // 디스크 캐시 삭제
      await clearDiskCache(testCacheDir);

      expect(await fs.pathExists(testCacheDir)).toBe(false);
    });
  });
});
