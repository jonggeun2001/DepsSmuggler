/**
 * OS Package Downloader Types
 * OS 패키지(yum/rpm, apt/deb, apk)를 위한 공통 타입 정의
 */

// OS 패키지 관리자 타입
export type OSPackageManager = 'yum' | 'apt' | 'apk';

// 아키텍처 타입
export type OSArchitecture =
  | 'x86_64' | 'amd64'      // 64비트 x86
  | 'aarch64' | 'arm64'     // 64비트 ARM
  | 'i686' | 'i386' | 'x86' // 32비트 x86
  | 'armv7l' | 'armhf' | 'armv7' // 32비트 ARM
  | 'noarch' | 'all';       // 아키텍처 무관

// 체크섬 타입
export type ChecksumType = 'md5' | 'sha1' | 'sha256' | 'sha512';

// 버전 비교 연산자
export type VersionOperator = '=' | '<' | '>' | '<=' | '>=' | '<<' | '>>';

// 에러 처리 액션
export type OSErrorAction = 'retry' | 'skip' | 'cancel';

// 출력 형식
export type OutputType = 'archive' | 'repository' | 'both';

// 압축 형식
export type ArchiveFormat = 'zip' | 'tar.gz';

// 스크립트 타입
export type ScriptType = 'dependency-order' | 'local-repo';

// 검색 매치 타입
export type MatchType = 'exact' | 'partial' | 'wildcard';

// 캐시 모드
export type CacheMode = 'session' | 'persistent' | 'none';

/**
 * 저장소 정보
 */
export interface Repository {
  /** 저장소 고유 ID */
  id: string;
  /** 저장소 이름 */
  name: string;
  /** 저장소 베이스 URL */
  baseUrl: string;
  /** 활성화 여부 */
  enabled: boolean;
  /** GPG 서명 검증 여부 */
  gpgCheck: boolean;
  /** GPG 키 URL */
  gpgKeyUrl?: string;
  /** 우선순위 (낮을수록 높은 우선순위) */
  priority?: number;
  /** 공식 저장소 여부 */
  isOfficial: boolean;
}

/**
 * OS 배포판 정보
 */
export interface OSDistribution {
  /** 배포판 고유 ID (예: 'centos-7', 'ubuntu-22.04', 'alpine-3.20') */
  id: string;
  /** 배포판 표시 이름 (예: 'CentOS 7', 'Ubuntu 22.04 LTS') */
  name: string;
  /** 버전 */
  version: string;
  /** 코드명 (예: 'jammy', 'bookworm') */
  codename?: string;
  /** 패키지 관리자 */
  packageManager: OSPackageManager;
  /** 지원 아키텍처 */
  architectures: OSArchitecture[];
  /** 기본 저장소 */
  defaultRepos: Repository[];
  /** 확장 저장소 (EPEL, Universe 등) */
  extendedRepos: Repository[];
}

/**
 * 패키지 의존성
 */
export interface PackageDependency {
  /** 의존성 패키지 이름 */
  name: string;
  /** 버전 (없으면 모든 버전) */
  version?: string;
  /** 버전 비교 연산자 */
  operator?: VersionOperator;
  /** 선택적 의존성 여부 */
  isOptional?: boolean;
}

/**
 * 체크섬 정보
 */
export interface Checksum {
  type: ChecksumType;
  value: string;
}

/**
 * OS 패키지 정보
 */
export interface OSPackageInfo {
  /** 패키지 이름 */
  name: string;
  /** 버전 */
  version: string;
  /** 릴리스 (RPM: 1.el7) */
  release?: string;
  /** Epoch (RPM 버전 우선순위) */
  epoch?: number;
  /** 아키텍처 */
  architecture: OSArchitecture;
  /** 파일 크기 (bytes) */
  size: number;
  /** 설치 후 크기 (bytes) */
  installedSize?: number;
  /** 체크섬 */
  checksum: Checksum;
  /** 저장소 내 파일 경로 */
  location: string;
  /** 소속 저장소 */
  repository: Repository;
  /** 패키지 설명 */
  description?: string;
  /** 요약 */
  summary?: string;
  /** 라이선스 */
  license?: string;
  /** 필수 의존성 */
  dependencies: PackageDependency[];
  /** 제공하는 기능/패키지 */
  provides?: string[];
  /** 충돌하는 패키지 */
  conflicts?: string[];
  /** 대체하는 패키지 */
  obsoletes?: string[];
  /** 추천 의존성 (약한 의존성) */
  suggests?: string[];
  /** 권장 의존성 */
  recommends?: string[];
}

/**
 * 패키지 검색 옵션
 */
export interface OSPackageSearchOptions {
  /** 검색 쿼리 */
  query: string;
  /** 대상 배포판 */
  distribution: OSDistribution;
  /** 대상 아키텍처 */
  architecture: OSArchitecture;
  /** 검색할 저장소 (없으면 모든 활성 저장소) */
  repositories?: Repository[];
  /** 검색 매치 타입 */
  matchType?: MatchType;
  /** 버전 목록 포함 여부 */
  includeVersions?: boolean;
  /** 결과 제한 */
  limit?: number;
}

/**
 * 패키지 검색 결과
 */
export interface OSPackageSearchResult {
  /** 패키지 이름 */
  name: string;
  /** 사용 가능한 버전 목록 (최신순) */
  versions: OSPackageInfo[];
  /** 최신 버전 */
  latest: OSPackageInfo;
}

/**
 * 다운로드 진행 상황
 */
export interface OSDownloadProgress {
  /** 현재 다운로드 중인 패키지 이름 */
  currentPackage: string;
  /** 현재 패키지 인덱스 */
  currentIndex: number;
  /** 전체 패키지 수 */
  totalPackages: number;
  /** 다운로드된 바이트 */
  bytesDownloaded: number;
  /** 전체 바이트 */
  totalBytes: number;
  /** 다운로드 속도 (bytes/sec) */
  speed: number;
  /** 현재 단계 */
  phase: 'resolving' | 'downloading' | 'verifying' | 'packaging';
}

/**
 * 다운로드 에러
 */
export interface OSDownloadError {
  /** 에러 타입 */
  type: 'network' | 'checksum' | 'gpg' | 'dependency' | 'unknown';
  /** 에러 메시지 */
  message: string;
  /** 관련 패키지 */
  package?: OSPackageInfo;
  /** 원본 에러 */
  cause?: Error;
  /** 재시도 가능 여부 */
  retryable: boolean;
}

/**
 * 다운로드 옵션
 */
export interface OSPackageDownloadOptions {
  /** 다운로드할 패키지 목록 */
  packages: OSPackageInfo[];
  /** 출력 디렉토리 */
  outputDir: string;
  /** 의존성 해결 여부 */
  resolveDependencies: boolean;
  /** 선택적 의존성 포함 여부 */
  includeOptionalDeps: boolean;
  /** 동시 다운로드 수 */
  concurrency: number;
  /** GPG 검증 여부 */
  verifyGPG: boolean;
  /** 캐시 모드 */
  cacheMode: CacheMode;
  /** 진행 상황 콜백 */
  onProgress?: (progress: OSDownloadProgress) => void;
  /** 에러 발생 시 콜백 (사용자 선택 반환) */
  onError?: (error: OSDownloadError) => Promise<OSErrorAction>;
}

/**
 * 출력 옵션
 */
export interface OSPackageOutputOptions {
  /** 출력 형식 */
  type: OutputType;
  /** 압축 형식 (archive 타입일 때) */
  archiveFormat?: ArchiveFormat;
  /** 스크립트 생성 여부 */
  generateScripts: boolean;
  /** 생성할 스크립트 타입 */
  scriptTypes: ScriptType[];
}

/**
 * 의존성 해결 결과
 */
export interface DependencyResolutionResult {
  /** 해결된 패키지 목록 (의존성 순서대로) */
  packages: OSPackageInfo[];
  /** 해결되지 않은 의존성 */
  unresolved: PackageDependency[];
  /** 버전 충돌 (모든 버전 다운로드 대상) */
  conflicts: Array<{
    package: string;
    versions: OSPackageInfo[];
  }>;
  /** 경고 메시지 */
  warnings: string[];
}

/**
 * 메타데이터 파서 인터페이스
 */
export interface MetadataParser {
  /** 저장소 메타데이터 가져오기 */
  fetchMetadata(repo: Repository): Promise<void>;
  /** 패키지 검색 */
  searchPackages(options: OSPackageSearchOptions): Promise<OSPackageSearchResult[]>;
  /** 패키지 정보 가져오기 */
  getPackageInfo(name: string, version?: string): Promise<OSPackageInfo | null>;
  /** 패키지의 모든 버전 가져오기 */
  getPackageVersions(name: string): Promise<OSPackageInfo[]>;
}

/**
 * 의존성 해결기 인터페이스
 */
export interface DependencyResolver {
  /** 의존성 해결 */
  resolve(
    packages: OSPackageInfo[],
    options: {
      includeOptional: boolean;
      architecture: OSArchitecture;
    }
  ): Promise<DependencyResolutionResult>;
}

/**
 * 캐시 관리자 인터페이스
 */
export interface CacheManager {
  /** 캐시된 메타데이터 가져오기 */
  getMetadata(key: string): Promise<unknown | null>;
  /** 메타데이터 캐시 저장 */
  setMetadata(key: string, data: unknown, ttl?: number): Promise<void>;
  /** 캐시된 패키지 파일 경로 가져오기 */
  getPackagePath(pkg: OSPackageInfo): Promise<string | null>;
  /** 패키지 파일 캐시 */
  cachePackage(pkg: OSPackageInfo, filePath: string): Promise<void>;
  /** 캐시 무효화 */
  invalidate(pattern?: string): Promise<void>;
  /** 캐시 통계 */
  getStats(): Promise<{ size: number; count: number }>;
}

/**
 * GPG 검증기 인터페이스
 */
export interface GPGVerifier {
  /** GPG 키 가져오기 */
  importKey(keyUrl: string): Promise<void>;
  /** 패키지 서명 검증 */
  verifyPackage(pkg: OSPackageInfo, filePath: string): Promise<boolean>;
  /** 저장소 메타데이터 서명 검증 */
  verifyMetadata(repo: Repository, signatureFile: string, dataFile: string): Promise<boolean>;
}

/**
 * 스크립트 생성기 인터페이스
 */
export interface ScriptGenerator {
  /** 의존성 순서 설치 스크립트 생성 */
  generateDependencyOrderScript(packages: OSPackageInfo[], os: 'linux' | 'windows'): string;
  /** 로컬 저장소 설정 스크립트 생성 */
  generateLocalRepoScript(repoPath: string, packageManager: OSPackageManager): string;
}

/**
 * 출력 패키저 인터페이스
 */
export interface OutputPackager {
  /** 아카이브 생성 */
  createArchive(
    packages: OSPackageInfo[],
    outputPath: string,
    format: ArchiveFormat
  ): Promise<string>;
  /** 로컬 저장소 구조 생성 */
  createLocalRepository(
    packages: OSPackageInfo[],
    outputPath: string,
    packageManager: OSPackageManager
  ): Promise<string>;
}

/**
 * OS 패키지 다운로더 메인 인터페이스
 */
export interface OSPackageDownloader {
  /** 배포판 설정 */
  setDistribution(distribution: OSDistribution): void;
  /** 아키텍처 설정 */
  setArchitecture(architecture: OSArchitecture): void;
  /** 저장소 추가 */
  addRepository(repo: Repository): void;
  /** 저장소 제거 */
  removeRepository(repoId: string): void;
  /** 패키지 검색 */
  search(options: OSPackageSearchOptions): Promise<OSPackageSearchResult[]>;
  /** 패키지 다운로드 */
  download(options: OSPackageDownloadOptions): Promise<DependencyResolutionResult>;
  /** 출력물 생성 */
  package(options: OSPackageOutputOptions): Promise<string>;
}

/**
 * 용도별 추천 정보
 */
export interface UseCaseRecommendation {
  /** 용도 ID */
  id: 'enterprise' | 'legacy' | 'container' | 'development';
  /** 용도 이름 */
  name: string;
  /** 설명 */
  description: string;
  /** 추천 배포판 ID 목록 */
  distributions: string[];
}
