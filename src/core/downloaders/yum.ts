import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { XMLParser } from 'fast-xml-parser';
import {
  IDownloader,
  PackageInfo,
  PackageMetadata,
  DownloadProgressEvent,
  Architecture,
} from '../../types';
import logger from '../../utils/logger';

// repomd.xml 구조
interface RepoMd {
  repomd: {
    data: RepoMdData | RepoMdData[];
  };
}

interface RepoMdData {
  '@_type': string;
  location: {
    '@_href': string;
  };
  checksum?: {
    '#text': string;
    '@_type': string;
  };
  'open-checksum'?: {
    '#text': string;
    '@_type': string;
  };
}

// primary.xml 패키지 구조
interface PrimaryPackage {
  name: string;
  arch: string;
  version: {
    '@_ver': string;
    '@_rel': string;
    '@_epoch'?: string;
  };
  summary?: string;
  description?: string;
  packager?: string;
  url?: string;
  time?: {
    '@_file': string;
    '@_build': string;
  };
  size?: {
    '@_package': string;
    '@_installed': string;
  };
  location: {
    '@_href': string;
  };
  checksum?: {
    '#text': string;
    '@_type': string;
  };
  format?: {
    'rpm:requires'?: {
      'rpm:entry': RpmEntry | RpmEntry[];
    };
    'rpm:provides'?: {
      'rpm:entry': RpmEntry | RpmEntry[];
    };
  };
}

interface RpmEntry {
  '@_name': string;
  '@_ver'?: string;
  '@_flags'?: string;
}

// 기본 저장소 URL
const DEFAULT_REPOS: Record<string, string> = {
  'centos-8-baseos': 'https://vault.centos.org/8-stream/BaseOS/x86_64/os/',
  'centos-8-appstream': 'https://vault.centos.org/8-stream/AppStream/x86_64/os/',
  'rocky-8-baseos': 'https://download.rockylinux.org/pub/rocky/8/BaseOS/x86_64/os/',
  'rocky-9-baseos': 'https://download.rockylinux.org/pub/rocky/9/BaseOS/x86_64/os/',
  'alma-8-baseos': 'https://repo.almalinux.org/almalinux/8/BaseOS/x86_64/os/',
  'alma-9-baseos': 'https://repo.almalinux.org/almalinux/9/BaseOS/x86_64/os/',
};

export class YumDownloader implements IDownloader {
  readonly type = 'yum' as const;
  private client: AxiosInstance;
  private parser: XMLParser;
  private packageCache: Map<string, Map<string, PrimaryPackage>> = new Map();

  constructor() {
    this.client = axios.create({
      timeout: 60000,
      headers: {
        Accept: '*/*',
      },
    });
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    });
  }

  /**
   * 패키지 검색
   */
  async searchPackages(
    query: string,
    repoUrl: string = DEFAULT_REPOS['rocky-8-baseos']
  ): Promise<PackageInfo[]> {
    try {
      const packages = await this.loadPrimaryMetadata(repoUrl);
      const results: PackageInfo[] = [];

      for (const [, pkg] of packages) {
        if (pkg.name.toLowerCase().includes(query.toLowerCase())) {
          results.push(this.packageToInfo(pkg, repoUrl));
        }
      }

      return results.slice(0, 50);
    } catch (error) {
      logger.error('YUM 패키지 검색 실패', { query, repoUrl, error });
      throw error;
    }
  }

  /**
   * 버전 목록 조회
   */
  async getVersions(
    packageName: string,
    repoUrl: string = DEFAULT_REPOS['rocky-8-baseos']
  ): Promise<string[]> {
    try {
      const packages = await this.loadPrimaryMetadata(repoUrl);
      const versions: string[] = [];

      for (const [key, pkg] of packages) {
        if (pkg.name === packageName) {
          const version = this.formatVersion(pkg.version);
          if (!versions.includes(version)) {
            versions.push(version);
          }
        }
      }

      return versions.sort((a, b) => b.localeCompare(a));
    } catch (error) {
      logger.error('YUM 버전 목록 조회 실패', { packageName, repoUrl, error });
      throw error;
    }
  }

  /**
   * 패키지 메타데이터 조회
   */
  async getPackageMetadata(
    name: string,
    version: string,
    repoUrl: string = DEFAULT_REPOS['rocky-8-baseos'],
    arch: Architecture = 'x86_64'
  ): Promise<PackageInfo> {
    try {
      const packages = await this.loadPrimaryMetadata(repoUrl);

      for (const [, pkg] of packages) {
        if (pkg.name === name && (pkg.arch === arch || pkg.arch === 'noarch')) {
          const pkgVersion = this.formatVersion(pkg.version);
          if (version === 'latest' || pkgVersion.startsWith(version)) {
            return this.packageToInfo(pkg, repoUrl);
          }
        }
      }

      throw new Error(`패키지를 찾을 수 없습니다: ${name}-${version}`);
    } catch (error) {
      logger.error('YUM 메타데이터 조회 실패', { name, version, error });
      throw error;
    }
  }

  /**
   * 패키지 다운로드
   */
  async downloadPackage(
    info: PackageInfo,
    destPath: string,
    onProgress?: (progress: DownloadProgressEvent) => void
  ): Promise<string> {
    try {
      const repoUrl = (info.metadata?.repository as string) || DEFAULT_REPOS['rocky-8-baseos'];
      const downloadUrl = info.metadata?.downloadUrl as string;

      if (!downloadUrl) {
        throw new Error(`다운로드 URL이 없습니다: ${info.name}`);
      }

      const fileName = path.basename(downloadUrl);
      const filePath = path.join(destPath, fileName);

      await fs.ensureDir(destPath);

      // 파일 다운로드
      const response = await axios({
        method: 'GET',
        url: downloadUrl,
        responseType: 'stream',
        timeout: 300000,
      });

      const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
      let downloadedBytes = 0;
      let lastBytes = 0;
      let lastTime = Date.now();
      let currentSpeed = 0;

      const writer = fs.createWriteStream(filePath);

      response.data.on('data', (chunk: Buffer) => {
        downloadedBytes += chunk.length;

        // 속도 계산 (0.3초마다)
        const now = Date.now();
        const elapsed = (now - lastTime) / 1000;
        if (elapsed >= 0.3) {
          currentSpeed = (downloadedBytes - lastBytes) / elapsed;
          lastBytes = downloadedBytes;
          lastTime = now;
        }

        if (onProgress) {
          onProgress({
            itemId: `${info.name}@${info.version}`,
            progress: totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0,
            downloadedBytes,
            totalBytes,
            speed: currentSpeed,
          });
        }
      });

      response.data.pipe(writer);

      await new Promise<void>((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      // 체크섬 검증
      if (info.metadata?.checksum?.sha256) {
        const isValid = await this.verifyChecksum(
          filePath,
          info.metadata.checksum.sha256,
          'sha256'
        );
        if (!isValid) {
          await fs.remove(filePath);
          throw new Error('체크섬 검증 실패');
        }
      }

      logger.info('YUM 패키지 다운로드 완료', {
        name: info.name,
        version: info.version,
        filePath,
      });

      return filePath;
    } catch (error) {
      logger.error('YUM 패키지 다운로드 실패', {
        name: info.name,
        version: info.version,
        error,
      });
      throw error;
    }
  }

  /**
   * 체크섬 검증
   */
  async verifyChecksum(
    filePath: string,
    expected: string,
    algorithm: 'sha256' | 'sha1' | 'md5' = 'sha256'
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash(algorithm);
      const stream = fs.createReadStream(filePath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => {
        const actual = hash.digest('hex').toLowerCase();
        resolve(actual === expected.toLowerCase());
      });
      stream.on('error', reject);
    });
  }

  /**
   * Primary 메타데이터 로드
   */
  private async loadPrimaryMetadata(
    repoUrl: string
  ): Promise<Map<string, PrimaryPackage>> {
    // 캐시 확인
    if (this.packageCache.has(repoUrl)) {
      return this.packageCache.get(repoUrl)!;
    }

    // repomd.xml 조회
    const repomdUrl = `${repoUrl}repodata/repomd.xml`;
    const repomdResponse = await this.client.get<string>(repomdUrl);
    const repomd = this.parser.parse(repomdResponse.data) as RepoMd;

    // primary.xml 위치 찾기
    const dataList = Array.isArray(repomd.repomd.data)
      ? repomd.repomd.data
      : [repomd.repomd.data];
    const primaryData = dataList.find((d) => d['@_type'] === 'primary');

    if (!primaryData) {
      throw new Error('primary.xml을 찾을 수 없습니다');
    }

    const primaryHref = primaryData.location['@_href'];
    const primaryUrl = `${repoUrl}${primaryHref}`;

    // primary.xml 다운로드 및 파싱
    const primaryResponse = await this.client.get(primaryUrl, {
      responseType: 'arraybuffer',
    });

    let primaryXml: string;
    if (primaryHref.endsWith('.gz')) {
      primaryXml = zlib.gunzipSync(primaryResponse.data).toString('utf-8');
    } else {
      primaryXml = primaryResponse.data.toString('utf-8');
    }

    const primary = this.parser.parse(primaryXml);
    const packages = new Map<string, PrimaryPackage>();

    const pkgList = primary.metadata?.package;
    if (pkgList) {
      const pkgArray = Array.isArray(pkgList) ? pkgList : [pkgList];
      for (const pkg of pkgArray) {
        const key = `${pkg.name}-${pkg.arch}`;
        packages.set(key, pkg as PrimaryPackage);
      }
    }

    // 캐시 저장
    this.packageCache.set(repoUrl, packages);

    return packages;
  }

  /**
   * 버전 형식화
   */
  private formatVersion(version: {
    '@_ver': string;
    '@_rel': string;
    '@_epoch'?: string;
  }): string {
    const epoch = version['@_epoch'];
    const ver = version['@_ver'];
    const rel = version['@_rel'];

    if (epoch && epoch !== '0') {
      return `${epoch}:${ver}-${rel}`;
    }
    return `${ver}-${rel}`;
  }

  /**
   * PrimaryPackage를 PackageInfo로 변환
   */
  private packageToInfo(pkg: PrimaryPackage, repoUrl: string): PackageInfo {
    const version = this.formatVersion(pkg.version);
    const downloadUrl = `${repoUrl}${pkg.location['@_href']}`;

    const metadata: PackageMetadata = {
      description: pkg.summary || pkg.description,
      homepage: pkg.url,
      size: pkg.size ? parseInt(pkg.size['@_package'], 10) : undefined,
      downloadUrl,
      repository: repoUrl,
      checksum: pkg.checksum
        ? {
            [pkg.checksum['@_type']]: pkg.checksum['#text'],
          }
        : undefined,
    };

    return {
      type: 'yum',
      name: pkg.name,
      version,
      arch: pkg.arch as Architecture,
      metadata,
    };
  }

  /**
   * 기본 저장소 목록 반환
   */
  getDefaultRepos(): Record<string, string> {
    return { ...DEFAULT_REPOS };
  }

  /**
   * 캐시 클리어
   */
  clearCache(): void {
    this.packageCache.clear();
  }
}

// 싱글톤 인스턴스
let yumDownloaderInstance: YumDownloader | null = null;

export function getYumDownloader(): YumDownloader {
  if (!yumDownloaderInstance) {
    yumDownloaderInstance = new YumDownloader();
  }
  return yumDownloaderInstance;
}
