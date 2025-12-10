import {
  IResolver,
  PackageInfo,
  DependencyNode,
  DependencyResolutionResult,
  DependencyConflict,
  ResolverOptions,
} from '../../types';
import logger from '../../utils/logger';
import { PyPIInfo, PyPIResponse } from '../shared/pip-types';
import { compareVersions, isVersionCompatible } from '../shared';
import { fetchPackageMetadata, clearMemoryCache as clearPipCache, PipCacheOptions } from '../shared/pip-cache';

// 의존성 파싱 결과
interface ParsedDependency {
  name: string;
  versionSpec?: string;
  extras?: string[];
  markers?: string;
}

// 타겟 플랫폼 타입
interface TargetPlatform {
  system?: 'Linux' | 'Windows' | 'Darwin';
  machine?: 'x86_64' | 'aarch64' | 'arm64';
}

export class PipResolver implements IResolver {
  readonly type = 'pip' as const;
  private readonly baseUrl = 'https://pypi.org/pypi';
  private visited: Map<string, DependencyNode> = new Map();
  private conflicts: DependencyConflict[] = [];
  private targetPlatform: TargetPlatform | null = null;
  private pythonVersion: string | null = null;
  private cacheOptions: PipCacheOptions = {};

  /**
   * 캐시 옵션 설정
   */
  setCacheOptions(options: PipCacheOptions): void {
    this.cacheOptions = options;
  }

  /**
   * 캐시 초기화
   */
  clearCache(): void {
    clearPipCache();
  }

  /**
   * 의존성 해결
   */
  async resolveDependencies(
    packageName: string,
    version: string,
    options?: ResolverOptions & { pythonVersion?: string }
  ): Promise<DependencyResolutionResult> {
    // 상태 초기화
    this.visited.clear();
    this.conflicts = [];
    this.targetPlatform = options?.targetPlatform ?? null;
    this.pythonVersion = options?.pythonVersion ?? null;

    const maxDepth = options?.maxDepth ?? 10;

    try {
      const root = await this.resolvePackage(packageName, version, 0, maxDepth);
      const flatList = this.flattenDependencies(root);

      return {
        root,
        flatList,
        conflicts: this.conflicts,
        totalSize: flatList.reduce(
          (sum, pkg) => sum + (pkg.metadata?.size || 0),
          0
        ),
      };
    } catch (error) {
      logger.error('의존성 해결 실패', { packageName, version, error });
      throw error;
    }
  }

  /**
   * 단일 패키지 의존성 해결 (재귀)
   */
  private async resolvePackage(
    name: string,
    version: string,
    depth: number,
    maxDepth: number
  ): Promise<DependencyNode> {
    // "latest" 버전인 경우 실제 최신 버전 조회
    let actualVersion = version;
    if (version === 'latest' || !version) {
      const latestVersion = await this.getLatestVersion(name);
      if (!latestVersion) {
        throw new Error(`패키지를 찾을 수 없음: ${name}@${version}`);
      }
      actualVersion = latestVersion;
      logger.debug('"latest" 버전을 실제 버전으로 변환', { name, version, actualVersion });
    }

    const cacheKey = `${name.toLowerCase()}@${actualVersion}`;

    // 이미 방문한 패키지인 경우 캐시된 결과 반환 (순환 의존성 방지)
    if (this.visited.has(cacheKey)) {
      return this.visited.get(cacheKey)!;
    }

    // 최대 깊이 도달
    if (depth >= maxDepth) {
      const node: DependencyNode = {
        package: { type: 'pip', name, version: actualVersion },
        dependencies: [],
      };
      return node;
    }

    try {
      // PyPI에서 패키지 정보 조회 (캐시 사용)
      const cacheResult = await fetchPackageMetadata(name, actualVersion, this.cacheOptions);
      if (!cacheResult) {
        throw new Error(`패키지를 찾을 수 없음: ${name}@${actualVersion}`);
      }
      const { info } = cacheResult.data;

      const packageInfo: PackageInfo = {
        type: 'pip',
        name: info.name,
        version: info.version,
        metadata: {
          description: '',
        },
      };

      const node: DependencyNode = {
        package: packageInfo,
        dependencies: [],
      };

      // 캐시에 먼저 저장 (순환 참조 방지)
      this.visited.set(cacheKey, node);

      // requires_dist 파싱 및 의존성 해결
      if (info.requires_dist) {
        const parsedDeps = info.requires_dist
          .map((dep) => this.parseDependencyString(dep))
          .filter((dep) => dep !== null && this.evaluateMarker(dep.markers)); // 환경 마커 평가

        for (const dep of parsedDeps) {
          if (!dep) continue;

          try {
            // 최신 버전 조회
            const depVersion = await this.getLatestVersion(
              dep.name,
              dep.versionSpec
            );
            if (depVersion) {
              const childNode = await this.resolvePackage(
                dep.name,
                depVersion,
                depth + 1,
                maxDepth
              );
              node.dependencies.push(childNode);
            }
          } catch (error) {
            logger.warn('의존성 패키지 조회 실패', {
              parent: name,
              dependency: dep.name,
              error,
            });
          }
        }
      }

      return node;
    } catch (error) {
      logger.error('패키지 정보 조회 실패', { name, version: actualVersion, error });
      throw error;
    }
  }

  /**
   * 의존성 문자열 파싱
   * 예: "requests>=2.20.0", "urllib3[socks]>=1.21.1,<1.27"
   */
  private parseDependencyString(depString: string): ParsedDependency | null {
    try {
      // 환경 마커 분리 (;로 구분)
      const [mainPart, markers] = depString.split(';').map((s) => s.trim());

      // extras 추출 ([...] 부분)
      const extrasMatch = mainPart.match(/\[([^\]]+)\]/);
      const extras = extrasMatch ? extrasMatch[1].split(',').map((e) => e.trim()) : undefined;

      // extras 제거 후 이름과 버전 분리
      const withoutExtras = mainPart.replace(/\[[^\]]+\]/, '');

      // 버전 지정자 패턴
      const versionPattern = /(>=|<=|==|!=|~=|>|<|===)/;
      const match = withoutExtras.match(versionPattern);

      let name: string;
      let versionSpec: string | undefined;

      if (match) {
        const index = withoutExtras.indexOf(match[0]);
        name = withoutExtras.substring(0, index).trim();
        versionSpec = withoutExtras.substring(index).trim();
      } else {
        name = withoutExtras.trim();
      }

      // 패키지명 정규화 (소문자, 하이픈을 언더스코어로)
      name = name.toLowerCase().replace(/-/g, '_');

      return {
        name,
        versionSpec,
        extras,
        markers: markers || undefined,
      };
    } catch {
      return null;
    }
  }

  /**
   * 환경 마커 평가
   * targetPlatform이 설정된 경우 해당 플랫폼에 맞는 마커만 통과
   * targetPlatform이 없으면 마커가 없는 의존성만 통과 (기존 동작)
   */
  private evaluateMarker(marker?: string): boolean {
    // 마커가 없으면 항상 포함
    if (!marker) return true;

    // 타겟 플랫폼이 설정되지 않으면 마커가 있는 의존성 제외 (기존 동작)
    if (!this.targetPlatform) return false;

    const { system, machine } = this.targetPlatform;

    // extra 마커는 제외 (예: extra == "dev")
    if (marker.includes('extra')) return false;

    // platform_system 평가
    const systemMatch = marker.match(/platform_system\s*==\s*["'](\w+)["']/);
    if (systemMatch) {
      const requiredSystem = systemMatch[1];
      if (system && system !== requiredSystem) return false;
      if (!system) return false; // 시스템이 지정되지 않으면 제외
    }

    // platform_machine 평가
    const machineMatch = marker.match(/platform_machine\s*==\s*["'](\w+)["']/);
    if (machineMatch) {
      const requiredMachine = machineMatch[1];
      if (machine) {
        // x86_64와 amd64는 동일하게 처리
        const normalizedRequired = requiredMachine.toLowerCase();
        const normalizedTarget = machine.toLowerCase();
        const isX64 = (m: string) => m === 'x86_64' || m === 'amd64';

        if (isX64(normalizedRequired) && isX64(normalizedTarget)) {
          // 둘 다 x64 계열이면 통과
        } else if (normalizedRequired !== normalizedTarget) {
          return false;
        }
      } else {
        return false; // 머신이 지정되지 않으면 제외
      }
    }

    // python_version 마커는 무시 (모든 버전 포함)
    // sys_platform 평가
    const sysPlatformMatch = marker.match(/sys_platform\s*==\s*["'](\w+)["']/);
    if (sysPlatformMatch) {
      const requiredPlatform = sysPlatformMatch[1];
      const platformMap: Record<string, string> = {
        'Linux': 'linux',
        'Windows': 'win32',
        'Darwin': 'darwin',
      };
      if (system && platformMap[system] !== requiredPlatform) return false;
      if (!system) return false;
    }

    // 모든 조건을 통과하면 포함
    return true;
  }

  /**
   * 버전 스펙에 맞는 최신 버전 조회 (캐시 사용)
   */
  private async getLatestVersion(
    name: string,
    versionSpec?: string
  ): Promise<string | null> {
    try {
      // 캐시에서 패키지 메타데이터 조회
      const cacheResult = await fetchPackageMetadata(name, undefined, this.cacheOptions);
      if (!cacheResult) return null;

      const { data } = cacheResult;
      const versions = Object.keys(data.releases).filter(
        (v) => data.releases[v].length > 0 // 실제 릴리스가 있는 버전만
      );

      if (versions.length === 0) return null;

      // 버전 스펙이 없으면 최신 버전
      if (!versionSpec) {
        return data.info.version;
      }

      // 버전 스펙 파싱 및 필터링
      const compatibleVersions = versions.filter((v) =>
        isVersionCompatible(v, versionSpec)
      );

      if (compatibleVersions.length === 0) {
        // 호환 버전이 없으면 최신 버전 사용 (충돌 기록)
        this.conflicts.push({
          type: 'version',
          packageName: name,
          versions: [versionSpec, data.info.version],
          resolvedVersion: data.info.version,
        });
        return data.info.version;
      }

      // 최신 호환 버전 반환
      return compatibleVersions.sort((a, b) =>
        compareVersions(b, a)
      )[0];
    } catch {
      return null;
    }
  }

  /**
   * 의존성 트리를 평탄화
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
   * requirements.txt 파싱
   */
  async parseFromText(content: string): Promise<PackageInfo[]> {
    const lines = content.split('\n');
    const packages: PackageInfo[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // 빈 줄, 주석, 옵션(-r, -e, --) 무시
      if (
        !trimmed ||
        trimmed.startsWith('#') ||
        trimmed.startsWith('-r') ||
        trimmed.startsWith('-e') ||
        trimmed.startsWith('--')
      ) {
        continue;
      }

      const parsed = this.parseDependencyString(trimmed);
      if (parsed) {
        // 버전 추출 또는 최신 버전 조회
        let version = 'latest';

        if (parsed.versionSpec) {
          // ==로 고정된 버전 추출
          const exactMatch = parsed.versionSpec.match(/^==(.+)$/);
          if (exactMatch) {
            version = exactMatch[1];
          } else {
            // 다른 버전 스펙이면 호환 버전 조회
            const compatVersion = await this.getLatestVersion(
              parsed.name,
              parsed.versionSpec
            );
            if (compatVersion) {
              version = compatVersion;
            }
          }
        } else {
          // 버전 지정 없으면 최신 버전 조회
          const latestVersion = await this.getLatestVersion(parsed.name);
          if (latestVersion) {
            version = latestVersion;
          }
        }

        packages.push({
          type: 'pip',
          name: parsed.name,
          version,
        });
      }
    }

    return packages;
  }
}

// 싱글톤 인스턴스
let pipResolverInstance: PipResolver | null = null;

export function getPipResolver(): PipResolver {
  if (!pipResolverInstance) {
    pipResolverInstance = new PipResolver();
  }
  return pipResolverInstance;
}
