import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  IDownloader,
  PackageInfo,
  PackageMetadata,
  DownloadProgressEvent,
} from '../../types';
import logger from '../../utils/logger';

// Maven Central Search API 응답 타입
interface MavenSearchResponse {
  response: {
    numFound: number;
    docs: MavenArtifact[];
  };
}

interface MavenArtifact {
  id: string;
  g: string; // groupId
  a: string; // artifactId
  v: string; // version
  p?: string; // packaging (jar, war, pom, etc.)
  timestamp?: number;
  ec?: string[]; // extensions/classifiers
  latestVersion?: string;
  repositoryId?: string;
}

// 아티팩트 타입
type ArtifactType = 'jar' | 'pom' | 'sources' | 'javadoc' | 'war' | 'ear';

export class MavenDownloader implements IDownloader {
  readonly type = 'maven' as const;
  private client: AxiosInstance;
  private readonly searchUrl = 'https://search.maven.org/solrsearch/select';
  private readonly repoUrl = 'https://repo1.maven.org/maven2';

  constructor() {
    this.client = axios.create({
      timeout: 30000,
      headers: {
        Accept: 'application/json',
      },
    });
  }

  /**
   * 아티팩트 검색
   */
  async searchPackages(query: string): Promise<PackageInfo[]> {
    try {
      const response = await this.client.get<MavenSearchResponse>(this.searchUrl, {
        params: {
          q: query,
          rows: 50,
          wt: 'json',
        },
      });

      return response.data.response.docs.map((artifact) => ({
        type: 'maven',
        name: `${artifact.g}:${artifact.a}`,
        version: artifact.latestVersion || artifact.v,
        metadata: {
          groupId: artifact.g,
          artifactId: artifact.a,
        },
      }));
    } catch (error) {
      logger.error('Maven 아티팩트 검색 실패', { query, error });
      throw error;
    }
  }

  /**
   * 아티팩트 버전 목록 조회
   */
  async getVersions(packageName: string): Promise<string[]> {
    try {
      // packageName: "groupId:artifactId" 형식
      const [groupId, artifactId] = packageName.split(':');

      const response = await this.client.get<MavenSearchResponse>(this.searchUrl, {
        params: {
          q: `g:"${groupId}" AND a:"${artifactId}"`,
          core: 'gav',
          rows: 100,
          wt: 'json',
        },
      });

      const versions = response.data.response.docs.map((doc) => doc.v);

      // 버전 정렬 (최신순)
      return versions.sort((a, b) => this.compareVersions(b, a));
    } catch (error) {
      logger.error('Maven 버전 목록 조회 실패', { packageName, error });
      throw error;
    }
  }

  /**
   * 아티팩트 메타데이터 조회
   */
  async getPackageMetadata(name: string, version: string): Promise<PackageInfo> {
    try {
      const [groupId, artifactId] = name.split(':');

      const response = await this.client.get<MavenSearchResponse>(this.searchUrl, {
        params: {
          q: `g:"${groupId}" AND a:"${artifactId}" AND v:"${version}"`,
          rows: 1,
          wt: 'json',
        },
      });

      const artifact = response.data.response.docs[0];
      const downloadUrl = this.buildDownloadUrl(groupId, artifactId, version, 'jar');
      const sha1Url = downloadUrl + '.sha1';

      // SHA-1 체크섬 조회
      let sha1: string | undefined;
      try {
        const sha1Response = await this.client.get<string>(sha1Url);
        sha1 = sha1Response.data.trim().split(' ')[0];
      } catch {
        // 체크섬 없을 수 있음
      }

      const metadata: PackageMetadata = {
        groupId,
        artifactId,
        downloadUrl,
        checksum: sha1 ? { sha1 } : undefined,
      };

      return {
        type: 'maven',
        name: `${groupId}:${artifactId}`,
        version: artifact?.v || version,
        metadata,
      };
    } catch (error) {
      logger.error('Maven 메타데이터 조회 실패', { name, version, error });
      throw error;
    }
  }

  /**
   * 아티팩트 다운로드
   */
  async downloadPackage(
    info: PackageInfo,
    destPath: string,
    onProgress?: (progress: DownloadProgressEvent) => void
  ): Promise<string> {
    const groupId = info.metadata?.groupId as string;
    const artifactId = info.metadata?.artifactId as string;

    if (!groupId || !artifactId) {
      const [g, a] = info.name.split(':');
      return this.downloadArtifact(g, a, info.version, destPath, 'jar', onProgress);
    }

    return this.downloadArtifact(groupId, artifactId, info.version, destPath, 'jar', onProgress);
  }

  /**
   * 특정 타입의 아티팩트 다운로드
   */
  async downloadArtifact(
    groupId: string,
    artifactId: string,
    version: string,
    destPath: string,
    artifactType: ArtifactType = 'jar',
    onProgress?: (progress: DownloadProgressEvent) => void
  ): Promise<string> {
    try {
      const downloadUrl = this.buildDownloadUrl(groupId, artifactId, version, artifactType);
      const fileName = this.buildFileName(artifactId, version, artifactType);
      const filePath = path.join(destPath, fileName);

      // 디렉토리 생성
      await fs.ensureDir(destPath);

      // SHA-1 체크섬 조회
      let expectedSha1: string | undefined;
      try {
        const sha1Response = await this.client.get<string>(downloadUrl + '.sha1');
        expectedSha1 = sha1Response.data.trim().split(' ')[0];
      } catch {
        // 체크섬 없을 수 있음
      }

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
            itemId: `${groupId}:${artifactId}@${version}`,
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
      if (expectedSha1) {
        const isValid = await this.verifyChecksum(filePath, expectedSha1);
        if (!isValid) {
          await fs.remove(filePath);
          throw new Error('체크섬 검증 실패');
        }
      }

      logger.info('Maven 아티팩트 다운로드 완료', {
        groupId,
        artifactId,
        version,
        artifactType,
        filePath,
      });

      return filePath;
    } catch (error) {
      logger.error('Maven 아티팩트 다운로드 실패', {
        groupId,
        artifactId,
        version,
        artifactType,
        error,
      });
      throw error;
    }
  }

  /**
   * POM 파일 다운로드
   */
  async downloadPom(
    groupId: string,
    artifactId: string,
    version: string,
    destPath: string
  ): Promise<string> {
    return this.downloadArtifact(groupId, artifactId, version, destPath, 'pom');
  }

  /**
   * Sources JAR 다운로드
   */
  async downloadSources(
    groupId: string,
    artifactId: string,
    version: string,
    destPath: string
  ): Promise<string> {
    return this.downloadArtifact(groupId, artifactId, version, destPath, 'sources');
  }

  /**
   * Javadoc JAR 다운로드
   */
  async downloadJavadoc(
    groupId: string,
    artifactId: string,
    version: string,
    destPath: string
  ): Promise<string> {
    return this.downloadArtifact(groupId, artifactId, version, destPath, 'javadoc');
  }

  /**
   * 체크섬 검증 (SHA-1)
   */
  async verifyChecksum(filePath: string, expected: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha1');
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
   * 다운로드 URL 생성
   */
  private buildDownloadUrl(
    groupId: string,
    artifactId: string,
    version: string,
    artifactType: ArtifactType
  ): string {
    const groupPath = groupId.replace(/\./g, '/');
    const fileName = this.buildFileName(artifactId, version, artifactType);
    return `${this.repoUrl}/${groupPath}/${artifactId}/${version}/${fileName}`;
  }

  /**
   * 파일명 생성
   */
  private buildFileName(
    artifactId: string,
    version: string,
    artifactType: ArtifactType
  ): string {
    switch (artifactType) {
      case 'pom':
        return `${artifactId}-${version}.pom`;
      case 'sources':
        return `${artifactId}-${version}-sources.jar`;
      case 'javadoc':
        return `${artifactId}-${version}-javadoc.jar`;
      case 'war':
        return `${artifactId}-${version}.war`;
      case 'ear':
        return `${artifactId}-${version}.ear`;
      case 'jar':
      default:
        return `${artifactId}-${version}.jar`;
    }
  }

  /**
   * 버전 비교
   */
  private compareVersions(a: string, b: string): number {
    const normalize = (v: string) =>
      v.split(/[.-]/).map((p) => {
        const num = parseInt(p, 10);
        return isNaN(num) ? p : num;
      });

    const partsA = normalize(a);
    const partsB = normalize(b);

    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const partA = partsA[i] ?? 0;
      const partB = partsB[i] ?? 0;

      if (typeof partA === 'number' && typeof partB === 'number') {
        if (partA !== partB) return partA - partB;
      } else {
        const strA = String(partA);
        const strB = String(partB);
        if (strA !== strB) return strA.localeCompare(strB);
      }
    }
    return 0;
  }

  /**
   * groupId:artifactId:version 형식 파싱
   */
  parseCoordinates(coordinates: string): {
    groupId: string;
    artifactId: string;
    version?: string;
  } | null {
    const parts = coordinates.split(':');
    if (parts.length < 2) return null;

    return {
      groupId: parts[0],
      artifactId: parts[1],
      version: parts[2],
    };
  }
}

// 싱글톤 인스턴스
let mavenDownloaderInstance: MavenDownloader | null = null;

export function getMavenDownloader(): MavenDownloader {
  if (!mavenDownloaderInstance) {
    mavenDownloaderInstance = new MavenDownloader();
  }
  return mavenDownloaderInstance;
}
