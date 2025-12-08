/**
 * YUM/RPM Package Downloader
 * RHEL/CentOS 계열 패키지 다운로더
 */

import type { OSPackageInfo } from '../types';
import { BaseOSDownloader, type BaseDownloaderOptions } from '../base-downloader';
import { resolveRepoUrl } from '../repositories';

/**
 * YUM 패키지 다운로더
 */
export class YumDownloader extends BaseOSDownloader {
  constructor(options: BaseDownloaderOptions) {
    super(options);
  }

  /**
   * 다운로드 URL 생성
   */
  protected getDownloadUrl(pkg: OSPackageInfo): string {
    const baseUrl = resolveRepoUrl(
      pkg.repository.baseUrl,
      this.options.architecture,
      this.options.distribution
    );

    // location은 상대 경로
    return `${baseUrl.replace(/\/$/, '')}/${pkg.location}`;
  }

  /**
   * 파일명 생성
   */
  protected getFilename(pkg: OSPackageInfo): string {
    // RPM 파일명 형식: name-version-release.arch.rpm
    const release = pkg.release ? `-${pkg.release}` : '';
    return `${pkg.name}-${pkg.version}${release}.${pkg.architecture}.rpm`;
  }
}
