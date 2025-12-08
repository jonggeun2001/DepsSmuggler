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
    const [groupId, artifactId] = packageName.split(':');

    try {
      // 1차: maven-metadata.xml에서 정확한 버전 목록 조회
      return await this.getVersionsFromMetadata(groupId, artifactId);
    } catch (metadataError) {
      logger.warn('maven-metadata.xml 조회 실패, 폴백 API 사용', { packageName, error: metadataError });

      try {
        // 2차: 기존 Search API 폴백
        return await this.getVersionsFromSearchApi(groupId, artifactId);
      } catch (error) {
        logger.error('Maven 버전 목록 조회 실패', { packageName, error });
        throw error;
      }
    }
  }


  /**
   * maven-metadata.xml에서 버전 목록 조회
   */
  private async getVersionsFromMetadata(groupId: string, artifactId: string): Promise<string[]> {
    const groupPath = groupId.replace(/\./g, '/');
    const metadataUrl = `${this.repoUrl}/${groupPath}/${artifactId}/maven-metadata.xml`;

    const response = await this.client.get<string>(metadataUrl, {
      responseType: 'text' as const,
      timeout: 10000,
    });

    const versions = this.parseMetadataXml(response.data);

    // 버전 정렬 (최신순)
    return versions.sort((a, b) => this.compareVersions(b, a));
  }

  /**
   * maven-metadata.xml 파싱
   */
  private parseMetadataXml(xml: string): string[] {
    const versionRegex = /<version>([^<]+)<\/version>/g;
    const versions: string[] = [];
    let match;

    while ((match = versionRegex.exec(xml)) !== null) {
      versions.push(match[1]);
    }

    return versions;
  }

  /**
   * Search API에서 버전 목록 조회 (폴백용)
   */
  private async getVersionsFromSearchApi(groupId: string, artifactId: string): Promise<string[]> {
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
    const groupId = (info.metadata?.groupId as string) || info.name.split(':')[0];
    const artifactId = (info.metadata?.artifactId as string) || info.name.split(':')[1];

    // 1. 주 아티팩트(jar) 다운로드
    const jarPath = await this.downloadArtifact(
      groupId,
      artifactId,
      info.version,
      destPath,
      'jar',
      onProgress
    );

    // 2. jar 체크섬 파일 다운로드 (.sha1)
    await this.downloadChecksumFile(groupId, artifactId, info.version, destPath, 'jar');

    // 3. pom 파일 다운로드
    try {
      await this.downloadArtifact(groupId, artifactId, info.version, destPath, 'pom');
      // 4. pom 체크섬 파일 다운로드 (.sha1)
      await this.downloadChecksumFile(groupId, artifactId, info.version, destPath, 'pom');
    } catch (error) {
      logger.warn('pom 다운로드 실패 (계속 진행)', {
        groupId,
        artifactId,
        version: info.version,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    logger.info('Maven 패키지 완전 다운로드 완료', {
      groupId,
      artifactId,
      version: info.version,
      files: ['jar', 'jar.sha1', 'pom', 'pom.sha1'],
    });

    return jarPath;
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
   * 체크섬 파일 다운로드 (.sha1)
   */
  private async downloadChecksumFile(
    groupId: string,
    artifactId: string,
    version: string,
    destPath: string,
    artifactType: ArtifactType
  ): Promise<void> {
    const baseUrl = this.buildDownloadUrl(groupId, artifactId, version, artifactType);
    const baseFileName = this.buildFileName(artifactId, version, artifactType);

    try {
      const checksumUrl = `${baseUrl}.sha1`;
      const checksumFileName = `${baseFileName}.sha1`;
      const checksumFilePath = path.join(destPath, checksumFileName);

      const response = await this.client.get<string>(checksumUrl, {
        responseType: 'text',
        timeout: 10000,
      });

      // sha1 파일 내용 정리 (공백이나 파일명이 포함된 경우 처리)
      const sha1Content = response.data.trim().split(' ')[0].split('\n')[0];
      await fs.writeFile(checksumFilePath, sha1Content);

      logger.debug('체크섬 파일 다운로드 완료', {
        file: checksumFileName,
      });
    } catch (error) {
      // 체크섬 파일이 없을 수 있으므로 경고만 로깅
      logger.debug('sha1 파일 다운로드 실패 (선택적)', {
        artifactType,
        error: error instanceof Error ? error.message : String(error),
      });
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
