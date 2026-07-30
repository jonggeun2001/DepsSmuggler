import { describe, it, expect, beforeEach } from 'vitest';
import { PipDownloader } from './pip';
import { isPythonRequiresCompatible } from '../shared/pip-wheel';
import type { PipTargetPlatform } from '../../types/platform/pip-target-platform';
import type { PyPIRelease } from '../shared/pip-types';

describe('PipDownloader wheel 호환성', () => {
  let downloader: PipDownloader;

  beforeEach(() => {
    downloader = new PipDownloader();
  });

  // Private 메서드 테스트를 위한 헬퍼
  const testSelectBestRelease = (releases: PyPIRelease[], platform: PipTargetPlatform | null) => {
    if (platform) {
      downloader.setPipTargetPlatform(platform);
    }
    // @ts-expect-error - private 메서드 테스트
    return downloader.selectBestRelease(releases);
  };

  const createWheelRelease = (filename: string): PyPIRelease => ({
    filename,
    url: `https://files.pythonhosted.org/packages/.../${filename}`,
    size: 1000000,
    md5_digest: 'abc123',
    digests: {
      md5: 'abc123',
      sha256: 'def456',
    },
    packagetype: 'bdist_wheel',
    python_version: 'cp311',
  });

  const createSdistRelease = (filename: string): PyPIRelease => ({
    filename,
    url: `https://files.pythonhosted.org/packages/.../${filename}`,
    size: 500000,
    md5_digest: 'xyz789',
    digests: {
      md5: 'xyz789',
      sha256: 'uvw012',
    },
    packagetype: 'sdist',
    python_version: 'source',
  });

  describe('Linux manylinux 호환성', () => {
    it('타겟 glibc 2.28에 대해 manylinux_2_28 wheel을 선택해야 함', () => {
      const releases: PyPIRelease[] = [
        createWheelRelease('numpy-1.24.0-cp311-cp311-manylinux_2_17_x86_64.whl'),
        createWheelRelease('numpy-1.24.0-cp311-cp311-manylinux_2_28_x86_64.whl'),
        createSdistRelease('numpy-1.24.0.tar.gz'),
      ];

      const platform: PipTargetPlatform = {
        os: 'linux',
        arch: 'x86_64',
        glibcVersion: '2.28',
      };

      const result = testSelectBestRelease(releases, platform);
      expect(result?.filename).toContain('manylinux_2_28');
    });

    it('타겟 glibc 2.28에 대해 manylinux_2_17만 있으면 선택해야 함 (하위 호환)', () => {
      const releases: PyPIRelease[] = [
        createWheelRelease('numpy-1.24.0-cp311-cp311-manylinux_2_17_x86_64.whl'),
        createSdistRelease('numpy-1.24.0.tar.gz'),
      ];

      const platform: PipTargetPlatform = {
        os: 'linux',
        arch: 'x86_64',
        glibcVersion: '2.28',
      };

      const result = testSelectBestRelease(releases, platform);
      expect(result?.filename).toContain('manylinux_2_17');
    });

    it('타겟 glibc 2.17에 대해 manylinux_2_28은 선택하지 않아야 함', () => {
      const releases: PyPIRelease[] = [
        createWheelRelease('numpy-1.24.0-cp311-cp311-manylinux_2_28_x86_64.whl'),
        createSdistRelease('numpy-1.24.0.tar.gz'),
      ];

      const platform: PipTargetPlatform = {
        os: 'linux',
        arch: 'x86_64',
        glibcVersion: '2.17',
      };

      const result = testSelectBestRelease(releases, platform);
      // 호환되는 wheel이 없으므로 sdist 선택
      expect(result?.filename).toContain('.tar.gz');
    });

    it('manylinux2014 (glibc 2.17) 레거시 태그 지원', () => {
      const releases: PyPIRelease[] = [
        createWheelRelease('numpy-1.24.0-cp311-cp311-manylinux2014_x86_64.whl'),
        createSdistRelease('numpy-1.24.0.tar.gz'),
      ];

      const platform: PipTargetPlatform = {
        os: 'linux',
        arch: 'x86_64',
        glibcVersion: '2.28',
      };

      const result = testSelectBestRelease(releases, platform);
      expect(result?.filename).toContain('manylinux2014');
    });
  });

  describe('macOS 호환성', () => {
    it('타겟 macOS 11.0에 대해 macosx_11_0 wheel을 선택해야 함', () => {
      const releases: PyPIRelease[] = [
        createWheelRelease('numpy-1.24.0-cp311-cp311-macosx_10_9_x86_64.whl'),
        createWheelRelease('numpy-1.24.0-cp311-cp311-macosx_11_0_arm64.whl'),
        createSdistRelease('numpy-1.24.0.tar.gz'),
      ];

      const platform: PipTargetPlatform = {
        os: 'macos',
        arch: 'arm64',
        macosVersion: '11.0',
      };

      const result = testSelectBestRelease(releases, platform);
      expect(result?.filename).toContain('macosx_11_0_arm64');
    });

    it('타겟 macOS 11.0에 대해 macosx_10_9만 있으면 선택해야 함 (하위 호환)', () => {
      const releases: PyPIRelease[] = [
        createWheelRelease('numpy-1.24.0-cp311-cp311-macosx_10_9_x86_64.whl'),
        createSdistRelease('numpy-1.24.0.tar.gz'),
      ];

      const platform: PipTargetPlatform = {
        os: 'macos',
        arch: 'x86_64',
        macosVersion: '11.0',
      };

      const result = testSelectBestRelease(releases, platform);
      expect(result?.filename).toContain('macosx_10_9');
    });
  });

  describe('Windows 호환성', () => {
    it('Windows x64에 대해 win_amd64 wheel을 선택해야 함', () => {
      const releases: PyPIRelease[] = [
        createWheelRelease('numpy-1.24.0-cp311-cp311-win_amd64.whl'),
        createWheelRelease('numpy-1.24.0-cp311-cp311-win32.whl'),
        createSdistRelease('numpy-1.24.0.tar.gz'),
      ];

      const platform: PipTargetPlatform = {
        os: 'windows',
        arch: 'amd64',
      };

      const result = testSelectBestRelease(releases, platform);
      expect(result?.filename).toContain('win_amd64');
    });

    it('Windows x86에 대해 win32 wheel을 선택해야 함', () => {
      const releases: PyPIRelease[] = [
        createWheelRelease('numpy-1.24.0-cp311-cp311-win_amd64.whl'),
        createWheelRelease('numpy-1.24.0-cp311-cp311-win32.whl'),
        createSdistRelease('numpy-1.24.0.tar.gz'),
      ];

      const platform: PipTargetPlatform = {
        os: 'windows',
        arch: 'i386',
      };

      const result = testSelectBestRelease(releases, platform);
      expect(result?.filename).toContain('win32');
    });
  });

  describe('Pure Python wheel', () => {
    it('py3-none-any wheel은 모든 플랫폼에서 선택 가능', () => {
      const releases: PyPIRelease[] = [
        createWheelRelease('requests-2.28.0-py3-none-any.whl'),
        createSdistRelease('requests-2.28.0.tar.gz'),
      ];

      const platform: PipTargetPlatform = {
        os: 'linux',
        arch: 'x86_64',
        glibcVersion: '2.28',
      };

      const result = testSelectBestRelease(releases, platform);
      expect(result?.filename).toContain('py3-none-any');
    });
  });

  describe('아키텍처 불일치', () => {
    it('타겟 x86_64에 대해 aarch64 wheel은 선택하지 않아야 함', () => {
      const releases: PyPIRelease[] = [
        createWheelRelease('numpy-1.24.0-cp311-cp311-manylinux_2_28_aarch64.whl'),
        createSdistRelease('numpy-1.24.0.tar.gz'),
      ];

      const platform: PipTargetPlatform = {
        os: 'linux',
        arch: 'x86_64',
        glibcVersion: '2.28',
      };

      const result = testSelectBestRelease(releases, platform);
      // 호환되는 wheel이 없으므로 sdist 선택
      expect(result?.filename).toContain('.tar.gz');
    });
  });

  describe('타겟 플랫폼 미설정', () => {
    it('타겟 플랫폼이 없으면 기본 동작 (첫 번째 wheel)', () => {
      const releases: PyPIRelease[] = [
        createWheelRelease('numpy-1.24.0-cp311-cp311-manylinux_2_28_x86_64.whl'),
        createWheelRelease('numpy-1.24.0-cp311-cp311-manylinux_2_17_x86_64.whl'),
        createSdistRelease('numpy-1.24.0.tar.gz'),
      ];

      const result = testSelectBestRelease(releases, null);
      // 첫 번째 wheel 선택
      expect(result?.packagetype).toBe('bdist_wheel');
    });

    it('타겟 플랫폼이 없고 py3-none-any가 있으면 우선 선택', () => {
      const releases: PyPIRelease[] = [
        createWheelRelease('numpy-1.24.0-cp311-cp311-manylinux_2_28_x86_64.whl'),
        createWheelRelease('requests-2.28.0-py3-none-any.whl'),
        createSdistRelease('numpy-1.24.0.tar.gz'),
      ];

      const result = testSelectBestRelease(releases, null);
      expect(result?.filename).toContain('py3-none-any');
    });
  });

  describe('Python 버전 호환성', () => {
    it('Python 3.12 설정 시 cp312 wheel을 선택해야 함', () => {
      const releases: PyPIRelease[] = [
        createWheelRelease('torch-2.0.0-cp311-cp311-manylinux_2_17_x86_64.whl'),
        createWheelRelease('torch-2.0.0-cp312-cp312-manylinux_2_17_x86_64.whl'),
        createWheelRelease('torch-2.0.0-cp39-cp39-manylinux_2_17_x86_64.whl'),
        createSdistRelease('torch-2.0.0.tar.gz'),
      ];

      const platform: PipTargetPlatform = {
        os: 'linux',
        arch: 'x86_64',
        pythonVersion: '3.12',
        glibcVersion: '2.28',
      };

      const result = testSelectBestRelease(releases, platform);
      expect(result?.filename).toContain('cp312');
    });

    it('Python 3.11 설정 시 cp311 wheel을 선택해야 함', () => {
      const releases: PyPIRelease[] = [
        createWheelRelease('torch-2.0.0-cp311-cp311-manylinux_2_17_x86_64.whl'),
        createWheelRelease('torch-2.0.0-cp312-cp312-manylinux_2_17_x86_64.whl'),
        createWheelRelease('torch-2.0.0-cp39-cp39-manylinux_2_17_x86_64.whl'),
        createSdistRelease('torch-2.0.0.tar.gz'),
      ];

      const platform: PipTargetPlatform = {
        os: 'linux',
        arch: 'x86_64',
        pythonVersion: '3.11',
        glibcVersion: '2.28',
      };

      const result = testSelectBestRelease(releases, platform);
      expect(result?.filename).toContain('cp311');
    });

    it('Python 3.12 설정 시 cp311은 선택하지 않고 sdist 선택', () => {
      const releases: PyPIRelease[] = [
        createWheelRelease('torch-2.0.0-cp311-cp311-manylinux_2_17_x86_64.whl'),
        createWheelRelease('torch-2.0.0-cp39-cp39-manylinux_2_17_x86_64.whl'),
        createSdistRelease('torch-2.0.0.tar.gz'),
      ];

      const platform: PipTargetPlatform = {
        os: 'linux',
        arch: 'x86_64',
        pythonVersion: '3.12',
        glibcVersion: '2.28',
      };

      const result = testSelectBestRelease(releases, platform);
      // 호환되는 wheel이 없으므로 sdist 선택
      expect(result?.filename).toContain('.tar.gz');
    });

    it('py3-none-any wheel은 모든 Python 버전과 호환', () => {
      const releases: PyPIRelease[] = [
        createWheelRelease('requests-2.28.0-py3-none-any.whl'),
        createSdistRelease('requests-2.28.0.tar.gz'),
      ];

      const platform: PipTargetPlatform = {
        os: 'linux',
        arch: 'x86_64',
        pythonVersion: '3.12',
        glibcVersion: '2.28',
      };

      const result = testSelectBestRelease(releases, platform);
      expect(result?.filename).toContain('py3-none-any');
    });

    it('abi3 wheel은 여러 Python 버전과 호환', () => {
      const releases: PyPIRelease[] = [
        createWheelRelease('cryptography-40.0.0-cp37-abi3-manylinux_2_28_x86_64.whl'),
        createSdistRelease('cryptography-40.0.0.tar.gz'),
      ];

      const platform: PipTargetPlatform = {
        os: 'linux',
        arch: 'x86_64',
        pythonVersion: '3.12',
        glibcVersion: '2.28',
      };

      const result = testSelectBestRelease(releases, platform);
      expect(result?.filename).toContain('abi3');
    });

    it('Python 3.12에 호환되지 않는 py310 및 미래 abi3 wheel은 선택하지 않아야 함', () => {
      const releases: PyPIRelease[] = [
        createWheelRelease('package-1.0.0-py310-none-any.whl'),
        createWheelRelease('package-1.0.0-cp313-abi3-manylinux_2_28_x86_64.whl'),
        createSdistRelease('package-1.0.0.tar.gz'),
      ];

      const platform: PipTargetPlatform = {
        os: 'linux',
        arch: 'x86_64',
        pythonVersion: '3.12',
        glibcVersion: '2.28',
      };

      const result = testSelectBestRelease(releases, platform);
      expect(result?.filename).toContain('.tar.gz');
    });

    it('파일 requires_python이 대상보다 높으면 wheel과 sdist를 모두 선택하지 않아야 함', () => {
      const releases: PyPIRelease[] = [
        {
          ...createWheelRelease('future-1.0.0-py3-none-any.whl'),
          requires_python: '>=3.13',
        },
        {
          ...createSdistRelease('future-1.0.0.tar.gz'),
          requires_python: '>=3.13',
        },
      ];

      const platform: PipTargetPlatform = {
        os: 'linux',
        arch: 'x86_64',
        pythonVersion: '3.12',
      };

      expect(testSelectBestRelease(releases, platform)).toBeNull();
    });
  });
});

describe('Requires-Python PEP 440 호환성', () => {
  it('범위, compatible release, wildcard, 제외 조건을 대상 Python에 적용한다', () => {
    expect(isPythonRequiresCompatible('>=3.8, <3.13', '3.12')).toBe(true);
    expect(isPythonRequiresCompatible('~=3.11.2', '3.12')).toBe(false);
    expect(isPythonRequiresCompatible('==3.12.*', '3.12.1')).toBe(true);
    expect(isPythonRequiresCompatible('!=3.12.*', '3.12')).toBe(false);
    expect(isPythonRequiresCompatible('>3.12.dev1', '3.12')).toBe(true);
  });

  it('지원하지 않는 Python 버전을 요구하거나 해석할 수 없는 specifier는 거부한다', () => {
    expect(isPythonRequiresCompatible('>=3.13', '3.12')).toBe(false);
    expect(isPythonRequiresCompatible('invalid specifier', '3.12')).toBe(false);
  });
});
