import axios from 'axios';
import {
  IResolver,
  PackageInfo,
  DependencyNode,
  DependencyResolutionResult,
  DependencyConflict,
  ResolverOptions,
} from '../../types';
import logger from '../../utils/logger';

// PyPI API 응답 타입
interface PyPIInfo {
  name: string;
  version: string;
  requires_dist?: string[];
}

interface PyPIResponse {
  info: PyPIInfo;
  releases: Record<string, unknown[]>;
}

// 의존성 파싱 결과
interface ParsedDependency {
  name: string;
  versionSpec?: string;
  extras?: string[];
  markers?: string;
}

export class PipResolver implements IResolver {
  readonly type = 'pip' as const;
  private readonly baseUrl = 'https://pypi.org/pypi';
  private visited: Map<string, DependencyNode> = new Map();
  private conflicts: DependencyConflict[] = [];

  /**
   * 의존성 해결
   */
  async resolveDependencies(
    packageName: string,
    version: string,
    options?: ResolverOptions
  ): Promise<DependencyResolutionResult> {
    // 상태 초기화
    this.visited.clear();
    this.conflicts = [];

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
    const cacheKey = `${name.toLowerCase()}@${version}`;

    // 이미 방문한 패키지인 경우 캐시된 결과 반환 (순환 의존성 방지)
    if (this.visited.has(cacheKey)) {
      return this.visited.get(cacheKey)!;
    }

    // 최대 깊이 도달
    if (depth >= maxDepth) {
      const node: DependencyNode = {
        package: { type: 'pip', name, version },
        dependencies: [],
      };
      return node;
    }

    try {
      // PyPI에서 패키지 정보 조회
      const response = await axios.get<PyPIResponse>(
        `${this.baseUrl}/${name}/${version}/json`
      );
      const { info } = response.data;

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
          .filter((dep) => dep !== null && !dep.markers); // 환경 마커가 없는 것만

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
      logger.error('패키지 정보 조회 실패', { name, version, error });
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
   * 버전 스펙에 맞는 최신 버전 조회
   */
  private async getLatestVersion(
    name: string,
    versionSpec?: string
  ): Promise<string | null> {
    try {
      const response = await axios.get<PyPIResponse>(
        `${this.baseUrl}/${name}/json`
      );
      const versions = Object.keys(response.data.releases).filter(
        (v) => response.data.releases[v].length > 0 // 실제 릴리스가 있는 버전만
      );

      if (versions.length === 0) return null;

      // 버전 스펙이 없으면 최신 버전
      if (!versionSpec) {
        return response.data.info.version;
      }

      // 버전 스펙 파싱 및 필터링
      const compatibleVersions = versions.filter((v) =>
        this.isVersionCompatible(v, versionSpec)
      );

      if (compatibleVersions.length === 0) {
        // 호환 버전이 없으면 최신 버전 사용 (충돌 기록)
        this.conflicts.push({
          type: 'version',
          packageName: name,
          versions: [versionSpec, response.data.info.version],
          resolvedVersion: response.data.info.version,
        });
        return response.data.info.version;
      }

      // 최신 호환 버전 반환
      return compatibleVersions.sort((a, b) =>
        this.compareVersions(b, a)
      )[0];
    } catch {
      return null;
    }
  }

  /**
   * 버전 호환성 체크
   */
  private isVersionCompatible(version: string, spec: string): boolean {
    // 여러 조건 처리 (,로 구분)
    const conditions = spec.split(',').map((s) => s.trim());

    return conditions.every((condition) => {
      if (condition.startsWith('>=')) {
        return this.compareVersions(version, condition.slice(2)) >= 0;
      }
      if (condition.startsWith('<=')) {
        return this.compareVersions(version, condition.slice(2)) <= 0;
      }
      if (condition.startsWith('==')) {
        const target = condition.slice(2);
        if (target.includes('*')) {
          // 와일드카드 처리 (예: ==2.*)
          const prefix = target.replace('*', '');
          return version.startsWith(prefix);
        }
        return version === target;
      }
      if (condition.startsWith('!=')) {
        return version !== condition.slice(2);
      }
      if (condition.startsWith('~=')) {
        // 호환 릴리스 (예: ~=2.1은 >=2.1, ==2.*)
        const base = condition.slice(2);
        const parts = base.split('.');
        parts.pop();
        const prefix = parts.join('.');
        return (
          this.compareVersions(version, base) >= 0 &&
          version.startsWith(prefix)
        );
      }
      if (condition.startsWith('>')) {
        return this.compareVersions(version, condition.slice(1)) > 0;
      }
      if (condition.startsWith('<')) {
        return this.compareVersions(version, condition.slice(1)) < 0;
      }
      return true;
    });
  }

  /**
   * 버전 비교
   */
  private compareVersions(a: string, b: string): number {
    const normalize = (v: string) =>
      v.split('.').map((p) => {
        const num = parseInt(p, 10);
        return isNaN(num) ? 0 : num;
      });

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
