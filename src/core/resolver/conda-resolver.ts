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
    // repodata 캐시는 세션 동안 유지 (매번 초기화하지 않음)

    const channel = (options as { channel?: string })?.channel || this.defaultChannel;
    const maxDepth = options?.maxDepth ?? 10;

    // 타겟 플랫폼 결정
    const targetOS = options?.targetPlatform?.system?.toLowerCase() || 'linux';
    const arch = options?.targetPlatform?.machine || 'x86_64';
    const targetSubdir = getCondaSubdir(targetOS, arch);

    // Python 버전 설정
    this.pythonVersion = (options as { pythonVersion?: string })?.pythonVersion || null;

    // RepoData 프로세서 설정 업데이트
    this.repoDataProcessor.updateConfig({
      targetSubdir,
      pythonVersion: this.pythonVersion,
    });
    
    const startTime = Date.now();
    logger.info(`Conda 의존성 해결 시작: ${packageName}@${version}`, {
      channel,
      targetSubdir,
      pythonVersion: this.pythonVersion,
    });

    try {
      const root = await this.resolvePackage(packageName, version, channel, 0, maxDepth);
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

    // 최대 깊이 도달 - 의존성은 해결하지 않지만 패키지 정보는 조회하여 downloadUrl 설정
    if (depth >= maxDepth) {
      const targetSubdir = this.repoDataProcessor.targetSubdir;
      const targetCacheKey = `${channel}/${targetSubdir}`;
      const repodata = await this.repoDataProcessor.getRepoData(channel, targetSubdir);

      if (repodata) {
        const versionSpec = version === 'latest' ? undefined : `==${version}`;
        const candidates = this.repoDataProcessor.findPackageCandidates(repodata, name, versionSpec, targetCacheKey);
        if (candidates.length > 0) {
          const downloadUrl = `${this.condaUrl}/${channel}/${candidates[0].subdir}/${candidates[0].filename}`;
          return {
            package: {
              type: 'conda',
              name,
              version: candidates[0].version,
              metadata: {
                repository: `${channel}/${name}`,
                subdir: candidates[0].subdir,
                filename: candidates[0].filename,
                downloadUrl,
                size: candidates[0].size,
              },
            },
            dependencies: [],
          };
        }
      }

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
          // 첫 번째 후보가 Python 버전과 호환되는지 확인 (정렬 우선순위에 따라 호환되는 것이 먼저 옴)
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
          const candidates = this.repoDataProcessor.findPackageCandidates(noarchRepodata, name, version === 'latest' ? undefined : `==${version}`, noarchCacheKey);
          if (candidates.length > 0) {
            // noarch 패키지는 모든 Python 버전과 호환되므로 우선 사용
            isPythonMatch = true; // noarch는 항상 호환
            depends = candidates[0].depends;
            resolvedVersion = candidates[0].version;
            resolvedSubdir = candidates[0].subdir;
            resolvedFilename = candidates[0].filename;
            resolvedSize = candidates[0].size;
          }
        }
      }

      // Python 버전 불일치 시 스킵 (strict mode)
      if (!isPythonMatch && depends.length > 0) {
        logger.warn(`Python 버전 불일치로 스킵: ${name}@${version} (Python ${this.pythonVersion}용 빌드 없음)`);
        return {
          package: { type: 'conda', name, version },
          dependencies: [],
        };
      }

      // repodata에서 못 찾은 경우 (API fallback 제거 - 플랫폼 불일치 방지)
      if (depends.length === 0 && !resolvedSubdir) {
        logger.debug(`repodata에서 찾지 못함: ${name}@${version} (${channel})`);
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
          size: resolvedSize,
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
          const depVersion = await this.repoDataProcessor.getLatestVersionFromRepoData(
            parsed.name,
            channel,
            parsed.versionSpec,
            (name, ch, spec) => this.getLatestVersion(name, ch, spec)
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
