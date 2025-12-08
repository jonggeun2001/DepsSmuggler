/**
 * YUM/RPM Metadata Parser
 * RHEL/CentOS용 repomd.xml, primary.xml.gz 파싱 모듈
 */

import { XMLParser } from 'fast-xml-parser';
import { gunzipSync } from 'zlib';
import type {
  OSPackageInfo,
  PackageDependency,
  Repository,
  OSArchitecture,
  VersionOperator,
  Checksum,
  ChecksumType,
} from '../types';

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
  private xmlParser: XMLParser;
  private maxRetries = 3;
  private retryDelay = 1000;

  constructor(repository: Repository, architecture: OSArchitecture = 'x86_64') {
    this.repository = repository;
    this.architecture = architecture;
    this.baseUrl = this.resolveUrlVariables(repository.baseUrl);
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      parseAttributeValue: true,
      trimValues: true,
    });
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
        const response = await fetch(url);
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

      // gzip 해제
      let xmlContent: string;
      if (location.endsWith('.gz')) {
        const decompressed = gunzipSync(Buffer.from(data as ArrayBuffer));
        xmlContent = decompressed.toString('utf-8');
      } else {
        xmlContent = data as string;
      }

      // XML 파싱
      const parsed = this.xmlParser.parse(xmlContent);
      const metadata = parsed.metadata;

      if (!metadata) {
        throw new Error('Invalid primary.xml: missing metadata root element');
      }

      const packages: OSPackageInfo[] = [];
      const packageElements = Array.isArray(metadata.package)
        ? metadata.package
        : metadata.package
          ? [metadata.package]
          : [];

      for (const pkgEl of packageElements) {
        try {
          const pkgInfo = this.parsePackageElement(pkgEl);
          packages.push(pkgInfo);
        } catch (error) {
          // 개별 패키지 파싱 실패는 건너뛰기
          console.warn(`Failed to parse package: ${(error as Error).message}`);
        }
      }

      return packages;
    } catch (error) {
      throw new Error(
        `Failed to parse primary.xml from ${primaryUrl}: ${(error as Error).message}`
      );
    }
  }

  /**
   * 패키지 요소 파싱
   */
  private parsePackageElement(pkgEl: Record<string, unknown>): OSPackageInfo {
    const versionEl = pkgEl.version as Record<string, unknown> | undefined;
    const sizeEl = pkgEl.size as Record<string, unknown> | undefined;
    const locationEl = pkgEl.location as Record<string, unknown> | undefined;
    const checksumEl = pkgEl.checksum as Record<string, unknown> | undefined;
    const formatEl = pkgEl.format as Record<string, unknown> | undefined;

    // 기본 정보
    const name = (pkgEl.name as string) || '';
    const arch = ((pkgEl.arch as string) || 'noarch') as OSArchitecture;

    // 버전 정보
    const version = (versionEl?.['@_ver'] as string) || '';
    const release = (versionEl?.['@_rel'] as string) || undefined;
    const epoch = versionEl?.['@_epoch'] as number | undefined;

    // 크기 정보
    const size = (sizeEl?.['@_package'] as number) || 0;
    const installedSize = (sizeEl?.['@_installed'] as number) || undefined;

    // 체크섬
    const checksum: Checksum = {
      type: ((checksumEl?.['@_type'] as string) || 'sha256') as ChecksumType,
      value: (checksumEl?.['#text'] as string) || '',
    };

    // 위치
    const locationHref = (locationEl?.['@_href'] as string) || '';

    // 설명 정보
    const description = (pkgEl.description as string) || undefined;
    const summary = (pkgEl.summary as string) || undefined;
    const license = formatEl?.['rpm:license'] as string | undefined;

    // 의존성 파싱
    const dependencies = this.parseRpmRequires(formatEl?.['rpm:requires']);
    const provides = this.parseRpmProvides(formatEl?.['rpm:provides']);
    const conflicts = this.parseRpmProvides(formatEl?.['rpm:conflicts']);
    const obsoletes = this.parseRpmProvides(formatEl?.['rpm:obsoletes']);
    const suggests = this.parseRpmProvides(formatEl?.['rpm:suggests']);
    const recommends = this.parseRpmProvides(formatEl?.['rpm:recommends']);

    return {
      name,
      version,
      release,
      epoch,
      architecture: arch,
      size,
      installedSize,
      checksum,
      location: locationHref,
      repository: this.repository,
      description,
      summary,
      license,
      dependencies,
      provides: provides.length > 0 ? provides : undefined,
      conflicts: conflicts.length > 0 ? conflicts : undefined,
      obsoletes: obsoletes.length > 0 ? obsoletes : undefined,
      suggests: suggests.length > 0 ? suggests : undefined,
      recommends: recommends.length > 0 ? recommends : undefined,
    };
  }

  /**
   * RPM requires 파싱
   */
  private parseRpmRequires(requires: unknown): PackageDependency[] {
    if (!requires) return [];

    const requiresObj = requires as Record<string, unknown>;
    const entries = requiresObj['rpm:entry'];
    if (!entries) return [];

    const entryList = Array.isArray(entries) ? entries : [entries];
    const dependencies: PackageDependency[] = [];

    for (const entry of entryList) {
      if (!entry || typeof entry !== 'object') continue;

      const entryObj = entry as Record<string, unknown>;
      const name = (entryObj['@_name'] as string) || '';

      // 시스템 의존성 필터링 (rpmlib, config 등)
      if (this.isSystemDependency(name)) continue;

      const flags = entryObj['@_flags'] as string | undefined;
      const ver = entryObj['@_ver'] as string | undefined;
      const pre = entryObj['@_pre'] as number | undefined;

      dependencies.push({
        name,
        version: ver,
        operator: flags ? this.parseRpmFlags(flags) : undefined,
        isOptional: pre === 1,
      });
    }

    return dependencies;
  }

  /**
   * 시스템 의존성 여부 확인
   */
  private isSystemDependency(name: string): boolean {
    // rpmlib, config, 파일 경로 등은 시스템 의존성으로 필터링
    return (
      name.startsWith('rpmlib(') ||
      name.startsWith('config(') ||
      name.startsWith('/') ||
      name.startsWith('libc.so') ||
      name.startsWith('libpthread.so') ||
      name.startsWith('libm.so') ||
      name.startsWith('libdl.so') ||
      name.startsWith('librt.so') ||
      name.startsWith('rtld(')
    );
  }

  /**
   * RPM provides/conflicts/obsoletes 파싱
   */
  private parseRpmProvides(provides: unknown): string[] {
    if (!provides) return [];

    const providesObj = provides as Record<string, unknown>;
    const entries = providesObj['rpm:entry'];
    if (!entries) return [];

    const entryList = Array.isArray(entries) ? entries : [entries];
    const result: string[] = [];

    for (const entry of entryList) {
      if (!entry || typeof entry !== 'object') continue;

      const entryObj = entry as Record<string, unknown>;
      const name = (entryObj['@_name'] as string) || '';
      if (name) {
        result.push(name);
      }
    }

    return result;
  }

  /**
   * RPM flags 파싱 (EQ, LT, GT 등)
   */
  private parseRpmFlags(flags: string): VersionOperator | undefined {
    const flagMap: Record<string, VersionOperator> = {
      EQ: '=',
      LT: '<',
      GT: '>',
      LE: '<=',
      GE: '>=',
    };

    return flagMap[flags.toUpperCase()];
  }

  /**
   * 패키지 검색 (이름으로)
   */
  async searchPackages(query: string, matchType: 'exact' | 'partial' | 'wildcard' = 'partial'): Promise<OSPackageInfo[]> {
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
        case 'wildcard':
          const regex = new RegExp('^' + query.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
          return regex.test(pkg.name);
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
    const partsA = a.split(/[.-]/);
    const partsB = b.split(/[.-]/);

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
