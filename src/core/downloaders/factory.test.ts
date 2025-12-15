/**
 * DownloaderFactory 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getDownloaderRegistry,
  getDownloader,
  registerDownloader,
  setTestDownloader,
  clearTestDownloader,
  clearAllTestDownloaders,
  resetDownloaderRegistry,
  initializeDownloaders,
  getDownloaderAsync,
} from './factory';
import { IDownloader, PackageType, PackageInfo, DownloadProgressEvent } from '../../types';

// 테스트용 Mock 다운로더 생성
function createMockDownloader(type: PackageType): IDownloader {
  return {
    type,
    searchPackages: vi.fn().mockResolvedValue([]),
    getVersions: vi.fn().mockResolvedValue(['1.0.0', '2.0.0']),
    getPackageMetadata: vi.fn().mockResolvedValue({
      name: 'test-package',
      version: '1.0.0',
      type,
    }),
    downloadPackage: vi.fn().mockResolvedValue('/path/to/package'),
    verifyChecksum: vi.fn().mockResolvedValue(true),
    resolveDependencies: vi.fn().mockResolvedValue([]),
  };
}

describe('DownloaderRegistry', () => {
  beforeEach(() => {
    // 각 테스트 전에 레지스트리 초기화
    resetDownloaderRegistry();
  });

  afterEach(() => {
    // 각 테스트 후 정리
    resetDownloaderRegistry();
  });

  describe('registerDownloader & getDownloader', () => {
    it('다운로더를 등록하고 가져올 수 있어야 함', () => {
      const mockDownloader = createMockDownloader('pip');

      registerDownloader('pip', () => mockDownloader);

      const result = getDownloader('pip');
      expect(result).toBe(mockDownloader);
      expect(result.type).toBe('pip');
    });

    it('동일한 타입의 다운로더는 캐시된 인스턴스를 반환해야 함', () => {
      let callCount = 0;
      registerDownloader('npm', () => {
        callCount++;
        return createMockDownloader('npm');
      });

      const first = getDownloader('npm');
      const second = getDownloader('npm');

      expect(first).toBe(second);
      expect(callCount).toBe(1); // 생성자는 한 번만 호출됨
    });

    it('등록되지 않은 다운로더를 요청하면 에러가 발생해야 함', () => {
      expect(() => getDownloader('maven' as PackageType)).toThrow(
        '다운로더가 등록되지 않았습니다: maven'
      );
    });

    it('여러 타입의 다운로더를 등록할 수 있어야 함', () => {
      const pipDownloader = createMockDownloader('pip');
      const npmDownloader = createMockDownloader('npm');
      const mavenDownloader = createMockDownloader('maven');

      registerDownloader('pip', () => pipDownloader);
      registerDownloader('npm', () => npmDownloader);
      registerDownloader('maven', () => mavenDownloader);

      expect(getDownloader('pip')).toBe(pipDownloader);
      expect(getDownloader('npm')).toBe(npmDownloader);
      expect(getDownloader('maven')).toBe(mavenDownloader);
    });
  });

  describe('setTestDownloader & clearTestDownloader', () => {
    it('테스트용 다운로더를 설정하면 기존 인스턴스 대신 반환되어야 함', () => {
      const originalDownloader = createMockDownloader('pip');
      const mockDownloader = createMockDownloader('pip');

      registerDownloader('pip', () => originalDownloader);

      // 원본 확인
      expect(getDownloader('pip')).toBe(originalDownloader);

      // 테스트용 모킹 설정
      setTestDownloader('pip', mockDownloader);

      // 모킹된 인스턴스 반환
      expect(getDownloader('pip')).toBe(mockDownloader);

      // 테스트 정리
      clearTestDownloader('pip');

      // 다시 원본 반환
      expect(getDownloader('pip')).toBe(originalDownloader);
    });

    it('clearAllTestDownloaders로 모든 오버라이드를 제거할 수 있어야 함', () => {
      const originalPip = createMockDownloader('pip');
      const originalNpm = createMockDownloader('npm');
      const mockPip = createMockDownloader('pip');
      const mockNpm = createMockDownloader('npm');

      registerDownloader('pip', () => originalPip);
      registerDownloader('npm', () => originalNpm);

      setTestDownloader('pip', mockPip);
      setTestDownloader('npm', mockNpm);

      expect(getDownloader('pip')).toBe(mockPip);
      expect(getDownloader('npm')).toBe(mockNpm);

      clearAllTestDownloaders();

      expect(getDownloader('pip')).toBe(originalPip);
      expect(getDownloader('npm')).toBe(originalNpm);
    });
  });

  describe('resetDownloaderRegistry', () => {
    it('레지스트리 초기화 시 모든 상태가 초기화되어야 함', () => {
      const mockDownloader = createMockDownloader('pip');
      registerDownloader('pip', () => mockDownloader);

      const firstInstance = getDownloader('pip');
      expect(firstInstance).toBe(mockDownloader);

      resetDownloaderRegistry();

      // 생성자도 초기화되므로 에러 발생
      expect(() => getDownloader('pip')).toThrow('다운로더가 등록되지 않았습니다');
    });

    it('초기화 후 다시 등록할 수 있어야 함', () => {
      registerDownloader('pip', () => createMockDownloader('pip'));
      resetDownloaderRegistry();

      // 다시 등록
      const newMock = createMockDownloader('pip');
      registerDownloader('pip', () => newMock);

      expect(getDownloader('pip')).toBe(newMock);
    });
  });

  describe('getDownloaderRegistry', () => {
    it('레지스트리 인스턴스를 반환해야 함', () => {
      const registry = getDownloaderRegistry();

      expect(registry).toBeDefined();
      expect(typeof registry.get).toBe('function');
      expect(typeof registry.has).toBe('function');
      expect(typeof registry.setOverride).toBe('function');
    });

    it('has() 메서드로 등록 여부를 확인할 수 있어야 함', () => {
      const registry = getDownloaderRegistry();

      expect(registry.has('pip')).toBe(false);

      registerDownloader('pip', () => createMockDownloader('pip'));

      expect(registry.has('pip')).toBe(true);
    });

    it('getRegisteredTypes()로 등록된 타입 목록을 가져올 수 있어야 함', () => {
      const registry = getDownloaderRegistry();

      registerDownloader('pip', () => createMockDownloader('pip'));
      registerDownloader('npm', () => createMockDownloader('npm'));

      const types = registry.getRegisteredTypes();

      expect(types).toContain('pip');
      expect(types).toContain('npm');
    });

    it('clearInstance()로 특정 캐시를 제거할 수 있어야 함', () => {
      const registry = getDownloaderRegistry();

      let callCount = 0;
      registerDownloader('pip', () => {
        callCount++;
        return createMockDownloader('pip');
      });

      getDownloader('pip');
      expect(callCount).toBe(1);

      getDownloader('pip');
      expect(callCount).toBe(1); // 캐시됨

      registry.clearInstance('pip');

      getDownloader('pip');
      expect(callCount).toBe(2); // 새로 생성됨
    });
  });
});

describe('initializeDownloaders & getDownloaderAsync', () => {
  beforeEach(() => {
    resetDownloaderRegistry();
  });

  afterEach(() => {
    resetDownloaderRegistry();
  });

  it('initializeDownloaders가 모든 기본 다운로더를 등록해야 함', async () => {
    await initializeDownloaders();

    const registry = getDownloaderRegistry();
    const types = registry.getRegisteredTypes();

    expect(types).toContain('pip');
    expect(types).toContain('conda');
    expect(types).toContain('maven');
    expect(types).toContain('npm');
    expect(types).toContain('docker');
    expect(types).toContain('yum');
  });

  it('getDownloaderAsync가 자동으로 초기화해야 함', async () => {
    // 초기화 없이 호출
    const downloader = await getDownloaderAsync('pip');

    expect(downloader).toBeDefined();
    expect(downloader.type).toBe('pip');
  });

  it('이미 초기화된 경우 다시 초기화하지 않아야 함', async () => {
    await initializeDownloaders();
    await initializeDownloaders(); // 두 번 호출해도 에러 없음

    const registry = getDownloaderRegistry();
    expect(registry.has('pip')).toBe(true);
  });
});

describe('테스트 시나리오: 모킹 사용 예제', () => {
  beforeEach(async () => {
    resetDownloaderRegistry();
    await initializeDownloaders();
  });

  afterEach(() => {
    resetDownloaderRegistry();
  });

  it('다운로드 함수를 모킹하여 테스트할 수 있어야 함', async () => {
    // 모킹된 다운로더 생성
    const mockPipDownloader = createMockDownloader('pip');
    vi.mocked(mockPipDownloader.downloadPackage).mockResolvedValue('/mocked/path/package.whl');

    // 테스트용으로 설정
    setTestDownloader('pip', mockPipDownloader);

    // 코드에서 사용
    const downloader = getDownloader('pip');
    const result = await downloader.downloadPackage(
      { name: 'requests', version: '2.28.0', type: 'pip' },
      '/output'
    );

    expect(result).toBe('/mocked/path/package.whl');
    expect(mockPipDownloader.downloadPackage).toHaveBeenCalledWith(
      { name: 'requests', version: '2.28.0', type: 'pip' },
      '/output'
    );
  });

  it('의존성 해결 함수를 모킹하여 테스트할 수 있어야 함', async () => {
    const mockMavenDownloader = createMockDownloader('maven');
    const mockDependencies: PackageInfo[] = [
      { name: 'dep1', version: '1.0.0', type: 'maven' },
      { name: 'dep2', version: '2.0.0', type: 'maven' },
    ];
    vi.mocked(mockMavenDownloader.resolveDependencies).mockResolvedValue(mockDependencies);

    setTestDownloader('maven', mockMavenDownloader);

    const downloader = getDownloader('maven');
    const deps = await downloader.resolveDependencies?.(
      { name: 'spring-core', version: '5.3.0', type: 'maven' }
    );

    expect(deps).toEqual(mockDependencies);
  });
});
