import { describe, it, expect, beforeEach } from 'vitest';
import { getPipDownloader } from './pip';

describe('pip downloader', () => {
  let downloader: ReturnType<typeof getPipDownloader>;

  beforeEach(() => {
    downloader = getPipDownloader();
  });

  describe('getPipDownloader', () => {
    it('싱글톤 인스턴스 반환', () => {
      const instance1 = getPipDownloader();
      const instance2 = getPipDownloader();
      expect(instance1).toBe(instance2);
    });

    it('type이 pip', () => {
      expect(downloader.type).toBe('pip');
    });
  });

  describe('searchPackages (integration)', () => {
    it.skip('패키지 검색', async () => {
      const results = await downloader.searchPackages('requests');
      expect(Array.isArray(results)).toBe(true);
      if (results.length > 0) {
        expect(results[0]).toHaveProperty('name');
      }
    });
  });

  describe('getVersions (integration)', () => {
    it.skip('버전 목록 조회', async () => {
      const versions = await downloader.getVersions('requests');
      expect(Array.isArray(versions)).toBe(true);
      expect(versions.length).toBeGreaterThan(0);
    });
  });
});

// pip 다운로더 유틸리티 로직 테스트
describe('pip downloader utilities', () => {
  describe('release selection logic', () => {
    // PyPIRelease 구조 mock
    interface MockRelease {
      filename: string;
      packagetype: string;
      python_version?: string;
      url?: string;
    }

    const selectBestRelease = (releases: MockRelease[]): MockRelease | null => {
      if (releases.length === 0) return null;

      // wheel 파일 우선
      const wheels = releases.filter((r) => r.packagetype === 'bdist_wheel');
      if (wheels.length > 0) {
        // 범용 wheel 우선 (py3-none-any)
        const universal = wheels.find(
          (w) =>
            w.filename.includes('py3-none-any') ||
            w.filename.includes('py2.py3-none-any')
        );
        if (universal) return universal;

        // 그 외 wheel
        return wheels[0];
      }

      // source distribution
      const sdist = releases.find((r) => r.packagetype === 'sdist');
      if (sdist) return sdist;

      return releases[0];
    };

    it('범용 wheel 우선 선택', () => {
      const releases: MockRelease[] = [
        { filename: 'package-1.0.0-py3-none-any.whl', packagetype: 'bdist_wheel' },
        { filename: 'package-1.0.0-cp39-cp39-manylinux1_x86_64.whl', packagetype: 'bdist_wheel' },
        { filename: 'package-1.0.0.tar.gz', packagetype: 'sdist' },
      ];
      const selected = selectBestRelease(releases);
      expect(selected?.filename).toBe('package-1.0.0-py3-none-any.whl');
    });

    it('py2.py3 범용 wheel 선택', () => {
      const releases: MockRelease[] = [
        { filename: 'package-1.0.0-py2.py3-none-any.whl', packagetype: 'bdist_wheel' },
        { filename: 'package-1.0.0.tar.gz', packagetype: 'sdist' },
      ];
      const selected = selectBestRelease(releases);
      expect(selected?.filename).toBe('package-1.0.0-py2.py3-none-any.whl');
    });

    it('범용 wheel 없으면 첫 번째 wheel 선택', () => {
      const releases: MockRelease[] = [
        { filename: 'package-1.0.0-cp39-cp39-manylinux1_x86_64.whl', packagetype: 'bdist_wheel' },
        { filename: 'package-1.0.0-cp38-cp38-win_amd64.whl', packagetype: 'bdist_wheel' },
        { filename: 'package-1.0.0.tar.gz', packagetype: 'sdist' },
      ];
      const selected = selectBestRelease(releases);
      expect(selected?.filename).toBe('package-1.0.0-cp39-cp39-manylinux1_x86_64.whl');
    });

    it('wheel 없으면 sdist 선택', () => {
      const releases: MockRelease[] = [
        { filename: 'package-1.0.0.tar.gz', packagetype: 'sdist' },
        { filename: 'package-1.0.0.zip', packagetype: 'sdist' },
      ];
      const selected = selectBestRelease(releases);
      expect(selected?.filename).toBe('package-1.0.0.tar.gz');
    });

    it('빈 배열 처리', () => {
      expect(selectBestRelease([])).toBeNull();
    });
  });

  describe('architecture pattern matching', () => {
    const archPatterns: Record<string, string[]> = {
      x86_64: ['x86_64', 'amd64', 'win_amd64', 'manylinux_x86_64', 'manylinux1', 'manylinux2010', 'manylinux2014'],
      amd64: ['x86_64', 'amd64', 'win_amd64'],
      arm64: ['arm64', 'aarch64', 'macosx_arm64'],
      aarch64: ['arm64', 'aarch64', 'linux_aarch64'],
      i386: ['i386', 'i686', 'win32'],
    };

    const matchesArch = (filename: string, arch: string): boolean => {
      const patterns = archPatterns[arch] || [arch];
      return patterns.some((p) => filename.toLowerCase().includes(p));
    };

    it('x86_64 아키텍처 매칭', () => {
      expect(matchesArch('package-1.0.0-cp39-cp39-manylinux1_x86_64.whl', 'x86_64')).toBe(true);
      expect(matchesArch('package-1.0.0-cp39-cp39-win_amd64.whl', 'x86_64')).toBe(true);
      expect(matchesArch('package-1.0.0-cp39-cp39-manylinux2014_x86_64.whl', 'x86_64')).toBe(true);
    });

    it('arm64 아키텍처 매칭', () => {
      expect(matchesArch('package-1.0.0-cp39-cp39-macosx_arm64.whl', 'arm64')).toBe(true);
      expect(matchesArch('package-1.0.0-cp39-cp39-linux_aarch64.whl', 'arm64')).toBe(true);
    });

    it('i386 아키텍처 매칭', () => {
      expect(matchesArch('package-1.0.0-cp39-cp39-win32.whl', 'i386')).toBe(true);
    });

    it('매칭되지 않는 경우', () => {
      expect(matchesArch('package-1.0.0-cp39-cp39-win_amd64.whl', 'arm64')).toBe(false);
    });
  });

  describe('OS pattern matching', () => {
    const osPatterns: Record<string, string[]> = {
      windows: ['win_amd64', 'win32', 'win'],
      macos: ['macosx', 'darwin'],
      linux: ['manylinux', 'linux_x86_64', 'linux_aarch64', 'linux'],
    };

    const matchesOS = (filename: string, targetOS: string): boolean => {
      const patterns = osPatterns[targetOS] || [];
      return patterns.some((p) => filename.toLowerCase().includes(p));
    };

    it('Windows OS 매칭', () => {
      expect(matchesOS('package-1.0.0-cp39-cp39-win_amd64.whl', 'windows')).toBe(true);
      expect(matchesOS('package-1.0.0-cp39-cp39-win32.whl', 'windows')).toBe(true);
    });

    it('macOS 매칭', () => {
      expect(matchesOS('package-1.0.0-cp39-cp39-macosx_10_9_x86_64.whl', 'macos')).toBe(true);
      expect(matchesOS('package-1.0.0-cp39-cp39-macosx_arm64.whl', 'macos')).toBe(true);
    });

    it('Linux 매칭', () => {
      expect(matchesOS('package-1.0.0-cp39-cp39-manylinux1_x86_64.whl', 'linux')).toBe(true);
      expect(matchesOS('package-1.0.0-cp39-cp39-linux_x86_64.whl', 'linux')).toBe(true);
    });

    it('cross-platform 매칭', () => {
      // none-any는 모든 플랫폼에서 동작
      expect(matchesOS('package-1.0.0-py3-none-any.whl', 'windows')).toBe(false);
      expect(matchesOS('package-1.0.0-py3-none-any.whl', 'linux')).toBe(false);
      // 이 경우는 별도 처리 필요 (pure Python package)
    });
  });

  describe('Python version matching', () => {
    const matchesPythonVersion = (pythonVersion: string, target: string): boolean => {
      return pythonVersion === 'py3' || pythonVersion.includes(target);
    };

    it('py3 범용 버전', () => {
      expect(matchesPythonVersion('py3', '39')).toBe(true);
      expect(matchesPythonVersion('py3', '310')).toBe(true);
    });

    it('특정 Python 버전', () => {
      expect(matchesPythonVersion('cp39', '39')).toBe(true);
      expect(matchesPythonVersion('cp310', '310')).toBe(true);
    });

    it('버전 불일치', () => {
      expect(matchesPythonVersion('cp38', '39')).toBe(false);
    });
  });
});
