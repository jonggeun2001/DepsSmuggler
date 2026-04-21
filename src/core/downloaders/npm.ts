/**
 * npm 패키지 다운로더
 * npm Registry API를 사용하여 패키지 검색, 조회, 다운로드 수행
 *
 * 버전 해결 로직은 NpmVersionResolver에 위임
 */

import * as crypto from 'crypto';
import * as path from 'path';
import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs-extra';
import * as ssri from 'ssri';
import {
  PackageInfo,
  IDownloader,
  DownloadProgressEvent,
} from '../../types';
import logger from '../../utils/logger';
import { NPM_CONSTANTS } from '../constants/npm';
import { clearNpmCache } from '../shared/npm-cache';
import {
  NpmPackageVersion,
  NpmSearchResponse,
  NpmSearchResult,
} from '../shared/npm-types';
import { NpmVersionResolver } from '../shared/npm-version-resolver';
import { sanitizePath } from '../shared/path-utils';

/**
 * npm 다운로더 클래스
 */
export class NpmDownloader implements IDownloader {
  readonly type = 'npm' as const;
  private client: AxiosInstance;
  private readonly registryUrl: string;
  private readonly searchUrl: string;
  private versionResolver: NpmVersionResolver;

  constructor(
    registryUrl = NPM_CONSTANTS.DEFAULT_REGISTRY_URL,
    searchUrl = NPM_CONSTANTS.DEFAULT_SEARCH_URL
  ) {
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
      // 메타데이터에서 다운로드 URL 획득
      const packageInfo = await this.getPackageMetadata(info.name, info.version);
      const downloadUrl = packageInfo.metadata?.downloadUrl;

      if (!downloadUrl) {
        throw new Error(`다운로드 URL을 찾을 수 없습니다: ${info.name}@${info.version}`);
      }

      // 파일명 추출 (경로 조작 방지를 위해 정규화)
      const rawFileName = path.basename(new URL(downloadUrl).pathname);
      const fileName = sanitizePath(rawFileName, /[^a-zA-Z0-9._-]/g);
      const filePath = path.join(destPath, fileName);

      // 디렉토리 생성
      await fs.ensureDir(destPath);

      // 파일 다운로드
      const response = await axios({
        method: 'GET',
        url: downloadUrl,
        responseType: 'stream',
        timeout: NPM_CONSTANTS.DOWNLOAD_TIMEOUT_MS,
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
      const expectedIntegrity = packageInfo.metadata?.checksum?.sha512;
      const expectedSha1 = packageInfo.metadata?.checksum?.sha1;

      if (expectedIntegrity) {
        const isValid = await this.verifyIntegrity(filePath, expectedIntegrity);
        if (!isValid) {
          await fs.remove(filePath);
          throw new Error('무결성 검증 실패 (integrity)');
        }
      } else if (expectedSha1) {
        const isValid = await this.verifyShasum(filePath, expectedSha1);
        if (!isValid) {
          await fs.remove(filePath);
          throw new Error('체크섬 검증 실패 (sha1)');
        }
      }

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
      // 파일명 추출 (경로 조작 방지를 위해 정규화)
      const rawFileName = path.basename(new URL(tarballUrl).pathname);
      const fileName = sanitizePath(rawFileName, /[^a-zA-Z0-9._-]/g);
      const filePath = path.join(destPath, fileName);

      await fs.ensureDir(destPath);

      const response = await axios({
        method: 'GET',
        url: tarballUrl,
        responseType: 'stream',
        timeout: NPM_CONSTANTS.DOWNLOAD_TIMEOUT_MS,
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
            itemId: tarballUrl,
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

      // integrity 검증
      if (integrity) {
        const isValid = await this.verifyIntegrity(filePath, integrity);
        if (!isValid) {
          await fs.remove(filePath);
          throw new Error('무결성 검증 실패');
        }
      }

      return filePath;
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
