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
import { CondaPackageFile } from '../shared/conda-types';
import {
  compareCondaVersions,
  matchesVersionSpec,
  parseMatchSpec as parseMatchSpecFn,
  getCondaSubdir,
  flattenDependencyTree,
} from '../shared';
import {
  CondaRepoDataProcessor,
  PackageCandidate,
} from './conda-repodata-processor';

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

// PackageCandidate는 conda-repodata-processor.ts에서 import됨

export class CondaResolver implements IResolver {
  readonly type = 'conda' as const;
  private readonly apiUrl = 'https://api.anaconda.org';
  private readonly condaUrl = 'https://conda.anaconda.org';
  private visited: Map<string, DependencyNode> = new Map();
  private conflicts: DependencyConflict[] = [];
  private defaultChannel = 'conda-forge';

  // RepoData 프로세서 (캐싱, 검색 최적화 담당)
  private repoDataProcessor: CondaRepoDataProcessor;

  // Python 버전 설정 (프로세서에도 전달)
  private pythonVersion: string | null = null;

  constructor() {
    this.repoDataProcessor = new CondaRepoDataProcessor({
      condaUrl: this.condaUrl,
      targetSubdir: 'linux-64',
      pythonVersion: null,
      cudaVersion: null,
    });
  }

  // RepoData 관련 메서드들은 CondaRepoDataProcessor로 분리됨 (conda-repodata-processor.ts)

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

    const channel = (options as { channel?: string })?.channel || this.defaultChannel;
    const maxDepth = options?.maxDepth ?? 10;

    // 타겟 플랫폼 결정
    const targetOS = options?.targetPlatform?.system?.toLowerCase() || 'linux';
    const arch = options?.targetPlatform?.machine || 'x86_64';
    const targetSubdir = getCondaSubdir(targetOS, arch);

    // Python 버전 설정
    this.pythonVersion = (options as { pythonVersion?: string })?.pythonVersion || null;

    // CUDA 버전 설정
    const cudaVersion = (options as { cudaVersion?: string })?.cudaVersion || null;

    // RepoData 프로세서 설정 업데이트
    this.repoDataProcessor.updateConfig({
      targetSubdir,
      pythonVersion: this.pythonVersion,
      cudaVersion,
    });
    
    const startTime = Date.now();
    logger.info(`Conda 의존성 해결 시작: ${packageName}@${version}`, {
      channel,
      targetSubdir,
      pythonVersion: this.pythonVersion,
    });

    try {
      // BFS 기반 의존성 해결
      interface QueueItem {
        name: string;
        version: string;
        depth: number;
        parentCacheKey?: string;
      }

      const queue: QueueItem[] = [{ name: packageName, version, depth: 0 }];
      const resolvedNodes = new Map<string, DependencyNode>();
      const parentChildMap = new Map<string, string[]>();
      let rootCacheKey: string | undefined;

      while (queue.length > 0) {
        const current = queue.shift()!;
        const { name, version: ver, depth, parentCacheKey } = current;

        // 최대 깊이 체크
        if (depth > maxDepth) {
          continue;
        }

        const cacheKey = `${channel}/${name.toLowerCase()}@${ver}`;

        // 이미 해결된 패키지면 부모-자식 관계만 추가
        if (resolvedNodes.has(cacheKey)) {
          if (parentCacheKey) {
            const children = parentChildMap.get(parentCacheKey) || [];
            if (!children.includes(cacheKey)) {
              children.push(cacheKey);
              parentChildMap.set(parentCacheKey, children);
            }
          }
          continue;
        }

        // 루트 캐시키 저장
        if (!rootCacheKey) {
          rootCacheKey = cacheKey;
        }

        // 패키지 정보 조회
        const pkgInfo = await this.fetchPackageInfoBFS(name, ver, channel);

        // 노드 생성
        const node: DependencyNode = {
          package: pkgInfo.packageInfo,
          dependencies: [],
        };
        resolvedNodes.set(cacheKey, node);
        this.visited.set(cacheKey, node);

        // 부모-자식 관계 저장
        if (parentCacheKey) {
          const children = parentChildMap.get(parentCacheKey) || [];
          children.push(cacheKey);
          parentChildMap.set(parentCacheKey, children);
        }

        // Python 버전 불일치 시 스킵
        if (!pkgInfo.isPythonMatch && pkgInfo.depends.length > 0) {
          logger.warn(`Python 버전 불일치로 스킵: ${name}@${ver}`);
          continue;
        }

        // 의존성 큐에 추가
        for (const depStr of pkgInfo.depends) {
          const parsed = this.parseDependencyString(depStr);
          if (!parsed || this.isSystemPackage(parsed.name)) continue;

          try {
            const depVersion = await this.repoDataProcessor.getLatestVersionFromRepoData(
              parsed.name,
              channel,
              parsed.versionSpec,
              (n, ch, spec) => this.getLatestVersion(n, ch, spec)
            );

            if (depVersion) {
              const depCacheKey = `${channel}/${parsed.name.toLowerCase()}@${depVersion}`;
              if (!resolvedNodes.has(depCacheKey)) {
                queue.push({
                  name: parsed.name,
                  version: depVersion,
                  depth: depth + 1,
                  parentCacheKey: cacheKey,
                });
              } else {
                // 이미 해결된 경우 부모-자식 관계만 추가
                const children = parentChildMap.get(cacheKey) || [];
                if (!children.includes(depCacheKey)) {
                  children.push(depCacheKey);
                  parentChildMap.set(cacheKey, children);
                }
              }
            }
          } catch {
            logger.warn('Conda 의존성 패키지 조회 실패', { parent: name, dependency: parsed.name });
          }
        }
      }

      // 의존성 트리 구축
      if (!rootCacheKey || !resolvedNodes.has(rootCacheKey)) {
        throw new Error(`패키지를 찾을 수 없음: ${packageName}@${version}`);
      }

      for (const [parentKey, childKeys] of parentChildMap) {
        const parentNode = resolvedNodes.get(parentKey);
        if (parentNode) {
          for (const childKey of childKeys) {
            const childNode = resolvedNodes.get(childKey);
            if (childNode) {
              parentNode.dependencies.push(childNode);
            }
          }
        }
      }

      const root = resolvedNodes.get(rootCacheKey)!;
      const flatList = flattenDependencyTree(root);
      const totalSize = flatList.reduce((sum, pkg) => sum + ((pkg.metadata?.size as number) || 0), 0);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.info(`Conda 의존성 해결 완료: ${packageName}@${version} (${flatList.length}개 패키지, ${elapsed}초)`);

      return {
        root,
        flatList,
        conflicts: this.conflicts,
        totalSize,
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
  private async fetchPackageInfoBFS(
    name: string,
    version: string,
    channel: string
  ): Promise<{ packageInfo: PackageInfo; depends: string[]; isPythonMatch: boolean }> {
    // repodata에서 패키지 정보 조회
    let depends: string[] = [];
    let resolvedVersion = version;
    let resolvedSubdir: string | undefined;
    let resolvedFilename: string | undefined;
    let resolvedSize = 0;

    // 먼저 타겟 플랫폼의 repodata 확인
    const targetSubdir = this.repoDataProcessor.targetSubdir;
    const targetCacheKey = `${channel}/${targetSubdir}`;
    const repodata = await this.repoDataProcessor.getRepoData(channel, targetSubdir);
    let isPythonMatch = false;

    if (repodata) {
      const versionSpec = version === 'latest' ? undefined : `==${version}`;
      const candidates = this.repoDataProcessor.findPackageCandidates(repodata, name, versionSpec, targetCacheKey);
      if (candidates.length > 0) {
        isPythonMatch = (candidates[0] as { isPythonMatch?: boolean }).isPythonMatch ?? true;
        depends = candidates[0].depends;
        resolvedVersion = candidates[0].version;
        resolvedSubdir = candidates[0].subdir;
        resolvedFilename = candidates[0].filename;
        resolvedSize = candidates[0].size;
      }
    }

    // noarch도 확인: 후보가 없거나 Python 버전이 맞지 않는 경우
    if (depends.length === 0 || !isPythonMatch) {
      const noarchCacheKey = `${channel}/noarch`;
      const noarchRepodata = await this.repoDataProcessor.getRepoData(channel, 'noarch');
      if (noarchRepodata) {
        const candidates = this.repoDataProcessor.findPackageCandidates(
          noarchRepodata,
          name,
          version === 'latest' ? undefined : `==${version}`,
          noarchCacheKey
        );
        if (candidates.length > 0) {
          isPythonMatch = true; // noarch는 항상 호환
          depends = candidates[0].depends;
          resolvedVersion = candidates[0].version;
          resolvedSubdir = candidates[0].subdir;
          resolvedFilename = candidates[0].filename;
          resolvedSize = candidates[0].size;
        }
      }
    }

    // 다운로드 URL 생성
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
        size: resolvedSize,
      },
    };

    return { packageInfo, depends, isPythonMatch };
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

  // getLatestVersionFromRepoData는 CondaRepoDataProcessor로 분리됨

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
      '__win',
      '__osx',
      '__macos',
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
   * repodata 캐시 초기화
   */
  clearCache(): void {
    this.repoDataProcessor.clearCache();
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
                const compatVersion = await this.repoDataProcessor.getLatestVersionFromRepoData(
                  parsed.name,
                  channel,
                  parsed.versionSpec,
                  (name, ch, spec) => this.getLatestVersion(name, ch, spec)
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
