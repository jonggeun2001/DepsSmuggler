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

// Anaconda API 응답 타입
interface CondaSearchResult {
  name: string;
  summary: string;
  owner: string;
  full_name: string;
}

interface CondaPackageFile {
  version: string;
  basename: string;
  size: number;
  md5: string;
  sha256?: string;
  upload_time: string;
  ndownloads: number;
  attrs: {
    arch?: string;
    platform?: string;
    subdir?: string;
    build?: string;
    depends?: string[];
  };
}

interface CondaPackageInfo {
  name: string;
  summary: string;
  description: string;
  owner: string;
  license: string;
  home: string;
  dev_url?: string;
  doc_url?: string;
  files: CondaPackageFile[];
  versions: string[];
}

// 지원 채널
type CondaChannel = 'conda-forge' | 'main' | 'anaconda' | 'defaults' | string;

export class CondaDownloader implements IDownloader {
  readonly type = 'conda' as const;
  private client: AxiosInstance;
  private readonly apiUrl = 'https://api.anaconda.org';
  private readonly condaUrl = 'https://conda.anaconda.org';

  constructor() {
    this.client = axios.create({
      timeout: 30000,
      headers: {
        Accept: 'application/json',
      },
    });
  }

  /**
   * 패키지 검색
   */
  async searchPackages(
    query: string,
    channel: CondaChannel = 'conda-forge'
  ): Promise<PackageInfo[]> {
    try {
      const response = await this.client.get<CondaSearchResult[]>(
        `${this.apiUrl}/search`,
        {
          params: { q: query },
        }
      );

      // 채널 필터링
      const filtered = response.data.filter(
        (pkg) => pkg.owner === channel || channel === 'all'
      );

      return filtered.slice(0, 50).map((pkg) => ({
        type: 'conda',
        name: pkg.name,
        version: 'latest',
        metadata: {
          description: pkg.summary,
          repository: pkg.full_name,
        },
      }));
    } catch (error) {
      logger.error('Conda 패키지 검색 실패', { query, channel, error });
      throw error;
    }
  }

  /**
   * 패키지 버전 목록 조회
   */
  async getVersions(
    packageName: string,
    channel: CondaChannel = 'conda-forge'
  ): Promise<string[]> {
    try {
      const response = await this.client.get<CondaPackageInfo>(
        `${this.apiUrl}/package/${channel}/${packageName}`
      );

      // 버전 정렬 (최신순)
      return response.data.versions.sort((a, b) =>
        this.compareVersions(b, a)
      );
    } catch (error) {
      logger.error('Conda 버전 목록 조회 실패', { packageName, channel, error });
      throw error;
    }
  }

  /**
   * 패키지 메타데이터 조회
   */
  async getPackageMetadata(
    name: string,
    version: string,
    channel: CondaChannel = 'conda-forge',
    arch?: Architecture
  ): Promise<PackageInfo> {
    try {
      const response = await this.client.get<CondaPackageInfo>(
        `${this.apiUrl}/package/${channel}/${name}`
      );
      const pkgInfo = response.data;

      // 버전과 아키텍처에 맞는 파일 찾기
      const file = this.selectBestFile(pkgInfo.files, version, arch);

      const metadata: PackageMetadata = {
        description: pkgInfo.summary || pkgInfo.description,
        license: pkgInfo.license,
        homepage: pkgInfo.home,
        repository: `${channel}/${name}`,
        size: file?.size,
        checksum: file
          ? {
              md5: file.md5,
              sha256: file.sha256,
            }
          : undefined,
        downloadUrl: file
          ? `${this.condaUrl}/${channel}/${file.attrs.subdir || 'noarch'}/${file.basename}`
          : undefined,
      };

      return {
        type: 'conda',
        name: pkgInfo.name,
        version: file?.version || version,
        arch: this.mapArch(file?.attrs.subdir),
        metadata,
      };
    } catch (error) {
      logger.error('Conda 메타데이터 조회 실패', { name, version, channel, error });
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
      const channel = (info.metadata?.repository as string)?.split('/')[0] || 'conda-forge';

      // 메타데이터 조회
      const packageInfo = await this.getPackageMetadata(
        info.name,
        info.version,
        channel,
        info.arch
      );
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
        timeout: 300000,
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
            speed: 0,
          });
        }
      });

      response.data.pipe(writer);

      await new Promise<void>((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      // 체크섬 검증
      if (packageInfo.metadata?.checksum?.md5) {
        const isValid = await this.verifyChecksum(
          filePath,
          packageInfo.metadata.checksum.md5,
          'md5'
        );
        if (!isValid) {
          await fs.remove(filePath);
          throw new Error('체크섬 검증 실패');
        }
      }

      logger.info('Conda 패키지 다운로드 완료', {
        name: info.name,
        version: info.version,
        filePath,
      });

      return filePath;
    } catch (error) {
      logger.error('Conda 패키지 다운로드 실패', {
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
    algorithm: 'md5' | 'sha256' = 'md5'
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash(algorithm);
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
   * 특정 버전/아키텍처에 맞는 최적 파일 선택
   */
  private selectBestFile(
    files: CondaPackageFile[],
    version: string,
    arch?: Architecture
  ): CondaPackageFile | null {
    if (files.length === 0) return null;

    // 버전 필터링
    let filtered = files.filter((f) => f.version === version);
    if (filtered.length === 0) {
      // 버전이 없으면 최신 버전 사용
      filtered = files;
    }

    // 아키텍처 필터링
    if (arch) {
      const archMap: Record<string, string[]> = {
        x86_64: ['linux-64', 'osx-64', 'win-64'],
        amd64: ['linux-64', 'osx-64', 'win-64'],
        arm64: ['linux-aarch64', 'osx-arm64'],
        aarch64: ['linux-aarch64', 'osx-arm64'],
        noarch: ['noarch'],
        all: ['noarch'],
      };

      const subdirs = archMap[arch] || [arch];
      const archFiltered = filtered.filter(
        (f) => subdirs.includes(f.attrs.subdir || '') || f.attrs.subdir === 'noarch'
      );
      if (archFiltered.length > 0) {
        filtered = archFiltered;
      }
    }

    // noarch 우선, 없으면 첫 번째
    const noarch = filtered.find((f) => f.attrs.subdir === 'noarch');
    if (noarch) return noarch;

    // 최신 업로드 파일 선택
    return filtered.sort(
      (a, b) =>
        new Date(b.upload_time).getTime() - new Date(a.upload_time).getTime()
    )[0];
  }

  /**
   * subdir을 Architecture로 매핑
   */
  private mapArch(subdir?: string): Architecture | undefined {
    if (!subdir) return undefined;

    const mapping: Record<string, Architecture> = {
      'linux-64': 'x86_64',
      'osx-64': 'x86_64',
      'win-64': 'x86_64',
      'linux-aarch64': 'aarch64',
      'osx-arm64': 'arm64',
      noarch: 'noarch',
    };

    return mapping[subdir];
  }

  /**
   * 버전 비교
   */
  private compareVersions(a: string, b: string): number {
    const partsA = a.split('.').map((p) => parseInt(p, 10) || 0);
    const partsB = b.split('.').map((p) => parseInt(p, 10) || 0);

    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const numA = partsA[i] || 0;
      const numB = partsB[i] || 0;
      if (numA !== numB) return numA - numB;
    }
    return 0;
  }

  /**
   * 채널별 패키지 파일 목록 조회
   */
  async getPackageFiles(
    name: string,
    channel: CondaChannel = 'conda-forge'
  ): Promise<CondaPackageFile[]> {
    const response = await this.client.get<CondaPackageInfo>(
      `${this.apiUrl}/package/${channel}/${name}`
    );
    return response.data.files;
  }
}

// 싱글톤 인스턴스
let condaDownloaderInstance: CondaDownloader | null = null;

export function getCondaDownloader(): CondaDownloader {
  if (!condaDownloaderInstance) {
    condaDownloaderInstance = new CondaDownloader();
  }
  return condaDownloaderInstance;
}
