// ============================================
// 패키지 관련 타입
// ============================================

/** 지원하는 패키지 관리자 타입 */
export type PackageType =
  | 'pip'
  | 'conda'
  | 'maven'
  | 'gradle'
  | 'npm'
  | 'yum'
  | 'apt'
  | 'apk'
  | 'docker';

/** 지원하는 아키텍처 */
export type Architecture =
  | 'x86_64'
  | 'amd64'
  | 'arm64'
  | 'aarch64'
  | 'i386'
  | 'i686'
  | 'noarch'
  | 'all';

/** 패키지 정보 */
export interface PackageInfo {
  type: PackageType;
  name: string;
  version: string;
  arch?: Architecture;
  metadata?: PackageMetadata;
}

/** 패키지 메타데이터 */
export interface PackageMetadata {
  description?: string;
  author?: string;
  license?: string;
  homepage?: string;
  repository?: string;
  size?: number;
  checksum?: {
    md5?: string;
    sha1?: string;
    sha256?: string;
  };
  downloadUrl?: string;
  // Maven 전용
  groupId?: string;
  artifactId?: string;
  // Docker 전용
  registry?: string;
  tag?: string;
  digest?: string;
  // Python 전용
  pythonVersion?: string;
  wheelTags?: string[];
  // 기타 추가 메타데이터
  [key: string]: unknown;
}

// ============================================
// 의존성 관련 타입
// ============================================

/** 의존성 트리 노드 */
export interface DependencyNode {
  package: PackageInfo;
  dependencies: DependencyNode[];
  optional?: boolean;
  scope?: DependencyScope;
}

/** 의존성 스코프 (Maven 등에서 사용) */
export type DependencyScope =
  | 'compile'
  | 'runtime'
  | 'test'
  | 'provided'
  | 'system';

/** 의존성 해결 결과 */
export interface DependencyResolutionResult {
  root: DependencyNode;
  flatList: PackageInfo[];
  conflicts: DependencyConflict[];
  totalSize?: number;
}

/** 의존성 충돌 타입 */
export type ConflictType = 'version' | 'circular' | 'missing';

/** 의존성 충돌 정보 */
export interface DependencyConflict {
  type: ConflictType;
  packageName: string;
  versions: string[];
  resolvedVersion?: string;
}

// ============================================
// 다운로드 관련 타입
// ============================================

/** 다운로드 상태 */
export type DownloadStatus =
  | 'pending'
  | 'downloading'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled';

/** 다운로드 아이템 */
export interface DownloadItem {
  id: string;
  package: PackageInfo;
  status: DownloadStatus;
  progress: number; // 0-100
  downloadedBytes?: number;
  totalBytes?: number;
  speed?: number; // bytes per second
  error?: string;
  filePath?: string;
  startedAt?: Date;
  completedAt?: Date;
}

/** 다운로드 진행 이벤트 */
export interface DownloadProgressEvent {
  itemId: string;
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
  speed: number;
}

/** 다운로드 결과 */
export interface DownloadResult {
  success: boolean;
  items: DownloadItem[];
  totalDownloaded: number;
  totalFailed: number;
  totalSkipped: number;
  outputPath?: string;
}

// ============================================
// 출력 관련 타입
// ============================================

/** 출력 형식 */
export type OutputFormat = 'archive' | 'mirror' | 'withScript';

/** 압축 형식 */
export type ArchiveType = 'zip' | 'tar.gz';

/** 전달 방식 */
export type DeliveryMethod = 'local' | 'email';

/** 패키징 옵션 */
export interface PackagingOptions {
  format: OutputFormat;
  archiveType?: ArchiveType;
  outputPath: string;
  includeScript?: boolean;
  splitSize?: number; // MB 단위
}

/** 패키징 결과 */
export interface PackagingResult {
  success: boolean;
  files: string[];
  totalSize: number;
  manifest?: PackageManifest;
}

/** 패키지 매니페스트 */
export interface PackageManifest {
  createdAt: string;
  packages: PackageInfo[];
  totalPackages: number;
  totalSize: number;
  format: OutputFormat;
}

// ============================================
// 인터페이스 정의
// ============================================

/** 패키지 다운로더 인터페이스 */
export interface IDownloader {
  /** 패키지 타입 */
  readonly type: PackageType;

  /** 패키지 검색 */
  searchPackages(query: string): Promise<PackageInfo[]>;

  /** 버전 목록 조회 */
  getVersions(packageName: string): Promise<string[]>;

  /** 패키지 메타데이터 조회 */
  getPackageMetadata(name: string, version: string): Promise<PackageInfo>;

  /** 패키지 다운로드 */
  downloadPackage(
    info: PackageInfo,
    destPath: string,
    onProgress?: (progress: DownloadProgressEvent) => void
  ): Promise<string>;

  /** 체크섬 검증 */
  verifyChecksum?(filePath: string, expected: string): Promise<boolean>;
}

/** 의존성 해결기 인터페이스 */
export interface IResolver {
  /** 패키지 타입 */
  readonly type: PackageType;

  /** 의존성 해결 */
  resolveDependencies(
    packageName: string,
    version: string,
    options?: ResolverOptions
  ): Promise<DependencyResolutionResult>;

  /** 텍스트 파일 파싱 (requirements.txt, pom.xml 등) */
  parseFromText?(content: string): Promise<PackageInfo[]>;
}

/** 의존성 해결 옵션 */
export interface ResolverOptions {
  includeDevDependencies?: boolean;
  includeOptionalDependencies?: boolean;
  maxDepth?: number;
  architecture?: Architecture;
}

/** 패키저 인터페이스 */
export interface IPackager {
  /** 패키징 수행 */
  package(
    items: DownloadItem[],
    options: PackagingOptions
  ): Promise<PackagingResult>;
}

// ============================================
// 유틸리티 타입
// ============================================

/** 에러 처리 선택 */
export type ErrorAction = 'retry' | 'skip' | 'cancel';

/** 사용자 선택 요청 */
export interface UserPrompt {
  type: 'error' | 'confirm' | 'select';
  title: string;
  message: string;
  options?: ErrorAction[];
}

/** 이벤트 리스너 타입 */
export type EventCallback<T = unknown> = (data: T) => void;

/** 이벤트 에미터 인터페이스 */
export interface IEventEmitter<Events extends Record<string, unknown>> {
  on<K extends keyof Events>(event: K, callback: EventCallback<Events[K]>): void;
  off<K extends keyof Events>(event: K, callback: EventCallback<Events[K]>): void;
  emit<K extends keyof Events>(event: K, data: Events[K]): void;
}
