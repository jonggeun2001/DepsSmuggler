// 공통 타입 정의
import type { DownloadOptions as CanonicalDownloadOptions } from '../../types/download/options';
import type { DownloadProgress as CanonicalDownloadProgress } from '../../types/download/progress';
import type { Architecture as CanonicalArchitecture } from '../../types/platform/architecture';
import type { TargetOS as CanonicalTargetOS } from '../../types/platform/os-target';

export interface DownloadPackage {
  id: string;
  type: string;
  name: string;
  version: string;
  architecture?: string;
  /** 패키지 크기 (바이트) */
  size?: number;
  /** OS 패키지의 다운로드 URL (yum/apt/apk 등) */
  downloadUrl?: string;
  /** OS 패키지의 저장소 정보 */
  repository?: { baseUrl: string; name?: string };
  /** OS 패키지의 파일 경로 (저장소 내 위치) */
  location?: string;
  /** 실제 다운로드될 파일명 (예: numpy-1.24.0-py311h64a7726_0.conda, requests-2.28.0-py3-none-any.whl) */
  filename?: string;
  /** pip 커스텀 인덱스 URL (예: https://download.pytorch.org/whl/cu121) */
  indexUrl?: string;
  /** pip extras 의존성 (예: ['cuda'], ['security', 'socks']) */
  extras?: string[];
  /** Maven classifier (예: natives-linux, linux-x86_64) */
  classifier?: string;
  /** 추가 메타데이터 (Docker registry 등) */
  metadata?: Record<string, unknown>;
}

export type TargetOS = CanonicalTargetOS;
export type Architecture = CanonicalArchitecture;
export type DownloadOptions = CanonicalDownloadOptions;

export interface DownloadUrlResult {
  url: string;
  filename: string;
  size?: number;
}

export type DownloadProgress = CanonicalDownloadProgress;

export interface DownloadPackageResult {
  id: string;
  success: boolean;
  error?: string;
}

export type DownloadResult = DownloadPackageResult;
