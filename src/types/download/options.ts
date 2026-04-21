import type { Architecture } from '../platform/architecture';
import type { TargetOS } from '../platform/os-target';

export type DownloadOutputFormat = 'zip' | 'tar.gz';
export type DownloadDeliveryMethod = 'local' | 'email';

export interface DownloadEmailOptions {
  to: string;
  from?: string;
  subject?: string;
}

export interface DownloadFileSplitOptions {
  enabled: boolean;
  maxSizeMB: number;
}

export interface DownloadSmtpOptions {
  host: string;
  port: number;
  user?: string;
  password?: string;
  from?: string;
  secure?: boolean;
}

export interface DownloadOptions {
  outputDir: string;
  outputFormat: DownloadOutputFormat;
  includeScripts: boolean;
  targetOS?: TargetOS;
  architecture?: Architecture;
  includeDependencies?: boolean;
  pythonVersion?: string;
  concurrency?: number;
  deliveryMethod?: DownloadDeliveryMethod;
  email?: DownloadEmailOptions;
  fileSplit?: DownloadFileSplitOptions;
  smtp?: DownloadSmtpOptions;
}

export interface PipDownloadOptions extends DownloadOptions {
  pythonVersion?: string;
}
