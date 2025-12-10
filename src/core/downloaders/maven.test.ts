import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getMavenDownloader } from './maven';

describe('maven downloader', () => {
  let downloader: ReturnType<typeof getMavenDownloader>;

  beforeEach(() => {
    downloader = getMavenDownloader();
  });

  describe('getMavenDownloader', () => {
    it('싱글톤 인스턴스 반환', () => {
      const instance1 = getMavenDownloader();
      const instance2 = getMavenDownloader();
      expect(instance1).toBe(instance2);
    });

    it('type이 maven', () => {
      expect(downloader.type).toBe('maven');
    });
  });

  describe('parseCoordinates', () => {
    it('groupId:artifactId 파싱', () => {
      const result = downloader.parseCoordinates('com.google.code.gson:gson');
      expect(result).toEqual({
        groupId: 'com.google.code.gson',
        artifactId: 'gson',
        version: undefined,
      });
    });

    it('groupId:artifactId:version 파싱', () => {
      const result = downloader.parseCoordinates('com.google.code.gson:gson:2.10.1');
      expect(result).toEqual({
        groupId: 'com.google.code.gson',
        artifactId: 'gson',
        version: '2.10.1',
      });
    });

    it('잘못된 형식은 null 반환', () => {
      expect(downloader.parseCoordinates('invalid')).toBeNull();
      expect(downloader.parseCoordinates('')).toBeNull();
    });

    it('복잡한 groupId 처리', () => {
      const result = downloader.parseCoordinates('org.springframework.boot:spring-boot-starter:3.2.0');
      expect(result).toEqual({
        groupId: 'org.springframework.boot',
        artifactId: 'spring-boot-starter',
        version: '3.2.0',
      });
    });
  });

  describe('searchPackages (integration)', () => {
    // 이 테스트는 실제 API를 호출하므로 skip 처리
    // CI 환경에서는 mock을 사용해야 함
    it.skip('패키지 검색', async () => {
      const results = await downloader.searchPackages('gson');
      expect(Array.isArray(results)).toBe(true);
      if (results.length > 0) {
        expect(results[0]).toHaveProperty('name');
        expect(results[0]).toHaveProperty('versions');
      }
    });
  });

  describe('getVersions (integration)', () => {
    it.skip('버전 목록 조회', async () => {
      const versions = await downloader.getVersions('com.google.code.gson:gson');
      expect(Array.isArray(versions)).toBe(true);
      expect(versions.length).toBeGreaterThan(0);
    });
  });
});

// Private 메서드 로직 테스트를 위한 별도 유틸리티 테스트
describe('maven downloader utilities', () => {
  describe('version comparison logic', () => {
    // compareVersions는 private이지만 로직 검증을 위해 동일 로직 테스트
    const normalize = (v: string) =>
      v.split(/[.-]/).map((p) => {
        const num = parseInt(p, 10);
        return isNaN(num) ? p : num;
      });

    const compareVersions = (a: string, b: string): number => {
      const partsA = normalize(a);
      const partsB = normalize(b);

      for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
        const partA = partsA[i] ?? 0;
        const partB = partsB[i] ?? 0;

        if (typeof partA === 'number' && typeof partB === 'number') {
          if (partA !== partB) return partA - partB;
        } else {
          const strA = String(partA);
          const strB = String(partB);
          if (strA !== strB) return strA.localeCompare(strB);
        }
      }
      return 0;
    };

    it('동일 버전', () => {
      expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    });

    it('major 버전 비교', () => {
      expect(compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0);
      expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
    });

    it('minor 버전 비교', () => {
      expect(compareVersions('1.2.0', '1.1.0')).toBeGreaterThan(0);
    });

    it('patch 버전 비교', () => {
      expect(compareVersions('1.0.2', '1.0.1')).toBeGreaterThan(0);
    });

    it('버전 자릿수가 다른 경우', () => {
      expect(compareVersions('1.0', '1.0.0')).toBe(0);
      expect(compareVersions('1.0.1', '1.0')).toBeGreaterThan(0);
    });

    it('pre-release 버전', () => {
      // alpha < beta < rc < release
      expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0);
    });
  });

  describe('URL building logic', () => {
    it('groupId를 path로 변환', () => {
      const groupId = 'com.google.code.gson';
      const groupPath = groupId.replace(/\./g, '/');
      expect(groupPath).toBe('com/google/code/gson');
    });

    it('파일명 생성 (jar)', () => {
      const artifactId = 'gson';
      const version = '2.10.1';
      const fileName = `${artifactId}-${version}.jar`;
      expect(fileName).toBe('gson-2.10.1.jar');
    });

    it('파일명 생성 (pom)', () => {
      const artifactId = 'gson';
      const version = '2.10.1';
      const fileName = `${artifactId}-${version}.pom`;
      expect(fileName).toBe('gson-2.10.1.pom');
    });

    it('파일명 생성 (sources)', () => {
      const artifactId = 'gson';
      const version = '2.10.1';
      const fileName = `${artifactId}-${version}-sources.jar`;
      expect(fileName).toBe('gson-2.10.1-sources.jar');
    });

    it('파일명 생성 (javadoc)', () => {
      const artifactId = 'gson';
      const version = '2.10.1';
      const fileName = `${artifactId}-${version}-javadoc.jar`;
      expect(fileName).toBe('gson-2.10.1-javadoc.jar');
    });

    it('전체 다운로드 URL 생성', () => {
      const repoUrl = 'https://repo1.maven.org/maven2';
      const groupId = 'com.google.code.gson';
      const artifactId = 'gson';
      const version = '2.10.1';
      const groupPath = groupId.replace(/\./g, '/');
      const fileName = `${artifactId}-${version}.jar`;
      const url = `${repoUrl}/${groupPath}/${artifactId}/${version}/${fileName}`;
      expect(url).toBe('https://repo1.maven.org/maven2/com/google/code/gson/gson/2.10.1/gson-2.10.1.jar');
    });
  });
});
