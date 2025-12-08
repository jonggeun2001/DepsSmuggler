/**
 * APK Package Downloader
 * Alpine Linux 패키지 다운로더
 */

import type { OSPackageInfo } from '../types';
import { BaseOSDownloader, type BaseDownloaderOptions } from '../base-downloader';

/**
 * APK 패키지 다운로더
 */
export class ApkDownloader extends BaseOSDownloader {
  constructor(options: BaseDownloaderOptions) {
    super(options);
  }

  /**
   * 다운로드 URL 생성
   */
  protected getDownloadUrl(pkg: OSPackageInfo): string {
    const baseUrl = pkg.repository.baseUrl.replace(/\/$/, '');
    // location은 arch/filename.apk 형태
    return `${baseUrl}/${pkg.location}`;
  }

  /**
   * 파일명 생성
   */
  protected getFilename(pkg: OSPackageInfo): string {
    // APK 파일명 형식: name-version.apk
    return `${pkg.name}-${pkg.version}.apk`;
  }
}
