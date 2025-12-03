import axios from 'axios';
import * as yaml from 'js-yaml';
import {
  IResolver,
  PackageInfo,
  DependencyNode,
  DependencyResolutionResult,
  DependencyConflict,
  ResolverOptions,
} from '../../types';
import logger from '../../utils/logger';

// Anaconda API 응답 타입
interface CondaPackageFile {
  version: string;
  attrs: {
    depends?: string[];
    subdir?: string;
  };
}

interface CondaPackageInfo {
  name: string;
  files: CondaPackageFile[];
  versions: string[];
}

// environment.yml 구조
interface EnvironmentYml {
  name?: string;
  channels?: string[];
  dependencies?: (string | { pip?: string[] })[];
}

// 파싱된 의존성
interface ParsedDependency {
  name: string;
  versionSpec?: string;
  build?: string;
}

export class CondaResolver implements IResolver {
  readonly type = 'conda' as const;
  private readonly apiUrl = 'https://api.anaconda.org';
  private visited: Map<string, DependencyNode> = new Map();
  private conflicts: DependencyConflict[] = [];
  private defaultChannel = 'conda-forge';

  /**
   * 의존성 해결
   */
  async resolveDependencies(
    packageName: string,
    version: string,
    options?: ResolverOptions & { channel?: string }
  ): Promise<DependencyResolutionResult> {
    this.visited.clear();
    this.conflicts = [];

    const channel = (options as { channel?: string })?.channel || this.defaultChannel;
    const maxDepth = options?.maxDepth ?? 10;

    try {
      const root = await this.resolvePackage(packageName, version, channel, 0, maxDepth);
      const flatList = this.flattenDependencies(root);

      return {
        root,
        flatList,
        conflicts: this.conflicts,
      };
    } catch (error) {
      logger.error('Conda 의존성 해결 실패', { packageName, version, channel, error });
      throw error;
    }
  }

  /**
   * 단일 패키지 의존성 해결 (재귀)
   */
  private async resolvePackage(
    name: string,
    version: string,
    channel: string,
    depth: number,
    maxDepth: number
  ): Promise<DependencyNode> {
    const cacheKey = `${channel}/${name.toLowerCase()}@${version}`;

    // 순환 의존성 방지
    if (this.visited.has(cacheKey)) {
      return this.visited.get(cacheKey)!;
    }

    // 최대 깊이 도달
    if (depth >= maxDepth) {
      return {
        package: { type: 'conda', name, version },
        dependencies: [],
      };
    }

    try {
      // 패키지 정보 조회
      const response = await axios.get<CondaPackageInfo>(
        `${this.apiUrl}/package/${channel}/${name}`
      );
      const pkgInfo = response.data;

      // 버전에 맞는 파일 찾기
      const file = pkgInfo.files.find((f) => f.version === version);
      const depends = file?.attrs.depends || [];

      const packageInfo: PackageInfo = {
        type: 'conda',
        name: pkgInfo.name,
        version,
        metadata: {
          repository: `${channel}/${name}`,
        },
      };

      const node: DependencyNode = {
        package: packageInfo,
        dependencies: [],
      };

      // 캐시에 먼저 저장
      this.visited.set(cacheKey, node);

      // 의존성 해결
      for (const depStr of depends) {
        const parsed = this.parseDependencyString(depStr);
        if (!parsed || this.isSystemPackage(parsed.name)) continue;

        try {
          const depVersion = await this.getLatestVersion(
            parsed.name,
            channel,
            parsed.versionSpec
          );

          if (depVersion) {
            const childNode = await this.resolvePackage(
              parsed.name,
              depVersion,
              channel,
              depth + 1,
              maxDepth
            );
            node.dependencies.push(childNode);
          }
        } catch {
          // 의존성을 찾을 수 없는 경우 건너뛰기
          logger.warn('Conda 의존성 패키지 조회 실패', {
            parent: name,
            dependency: parsed.name,
          });
        }
      }

      return node;
    } catch (error) {
      logger.error('Conda 패키지 정보 조회 실패', { name, version, channel, error });
      throw error;
    }
  }

  /**
   * 의존성 문자열 파싱
   * 예: "python >=3.6", "numpy 1.19.*", "libgcc-ng >=7.5.0"
   */
  private parseDependencyString(depStr: string): ParsedDependency | null {
    try {
      const parts = depStr.trim().split(/\s+/);
      const name = parts[0];
      const versionSpec = parts.slice(1).join(' ') || undefined;

      return { name, versionSpec };
    } catch {
      return null;
    }
  }

  /**
   * 시스템 패키지 여부 확인 (건너뛸 패키지)
   */
  private isSystemPackage(name: string): boolean {
    const systemPackages = [
      'python',
      'python_abi',
      'libgcc-ng',
      'libstdcxx-ng',
      'libgomp',
      'openssl',
      'ca-certificates',
      'certifi',
      'ld_impl_linux-64',
      '_libgcc_mutex',
      '_openmp_mutex',
      'libffi',
      'ncurses',
      'readline',
      'sqlite',
      'tk',
      'xz',
      'zlib',
      'bzip2',
    ];
    return systemPackages.includes(name.toLowerCase());
  }

  /**
   * 최신 호환 버전 조회
   */
  private async getLatestVersion(
    name: string,
    channel: string,
    versionSpec?: string
  ): Promise<string | null> {
    try {
      const response = await axios.get<CondaPackageInfo>(
        `${this.apiUrl}/package/${channel}/${name}`
      );
      const versions = response.data.versions;

      if (versions.length === 0) return null;

      if (!versionSpec) {
        return versions[versions.length - 1]; // 최신 버전
      }

      // 버전 스펙 필터링
      const compatible = versions.filter((v) =>
        this.isVersionCompatible(v, versionSpec)
      );

      if (compatible.length > 0) {
        return compatible[compatible.length - 1];
      }

      // 호환 버전 없으면 최신 버전 사용
      this.conflicts.push({
        type: 'version',
        packageName: name,
        versions: [versionSpec, versions[versions.length - 1]],
        resolvedVersion: versions[versions.length - 1],
      });

      return versions[versions.length - 1];
    } catch {
      return null;
    }
  }

  /**
   * 버전 호환성 체크
   */
  private isVersionCompatible(version: string, spec: string): boolean {
    // 간단한 버전 스펙 처리
    if (spec.includes('>=')) {
      const target = spec.replace('>=', '').trim();
      return this.compareVersions(version, target) >= 0;
    }
    if (spec.includes('<=')) {
      const target = spec.replace('<=', '').trim();
      return this.compareVersions(version, target) <= 0;
    }
    if (spec.includes('>')) {
      const target = spec.replace('>', '').trim();
      return this.compareVersions(version, target) > 0;
    }
    if (spec.includes('<')) {
      const target = spec.replace('<', '').trim();
      return this.compareVersions(version, target) < 0;
    }
    if (spec.includes('==')) {
      const target = spec.replace('==', '').trim();
      if (target.includes('*')) {
        const prefix = target.replace('*', '');
        return version.startsWith(prefix);
      }
      return version === target;
    }
    if (spec.includes('*')) {
      const prefix = spec.replace('*', '').trim();
      return version.startsWith(prefix);
    }
    return true;
  }

  /**
   * 버전 비교
   */
  private compareVersions(a: string, b: string): number {
    const normalize = (v: string) =>
      v.split('.').map((p) => parseInt(p, 10) || 0);

    const partsA = normalize(a);
    const partsB = normalize(b);

    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const numA = partsA[i] || 0;
      const numB = partsB[i] || 0;
      if (numA !== numB) return numA - numB;
    }
    return 0;
  }

  /**
   * 의존성 트리 평탄화
   */
  private flattenDependencies(node: DependencyNode): PackageInfo[] {
    const result: Map<string, PackageInfo> = new Map();

    const traverse = (n: DependencyNode) => {
      const key = `${n.package.name.toLowerCase()}@${n.package.version}`;
      if (!result.has(key)) {
        result.set(key, n.package);
        n.dependencies.forEach(traverse);
      }
    };

    traverse(node);
    return Array.from(result.values());
  }

  /**
   * environment.yml 파싱
   */
  async parseFromText(content: string): Promise<PackageInfo[]> {
    try {
      const env = yaml.load(content) as EnvironmentYml;
      const packages: PackageInfo[] = [];

      if (!env.dependencies) return packages;

      for (const dep of env.dependencies) {
        if (typeof dep === 'string') {
          // conda 패키지
          const parsed = this.parseDependencyString(dep);
          if (parsed && !this.isSystemPackage(parsed.name)) {
            let version = 'latest';

            if (parsed.versionSpec) {
              // ==로 고정된 버전
              const exactMatch = parsed.versionSpec.match(/^==?(.+)$/);
              if (exactMatch) {
                version = exactMatch[1].replace('*', '');
              } else {
                // 호환 버전 조회
                const channel = env.channels?.[0] || this.defaultChannel;
                const compatVersion = await this.getLatestVersion(
                  parsed.name,
                  channel,
                  parsed.versionSpec
                );
                if (compatVersion) {
                  version = compatVersion;
                }
              }
            }

            packages.push({
              type: 'conda',
              name: parsed.name,
              version,
              metadata: {
                repository: `${env.channels?.[0] || this.defaultChannel}/${parsed.name}`,
              },
            });
          }
        } else if (dep.pip) {
          // pip 패키지는 별도 처리 (pip resolver로 위임)
          for (const pipPkg of dep.pip) {
            const match = pipPkg.match(/^([a-zA-Z0-9_-]+)(?:[=<>!~]+(.+))?$/);
            if (match) {
              packages.push({
                type: 'pip',
                name: match[1],
                version: match[2] || 'latest',
              });
            }
          }
        }
      }

      return packages;
    } catch (error) {
      logger.error('environment.yml 파싱 실패', { error });
      throw error;
    }
  }
}

// 싱글톤 인스턴스
let condaResolverInstance: CondaResolver | null = null;

export function getCondaResolver(): CondaResolver {
  if (!condaResolverInstance) {
    condaResolverInstance = new CondaResolver();
  }
  return condaResolverInstance;
}
