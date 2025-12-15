/**
 * 다운로더 팩토리
 * 테스트 용이성을 위해 의존성 주입을 지원하는 팩토리 패턴 구현
 */

import { IDownloader, PackageType } from '../../types';

// 다운로더 생성 함수 타입
type DownloaderCreator = () => IDownloader;

/**
 * 다운로더 레지스트리
 * - 기본 다운로더 인스턴스 관리
 * - 테스트를 위한 인스턴스 교체 지원
 */
class DownloaderRegistry {
  private instances: Map<PackageType, IDownloader> = new Map();
  private creators: Map<PackageType, DownloaderCreator> = new Map();
  private overrides: Map<PackageType, IDownloader> = new Map();

  /**
   * 다운로더 생성자 등록
   */
  registerCreator(type: PackageType, creator: DownloaderCreator): void {
    this.creators.set(type, creator);
  }

  /**
   * 다운로더 인스턴스 가져오기
   * 1. 오버라이드된 인스턴스 우선
   * 2. 기존 캐시된 인스턴스
   * 3. 새로 생성
   */
  get(type: PackageType): IDownloader {
    // 테스트용 오버라이드 확인
    const override = this.overrides.get(type);
    if (override) {
      return override;
    }

    // 기존 인스턴스 확인
    let instance = this.instances.get(type);
    if (instance) {
      return instance;
    }

    // 새로 생성
    const creator = this.creators.get(type);
    if (!creator) {
      throw new Error(`다운로더가 등록되지 않았습니다: ${type}`);
    }

    instance = creator();
    this.instances.set(type, instance);
    return instance;
  }

  /**
   * 등록된 다운로더 타입인지 확인
   */
  has(type: PackageType): boolean {
    return this.creators.has(type);
  }

  /**
   * 테스트용 다운로더 오버라이드 설정
   * @param type 패키지 타입
   * @param instance 대체할 인스턴스 (모킹된 인스턴스)
   */
  setOverride(type: PackageType, instance: IDownloader): void {
    this.overrides.set(type, instance);
  }

  /**
   * 특정 타입의 오버라이드 제거
   */
  clearOverride(type: PackageType): void {
    this.overrides.delete(type);
  }

  /**
   * 모든 오버라이드 제거
   */
  clearAllOverrides(): void {
    this.overrides.clear();
  }

  /**
   * 특정 타입의 캐시된 인스턴스 제거
   */
  clearInstance(type: PackageType): void {
    this.instances.delete(type);
  }

  /**
   * 모든 캐시된 인스턴스 제거
   */
  clearAllInstances(): void {
    this.instances.clear();
  }

  /**
   * 레지스트리 완전 초기화 (테스트 후 정리용)
   */
  reset(): void {
    this.instances.clear();
    this.overrides.clear();
    // creators는 유지 - 다시 등록 불필요
  }

  /**
   * 레지스트리 완전 초기화 (테스트 격리용)
   * creators까지 모두 제거
   */
  fullReset(): void {
    this.instances.clear();
    this.overrides.clear();
    this.creators.clear();
  }

  /**
   * 등록된 모든 다운로더 타입 반환
   */
  getRegisteredTypes(): PackageType[] {
    return Array.from(this.creators.keys());
  }
}

// 싱글톤 레지스트리 인스턴스
const registry = new DownloaderRegistry();

/**
 * 다운로더 레지스트리 접근
 * 일반 사용: getDownloader(type)
 * 테스트: registry.setOverride(type, mockInstance)
 */
export function getDownloaderRegistry(): DownloaderRegistry {
  return registry;
}

/**
 * 타입별 다운로더 가져오기
 * 기존 getXxxDownloader() 함수를 대체하는 통합 함수
 */
export function getDownloader(type: PackageType): IDownloader {
  return registry.get(type);
}

/**
 * 다운로더 생성자 등록
 * 각 다운로더 모듈에서 호출하여 자신을 등록
 */
export function registerDownloader(type: PackageType, creator: DownloaderCreator): void {
  registry.registerCreator(type, creator);
}

/**
 * 테스트용 다운로더 설정
 * 테스트 코드에서 모킹된 다운로더를 주입할 때 사용
 *
 * @example
 * // 테스트에서 사용
 * const mockDownloader = {
 *   type: 'pip' as PackageType,
 *   searchPackages: vi.fn().mockResolvedValue([]),
 *   // ... 기타 메서드
 * };
 * setTestDownloader('pip', mockDownloader);
 *
 * // 테스트 후 정리
 * clearTestDownloader('pip');
 */
export function setTestDownloader(type: PackageType, instance: IDownloader): void {
  registry.setOverride(type, instance);
}

/**
 * 테스트용 다운로더 제거
 */
export function clearTestDownloader(type: PackageType): void {
  registry.clearOverride(type);
}

/**
 * 모든 테스트용 다운로더 제거
 */
export function clearAllTestDownloaders(): void {
  registry.clearAllOverrides();
}

// ============================================
// 다운로더 지연 등록을 위한 초기화 함수
// ============================================

let initialized = false;

/**
 * 레지스트리 초기화 (테스트 후 정리)
 * creators를 포함한 모든 상태를 초기화
 */
export function resetDownloaderRegistry(): void {
  registry.fullReset();
  initialized = false;
}

/**
 * 모든 다운로더 등록 (지연 로딩)
 * 앱 시작 시 또는 첫 다운로더 요청 시 호출
 */
export async function initializeDownloaders(): Promise<void> {
  if (initialized) return;

  // 동적 import로 순환 참조 방지
  const [
    { PipDownloader },
    { CondaDownloader },
    { MavenDownloader },
    { NpmDownloader },
    { DockerDownloader },
    { YumDownloader: YumDL },
  ] = await Promise.all([
    import('./pip'),
    import('./conda'),
    import('./maven'),
    import('./npm'),
    import('./docker'),
    import('./yum'),
  ]);

  registry.registerCreator('pip', () => new PipDownloader());
  registry.registerCreator('conda', () => new CondaDownloader());
  registry.registerCreator('maven', () => new MavenDownloader());
  registry.registerCreator('npm', () => new NpmDownloader());
  registry.registerCreator('docker', () => new DockerDownloader());
  registry.registerCreator('yum', () => new YumDL());

  initialized = true;
}

/**
 * 다운로더 가져오기 (자동 초기화)
 * 초기화되지 않았으면 자동으로 초기화 후 반환
 */
export async function getDownloaderAsync(type: PackageType): Promise<IDownloader> {
  if (!initialized && !registry.has(type)) {
    await initializeDownloaders();
  }
  return registry.get(type);
}
