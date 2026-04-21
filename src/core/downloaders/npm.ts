/**
 * npm 패키지 다운로더
 * npm Registry API를 사용하여 패키지 검색, 조회, 다운로드 수행
 *
 * 버전 해결 로직은 NpmVersionResolver에 위임
 */

import * as crypto from 'crypto';
import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs-extra';
import * as ssri from 'ssri';
import {
  PackageInfo,
  IDownloader,
  DownloadProgressEvent,
} from '../../types';
import { BaseLanguageDownloader } from './lang-shared/base-language-downloader';
import logger from '../../utils/logger';
import { NPM_CONSTANTS } from '../constants/npm';
import { clearNpmCache } from '../shared/npm-cache';
import {
  NpmPackageVersion,
  NpmSearchResponse,
  NpmSearchResult,
} from '../shared/npm-types';
import { NpmVersionResolver } from '../shared/npm-version-resolver';

/**
 * npm 다운로더 클래스
 */
export class NpmDownloader extends BaseLanguageDownloader implements IDownloader {
  readonly type = 'npm' as const;
  private client: AxiosInstance;
  private readonly registryUrl: string;
  private readonly searchUrl: string;
  private versionResolver: NpmVersionResolver;

  constructor(
    registryUrl = NPM_CONSTANTS.DEFAULT_REGISTRY_URL,
    searchUrl = NPM_CONSTANTS.DEFAULT_SEARCH_URL
  ) {
    super();
    this.registryUrl = registryUrl;
    this.searchUrl = searchUrl;
    this.client = axios.create({
      timeout: NPM_CONSTANTS.API_TIMEOUT_MS,
      headers: {
        Accept: 'application/json',
      },
    });
    this.versionResolver = new NpmVersionResolver(registryUrl);
  }

  /**
   * 패키지 검색
   */
  async searchPackages(query: string, size = 20): Promise<PackageInfo[]> {
    try {
      const response = await this.client.get<NpmSearchResponse>(this.searchUrl, {
        params: {
          text: query,
          size,
        },
      });

      return response.data.objects.map((obj: NpmSearchResult) => ({
        type: 'npm',
        name: obj.package.name,
        version: obj.package.version,
        metadata: {
          description: obj.package.description,
          author: obj.package.author?.name,
          homepage: obj.package.links?.homepage,
        },
      }));
    } catch (error) {
      logger.error('npm 패키지 검색 실패', { query, error });
      throw error;
    }
  }

  /**
   * 패키지 버전 목록 조회
   */
  async getVersions(packageName: string): Promise<string[]> {
    // NpmVersionResolver에 위임
    return this.versionResolver.getVersions(packageName);
  }

  /**
   * 패키지 메타데이터 조회
   */
  async getPackageMetadata(name: string, version: string): Promise<PackageInfo> {
    try {
      const packument = await this.versionResolver.fetchPackument(name);
      const resolvedVersion = this.versionResolver.resolveVersion(version, packument);

      if (!resolvedVersion || !packument.versions[resolvedVersion]) {
        throw new Error(`버전을 찾을 수 없습니다: ${name}@${version}`);
      }

      const pkgVersion = packument.versions[resolvedVersion];

      return {
        type: 'npm',
        name: pkgVersion.name,
        version: pkgVersion.version,
        metadata: {
          description: pkgVersion.description,
          author: pkgVersion.author?.name || (typeof pkgVersion.author === 'string' ? pkgVersion.author : undefined),
          license: pkgVersion.license,
          homepage: pkgVersion.homepage,
          downloadUrl: pkgVersion.dist.tarball,
          size: pkgVersion.dist.unpackedSize,
          checksum: {
            sha1: pkgVersion.dist.shasum,
            sha512: pkgVersion.dist.integrity,
          },
        },
      };
    } catch (error) {
      logger.error('npm 메타데이터 조회 실패', { name, version, error });
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
      const packageInfo = await this.getPackageMetadata(info.name, info.version);
      const downloadUrl = packageInfo.metadata?.downloadUrl;

      if (!downloadUrl) {
        throw new Error(`다운로드 URL을 찾을 수 없습니다: ${info.name}@${info.version}`);
      }

      const expectedIntegrity = packageInfo.metadata?.checksum?.sha512;
      const expectedSha1 = packageInfo.metadata?.checksum?.sha1;
      const filePath = await this.downloadArtifactFile(
        destPath,
        {
          downloadUrl,
          itemId: `${info.name}@${info.version}`,
          timeoutMs: NPM_CONSTANTS.DOWNLOAD_TIMEOUT_MS,
          verifyFile: expectedIntegrity
            ? (pathToVerify) => this.verifyIntegrity(pathToVerify, expectedIntegrity)
            : expectedSha1
              ? (pathToVerify) => this.verifyShasum(pathToVerify, expectedSha1)
              : undefined,
          verificationFailureMessage: expectedIntegrity
            ? '무결성 검증 실패 (integrity)'
            : expectedSha1
              ? '체크섬 검증 실패 (sha1)'
              : undefined,
        },
        onProgress
      );

      logger.info('npm 패키지 다운로드 완료', {
        name: info.name,
        version: info.version,
        filePath,
      });

      return filePath;
    } catch (error) {
      logger.error('npm 패키지 다운로드 실패', {
        name: info.name,
        version: info.version,
        error,
      });
      throw error;
    }
  }

  /**
   * tarball URL 직접 다운로드
   */
  async downloadTarball(
    tarballUrl: string,
    destPath: string,
    integrity?: string,
    onProgress?: (progress: DownloadProgressEvent) => void
  ): Promise<string> {
    try {
      return await this.downloadArtifactFile(
        destPath,
        {
          downloadUrl: tarballUrl,
          itemId: tarballUrl,
          timeoutMs: NPM_CONSTANTS.DOWNLOAD_TIMEOUT_MS,
          verifyFile: integrity
            ? (pathToVerify) => this.verifyIntegrity(pathToVerify, integrity)
            : undefined,
          verificationFailureMessage: integrity ? '무결성 검증 실패' : undefined,
        },
        onProgress
      );
    } catch (error) {
      logger.error('tarball 다운로드 실패', { tarballUrl, error });
      throw error;
    }
  }

  /**
   * integrity 검증 (sha512)
   */
  async verifyIntegrity(filePath: string, expectedIntegrity: string): Promise<boolean> {
    try {
      const fileBuffer = await fs.readFile(filePath);
      return ssri.checkData(fileBuffer, expectedIntegrity) !== false;
    } catch {
      return false;
    }
  }

  /**
   * shasum 검증 (sha1)
   */
  async verifyShasum(filePath: string, expected: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha1');
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
   * 특정 패키지 버전 정보 조회
   */
  async getPackageVersion(name: string, version: string): Promise<NpmPackageVersion | null> {
    // NpmVersionResolver에 위임
    return this.versionResolver.getPackageInfo(name, version);
  }

  /**
   * dist-tags 조회
   */
  async getDistTags(packageName: string): Promise<Record<string, string>> {
    const packument = await this.versionResolver.fetchPackument(packageName);
    return packument['dist-tags'];
  }

  /**
   * 캐시 초기화
   */
  clearCache(): void {
    // 공유 캐시 모듈 초기화
    clearNpmCache();
    // 버전 리졸버 캐시도 초기화
    this.versionResolver.clearCache();
  }
}

// 싱글톤 인스턴스
let npmDownloaderInstance: NpmDownloader | null = null;

export function getNpmDownloader(): NpmDownloader {
  if (!npmDownloaderInstance) {
    npmDownloaderInstance = new NpmDownloader();
  }
  return npmDownloaderInstance;
}

export { npmDownloaderInstance };
