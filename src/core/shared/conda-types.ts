// Conda 공통 타입 정의

/**
 * repodata.json 패키지 구조
 */
export interface RepoDataPackage {
  name: string;
  version: string;
  build: string;
  build_number: number;
  depends: string[];
  subdir: string;
  md5?: string;
  sha256?: string;
  size?: number;
  timestamp?: number;
}

/**
 * repodata.json 전체 구조
 */
export interface RepoData {
  info?: { subdir: string };
  packages: Record<string, RepoDataPackage>;
  'packages.conda'?: Record<string, RepoDataPackage>;
}

/**
 * Anaconda API 검색 결과 타입
 */
export interface CondaSearchResult {
  name: string;
  summary: string;
  owner: string;
  full_name: string;
}

/**
 * Anaconda API 파일 정보 타입
 */
export interface CondaPackageFile {
  version: string;
  basename: string;
  size: number;
  md5: string;
  sha256?: string;
  upload_time: string;
  ndownloads?: number;
  attrs: {
    subdir: string;
    build: string;
    build_number: number;
    arch?: string;
    platform?: string;
    depends?: string[];
  };
}

/**
 * Anaconda API 패키지 버전 정보
 */
export interface CondaVersionInfo {
  version: string;
  files: CondaPackageFile[];
}

/**
 * Anaconda API 파일 응답 (files 엔드포인트)
 */
export interface AnacondaFileInfo {
  basename: string;
  version: string;
  size: number;
  attrs: {
    subdir: string;
    build: string;
    build_number: number;
  };
  download_url: string;
}
