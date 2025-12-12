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
import {
  RepoData,
  RepoDataPackage,
  CondaPackageFile,
} from '../shared/conda-types';
import {
  compareCondaVersions,
  matchesVersionSpec,
  parseMatchSpec as parseMatchSpecFn,
  getCondaSubdir,
  MatchSpec,
} from '../shared';
import { fetchRepodata } from '../shared/conda-cache';

// Resolver 전용 CondaPackageInfo (files, versions 추가 필드)
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

// 패키지 정보 (repodata에서 추출)
interface PackageCandidate {
  filename: string;
  name: string;
  version: string;
  build: string;
  buildNumber: number;
  depends: string[];
  subdir: string;
}

export class CondaResolver implements IResolver {
  readonly type = 'conda' as const;
  private readonly apiUrl = 'https://api.anaconda.org';
  private readonly condaUrl = 'https://conda.anaconda.org';
  private visited: Map<string, DependencyNode> = new Map();
  private conflicts: DependencyConflict[] = [];
  private defaultChannel = 'conda-forge';

  // repodata 캐시 (channel/subdir -> RepoData)
  private repodataCache: Map<string, RepoData> = new Map();

  // 패키지 이름별 인덱스 캐시 (channel/subdir -> Map<packageName, PackageEntry[]>)
  // O(n) 전체 순회 대신 O(1) 조회를 위한 인덱스
  private packageIndex: Map<string, Map<string, Array<{ filename: string; pkg: RepoDataPackage }>>> = new Map();

  // 타겟 플랫폼 설정
  private targetSubdir: string = 'linux-64';

  // Python 버전 설정
  private pythonVersion: string | null = null;

  /**
   * repodata에서 패키지 이름별 인덱스 생성 (O(n) -> O(1) 조회 최적화)
   */
  private buildPackageIndex(cacheKey: string, repodata: RepoData): Map<string, Array<{ filename: string; pkg: RepoDataPackage }>> {
    const startTime = Date.now();
    const index = new Map<string, Array<{ filename: string; pkg: RepoDataPackage }>>();

    // packages와 packages.conda 모두 인덱싱
    const allPackages = {
      ...repodata.packages,
      ...(repodata['packages.conda'] || {}),
    };

    for (const [filename, pkg] of Object.entries(allPackages)) {
      const normalizedName = pkg.name.toLowerCase();
      if (!index.has(normalizedName)) {
        index.set(normalizedName, []);
      }
      index.get(normalizedName)!.push({ filename, pkg });
    }

    const elapsed = Date.now() - startTime;
    logger.info(`패키지 인덱스 생성 완료: ${cacheKey} (${index.size}개 패키지명, ${elapsed}ms)`);

    return index;
  }

  /**
   * repodata.json 가져오기 (zstd 압축 우선, 캐싱 포함)
   */
  private async getRepoData(channel: string, subdir: string): Promise<RepoData | null> {
    const cacheKey = `${channel}/${subdir}`;

    // 메모리 캐시 확인 (세션 내 재사용)
    if (this.repodataCache.has(cacheKey)) {
      logger.debug(`repodata 메모리 캐시 사용: ${channel}/${subdir}`);
      return this.repodataCache.get(cacheKey)!;
    }

    logger.info(`repodata 로드 시작: ${channel}/${subdir} (처음 로드 시 시간이 걸릴 수 있습니다)`);

    // 파일 시스템 캐시 + HTTP 조건부 요청 사용
    const result = await fetchRepodata(channel, subdir, {
      baseUrl: this.condaUrl,
      useCache: true,
    });

    if (result) {
      // 메모리 캐시에도 저장 (세션 내 빠른 접근)
      this.repodataCache.set(cacheKey, result.data);

      // 패키지 이름별 인덱스 생성 (검색 최적화)
      const index = this.buildPackageIndex(cacheKey, result.data);
      this.packageIndex.set(cacheKey, index);

      logger.info(`repodata 로드 완료: ${channel}/${subdir}`, {
        fromCache: result.fromCache ? '디스크 캐시' : '네트워크',
        packages: result.meta.packageCount,
      });

      return result.data;
    }

    logger.error(`repodata 가져오기 실패: ${channel}/${subdir}`);
    return null;
  }

  /**
   * Python 버전에서 conda build 태그 추출 (예: "3.12" -> "py312")
   */
  private getPythonBuildTag(): string | null {
    if (!this.pythonVersion) return null;

    const match = this.pythonVersion.match(/^(\d+)\.(\d+)/);
    if (!match) return null;

    return `py${match[1]}${match[2]}`;
  }

  /**
   * build 문자열이 Python 버전과 호환되는지 확인
   */
  private isBuildCompatibleWithPython(build: string): boolean {
    const pythonTag = this.getPythonBuildTag();

    // pythonTag가 없으면 필터링 안함
    if (!pythonTag) return true;

    // build에 python 버전이 없으면 (네이티브 라이브러리) 호환
    const pyMatch = build.match(/py\d+/);
    if (!pyMatch) return true;

    // Python 버전이 있으면 정확히 매칭
    return build.includes(pythonTag);
  }

  /**
   * repodata에서 패키지 후보 찾기 (Conda MatchSpec 문법 지원)
   * 인덱스를 사용하여 O(1) 조회 최적화
   */
  private findPackageCandidates(
    repodata: RepoData,
    packageName: string,
    versionSpec?: string,
    cacheKey?: string
  ): PackageCandidate[] {
    const candidates: Array<PackageCandidate & { isPythonMatch: boolean; timestamp: number }> = [];
    const normalizedName = packageName.toLowerCase();

    // 인덱스가 있으면 O(1) 조회 사용
    let packageEntries: Array<{ filename: string; pkg: RepoDataPackage }> | undefined;
    if (cacheKey && this.packageIndex.has(cacheKey)) {
      packageEntries = this.packageIndex.get(cacheKey)?.get(normalizedName);
    }

    // 인덱스가 없으면 폴백: 전체 순회 (첫 로드 시)
    if (!packageEntries) {
      const allPackages = {
        ...repodata.packages,
        ...(repodata['packages.conda'] || {}),
      };
      packageEntries = [];
      for (const [filename, pkg] of Object.entries(allPackages)) {
        if (pkg.name.toLowerCase() === normalizedName) {
          packageEntries.push({ filename, pkg });
        }
      }
    }

    for (const { filename, pkg } of packageEntries) {
      // 버전 스펙 체크 (새로운 MatchSpec 파서 사용)
      if (versionSpec && !matchesVersionSpec(pkg.version, versionSpec)) {
        continue;
      }

      const isPythonMatch = this.isBuildCompatibleWithPython(pkg.build);

      candidates.push({
        filename,
        name: pkg.name,
        version: pkg.version,
        build: pkg.build,
        buildNumber: pkg.build_number,
        depends: pkg.depends || [],
        subdir: pkg.subdir || repodata.info?.subdir || 'noarch',
        isPythonMatch,
        timestamp: pkg.timestamp || 0,
      });
    }

    // 정렬 우선순위 (Conda SAT solver 최적화 순서 참고):
    // 1. Python 버전 매칭
    // 2. 버전 (내림차순 - 최신 우선)
    // 3. 빌드 번호 (내림차순)
    // 4. 타임스탬프 (내림차순 - 최신 우선)
    candidates.sort((a, b) => {
      // Python 매칭이 있는 것 우선
      if (a.isPythonMatch !== b.isPythonMatch) {
        return a.isPythonMatch ? -1 : 1;
      }

      // 버전 비교 (Conda 스타일)
      const versionCmp = compareCondaVersions(b.version, a.version);
      if (versionCmp !== 0) return versionCmp;

      // 빌드 번호
      const buildCmp = b.buildNumber - a.buildNumber;
      if (buildCmp !== 0) return buildCmp;

      // 타임스탬프
      return b.timestamp - a.timestamp;
    });

    return candidates;
  }

  /**
   * 의존성 해결
   */
  async resolveDependencies(
    packageName: string,
    version: string,
    options?: ResolverOptions & { channel?: string; pythonVersion?: string }
  ): Promise<DependencyResolutionResult> {
    this.visited.clear();
    this.conflicts = [];
    // repodata 캐시는 세션 동안 유지 (매번 초기화하지 않음)

    const channel = (options as { channel?: string })?.channel || this.defaultChannel;
    const maxDepth = options?.maxDepth ?? 10;

    // 타겟 플랫폼 결정
    const targetOS = options?.targetPlatform?.system?.toLowerCase() || 'linux';
    const arch = options?.targetPlatform?.machine || 'x86_64';
    this.targetSubdir = getCondaSubdir(targetOS, arch);

    // Python 버전 설정
    this.pythonVersion = (options as { pythonVersion?: string })?.pythonVersion || null;
    
    const startTime = Date.now();
    logger.info(`Conda 의존성 해결 시작: ${packageName}@${version}`, {
      channel,
      targetSubdir: this.targetSubdir,
      pythonVersion: this.pythonVersion,
    });

    try {
      const root = await this.resolvePackage(packageName, version, channel, 0, maxDepth);
      const flatList = this.flattenDependencies(root);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.info(`Conda 의존성 해결 완료: ${packageName}@${version} (${flatList.length}개 패키지, ${elapsed}초)`);

      return {
        root,
        flatList,
        conflicts: this.conflicts,
      };
    } catch (error) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.error(`Conda 의존성 해결 실패: ${packageName}@${version} (${elapsed}초)`, { error });
      throw error;
    }
  }

  /**
   * 단일 패키지 의존성 해결 (repodata.json 기반)
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
      // repodata에서 패키지 정보 조회
      let depends: string[] = [];
      let resolvedVersion = version;
      let resolvedSubdir: string | undefined;
      let resolvedFilename: string | undefined;

      // 먼저 타겟 플랫폼의 repodata 확인
      const targetCacheKey = `${channel}/${this.targetSubdir}`;
      const repodata = await this.getRepoData(channel, this.targetSubdir);
      if (repodata) {
        const candidates = this.findPackageCandidates(repodata, name, version === 'latest' ? undefined : `==${version}`, targetCacheKey);
        if (candidates.length > 0) {
          depends = candidates[0].depends;
          resolvedVersion = candidates[0].version;
          resolvedSubdir = candidates[0].subdir;
          resolvedFilename = candidates[0].filename;
        }
      }

      // noarch도 확인
      if (depends.length === 0) {
        const noarchCacheKey = `${channel}/noarch`;
        const noarchRepodata = await this.getRepoData(channel, 'noarch');
        if (noarchRepodata) {
          const candidates = this.findPackageCandidates(noarchRepodata, name, version === 'latest' ? undefined : `==${version}`, noarchCacheKey);
          if (candidates.length > 0) {
            depends = candidates[0].depends;
            resolvedVersion = candidates[0].version;
            resolvedSubdir = candidates[0].subdir;
            resolvedFilename = candidates[0].filename;
          }
        }
      }

      // repodata에서 못 찾으면 Anaconda API 폴백
      if (depends.length === 0) {
        const fallbackResult = await this.resolvePackageFallback(name, version, channel);
        if (fallbackResult) {
          depends = fallbackResult.depends;
          resolvedVersion = fallbackResult.version;
        }
      }

      // 다운로드 URL 생성 (subdir과 filename이 있는 경우)
      const downloadUrl = resolvedSubdir && resolvedFilename
        ? `${this.condaUrl}/${channel}/${resolvedSubdir}/${resolvedFilename}`
        : undefined;

      const packageInfo: PackageInfo = {
        type: 'conda',
        name,
        version: resolvedVersion,
        metadata: {
          repository: `${channel}/${name}`,
          subdir: resolvedSubdir,
          filename: resolvedFilename,
          downloadUrl,
        },
      };

      const node: DependencyNode = {
        package: packageInfo,
        dependencies: [],
      };

      // 캐시에 먼저 저장 (순환 참조 방지)
      this.visited.set(cacheKey, node);

      // 의존성 해결
      for (const depStr of depends) {
        const parsed = this.parseDependencyString(depStr);
        if (!parsed || this.isSystemPackage(parsed.name)) continue;

        try {
          const depVersion = await this.getLatestVersionFromRepoData(
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
   * Anaconda API 폴백 (repodata 조회 실패시)
   */
  private async resolvePackageFallback(
    name: string,
    version: string,
    channel: string
  ): Promise<{ depends: string[]; version: string } | null> {
    try {
      const response = await axios.get<CondaPackageInfo>(
        `${this.apiUrl}/package/${channel}/${name}`
      );
      const pkgInfo = response.data;

      // 버전에 맞는 파일 찾기
      const file = pkgInfo.files.find((f) => f.version === version);
      const depends = file?.attrs.depends || [];

      return { depends, version };
    } catch {
      return null;
    }
  }

  /**
   * repodata에서 최신 호환 버전 조회
   */
  private async getLatestVersionFromRepoData(
    name: string,
    channel: string,
    versionSpec?: string
  ): Promise<string | null> {
    // 타겟 플랫폼 repodata 확인
    const targetCacheKey = `${channel}/${this.targetSubdir}`;
    const repodata = await this.getRepoData(channel, this.targetSubdir);
    if (repodata) {
      const candidates = this.findPackageCandidates(repodata, name, versionSpec, targetCacheKey);
      if (candidates.length > 0) {
        return candidates[0].version;
      }
    }

    // noarch 확인
    const noarchCacheKey = `${channel}/noarch`;
    const noarchRepodata = await this.getRepoData(channel, 'noarch');
    if (noarchRepodata) {
      const candidates = this.findPackageCandidates(noarchRepodata, name, versionSpec, noarchCacheKey);
      if (candidates.length > 0) {
        return candidates[0].version;
      }
    }

    // 폴백: Anaconda API
    return this.getLatestVersion(name, channel, versionSpec);
  }

  /**
   * 의존성 문자열 파싱 (Conda MatchSpec 문법)
   * 지원 형식:
   * - "python >=3.6"
   * - "numpy 1.19.*"
   * - "libgcc-ng >=7.5.0,<8.0a0"
   * - "pytorch=1.8.*=*cuda*"
   * - "conda-forge::numpy"
   */
  private parseDependencyString(depStr: string): ParsedDependency | null {
    try {
      const matchSpec = parseMatchSpecFn(depStr);
      return {
        name: matchSpec.name,
        versionSpec: matchSpec.version,
        build: matchSpec.build,
      };
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
      'libuuid',
      'libzlib',
      'libexpat',
      'libnsl',
      'libxcrypt',
      'libsqlite',
      '__glibc',
      '__linux',
      '__unix',
    ];
    return systemPackages.includes(name.toLowerCase());
  }

  /**
   * 최신 호환 버전 조회 (Anaconda API 폴백)
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

      // 버전 정렬 (Conda 스타일, 내림차순)
      const sortedVersions = [...versions].sort((a, b) =>
        compareCondaVersions(b, a)
      );

      if (!versionSpec) {
        return sortedVersions[0]; // 최신 버전
      }

      // 버전 스펙 필터링 (새로운 MatchSpec 파서 사용)
      const compatible = sortedVersions.filter((v) =>
        matchesVersionSpec(v, versionSpec)
      );

      if (compatible.length > 0) {
        return compatible[0]; // 정렬된 목록에서 첫 번째 (최신)
      }

      // 호환 버전 없으면 최신 버전 사용
      this.conflicts.push({
        type: 'version',
        packageName: name,
        versions: [versionSpec, sortedVersions[0]],
        resolvedVersion: sortedVersions[0],
      });

      return sortedVersions[0];
    } catch {
      return null;
    }
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
   * repodata 캐시 초기화
   */
  clearCache(): void {
    this.repodataCache.clear();
    this.packageIndex.clear();
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
                const compatVersion = await this.getLatestVersionFromRepoData(
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
