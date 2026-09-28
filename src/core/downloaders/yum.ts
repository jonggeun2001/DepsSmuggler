/**
 * YUM/RPM Package Downloader
 * RHEL/CentOS 계열 OS 패키지 다운로더 (플랫 구조)
 *
 * @module downloaders/yum
 * @exports YumDownloader, YumMetadataParser, RepomdInfo, RepomdDataInfo, getYumDownloader
 */

import { XMLParser } from 'fast-xml-parser';
import { createYumXmlParser } from './yum-primary';
import { MetadataWorkerClient } from '../shared/metadata/worker-client';

const primaryWorker = new MetadataWorkerClient('yum-worker');
export const closeYumMetadataWorker = (): Promise<void> => primaryWorker.close();
import type {
  OSPackageInfo,
  Repository,
  OSArchitecture,
  Checksum,
  ChecksumType,
} from './os-shared/types';
import { BaseOSDownloader, type BaseDownloaderOptions } from './os-shared/base-downloader';
import { resolveRepoUrl } from './os-shared/repositories';

/**
 * repomd.xml 파싱 결과
 */
export interface RepomdInfo {
  /** 저장소 리비전 */
  revision: string;
  /** primary.xml 정보 */
  primary: RepomdDataInfo | null;
  /** filelists.xml 정보 */
  filelists: RepomdDataInfo | null;
  /** other.xml 정보 */
  other: RepomdDataInfo | null;
}

/**
 * repomd.xml 데이터 항목 정보
 */
export interface RepomdDataInfo {
  /** 파일 위치 (상대 경로) */
  location: string;
  /** 체크섬 */
  checksum: Checksum;
  /** 타임스탬프 */
  timestamp?: number;
  /** 압축 크기 */
  size?: number;
  /** 압축 해제 후 크기 */
  openSize?: number;
}

/**
 * YUM 메타데이터 파서
 */
export class YumMetadataParser {
  private baseUrl: string;
  private repository: Repository;
  private architecture: OSArchitecture;
  private abortSignal?: AbortSignal;
  private xmlParser: XMLParser;
  private maxRetries = 3;
  private retryDelay = 1000;

  constructor(
    repository: Repository,
    architecture: OSArchitecture = 'x86_64',
    abortSignal?: AbortSignal
  ) {
    this.repository = repository;
    this.architecture = architecture;
    this.abortSignal = abortSignal;
    this.baseUrl = this.resolveUrlVariables(repository.baseUrl);
    this.xmlParser = createYumXmlParser();
  }

  /**
   * URL 변수 치환 ($basearch, $releasever 등)
   */
  private resolveUrlVariables(url: string): string {
    let resolved = url.replace(/\/$/, ''); // trailing slash 제거

    // $basearch 치환 - 아키텍처 값으로 대체
    resolved = resolved.replace(/\$basearch/g, this.architecture);

    // $releasever 치환 - 저장소 ID에서 버전 추출 시도
    const versionMatch = this.repository.id.match(/(\d+)/);
    if (versionMatch) {
      resolved = resolved.replace(/\$releasever/g, versionMatch[1]);
    }

    return resolved;
  }

  /**
   * HTTP 요청 (재시도 지원)
   */
  private async fetchWithRetry(
    url: string,
    options: { responseType?: 'text' | 'arraybuffer' } = {}
  ): Promise<{ data: string | ArrayBuffer; status: number }> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        if (this.abortSignal?.aborted) {
          const abortError = new Error('Metadata load cancelled');
          abortError.name = 'AbortError';
          throw abortError;
        }

        const response = await fetch(url, {
          signal: this.abortSignal,
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        let data: string | ArrayBuffer;
        if (options.responseType === 'arraybuffer') {
          data = await response.arrayBuffer();
        } else {
          data = await response.text();
        }

        return { data, status: response.status };
      } catch (error) {
        lastError = error as Error;
        if (this.abortSignal?.aborted || (lastError as { name?: string }).name === 'AbortError') {
          throw lastError;
        }
        if (attempt < this.maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, this.retryDelay * attempt));
        }
      }
    }

    throw new Error(
      `Failed to fetch ${url} after ${this.maxRetries} attempts: ${lastError?.message}`
    );
  }

  /**
   * repomd.xml 파싱하여 primary.xml 위치 찾기
   */
  async parseRepomd(): Promise<RepomdInfo> {
    const repomdUrl = `${this.baseUrl}/repodata/repomd.xml`;

    try {
      const { data } = await this.fetchWithRetry(repomdUrl);
      const parsed = this.xmlParser.parse(data as string);

      const repomd = parsed.repomd;
      if (!repomd) {
        throw new Error('Invalid repomd.xml: missing repomd root element');
      }

      const result: RepomdInfo = {
        revision: repomd.revision?.toString() || '',
        primary: null,
        filelists: null,
        other: null,
      };

      // data 요소들 파싱
      const dataElements = Array.isArray(repomd.data) ? repomd.data : [repomd.data];

      for (const dataEl of dataElements) {
        if (!dataEl) continue;

        const type = dataEl['@_type'];
        const info = this.parseRepomdDataElement(dataEl);

        if (type === 'primary') {
          result.primary = info;
        } else if (type === 'filelists') {
          result.filelists = info;
        } else if (type === 'other') {
          result.other = info;
        }
      }

      return result;
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError') {
        throw error;
      }
      throw new Error(`Failed to parse repomd.xml from ${repomdUrl}: ${(error as Error).message}`);
    }
  }

  /**
   * repomd.xml의 data 요소 파싱
   */
  private parseRepomdDataElement(dataEl: Record<string, unknown>): RepomdDataInfo {
    const location = dataEl.location as Record<string, unknown> | undefined;
    const checksum = dataEl.checksum as Record<string, unknown> | undefined;

    return {
      location: (location?.['@_href'] as string) || '',
      checksum: {
        type: ((checksum?.['@_type'] as string) || 'sha256') as ChecksumType,
        value: (checksum?.['#text'] as string) || '',
      },
      timestamp: dataEl.timestamp as number | undefined,
      size: dataEl.size as number | undefined,
      openSize: (dataEl['open-size'] as number) || undefined,
    };
  }

  /**
   * primary.xml.gz 파싱하여 패키지 목록 추출
   */
  async parsePrimary(location: string): Promise<OSPackageInfo[]> {
    const primaryUrl = `${this.baseUrl}/${location}`;

    try {
      const { data } = await this.fetchWithRetry(primaryUrl, { responseType: 'arraybuffer' });

      const buffer =
        typeof data === 'string' ? (new TextEncoder().encode(data).buffer as ArrayBuffer) : data;
      return await primaryWorker.run<OSPackageInfo[]>(
        {
          kind: 'parse',
          data: buffer,
          compressed: location.endsWith('.gz'),
          repository: this.repository,
        },
        [buffer],
        this.abortSignal
      );
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError') {
        throw error;
      }
      throw new Error(
        `Failed to parse primary.xml from ${primaryUrl}: ${(error as Error).message}`
      );
    }
  }

  /**
   * 패키지 검색 (이름으로)
   */
  async searchPackages(
    query: string,
    matchType: 'exact' | 'partial' | 'wildcard' = 'partial'
  ): Promise<OSPackageInfo[]> {
    const repomd = await this.parseRepomd();
    if (!repomd.primary) {
      throw new Error('No primary metadata found in repository');
    }

    const allPackages = await this.parsePrimary(repomd.primary.location);

    return allPackages.filter((pkg) => {
      switch (matchType) {
        case 'exact':
          return pkg.name === query;
        case 'partial':
          return pkg.name.includes(query);
        case 'wildcard': {
          const regex = new RegExp('^' + query.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
          return regex.test(pkg.name);
        }
        default:
          return false;
      }
    });
  }

  /**
   * 특정 패키지의 모든 버전 가져오기
   */
  async getPackageVersions(packageName: string): Promise<OSPackageInfo[]> {
    const packages = await this.searchPackages(packageName, 'exact');
    // 버전순 정렬 (최신순)
    return packages.sort((a, b) => this.compareVersions(b, a));
  }

  /**
   * 버전 비교 (epoch, version, release 순)
   */
  private compareVersions(a: OSPackageInfo, b: OSPackageInfo): number {
    // epoch 비교
    const epochA = a.epoch || 0;
    const epochB = b.epoch || 0;
    if (epochA !== epochB) return epochA - epochB;

    // version 비교
    const versionCmp = this.compareVersionStrings(a.version, b.version);
    if (versionCmp !== 0) return versionCmp;

    // release 비교
    return this.compareVersionStrings(a.release || '', b.release || '');
  }

  /**
   * 버전 문자열 비교 (RPM 버전 비교 규칙)
   */
  private compareVersionStrings(a: string, b: string): number {
    // 문자열이 아닌 경우 문자열로 변환
    const strA = typeof a === 'string' ? a : String(a ?? '');
    const strB = typeof b === 'string' ? b : String(b ?? '');

    const partsA = strA.split(/[.-]/);
    const partsB = strB.split(/[.-]/);

    const maxLen = Math.max(partsA.length, partsB.length);

    for (let i = 0; i < maxLen; i++) {
      const partA = partsA[i] || '0';
      const partB = partsB[i] || '0';

      // 숫자로 변환 가능하면 숫자 비교
      const numA = parseInt(partA, 10);
      const numB = parseInt(partB, 10);

      if (!isNaN(numA) && !isNaN(numB)) {
        if (numA !== numB) return numA - numB;
      } else {
        // 문자열 비교
        if (partA !== partB) return partA.localeCompare(partB);
      }
    }

    return 0;
  }
}

/**
 * YUM 패키지 다운로더
 */
export class YumDownloader extends BaseOSDownloader {
  readonly type = 'yum' as const;

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

// 싱글톤 인스턴스
let yumDownloaderInstance: YumDownloader | null = null;
let yumDownloaderKey: string | null = null;

export function getYumDownloader(options?: BaseDownloaderOptions): YumDownloader {
  if (!options && !yumDownloaderInstance) {
    throw new Error('YumDownloader requires BaseDownloaderOptions');
  }

  if (!options) {
    return yumDownloaderInstance!;
  }

  const bypassCache =
    Boolean(options.abortSignal) || Boolean(options.onProgress) || Boolean(options.onError);
  const currentKey = JSON.stringify({
    distributionId: options.distribution.id,
    architecture: options.architecture,
    outputDir: options.outputDir,
    concurrency: options.concurrency,
  });

  if (bypassCache) {
    return new YumDownloader(options);
  }

  if (!yumDownloaderInstance || yumDownloaderKey !== currentKey) {
    yumDownloaderInstance = new YumDownloader(options);
    yumDownloaderKey = currentKey;
  }
  return yumDownloaderInstance;
}
