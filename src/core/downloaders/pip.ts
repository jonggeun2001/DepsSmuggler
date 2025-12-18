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
import { sanitizePath } from '../shared/path-utils';
import type { PipTargetPlatform } from '../../types/pip-target-platform';
import {
  fetchPackageFiles,
  extractVersionFromFilename,
  findLatestVersion as findLatestVersionFromSimpleApi,
  SimpleApiPackageFile,
} from '../resolver/pip-simple-api';

export class PipDownloader implements IDownloader {
  readonly type = 'pip' as const;
  private client: AxiosInstance;
  private readonly baseUrl = 'https://pypi.org/pypi';
  private pipTargetPlatform: PipTargetPlatform | null = null;

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
   * pip 타겟 플랫폼 설정
   */
  setPipTargetPlatform(platform: PipTargetPlatform | null): void {
    this.pipTargetPlatform = platform;
  }

  /**
   * 패키지 검색 (PyPI Simple API 사용)
   */
  async searchPackages(query: string, indexUrl?: string): Promise<PackageInfo[]> {
    try {
      if (indexUrl) {
        // Simple API 사용 (커스텀 인덱스)
        const files = await fetchPackageFiles(indexUrl, query);
        if (files.length === 0) {
          return [];
        }

        // 최신 버전 찾기
        const latestVersion = findLatestVersionFromSimpleApi(files);
        if (!latestVersion) {
          return [];
        }

        return [
          {
            type: 'pip',
            name: query,
            version: latestVersion,
            metadata: {
              description: `커스텀 인덱스: ${new URL(indexUrl).hostname}`,
              indexUrl,
            },
          },
        ];
      } else {
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
      }
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return [];
      }
      logger.error('PyPI 패키지 검색 실패', { query, indexUrl, error });
      throw error;
    }
  }

  /**
   * 패키지 버전 목록 조회
   */
  async getVersions(packageName: string, indexUrl?: string): Promise<string[]> {
    try {
      if (indexUrl) {
        // Simple API 사용 (커스텀 인덱스)
        const files = await fetchPackageFiles(indexUrl, packageName);
        if (files.length === 0) {
          return [];
        }

        // 파일명에서 버전 추출
        const versions = new Set<string>();
        for (const file of files) {
          try {
            const version = extractVersionFromFilename(file.filename);
            if (!file.yanked) {
              versions.add(version);
            }
          } catch {
            // 버전 추출 실패 시 무시
          }
        }

        // 내림차순 정렬
        return Array.from(versions).sort((a, b) => compareVersions(b, a));
      } else {
        // PyPI JSON API 사용 (기존 로직)
        const response = await this.client.get<PyPIResponse>(
          `/${packageName}/json`
        );
        const releases = response.data.releases || {};

        const versions = Object.keys(releases)
          .filter((version) => releases[version].length > 0)
          .sort((a, b) => compareVersions(b, a));

        return versions;
      }
    } catch (error) {
      logger.error('PyPI 버전 목록 조회 실패', { packageName, indexUrl, error });
      throw error;
    }
  }

  /**
   * 패키지 메타데이터 조회
   */
  async getPackageMetadata(name: string, version: string, indexUrl?: string): Promise<PackageInfo> {
    try {
      if (indexUrl) {
        // Simple API 사용 (커스텀 인덱스)
        const files = await fetchPackageFiles(indexUrl, name);
        const targetFiles = files.filter(
          (f) => extractVersionFromFilename(f.filename) === version
        );

        if (targetFiles.length === 0) {
          throw new Error(`패키지를 찾을 수 없습니다: ${name}@${version}`);
        }

        // 최적의 wheel 선택 (플랫폼 호환성 고려)
        const selectedFile = this.selectBestReleaseFromSimpleApi(targetFiles);
        if (!selectedFile) {
          throw new Error(`호환되는 패키지를 찾을 수 없습니다: ${name}@${version}`);
        }

        const metadata: PackageMetadata = {
          description: `커스텀 인덱스: ${new URL(indexUrl).hostname}`,
          checksum: selectedFile.hash
            ? {
                sha256: selectedFile.hash.digest,
              }
            : undefined,
          downloadUrl: selectedFile.url,
          indexUrl,
        };

        return {
          type: 'pip',
          name,
          version,
          metadata,
        };
      } else {
        // PyPI JSON API 사용 (기존 로직)
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
      }
    } catch (error) {
      logger.error('PyPI 메타데이터 조회 실패', { name, version, indexUrl, error });
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
      // indexUrl 추출 (metadata에 있을 수 있음)
      const indexUrl = info.metadata?.indexUrl as string | undefined;

      // 메타데이터 조회하여 다운로드 URL 획득
      const packageInfo = await this.getPackageMetadata(info.name, info.version, indexUrl);
      const downloadUrl = packageInfo.metadata?.downloadUrl;

      if (!downloadUrl) {
        throw new Error(`다운로드 URL을 찾을 수 없습니다: ${info.name}@${info.version}`);
      }

      // 파일명 추출 (경로 조작 방지를 위해 정규화)
      const rawFileName = path.basename(new URL(downloadUrl).pathname);
      const fileName = sanitizePath(rawFileName, /[^a-zA-Z0-9._\-]/g);
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
        indexUrl,
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
        const actual = hash.digest('hex').toLowerCase();
        resolve(actual === expected.toLowerCase());
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

    const wheels = releases.filter((r) => r.packagetype === 'bdist_wheel');
    const sdist = releases.find((r) => r.packagetype === 'sdist');

    // 타겟 플랫폼이 설정되지 않은 경우 기본 동작
    if (!this.pipTargetPlatform) {
      if (wheels.length > 0) {
        // 범용 wheel 우선 (py3-none-any)
        const universal = wheels.find(
          (w) =>
            w.filename.includes('py3-none-any') ||
            w.filename.includes('py2.py3-none-any')
        );
        if (universal) return universal;
        return wheels[0];
      }
      return sdist || releases[0];
    }

    // 호환되는 wheel 필터링
    const compatibleWheels = wheels.filter(w => this.isWheelCompatible(w));

    if (compatibleWheels.length === 0) {
      return sdist || null;
    }

    // 정확히 일치하는 버전 찾기
    const { os, glibcVersion, macosVersion } = this.pipTargetPlatform;

    if (os === 'linux' && glibcVersion) {
      const exactMatch = compatibleWheels.find(w => {
        const tags = this.extractPlatformTags(w.filename);
        return tags.some(tag => {
          const match = tag.match(/^manylinux[_\d]*_(\d+)_(\d+)_/);
          if (match) {
            return `${match[1]}.${match[2]}` === glibcVersion;
          }
          return false;
        });
      });
      if (exactMatch) return exactMatch;
    }

    if (os === 'macos' && macosVersion) {
      const exactMatch = compatibleWheels.find(w => {
        const tags = this.extractPlatformTags(w.filename);
        return tags.some(tag => {
          const match = tag.match(/^macosx_(\d+)_(\d+)_/);
          if (match) {
            return `${match[1]}.${match[2]}` === macosVersion.replace('.', '_');
          }
          return false;
        });
      });
      if (exactMatch) return exactMatch;
    }

    return compatibleWheels[0];
  }

  /**
   * Simple API 파일 목록에서 최적의 릴리스 선택
   */
  private selectBestReleaseFromSimpleApi(
    files: SimpleApiPackageFile[]
  ): SimpleApiPackageFile | null {
    if (!this.pipTargetPlatform) {
      // 플랫폼 정보가 없으면 첫 번째 wheel 반환
      return files.find((f) => f.filename.endsWith('.whl')) || files[0];
    }

    // wheel 파일만 필터링
    const wheels = files.filter((f) => f.filename.endsWith('.whl'));

    for (const wheel of wheels) {
      // wheel 파일명 파싱
      const wheelMatch = /^[^-]+-[^-]+-([^-]+)-([^-]+)-(.+)\.whl$/.exec(wheel.filename);
      if (!wheelMatch) continue;

      const pythonTag = wheelMatch[1];
      const abiTag = wheelMatch[2];
      const platformTag = wheelMatch[3].toLowerCase();

      // Python 버전 체크
      if (this.pipTargetPlatform.linuxDistro) {
        const pyVersion = '311'; // 기본값 (설정에서 가져와야 함)
        if (!pythonTag.includes(pyVersion) && !pythonTag.includes('py3') && !pythonTag.includes('py2.py3')) {
          continue;
        }
      }

      // 플랫폼 호환성 체크
      const targetOs = this.pipTargetPlatform.os.toLowerCase();
      const targetArch = this.pipTargetPlatform.arch.toLowerCase();

      if (platformTag === 'any') {
        return wheel;
      }

      // Linux
      if (targetOs === 'linux') {
        if (platformTag.includes('manylinux') || platformTag.includes('linux')) {
          if (targetArch === 'x86_64' && platformTag.includes('x86_64')) {
            return wheel;
          }
          if (targetArch === 'aarch64' && platformTag.includes('aarch64')) {
            return wheel;
          }
        }
      }

      // Windows
      if (targetOs === 'windows') {
        if (platformTag.includes('win')) {
          if (targetArch === 'x86_64' && (platformTag.includes('amd64') || platformTag.includes('win_amd64'))) {
            return wheel;
          }
        }
      }

      // macOS
      if (targetOs === 'macos') {
        if (platformTag.includes('macosx')) {
          if (targetArch === 'x86_64' && platformTag.includes('x86_64')) {
            return wheel;
          }
          if (targetArch === 'arm64' && platformTag.includes('arm64')) {
            return wheel;
          }
        }
      }
    }

    // 호환되는 wheel이 없으면 첫 번째 wheel 또는 source dist 반환
    return wheels[0] || files.find((f) => f.filename.endsWith('.tar.gz')) || files[0];
  }

  /**
   * wheel 파일명에서 플랫폼 태그 추출
   */
  private extractPlatformTags(filename: string): string[] {
    const parts = filename.replace('.whl', '').split('-');
    if (parts.length < 5) return [];
    const platformPart = parts[parts.length - 1];
    return platformPart.split('.');
  }

  /**
   * glibc 버전 비교
   */
  private compareGlibcVersions(wheelGlibc: string, targetGlibc: string): boolean {
    const parseVersion = (v: string): number[] => {
      return v.split('.').map(n => parseInt(n, 10));
    };

    const wheel = parseVersion(wheelGlibc);
    const target = parseVersion(targetGlibc);

    for (let i = 0; i < Math.max(wheel.length, target.length); i++) {
      const w = wheel[i] || 0;
      const t = target[i] || 0;
      if (w < t) return true;
      if (w > t) return false;
    }
    return true;
  }

  /**
   * macOS 버전 비교
   */
  private compareMacOSVersions(wheelMacOS: string, targetMacOS: string): boolean {
    const parseVersion = (v: string): number[] => {
      return v.split('_').map(n => parseInt(n, 10));
    };

    const wheel = parseVersion(wheelMacOS);
    const target = parseVersion(targetMacOS);

    for (let i = 0; i < Math.max(wheel.length, target.length); i++) {
      const w = wheel[i] || 0;
      const t = target[i] || 0;
      if (w < t) return true;
      if (w > t) return false;
    }
    return true;
  }

  /**
   * wheel이 타겟 플랫폼과 호환되는지 확인
   */
  private isWheelCompatible(release: PyPIRelease): boolean {
    if (!this.pipTargetPlatform) {
      return true;
    }

    if (release.packagetype !== 'bdist_wheel') {
      return true;
    }

    const platformTags = this.extractPlatformTags(release.filename);
    if (platformTags.length === 0) return false;

    const { os, arch, glibcVersion, macosVersion } = this.pipTargetPlatform;

    if (platformTags.some(tag => tag === 'any')) {
      return true;
    }

    const normalizeArch = (a: string): string => {
      if (a === 'x86_64' || a === 'amd64') return 'x86_64';
      if (a === 'aarch64' || a === 'arm64') return 'aarch64';
      return a;
    };

    const targetArch = normalizeArch(arch);

    for (const tag of platformTags) {
      if (os === 'linux') {
        const manylinuxMatch = tag.match(/^manylinux[_\d]*_(\d+)_(\d+)_(.+)$/);
        if (manylinuxMatch) {
          const wheelGlibc = `${manylinuxMatch[1]}.${manylinuxMatch[2]}`;
          const wheelArch = normalizeArch(manylinuxMatch[3]);

          if (wheelArch !== targetArch) continue;

          if (glibcVersion && !this.compareGlibcVersions(wheelGlibc, glibcVersion)) {
            continue;
          }

          return true;
        }

        const legacyMatch = tag.match(/^(manylinux\d+)_(.+)$/);
        if (legacyMatch) {
          const wheelArch = normalizeArch(legacyMatch[2]);
          if (wheelArch !== targetArch) continue;

          const legacyGlibcMap: Record<string, string> = {
            'manylinux1': '2.5',
            'manylinux2010': '2.12',
            'manylinux2014': '2.17',
          };

          const wheelGlibc = legacyGlibcMap[legacyMatch[1]];
          if (wheelGlibc && glibcVersion && !this.compareGlibcVersions(wheelGlibc, glibcVersion)) {
            continue;
          }

          return true;
        }

        const linuxMatch = tag.match(/^linux_(.+)$/);
        if (linuxMatch) {
          const wheelArch = normalizeArch(linuxMatch[1]);
          return wheelArch === targetArch;
        }
      }

      if (os === 'macos') {
        const macosMatch = tag.match(/^macosx_(\d+)_(\d+)_(.+)$/);
        if (macosMatch) {
          const wheelMacOS = `${macosMatch[1]}_${macosMatch[2]}`;
          const wheelArch = normalizeArch(macosMatch[3]);

          if (wheelArch !== targetArch) continue;

          if (macosVersion && !this.compareMacOSVersions(wheelMacOS, macosVersion.replace('.', '_'))) {
            continue;
          }

          return true;
        }
      }

      if (os === 'windows') {
        if (tag === 'win_amd64' && (arch === 'x86_64' || arch === 'amd64')) return true;
        if (tag === 'win32' && arch === 'i386') return true;
        if (tag === 'win_arm64' && (arch === 'arm64' || arch === 'aarch64')) return true;
      }
    }

    return false;
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
