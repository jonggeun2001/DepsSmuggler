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
type ArtifactType =
  | 'jar'           // 기본 JAR
  | 'pom'           // POM only (BOM, parent)
  | 'war'           // 웹 애플리케이션
  | 'ear'           // 엔터프라이즈 애플리케이션
  | 'ejb'           // EJB (JAR로 다운로드)
  | 'maven-plugin'  // Maven 플러그인 (JAR로 다운로드)
  | 'bundle'        // OSGi 번들 (JAR로 다운로드)
  | 'rar'           // 리소스 어댑터
  | 'aar'           // Android 라이브러리
  | 'hpi'           // Jenkins 플러그인
  | 'test-jar'      // 테스트 JAR (classifier)
  | 'sources'       // 소스 JAR (classifier)
  | 'javadoc';      // Javadoc JAR (classifier)

/** 타입별 실제 확장자 매핑 */
const TYPE_EXTENSION_MAP: Record<ArtifactType, string> = {
  'jar': '.jar',
  'pom': '.pom',
  'war': '.war',
  'ear': '.ear',
  'ejb': '.jar',           // EJB는 JAR 확장자
  'maven-plugin': '.jar',  // 플러그인도 JAR 확장자
  'bundle': '.jar',        // OSGi 번들도 JAR 확장자
  'rar': '.rar',
  'aar': '.aar',
  'hpi': '.hpi',
  'test-jar': '.jar',      // classifier로 구분
  'sources': '.jar',       // classifier로 구분
  'javadoc': '.jar',       // classifier로 구분
};

/** Classifier 매핑 (타입별 기본 classifier) */
const TYPE_CLASSIFIER_MAP: Partial<Record<ArtifactType, string>> = {
  'test-jar': 'tests',
  'sources': 'sources',
  'javadoc': 'javadoc',
};

/** 유효한 ArtifactType 목록 */
const VALID_ARTIFACT_TYPES: ArtifactType[] = [
  'jar', 'pom', 'war', 'ear', 'ejb', 'maven-plugin',
  'bundle', 'rar', 'aar', 'hpi', 'test-jar', 'sources', 'javadoc'
];

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

      // packaging 타입 확인 (pom이면 JAR가 없는 POM-only 패키지)
      const packaging = artifact?.p || 'jar';

      const metadata: PackageMetadata = {
        groupId,
        artifactId,
        downloadUrl,
        checksum: sha1 ? { sha1 } : undefined,
        packaging, // 'jar', 'pom', 'war' 등
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
    const classifier = info.metadata?.classifier as string | undefined;

    // packaging 타입 확인 (pom이면 JAR가 없는 POM-only 패키지: BOM, parent POM 등)
    // getPackageMetadata에서는 packaging으로, resolver에서는 type으로 저장
    let packaging = (info.metadata?.packaging as string) || (info.metadata?.type as string);

    // packaging 타입이 없으면 POM 파일을 직접 조회하여 확인
    // (Search API는 BOM 같은 POM-only 패키지의 packaging 정보를 제대로 반환하지 않음)
    if (!packaging) {
      try {
        const pomUrl = this.buildDownloadUrl(groupId, artifactId, info.version, 'pom');
        const pomResponse = await this.client.get<string>(pomUrl);
        const pomXml = pomResponse.data;

        // POM에서 <packaging> 태그 파싱
        const packagingMatch = pomXml.match(/<packaging>([^<]+)<\/packaging>/);
        packaging = packagingMatch ? packagingMatch[1].trim() : 'jar';
        logger.debug('POM 파일에서 packaging 타입 조회', { groupId, artifactId, version: info.version, packaging });
      } catch {
        packaging = 'jar'; // 조회 실패 시 기본값
      }
    }

    // ArtifactType으로 변환 및 검증
    const artifactType = this.validateArtifactType(packaging);
    const isPomOnly = artifactType === 'pom';

    if (isPomOnly) {
      logger.info('POM-only 패키지 다운로드 (BOM/parent POM)', {
        groupId,
        artifactId,
        version: info.version,
        packaging: artifactType,
      });
    }

    let mainArtifactPath: string;

    // 1. 메인 아티팩트 다운로드 (POM-only가 아닌 경우)
    if (!isPomOnly) {
      mainArtifactPath = await this.downloadArtifact(
        groupId,
        artifactId,
        info.version,
        destPath,
        artifactType,
        onProgress,
        classifier
      );

      // 메인 아티팩트 체크섬 파일 다운로드 (.sha1)
      await this.downloadChecksumFile(groupId, artifactId, info.version, destPath, artifactType, classifier);
    } else {
      mainArtifactPath = ''; // POM 경로로 대체될 예정
    }

    // 2. pom 파일 다운로드 (모든 타입에 필요)
    try {
      const pomPath = await this.downloadArtifact(
        groupId,
        artifactId,
        info.version,
        destPath,
        'pom',
        isPomOnly ? onProgress : undefined // POM-only인 경우에만 진행률 표시
      );
      // pom 체크섬 파일 다운로드 (.sha1)
      await this.downloadChecksumFile(groupId, artifactId, info.version, destPath, 'pom');

      if (isPomOnly) {
        mainArtifactPath = pomPath;
      }
    } catch (error) {
      // POM-only 패키지인데 POM도 실패하면 에러
      if (isPomOnly) {
        throw new Error(`POM-only 패키지이나 POM 다운로드 실패: ${error instanceof Error ? error.message : String(error)}`);
      }
      logger.warn('pom 다운로드 실패 (계속 진행)', {
        groupId,
        artifactId,
        version: info.version,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    logger.info('Maven 패키지 다운로드 완료', {
      groupId,
      artifactId,
      version: info.version,
      type: artifactType,
      classifier,
      isPomOnly,
    });

    return mainArtifactPath;
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
    onProgress?: (progress: DownloadProgressEvent) => void,
    classifier?: string
  ): Promise<string> {
    try {
      const downloadUrl = this.buildDownloadUrl(groupId, artifactId, version, artifactType, classifier);
      const fileName = this.buildFileName(artifactId, version, artifactType, classifier);
      
      // .m2 형식의 디렉토리 구조 생성
      const m2SubPath = this.buildM2Path(groupId, artifactId, version);
      const artifactDir = path.join(destPath, m2SubPath);
      const filePath = path.join(artifactDir, fileName);

      // 디렉토리 생성
      await fs.ensureDir(artifactDir);

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
            itemId: `${groupId}:${artifactId}@${version}`,
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
        classifier,
        filePath,
      });

      return filePath;
    } catch (error) {
      logger.error('Maven 아티팩트 다운로드 실패', {
        groupId,
        artifactId,
        version,
        artifactType,
        classifier,
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
        const actual = hash.digest('hex').toLowerCase();
        resolve(actual === expected.toLowerCase());
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
    artifactType: ArtifactType,
    classifier?: string
  ): string {
    const groupPath = groupId.replace(/\./g, '/');
    const fileName = this.buildFileName(artifactId, version, artifactType, classifier);
    return `${this.repoUrl}/${groupPath}/${artifactId}/${version}/${fileName}`;
  }


  /**
   * .m2 저장소 형식의 경로 생성
   * 예: com/crealytics/spark-excel_2.12/3.5.1_0.20.4/
   */
  private buildM2Path(groupId: string, artifactId: string, version: string): string {
    const groupPath = groupId.replace(/\./g, '/');
    return path.join(groupPath, artifactId, version);
  }

  /**
   * 파일명 생성
   * @param artifactId 아티팩트 ID
   * @param version 버전
   * @param artifactType 아티팩트 타입
   * @param classifier 선택적 classifier (네이티브 라이브러리 등)
   */
  private buildFileName(
    artifactId: string,
    version: string,
    artifactType: ArtifactType,
    classifier?: string
  ): string {
    const ext = TYPE_EXTENSION_MAP[artifactType] || '.jar';

    // 타입에서 기본 classifier 가져오기
    const typeClassifier = TYPE_CLASSIFIER_MAP[artifactType];

    // 명시적 classifier가 우선, 없으면 타입의 기본 classifier 사용
    const finalClassifier = classifier || typeClassifier;

    if (finalClassifier) {
      return `${artifactId}-${version}-${finalClassifier}${ext}`;
    }
    return `${artifactId}-${version}${ext}`;
  }

  /**
   * packaging 문자열을 ArtifactType으로 변환 및 검증
   */
  private validateArtifactType(packaging: string): ArtifactType {
    if (VALID_ARTIFACT_TYPES.includes(packaging as ArtifactType)) {
      return packaging as ArtifactType;
    }

    // 알려지지 않은 타입은 jar로 폴백
    logger.warn('알려지지 않은 packaging 타입, jar로 폴백', { packaging });
    return 'jar';
  }


  /**
   * 체크섬 파일 다운로드 (.sha1)
   */
  private async downloadChecksumFile(
    groupId: string,
    artifactId: string,
    version: string,
    destPath: string,
    artifactType: ArtifactType,
    classifier?: string
  ): Promise<void> {
    const baseUrl = this.buildDownloadUrl(groupId, artifactId, version, artifactType, classifier);
    const baseFileName = this.buildFileName(artifactId, version, artifactType, classifier);

    // .m2 형식의 디렉토리 구조
    const m2SubPath = this.buildM2Path(groupId, artifactId, version);
    const artifactDir = path.join(destPath, m2SubPath);

    try {
      const checksumUrl = `${baseUrl}.sha1`;
      const checksumFileName = `${baseFileName}.sha1`;
      const checksumFilePath = path.join(artifactDir, checksumFileName);

      // 디렉토리 확인 (이미 downloadArtifact에서 생성되었을 것이지만 안전을 위해)
      await fs.ensureDir(artifactDir);

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
        classifier,
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
