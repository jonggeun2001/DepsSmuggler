/**
 * APK Metadata Parser
 * Alpine Linux용 APKINDEX.tar.gz 파싱 모듈
 */

import { gunzipSync } from 'zlib';
import * as tar from 'tar';
import { Readable } from 'stream';
import type {
  OSPackageInfo,
  PackageDependency,
  Repository,
  OSArchitecture,
  VersionOperator,
  Checksum,
  OSPackageSearchResult,
} from '../types';

/**
 * APK 메타데이터 파서
 */
export class ApkMetadataParser {
  private baseUrl: string;
  private architecture: OSArchitecture;
  private repository: Repository;
  private maxRetries = 3;
  private retryDelay = 1000;

  constructor(repository: Repository, architecture: OSArchitecture) {
    this.repository = repository;
    this.baseUrl = repository.baseUrl.replace(/\/$/, '');
    this.architecture = architecture;
  }

  /**
   * HTTP 요청 (재시도 지원)
   */
  private async fetchWithRetry(
    url: string
  ): Promise<{ data: ArrayBuffer; status: number }> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.arrayBuffer();
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
   * APKINDEX.tar.gz 파싱
   */
  async parseIndex(): Promise<OSPackageInfo[]> {
    const indexUrl = `${this.baseUrl}/${this.architecture}/APKINDEX.tar.gz`;

    try {
      const { data } = await this.fetchWithRetry(indexUrl);

      // gzip 해제
      const tarData = gunzipSync(Buffer.from(data));

      // tar에서 APKINDEX 파일 추출
      const apkIndexContent = await this.extractApkIndex(tarData);

      if (!apkIndexContent) {
        throw new Error('APKINDEX file not found in archive');
      }

      // 빈 줄로 패키지 구분
      const entries = apkIndexContent.split(/\n\n+/);
      const packages: OSPackageInfo[] = [];

      for (const entry of entries) {
        if (!entry.trim()) continue;

        try {
          const pkgInfo = this.parseApkEntry(entry);
          if (pkgInfo) {
            packages.push(pkgInfo);
          }
        } catch (error) {
          // 개별 패키지 파싱 실패는 건너뛰기
          console.warn(`Failed to parse APK entry: ${(error as Error).message}`);
        }
      }

      return packages;
    } catch (error) {
      throw new Error(
        `Failed to parse APKINDEX from ${indexUrl}: ${(error as Error).message}`
      );
    }
  }

  /**
   * tar에서 APKINDEX 파일 추출
   */
  private async extractApkIndex(tarData: Buffer): Promise<string | null> {
    return new Promise((resolve, reject) => {
      let content: string | null = null;
      const chunks: Buffer[] = [];

      const stream = Readable.from(tarData);

      stream
        .pipe(
          tar.t({
            onReadEntry: (entry) => {
              if (entry.path === 'APKINDEX') {
                entry.on('data', (chunk: Buffer) => {
                  chunks.push(chunk);
                });
                entry.on('end', () => {
                  content = Buffer.concat(chunks).toString('utf-8');
                });
              } else {
                entry.resume();
              }
            },
          })
        )
        .on('end', () => {
          resolve(content);
        })
        .on('error', (err) => {
          reject(err);
        });
    });
  }

  /**
   * 개별 패키지 엔트리 파싱
   * APK 인덱스는 단일 문자 키: Value 형식
   */
  private parseApkEntry(entry: string): OSPackageInfo | null {
    const fields = new Map<string, string>();
    const lines = entry.split('\n');

    for (const line of lines) {
      if (line.length < 2 || line[1] !== ':') continue;
      const key = line[0];
      const value = line.substring(2);
      fields.set(key, value);
    }

    const name = fields.get('P'); // Package name
    if (!name) return null;

    const version = fields.get('V') || ''; // Version
    const arch = (fields.get('A') || this.architecture) as OSArchitecture; // Architecture
    const size = parseInt(fields.get('S') || '0', 10); // Size
    const installedSize = fields.get('I')
      ? parseInt(fields.get('I')!, 10)
      : undefined; // Installed size
    const description = fields.get('T'); // Description
    const license = fields.get('L'); // License

    // 체크섬 파싱 (Q1 prefix 제거)
    const checksum = this.parseApkChecksum(fields.get('C'));

    // 파일 위치 생성
    const filename = `${name}-${version}.apk`;
    const location = `${this.architecture}/${filename}`;

    // 의존성 파싱
    const dependencies = this.parseApkDepends(fields.get('D')); // Depends
    const provides = fields.get('p')?.split(' ').filter(Boolean) || []; // Provides

    return {
      name,
      version,
      architecture: arch,
      size,
      installedSize,
      checksum,
      location,
      repository: this.repository,
      description,
      summary: description,
      license,
      dependencies,
      provides: provides.length > 0 ? provides : undefined,
    };
  }

  /**
   * APK 체크섬 파싱
   * 형식: Q1<base64_sha1> 또는 sha256:<hex>
   */
  private parseApkChecksum(checksumStr: string | undefined): Checksum {
    if (!checksumStr) {
      return { type: 'sha1', value: '' };
    }

    // Q1 prefix는 SHA1의 base64 인코딩
    if (checksumStr.startsWith('Q1')) {
      return {
        type: 'sha1',
        value: checksumStr.substring(2), // base64 값
      };
    }

    // sha256:hex 형식
    if (checksumStr.startsWith('sha256:')) {
      return {
        type: 'sha256',
        value: checksumStr.substring(7),
      };
    }

    // 기타 형식
    return {
      type: 'sha1',
      value: checksumStr,
    };
  }

  /**
   * 의존성 파싱
   * 공백으로 구분된 의존성
   */
  private parseApkDepends(depends: string | undefined): PackageDependency[] {
    if (!depends) return [];

    const dependencies: PackageDependency[] = [];
    const depList = depends.split(' ');

    for (const dep of depList) {
      const trimmedDep = dep.trim();
      if (!trimmedDep) continue;

      const parsed = this.parseSingleDependency(trimmedDep);
      if (parsed) {
        dependencies.push(parsed);
      }
    }

    return dependencies;
  }

  /**
   * 단일 의존성 파싱
   * 형식: name, name=version, name>version, name>=version, name<version, name<=version
   */
  private parseSingleDependency(depStr: string): PackageDependency | null {
    // 버전 조건 패턴
    const match = depStr.match(/^([^<>=!~]+)([<>=~]+)?(.+)?$/);
    if (!match) return null;

    const name = match[1].trim();

    // 시스템 의존성 필터링
    if (name.startsWith('so:') || name.startsWith('cmd:') || name.startsWith('pc:')) {
      return null;
    }

    const operator = match[2] ? this.parseApkOperator(match[2]) : undefined;
    const version = match[3]?.trim();

    return {
      name,
      version,
      operator,
    };
  }

  /**
   * APK 버전 연산자 파싱
   */
  private parseApkOperator(op: string): VersionOperator | undefined {
    const operatorMap: Record<string, VersionOperator> = {
      '=': '=',
      '<': '<',
      '>': '>',
      '<=': '<=',
      '>=': '>=',
      '~': '>=', // ~는 호환 버전을 의미, >= 로 근사
    };

    return operatorMap[op];
  }

  /**
   * 패키지 검색 (이름별 그룹화)
   */
  async searchPackages(
    query: string,
    matchType: 'exact' | 'partial' | 'wildcard' = 'partial'
  ): Promise<OSPackageSearchResult[]> {
    const allPackages = await this.parseIndex();

    // 쿼리와 일치하는 패키지 필터링
    const matchingPackages = allPackages.filter((pkg) => {
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

    // 패키지 이름별로 그룹화
    const groupedByName = new Map<string, OSPackageInfo[]>();
    for (const pkg of matchingPackages) {
      const existing = groupedByName.get(pkg.name) || [];
      existing.push(pkg);
      groupedByName.set(pkg.name, existing);
    }

    // OSPackageSearchResult 형태로 변환
    const results: OSPackageSearchResult[] = [];
    for (const [name, versions] of groupedByName) {
      // 버전 정렬 (최신순)
      const sortedVersions = versions.sort((a, b) => this.compareVersions(b.version, a.version));

      results.push({
        name,
        versions: sortedVersions,
        latest: sortedVersions[0],
      });
    }

    // 패키지 이름순으로 정렬
    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * 특정 패키지의 모든 버전 가져오기
   */
  async getPackageVersions(packageName: string): Promise<OSPackageInfo[]> {
    const results = await this.searchPackages(packageName, 'exact');
    // 검색 결과에서 첫 번째 일치하는 패키지의 모든 버전 반환
    if (results.length === 0) {
      return [];
    }
    return results[0].versions;
  }

  /**
   * Alpine 버전 비교
   * 형식: major.minor.patch[-r리비전]
   */
  private compareVersions(a: string, b: string): number {
    const parseVersion = (ver: string) => {
      const revMatch = ver.match(/-r(\d+)$/);
      const revision = revMatch ? parseInt(revMatch[1], 10) : 0;
      const main = revMatch ? ver.substring(0, ver.length - revMatch[0].length) : ver;
      return { main, revision };
    };

    const verA = parseVersion(a);
    const verB = parseVersion(b);

    // 메인 버전 비교
    const mainCmp = this.compareVersionStrings(verA.main, verB.main);
    if (mainCmp !== 0) return mainCmp;

    // 리비전 비교
    return verA.revision - verB.revision;
  }

  /**
   * 버전 문자열 비교
   */
  private compareVersionStrings(a: string, b: string): number {
    const partsA = a.split(/[._-]/);
    const partsB = b.split(/[._-]/);

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
