/**
 * APT/DEB Metadata Parser
 * Ubuntu/Debian용 Packages.gz, Release 파일 파싱 모듈
 */

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
 * Release 파일 정보
 */
export interface ReleaseInfo {
  /** 배포판 코드명 */
  codename: string;
  /** 버전 */
  version: string;
  /** 아키텍처 목록 */
  architectures: string[];
  /** 컴포넌트 목록 */
  components: string[];
  /** 날짜 */
  date: string;
  /** 설명 */
  description: string;
}

/**
 * APT 메타데이터 파서
 */
export class AptMetadataParser {
  private baseUrl: string;
  private component: string;
  private architecture: OSArchitecture;
  private repository: Repository;
  private maxRetries = 3;
  private retryDelay = 1000;

  constructor(
    repository: Repository,
    component: string,
    architecture: OSArchitecture
  ) {
    this.repository = repository;
    this.baseUrl = repository.baseUrl.replace(/\/$/, '');
    this.component = component;
    this.architecture = architecture;
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
   * Release 파일 파싱
   */
  async parseRelease(): Promise<ReleaseInfo> {
    const releaseUrl = `${this.baseUrl}/Release`;

    try {
      const { data } = await this.fetchWithRetry(releaseUrl);
      const lines = (data as string).split('\n');
      const result: ReleaseInfo = {
        codename: '',
        version: '',
        architectures: [],
        components: [],
        date: '',
        description: '',
      };

      for (const line of lines) {
        if (line.startsWith('Codename:')) {
          result.codename = line.substring(9).trim();
        } else if (line.startsWith('Version:')) {
          result.version = line.substring(8).trim();
        } else if (line.startsWith('Architectures:')) {
          result.architectures = line.substring(14).trim().split(/\s+/);
        } else if (line.startsWith('Components:')) {
          result.components = line.substring(11).trim().split(/\s+/);
        } else if (line.startsWith('Date:')) {
          result.date = line.substring(5).trim();
        } else if (line.startsWith('Description:')) {
          result.description = line.substring(12).trim();
        }
      }

      return result;
    } catch (error) {
      throw new Error(`Failed to parse Release from ${releaseUrl}: ${(error as Error).message}`);
    }
  }

  /**
   * Packages.gz 파싱
   */
  async parsePackages(): Promise<OSPackageInfo[]> {
    // Packages.gz URL 구성
    const packagesUrl = `${this.baseUrl}/${this.component}/binary-${this.architecture}/Packages.gz`;

    try {
      const { data } = await this.fetchWithRetry(packagesUrl, { responseType: 'arraybuffer' });

      // gzip 해제
      const decompressed = gunzipSync(Buffer.from(data as ArrayBuffer));
      const content = decompressed.toString('utf-8');

      // 빈 줄로 패키지 구분
      const entries = content.split(/\n\n+/);
      const packages: OSPackageInfo[] = [];

      for (const entry of entries) {
        if (!entry.trim()) continue;

        try {
          const pkgInfo = this.parsePackageEntry(entry);
          if (pkgInfo) {
            packages.push(pkgInfo);
          }
        } catch (error) {
          // 개별 패키지 파싱 실패는 건너뛰기
          console.warn(`Failed to parse package entry: ${(error as Error).message}`);
        }
      }

      return packages;
    } catch (error) {
      throw new Error(
        `Failed to parse Packages.gz from ${packagesUrl}: ${(error as Error).message}`
      );
    }
  }

  /**
   * 개별 패키지 엔트리 파싱
   */
  private parsePackageEntry(entry: string): OSPackageInfo | null {
    const fields = this.parseDebControlFields(entry);

    const name = fields.get('Package');
    if (!name) return null;

    const version = fields.get('Version') || '';
    const arch = (fields.get('Architecture') || 'all') as OSArchitecture;
    const size = parseInt(fields.get('Size') || '0', 10);
    const installedSize = fields.get('Installed-Size')
      ? parseInt(fields.get('Installed-Size')!, 10) * 1024 // KB to bytes
      : undefined;
    const filename = fields.get('Filename') || '';
    const description = fields.get('Description');
    const summary = description?.split('\n')[0];

    // 체크섬 (SHA256 우선)
    let checksum: Checksum;
    if (fields.get('SHA256')) {
      checksum = { type: 'sha256', value: fields.get('SHA256')! };
    } else if (fields.get('SHA1')) {
      checksum = { type: 'sha1', value: fields.get('SHA1')! };
    } else if (fields.get('MD5sum')) {
      checksum = { type: 'md5', value: fields.get('MD5sum')! };
    } else {
      checksum = { type: 'sha256', value: '' };
    }

    // 의존성 파싱
    const dependencies = this.parseDebDepends(fields.get('Depends'));
    const suggests = this.parseDebDepends(fields.get('Suggests'));
    const recommends = this.parseDebDepends(fields.get('Recommends'));
    const conflicts = this.parseDebDepends(fields.get('Conflicts'));
    const provides = fields.get('Provides')?.split(',').map((p) => p.trim()) || [];

    return {
      name,
      version,
      architecture: arch,
      size,
      installedSize,
      checksum,
      location: filename,
      repository: this.repository,
      description,
      summary,
      license: fields.get('License'),
      dependencies,
      provides: provides.length > 0 ? provides : undefined,
      conflicts: conflicts.length > 0 ? undefined : undefined,
      suggests: suggests.length > 0 ? suggests.map((d) => d.name) : undefined,
      recommends: recommends.length > 0 ? recommends.map((d) => d.name) : undefined,
    };
  }

  /**
   * Debian 컨트롤 필드 파싱 (멀티라인 지원)
   */
  private parseDebControlFields(entry: string): Map<string, string> {
    const fields = new Map<string, string>();
    const lines = entry.split('\n');

    let currentKey = '';
    let currentValue = '';

    for (const line of lines) {
      if (line.startsWith(' ') || line.startsWith('\t')) {
        // 멀티라인 필드 (공백/탭으로 시작)
        if (currentKey) {
          currentValue += '\n' + line.substring(1);
        }
      } else if (line.includes(':')) {
        // 새 필드
        if (currentKey) {
          fields.set(currentKey, currentValue);
        }
        const colonIndex = line.indexOf(':');
        currentKey = line.substring(0, colonIndex).trim();
        currentValue = line.substring(colonIndex + 1).trim();
      }
    }

    // 마지막 필드 저장
    if (currentKey) {
      fields.set(currentKey, currentValue);
    }

    return fields;
  }

  /**
   * Depends 필드 파싱
   */
  private parseDebDepends(depends: string | undefined): PackageDependency[] {
    if (!depends) return [];

    const dependencies: PackageDependency[] = [];

    // 쉼표로 구분된 의존성 분리
    const depList = depends.split(',');

    for (const dep of depList) {
      const trimmedDep = dep.trim();
      if (!trimmedDep) continue;

      // 대안(|) 처리: 첫 번째 패키지 사용
      const alternatives = trimmedDep.split('|');
      const primaryDep = alternatives[0].trim();

      const parsed = this.parseSingleDependency(primaryDep);
      if (parsed) {
        dependencies.push(parsed);
      }
    }

    return dependencies;
  }

  /**
   * 단일 의존성 파싱
   * 형식: 패키지명 [(연산자 버전)]
   */
  private parseSingleDependency(depStr: string): PackageDependency | null {
    // 버전 조건 파싱: `패키지명 (연산자 버전)`
    const match = depStr.match(/^([^\s(]+)(?:\s*\(([<>=]+)\s*([^)]+)\))?/);
    if (!match) return null;

    const name = match[1].trim();
    // 가상 패키지 또는 특수 패키지 필터링
    if (name.startsWith(':') || name.includes('{')) return null;

    const operator = match[2] ? this.parseDebOperator(match[2]) : undefined;
    const version = match[3]?.trim();

    return {
      name,
      version,
      operator,
    };
  }

  /**
   * Debian 버전 연산자 파싱
   */
  private parseDebOperator(op: string): VersionOperator | undefined {
    const operatorMap: Record<string, VersionOperator> = {
      '=': '=',
      '==': '=',
      '<': '<',
      '<<': '<<',
      '>': '>',
      '>>': '>>',
      '<=': '<=',
      '>=': '>=',
    };

    return operatorMap[op];
  }

  /**
   * 패키지 검색 (이름으로)
   */
  async searchPackages(
    query: string,
    matchType: 'exact' | 'partial' | 'wildcard' = 'partial'
  ): Promise<OSPackageInfo[]> {
    const allPackages = await this.parsePackages();

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
    return packages.sort((a, b) => this.compareVersions(b.version, a.version));
  }

  /**
   * Debian 버전 비교
   * 형식: [epoch:]upstream_version[-debian_revision]
   */
  private compareVersions(a: string, b: string): number {
    const parseVersion = (ver: string) => {
      const epochMatch = ver.match(/^(\d+):/);
      const epoch = epochMatch ? parseInt(epochMatch[1], 10) : 0;
      const rest = epochMatch ? ver.substring(epochMatch[0].length) : ver;

      const revisionMatch = rest.match(/-([^-]+)$/);
      const revision = revisionMatch ? revisionMatch[1] : '';
      const upstream = revisionMatch ? rest.substring(0, rest.length - revisionMatch[0].length) : rest;

      return { epoch, upstream, revision };
    };

    const verA = parseVersion(a);
    const verB = parseVersion(b);

    // epoch 비교
    if (verA.epoch !== verB.epoch) return verA.epoch - verB.epoch;

    // upstream 비교
    const upstreamCmp = this.compareVersionStrings(verA.upstream, verB.upstream);
    if (upstreamCmp !== 0) return upstreamCmp;

    // revision 비교
    return this.compareVersionStrings(verA.revision, verB.revision);
  }

  /**
   * 버전 문자열 비교
   */
  private compareVersionStrings(a: string, b: string): number {
    const partsA = a.split(/[.-~+]/);
    const partsB = b.split(/[.-~+]/);

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
