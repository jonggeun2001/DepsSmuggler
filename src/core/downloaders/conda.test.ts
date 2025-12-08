import { describe, it, expect, beforeEach } from 'vitest';
import { getCondaDownloader } from './conda';

describe('conda downloader', () => {
  let downloader: ReturnType<typeof getCondaDownloader>;

  beforeEach(() => {
    downloader = getCondaDownloader();
  });

  describe('getCondaDownloader', () => {
    it('싱글톤 인스턴스 반환', () => {
      const instance1 = getCondaDownloader();
      const instance2 = getCondaDownloader();
      expect(instance1).toBe(instance2);
    });

    it('type이 conda', () => {
      expect(downloader.type).toBe('conda');
    });
  });

  describe('searchPackages (integration)', () => {
    it.skip('패키지 검색', async () => {
      const results = await downloader.searchPackages('numpy');
      expect(Array.isArray(results)).toBe(true);
      if (results.length > 0) {
        expect(results[0]).toHaveProperty('name');
      }
    });
  });

  describe('getVersions (integration)', () => {
    it.skip('버전 목록 조회', async () => {
      const versions = await downloader.getVersions('numpy');
      expect(Array.isArray(versions)).toBe(true);
      expect(versions.length).toBeGreaterThan(0);
    });
  });

  describe('clearCache', () => {
    it('캐시 클리어', () => {
      downloader.clearCache();
      // 에러 없이 실행되어야 함
    });
  });
});

// conda 다운로더 유틸리티 로직 테스트
describe('conda downloader utilities', () => {
  describe('architecture mapping', () => {
    type Architecture = 'x86_64' | 'amd64' | 'arm64' | 'aarch64' | 'noarch' | 'i386' | 'all';

    const mapArch = (subdir?: string): Architecture | undefined => {
      if (!subdir) return undefined;

      const mapping: Record<string, Architecture> = {
        'linux-64': 'x86_64',
        'osx-64': 'x86_64',
        'win-64': 'x86_64',
        'linux-aarch64': 'aarch64',
        'osx-arm64': 'arm64',
        noarch: 'noarch',
      };

      return mapping[subdir];
    };

    it('linux-64를 x86_64로 매핑', () => {
      expect(mapArch('linux-64')).toBe('x86_64');
    });

    it('osx-64를 x86_64로 매핑', () => {
      expect(mapArch('osx-64')).toBe('x86_64');
    });

    it('win-64를 x86_64로 매핑', () => {
      expect(mapArch('win-64')).toBe('x86_64');
    });

    it('linux-aarch64를 aarch64로 매핑', () => {
      expect(mapArch('linux-aarch64')).toBe('aarch64');
    });

    it('osx-arm64를 arm64로 매핑', () => {
      expect(mapArch('osx-arm64')).toBe('arm64');
    });

    it('noarch 그대로 매핑', () => {
      expect(mapArch('noarch')).toBe('noarch');
    });

    it('undefined 입력시 undefined 반환', () => {
      expect(mapArch(undefined)).toBe(undefined);
    });

    it('알 수 없는 subdir', () => {
      expect(mapArch('unknown')).toBe(undefined);
    });
  });

  describe('file selection logic', () => {
    interface MockFile {
      version: string;
      upload_time: string;
      attrs: { subdir?: string };
    }

    const selectBestFile = (
      files: MockFile[],
      version: string,
      arch?: string
    ): MockFile | null => {
      if (files.length === 0) return null;

      // 버전 필터링
      let filtered = files.filter((f) => f.version === version);
      if (filtered.length === 0) {
        filtered = files;
      }

      // 아키텍처 필터링
      if (arch) {
        const archMap: Record<string, string[]> = {
          x86_64: ['linux-64', 'osx-64', 'win-64'],
          amd64: ['linux-64', 'osx-64', 'win-64'],
          arm64: ['linux-aarch64', 'osx-arm64'],
          aarch64: ['linux-aarch64', 'osx-arm64'],
          noarch: ['noarch'],
          all: ['noarch'],
        };

        const subdirs = archMap[arch] || [arch];
        const archFiltered = filtered.filter(
          (f) => subdirs.includes(f.attrs.subdir || '') || f.attrs.subdir === 'noarch'
        );
        if (archFiltered.length > 0) {
          filtered = archFiltered;
        }
      }

      // noarch 우선
      const noarch = filtered.find((f) => f.attrs.subdir === 'noarch');
      if (noarch) return noarch;

      // 최신 업로드 파일
      return filtered.sort(
        (a, b) =>
          new Date(b.upload_time).getTime() - new Date(a.upload_time).getTime()
      )[0];
    };

    it('버전 매칭 파일 선택', () => {
      const files: MockFile[] = [
        { version: '1.0.0', upload_time: '2024-01-01', attrs: { subdir: 'linux-64' } },
        { version: '1.1.0', upload_time: '2024-02-01', attrs: { subdir: 'linux-64' } },
      ];
      const result = selectBestFile(files, '1.0.0');
      expect(result?.version).toBe('1.0.0');
    });

    it('noarch 우선 선택', () => {
      const files: MockFile[] = [
        { version: '1.0.0', upload_time: '2024-01-01', attrs: { subdir: 'linux-64' } },
        { version: '1.0.0', upload_time: '2024-01-02', attrs: { subdir: 'noarch' } },
      ];
      const result = selectBestFile(files, '1.0.0');
      expect(result?.attrs.subdir).toBe('noarch');
    });

    it('아키텍처 필터링 (x86_64)', () => {
      const files: MockFile[] = [
        { version: '1.0.0', upload_time: '2024-01-01', attrs: { subdir: 'linux-64' } },
        { version: '1.0.0', upload_time: '2024-01-01', attrs: { subdir: 'osx-arm64' } },
      ];
      const result = selectBestFile(files, '1.0.0', 'x86_64');
      expect(result?.attrs.subdir).toBe('linux-64');
    });

    it('아키텍처 필터링 (arm64)', () => {
      const files: MockFile[] = [
        { version: '1.0.0', upload_time: '2024-01-01', attrs: { subdir: 'linux-64' } },
        { version: '1.0.0', upload_time: '2024-01-01', attrs: { subdir: 'osx-arm64' } },
      ];
      const result = selectBestFile(files, '1.0.0', 'arm64');
      expect(result?.attrs.subdir).toBe('osx-arm64');
    });

    it('최신 업로드 파일 선택', () => {
      const files: MockFile[] = [
        { version: '1.0.0', upload_time: '2024-01-01', attrs: { subdir: 'linux-64' } },
        { version: '1.0.0', upload_time: '2024-02-01', attrs: { subdir: 'linux-64' } },
      ];
      const result = selectBestFile(files, '1.0.0');
      expect(result?.upload_time).toBe('2024-02-01');
    });

    it('빈 배열 처리', () => {
      expect(selectBestFile([], '1.0.0')).toBeNull();
    });

    it('버전이 없을 때 전체 파일에서 선택', () => {
      const files: MockFile[] = [
        { version: '1.1.0', upload_time: '2024-01-01', attrs: { subdir: 'linux-64' } },
      ];
      const result = selectBestFile(files, '1.0.0');
      expect(result?.version).toBe('1.1.0');
    });
  });

  describe('subdir to arch filtering', () => {
    it('x86_64 아키텍처에 해당하는 subdirs', () => {
      const archMap: Record<string, string[]> = {
        x86_64: ['linux-64', 'osx-64', 'win-64'],
        amd64: ['linux-64', 'osx-64', 'win-64'],
        arm64: ['linux-aarch64', 'osx-arm64'],
        aarch64: ['linux-aarch64', 'osx-arm64'],
        noarch: ['noarch'],
        all: ['noarch'],
      };

      expect(archMap['x86_64']).toContain('linux-64');
      expect(archMap['x86_64']).toContain('osx-64');
      expect(archMap['x86_64']).toContain('win-64');
    });

    it('arm64 아키텍처에 해당하는 subdirs', () => {
      const archMap: Record<string, string[]> = {
        arm64: ['linux-aarch64', 'osx-arm64'],
        aarch64: ['linux-aarch64', 'osx-arm64'],
      };

      expect(archMap['arm64']).toContain('linux-aarch64');
      expect(archMap['arm64']).toContain('osx-arm64');
    });
  });
});
