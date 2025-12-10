import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  IDownloader,
  PackageInfo,
  PackageMetadata,
  DownloadProgressEvent,
  Architecture,
} from '../../types';
import logger from '../../utils/logger';
import {
  PyPIRelease,
  PyPIInfo,
  PyPIResponse,
  PyPISearchResult,
} from '../shared/pip-types';
import { compareVersions } from '../shared';
import { fetchVersionsFromSimpleApi } from '../shared/pip-simple-api';

export class PipDownloader implements IDownloader {
  readonly type = 'pip' as const;
  private client: AxiosInstance;
  private readonly baseUrl = 'https://pypi.org/pypi';

  constructor() {
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        Accept: 'application/json',
      },
    });
  }

  /**
   * 패키지 검색 (PyPI Simple API 사용)
   */
  async searchPackages(query: string): Promise<PackageInfo[]> {
    try {
      // PyPI는 공식 검색 API가 제한적이므로, 패키지명으로 직접 조회
      // 실제 검색은 pypi.org/search 웹페이지 스크래핑이 필요하지만,
      // 여기서는 단순히 패키지 존재 여부 확인
      const response = await this.client.get<PyPIResponse>(`/${query}/json`);
      const { info } = response.data;

      return [
        {
          type: 'pip',
          name: info.name,
          version: info.version,
          metadata: {
            description: info.summary,
            author: info.author,
            license: info.license,
            homepage: info.home_page,
          },
        },
      ];
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return [];
      }
      logger.error('PyPI 패키지 검색 실패', { query, error });
      throw error;
    }
  }

  /**
   * 패키지 버전 목록 조회
   */
  async getVersions(packageName: string): Promise<string[]> {
    try {
      // Simple API 우선 사용 (데이터 크기 90% 감소: ~50KB -> ~5KB)
      const simpleVersions = await fetchVersionsFromSimpleApi(packageName);
      if (simpleVersions && simpleVersions.length > 0) {
        logger.debug('Simple API로 버전 목록 조회 성공', {
          packageName,
          versionCount: simpleVersions.length,
        });
        // 버전 정렬 (최신순)
        return simpleVersions.sort((a, b) => compareVersions(b, a));
      }

      // Simple API 실패 시 JSON API 폴백
      logger.debug('JSON API로 폴백', { packageName });
      const response = await this.client.get<PyPIResponse>(
        `/${packageName}/json`
      );
      const versions = Object.keys(response.data.releases);

      // 버전 정렬 (최신순)
      return versions.sort((a, b) => {
        return compareVersions(b, a);
      });
    } catch (error) {
      logger.error('PyPI 버전 목록 조회 실패', { packageName, error });
      throw error;
    }
  }

  /**
   * 패키지 메타데이터 조회
   */
  async getPackageMetadata(name: string, version: string): Promise<PackageInfo> {
    try {
      const response = await this.client.get<PyPIResponse>(
        `/${name}/${version}/json`
      );
      const { info, urls } = response.data;

      // 다운로드 URL 선택 (wheel 우선)
      const downloadInfo = this.selectBestRelease(urls);

      const metadata: PackageMetadata = {
        description: info.summary,
        author: info.author,
        license: info.license,
        homepage: info.home_page,
        pythonVersion: info.requires_python,
        checksum: downloadInfo
          ? {
              md5: downloadInfo.md5_digest,
              sha256: downloadInfo.digests.sha256,
            }
          : undefined,
        downloadUrl: downloadInfo?.url,
        size: downloadInfo?.size,
      };

      return {
        type: 'pip',
        name: info.name,
        version: info.version,
        metadata,
      };
    } catch (error) {
      logger.error('PyPI 메타데이터 조회 실패', { name, version, error });
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
      // 메타데이터 조회하여 다운로드 URL 획득
      const packageInfo = await this.getPackageMetadata(info.name, info.version);
      const downloadUrl = packageInfo.metadata?.downloadUrl;

      if (!downloadUrl) {
        throw new Error(`다운로드 URL을 찾을 수 없습니다: ${info.name}@${info.version}`);
      }

      // 파일명 추출
      const fileName = path.basename(new URL(downloadUrl).pathname);
      const filePath = path.join(destPath, fileName);

      // 디렉토리 생성
      await fs.ensureDir(destPath);

      // 파일 다운로드
      const response = await axios({
        method: 'GET',
        url: downloadUrl,
        responseType: 'stream',
        timeout: 300000, // 5분
      });

      const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
      let downloadedBytes = 0;

      const writer = fs.createWriteStream(filePath);

      response.data.on('data', (chunk: Buffer) => {
        downloadedBytes += chunk.length;
        if (onProgress) {
          onProgress({
            itemId: `${info.name}@${info.version}`,
            progress: totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0,
            downloadedBytes,
            totalBytes,
            speed: 0, // 속도 계산은 DownloadManager에서 처리
          });
        }
      });

      response.data.pipe(writer);

      await new Promise<void>((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      // 체크섬 검증
      if (packageInfo.metadata?.checksum?.sha256) {
        const isValid = await this.verifyChecksum(
          filePath,
          packageInfo.metadata.checksum.sha256
        );
        if (!isValid) {
          await fs.remove(filePath);
          throw new Error('체크섬 검증 실패');
        }
      }

      logger.info('패키지 다운로드 완료', {
        name: info.name,
        version: info.version,
        filePath,
      });

      return filePath;
    } catch (error) {
      logger.error('PyPI 패키지 다운로드 실패', {
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
  async verifyChecksum(filePath: string, expected: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => {
        const actual = hash.digest('hex');
        resolve(actual === expected);
      });
      stream.on('error', reject);
    });
  }

  /**
   * 특정 OS/아키텍처/Python 버전에 맞는 릴리스 조회
   */
  async getReleasesForArch(
    name: string,
    version: string,
    arch?: Architecture,
    pythonVersion?: string,
    targetOS?: 'any' | 'windows' | 'macos' | 'linux'
  ): Promise<PyPIRelease[]> {
    const response = await this.client.get<PyPIResponse>(
      `/${name}/${version}/json`
    );
    let releases = response.data.urls;

    // OS별 플랫폼 태그 필터링
    if (targetOS && targetOS !== 'any') {
      const osPatterns: Record<string, string[]> = {
        windows: ['win_amd64', 'win32', 'win'],
        macos: ['macosx', 'darwin'],
        linux: ['manylinux', 'linux_x86_64', 'linux_aarch64', 'linux'],
      };

      const patterns = osPatterns[targetOS] || [];
      releases = releases.filter(
        (r) =>
          r.packagetype === 'sdist' ||
          r.filename.includes('none-any') || // 순수 Python 패키지
          patterns.some((p) => r.filename.toLowerCase().includes(p))
      );
    }

    // 아키텍처 필터링
    if (arch && arch !== 'noarch') {
      const archPatterns: Record<string, string[]> = {
        x86_64: ['x86_64', 'amd64', 'win_amd64', 'manylinux_x86_64', 'manylinux1', 'manylinux2010', 'manylinux2014'],
        amd64: ['x86_64', 'amd64', 'win_amd64'],
        arm64: ['arm64', 'aarch64', 'macosx_arm64'],
        aarch64: ['arm64', 'aarch64', 'linux_aarch64'],
        i386: ['i386', 'i686', 'win32'],
      };

      const patterns = archPatterns[arch] || [arch];
      releases = releases.filter(
        (r) =>
          r.packagetype === 'sdist' ||
          r.filename.includes('none-any') || // 순수 Python 패키지
          patterns.some((p) => r.filename.toLowerCase().includes(p))
      );
    }

    // Python 버전 필터링
    if (pythonVersion) {
      releases = releases.filter(
        (r) =>
          r.packagetype === 'sdist' ||
          r.python_version === 'py3' ||
          r.python_version.includes(pythonVersion)
      );
    }

    return releases;
  }

  /**
   * 최적의 릴리스 선택 (wheel 우선)
   */
  private selectBestRelease(releases: PyPIRelease[]): PyPIRelease | null {
    if (releases.length === 0) return null;

    // wheel 파일 우선
    const wheels = releases.filter((r) => r.packagetype === 'bdist_wheel');
    if (wheels.length > 0) {
      // 범용 wheel 우선 (py3-none-any)
      const universal = wheels.find(
        (w) =>
          w.filename.includes('py3-none-any') ||
          w.filename.includes('py2.py3-none-any')
      );
      if (universal) return universal;

      // 그 외 wheel
      return wheels[0];
    }

    // source distribution
    const sdist = releases.find((r) => r.packagetype === 'sdist');
    if (sdist) return sdist;

    return releases[0];
  }
}

// 싱글톤 인스턴스
let pipDownloaderInstance: PipDownloader | null = null;

export function getPipDownloader(): PipDownloader {
  if (!pipDownloaderInstance) {
    pipDownloaderInstance = new PipDownloader();
  }
  return pipDownloaderInstance;
}
