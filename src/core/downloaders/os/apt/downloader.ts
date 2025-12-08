/**
 * APT/DEB Package Downloader
 * Ubuntu/Debian 계열 패키지 다운로더
 */

import type { OSPackageInfo } from '../types';
import { BaseOSDownloader, type BaseDownloaderOptions } from '../base-downloader';

/**
 * APT 패키지 다운로더
 */
export class AptDownloader extends BaseOSDownloader {
  constructor(options: BaseDownloaderOptions) {
    super(options);
  }

  /**
   * 다운로드 URL 생성
   */
  protected getDownloadUrl(pkg: OSPackageInfo): string {
    // APT의 경우 baseUrl은 dists/codename/component/ 형태
    // location은 pool/... 형태의 전체 경로
    const baseUrl = pkg.repository.baseUrl;

    // dists/codename/component 부분을 제거하고 pool 경로 추가
    const match = baseUrl.match(/^(https?:\/\/[^/]+)/);
    const domain = match ? match[1] : baseUrl;

    return `${domain}/${pkg.location}`;
  }

  /**
   * 파일명 생성
   */
  protected getFilename(pkg: OSPackageInfo): string {
    // DEB 파일명 형식: name_version_arch.deb
    return `${pkg.name}_${pkg.version}_${pkg.architecture}.deb`;
  }
}
