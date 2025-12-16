import axios from 'axios';
import * as zlib from 'zlib';
import { XMLParser } from 'fast-xml-parser';
import {
  IResolver,
  PackageInfo,
  DependencyNode,
  DependencyResolutionResult,
  DependencyConflict,
  ResolverOptions,
  Architecture,
} from '../../types';
import logger from '../../utils/logger';

// RPM 의존성 엔트리
interface RpmEntry {
  '@_name': string;
  '@_ver'?: string;
  '@_rel'?: string;
  '@_flags'?: string;
  '@_epoch'?: string;
}

// Primary.xml 패키지 구조
interface PrimaryPackage {
  name: string;
  arch: string;
  version: {
    '@_ver': string;
    '@_rel': string;
    '@_epoch'?: string;
  };
  summary?: string;
  location: {
    '@_href': string;
  };
  checksum?: {
    '#text': string;
    '@_type': string;
  };
  size?: {
    '@_package': string;
  };
  format?: {
    'rpm:requires'?: {
      'rpm:entry': RpmEntry | RpmEntry[];
    };
    'rpm:provides'?: {
      'rpm:entry': RpmEntry | RpmEntry[];
    };
  };
}

// 기본 저장소 URL
const DEFAULT_REPO = 'https://download.rockylinux.org/pub/rocky/8/BaseOS/x86_64/os/';

export class YumResolver implements IResolver {
  readonly type = 'yum' as const;
  private parser: XMLParser;
  private visited: Map<string, DependencyNode> = new Map();
  private conflicts: DependencyConflict[] = [];
  private packagesByName: Map<string, PrimaryPackage[]> = new Map();
  private providerCache: Map<string, PrimaryPackage> = new Map();
  private metadataLoaded = false;
  private currentRepoUrl = '';

  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    });
  }

  /**
   * 의존성 해결
   */
  async resolveDependencies(
    packageName: string,
    version: string,
    options?: ResolverOptions & { repoUrl?: string; arch?: Architecture }
  ): Promise<DependencyResolutionResult> {
    this.visited.clear();
    this.conflicts = [];

    const repoUrl = options?.repoUrl || DEFAULT_REPO;
    const arch = options?.architecture || 'x86_64';
    const maxDepth = options?.maxDepth ?? 5;

    try {
      // 메타데이터 로드
      await this.loadMetadata(repoUrl);

      const root = await this.resolvePackage(packageName, version, arch, 0, maxDepth);
      const flatList = this.flattenDependencies(root);

      return {
        root,
        flatList,
        conflicts: this.conflicts,
      };
    } catch (error) {
      logger.error('YUM 의존성 해결 실패', { packageName, version, error });
      throw error;
    }
  }

  /**
   * 단일 패키지 의존성 해결 (재귀)
   */
  private async resolvePackage(
    name: string,
    version: string,
    arch: Architecture,
    depth: number,
    maxDepth: number
  ): Promise<DependencyNode> {
    const cacheKey = `${name}-${arch}`;

    // 순환 의존성 방지
    if (this.visited.has(cacheKey)) {
      return this.visited.get(cacheKey)!;
    }

    // 최대 깊이 도달
    if (depth >= maxDepth) {
      return {
        package: {
          type: 'yum',
          name,
          version,
          arch,
        },
        dependencies: [],
      };
    }

    try {
      // 패키지 찾기
      const pkg = this.findPackage(name, version, arch);

      if (!pkg) {
        return {
          package: { type: 'yum', name, version, arch },
          dependencies: [],
        };
      }

      const packageInfo: PackageInfo = {
        type: 'yum',
        name: pkg.name,
        version: this.formatVersion(pkg.version),
        arch: pkg.arch as Architecture,
        metadata: {
          description: pkg.summary,
          downloadUrl: `${this.currentRepoUrl}${pkg.location['@_href']}`,
          size: pkg.size ? parseInt(pkg.size['@_package'], 10) : undefined,
          checksum: pkg.checksum
            ? { [pkg.checksum['@_type']]: pkg.checksum['#text'] }
            : undefined,
        },
      };

      const node: DependencyNode = {
        package: packageInfo,
        dependencies: [],
      };

      // 캐시에 저장
      this.visited.set(cacheKey, node);

      // 의존성 해결
      const requires = this.normalizeEntries(pkg.format?.['rpm:requires']?.['rpm:entry']);

      for (const req of requires) {
        // 시스템 라이브러리 건너뛰기
        if (this.isSystemDependency(req['@_name'])) {
          continue;
        }

        // 의존성 제공자 찾기
        const provider = this.findProvider(req['@_name'], arch);

        if (provider && provider.name !== name) {
          const childNode = await this.resolvePackage(
            provider.name,
            this.formatVersion(provider.version),
            arch,
            depth + 1,
            maxDepth
          );
          node.dependencies.push(childNode);
        }
      }

      return node;
    } catch (error) {
      logger.error('YUM 패키지 의존성 해결 실패', { name, version, error });
      return {
        package: { type: 'yum', name, version, arch },
        dependencies: [],
      };
    }
  }

  /**
   * 메타데이터 로드
   */
  private async loadMetadata(repoUrl: string): Promise<void> {
    if (this.metadataLoaded && this.currentRepoUrl === repoUrl) {
      return;
    }

    this.packagesByName.clear();
    this.providerCache.clear();
    this.currentRepoUrl = repoUrl;

    // repomd.xml 조회
    const repomdUrl = `${repoUrl}repodata/repomd.xml`;
    const repomdResponse = await axios.get<string>(repomdUrl);
    const repomd = this.parser.parse(repomdResponse.data);

    // primary.xml 위치 찾기
    const dataList = Array.isArray(repomd.repomd.data)
      ? repomd.repomd.data
      : [repomd.repomd.data];
    const primaryData = dataList.find((d: { '@_type': string }) => d['@_type'] === 'primary');

    if (!primaryData) {
      throw new Error('primary.xml을 찾을 수 없습니다');
    }

    const primaryHref = primaryData.location['@_href'];
    const primaryUrl = `${repoUrl}${primaryHref}`;

    // primary.xml 다운로드 및 파싱
    const primaryResponse = await axios.get(primaryUrl, {
      responseType: 'arraybuffer',
    });

    let primaryXml: string;
    if (primaryHref.endsWith('.gz')) {
      primaryXml = zlib.gunzipSync(primaryResponse.data).toString('utf-8');
    } else {
      primaryXml = primaryResponse.data.toString('utf-8');
    }

    const primary = this.parser.parse(primaryXml);
    const pkgList = primary.metadata?.package;

    if (pkgList) {
      const pkgArray = Array.isArray(pkgList) ? pkgList : [pkgList];

      for (const pkg of pkgArray) {
        const typedPkg = pkg as PrimaryPackage;

        // 이름으로 인덱싱
        if (!this.packagesByName.has(typedPkg.name)) {
          this.packagesByName.set(typedPkg.name, []);
        }
        this.packagesByName.get(typedPkg.name)!.push(typedPkg);

        // provides로 인덱싱
        const provides = this.normalizeEntries(typedPkg.format?.['rpm:provides']?.['rpm:entry']);
        for (const prov of provides) {
          if (!this.providerCache.has(prov['@_name'])) {
            this.providerCache.set(prov['@_name'], typedPkg);
          }
        }
      }
    }

    this.metadataLoaded = true;
    logger.info('YUM 메타데이터 로드 완료', {
      repoUrl,
      packageCount: this.packagesByName.size,
    });
  }

  /**
   * 패키지 찾기
   */
  private findPackage(
    name: string,
    version: string,
    arch: Architecture
  ): PrimaryPackage | null {
    const packages = this.packagesByName.get(name);
    if (!packages) return null;

    // 아키텍처 필터링 (noarch 포함)
    const filtered = packages.filter(
      (p) => p.arch === arch || p.arch === 'noarch'
    );

    if (filtered.length === 0) return null;

    // 버전 매칭
    if (version && version !== 'latest') {
      const matched = filtered.find((p) =>
        this.formatVersion(p.version).startsWith(version)
      );
      if (matched) return matched;
    }

    // 최신 버전 반환
    return filtered[0];
  }

  /**
   * 의존성 제공자 찾기
   */
  private findProvider(capability: string, arch: Architecture): PrimaryPackage | null {
    // 먼저 정확한 이름으로 찾기
    const byName = this.packagesByName.get(capability);
    if (byName) {
      const filtered = byName.filter(
        (p) => p.arch === arch || p.arch === 'noarch'
      );
      if (filtered.length > 0) return filtered[0];
    }

    // provides에서 찾기
    const provider = this.providerCache.get(capability);
    if (provider && (provider.arch === arch || provider.arch === 'noarch')) {
      return provider;
    }

    return null;
  }

  /**
   * 시스템 의존성 여부 확인
   */
  private isSystemDependency(name: string): boolean {
    // 시스템 라이브러리 패턴
    const systemPatterns = [
      /^lib.*\.so/,
      /^\/usr\//,
      /^\/bin\//,
      /^\/etc\//,
      /^\/lib/,
      /^rpmlib\(/,
      /^config\(/,
      /^rtld\(/,
      /^libc\.so/,
      /^libpthread/,
      /^libm\.so/,
      /^libdl\.so/,
      /^librt\.so/,
      /^ld-linux/,
    ];

    return systemPatterns.some((pattern) => pattern.test(name));
  }

  /**
   * RPM 엔트리 정규화
   */
  private normalizeEntries(entries: RpmEntry | RpmEntry[] | undefined): RpmEntry[] {
    if (!entries) return [];
    return Array.isArray(entries) ? entries : [entries];
  }

  /**
   * 버전 형식화
   */
  private formatVersion(version: {
    '@_ver': string;
    '@_rel': string;
    '@_epoch'?: string;
  }): string {
    const epoch = version['@_epoch'];
    const ver = version['@_ver'];
    const rel = version['@_rel'];

    if (epoch && epoch !== '0') {
      return `${epoch}:${ver}-${rel}`;
    }
    return `${ver}-${rel}`;
  }

  /**
   * 의존성 트리 평탄화
   */
  private flattenDependencies(node: DependencyNode): PackageInfo[] {
    const result: Map<string, PackageInfo> = new Map();

    const traverse = (n: DependencyNode) => {
      const key = `${n.package.name}-${n.package.arch}`;
      if (!result.has(key)) {
        result.set(key, n.package);
        n.dependencies.forEach(traverse);
      }
    };

    traverse(node);
    return Array.from(result.values());
  }

  /**
   * 텍스트 파싱 (패키지 목록)
   */
  async parseFromText(content: string): Promise<PackageInfo[]> {
    const lines = content.split('\n');
    const packages: PackageInfo[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // 형식: package-name 또는 package-name-version
      const match = trimmed.match(/^([a-zA-Z0-9._+-]+?)(?:-(\d.*))?$/);
      if (match) {
        packages.push({
          type: 'yum',
          name: match[1],
          version: match[2] || 'latest',
        });
      }
    }

    return packages;
  }

  /**
   * 캐시 클리어
   */
  clearCache(): void {
    this.packagesByName.clear();
    this.providerCache.clear();
    this.visited.clear();
    this.metadataLoaded = false;
  }
}

// 싱글톤 인스턴스
let yumResolverInstance: YumResolver | null = null;

export function getYumResolver(): YumResolver {
  if (!yumResolverInstance) {
    yumResolverInstance = new YumResolver();
  }
  return yumResolverInstance;
}
