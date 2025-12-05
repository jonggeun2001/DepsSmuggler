// 공통 타입 정의

export interface DownloadPackage {
  id: string;
  type: string;
  name: string;
  version: string;
  architecture?: string;
}

export type TargetOS = 'windows' | 'macos' | 'linux' | 'any';
export type Architecture = 'x86_64' | 'amd64' | 'arm64' | 'aarch64' | 'noarch';

export interface DownloadOptions {
  outputDir: string;
  outputFormat: 'zip' | 'tar.gz' | 'mirror';
  includeScripts: boolean;
  targetOS?: TargetOS;
  architecture?: Architecture;
  includeDependencies?: boolean;
  pythonVersion?: string;
}

export interface DownloadUrlResult {
  url: string;
  filename: string;
  size?: number;
}

export interface DownloadProgress {
  packageId: string;
  status: 'pending' | 'downloading' | 'completed' | 'failed';
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
  speed: number;
  error?: string;
}

export interface DownloadResult {
  id: string;
  success: boolean;
  error?: string;
}
