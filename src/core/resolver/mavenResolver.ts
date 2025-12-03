import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import {
  IResolver,
  PackageInfo,
  DependencyNode,
  DependencyResolutionResult,
  DependencyConflict,
  DependencyScope,
  ResolverOptions,
} from '../../types';
import logger from '../../utils/logger';

// POM 구조 타입
interface PomProject {
  parent?: {
    groupId?: string;
    artifactId?: string;
    version?: string;
  };
  groupId?: string;
  artifactId?: string;
  version?: string;
  packaging?: string;
  properties?: Record<string, string>;
  dependencyManagement?: {
    dependencies?: {
      dependency?: PomDependency | PomDependency[];
    };
  };
  dependencies?: {
    dependency?: PomDependency | PomDependency[];
  };
  build?: {
    plugins?: {
      plugin?: PomPlugin | PomPlugin[];
    };
  };
}

interface PomDependency {
  groupId: string;
  artifactId: string;
  version?: string;
  scope?: string;
  type?: string;
  optional?: string | boolean;
  exclusions?: {
    exclusion?: { groupId: string; artifactId: string } | { groupId: string; artifactId: string }[];
  };
}

interface PomPlugin {
  groupId?: string;
  artifactId: string;
  version?: string;
}

export class MavenResolver implements IResolver {
  readonly type = 'maven' as const;
  private readonly repoUrl = 'https://repo1.maven.org/maven2';
  private parser: XMLParser;
  private visited: Map<string, DependencyNode> = new Map();
  private conflicts: DependencyConflict[] = [];
  private dependencyManagement: Map<string, string> = new Map();

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
    options?: ResolverOptions
  ): Promise<DependencyResolutionResult> {
    this.visited.clear();
    this.conflicts = [];
    this.dependencyManagement.clear();

    const [groupId, artifactId] = packageName.split(':');
    const maxDepth = options?.maxDepth ?? 10;
    const includeOptional = options?.includeOptionalDependencies ?? false;

    try {
      const root = await this.resolvePackage(
        groupId,
        artifactId,
        version,
        0,
        maxDepth,
        includeOptional
      );
      const flatList = this.flattenDependencies(root);

      return {
        root,
        flatList,
        conflicts: this.conflicts,
      };
    } catch (error) {
      logger.error('Maven 의존성 해결 실패', { packageName, version, error });
      throw error;
    }
  }

  /**
   * 단일 패키지 의존성 해결 (재귀)
   */
  private async resolvePackage(
    groupId: string,
    artifactId: string,
    version: string,
    depth: number,
    maxDepth: number,
    includeOptional: boolean
  ): Promise<DependencyNode> {
    const cacheKey = `${groupId}:${artifactId}@${version}`;

    // 순환 의존성 방지
    if (this.visited.has(cacheKey)) {
      return this.visited.get(cacheKey)!;
    }

    // 최대 깊이 도달
    if (depth >= maxDepth) {
      return {
        package: {
          type: 'maven',
          name: `${groupId}:${artifactId}`,
          version,
          metadata: { groupId, artifactId },
        },
        dependencies: [],
      };
    }

    try {
      // POM 파일 조회
      const pom = await this.fetchPom(groupId, artifactId, version);

      const packageInfo: PackageInfo = {
        type: 'maven',
        name: `${groupId}:${artifactId}`,
        version,
        metadata: { groupId, artifactId },
      };

      const node: DependencyNode = {
        package: packageInfo,
        dependencies: [],
      };

      // 캐시에 먼저 저장
      this.visited.set(cacheKey, node);

      // Parent POM 처리
      if (pom.parent) {
        const parentGroupId = pom.parent.groupId || groupId;
        const parentArtifactId = pom.parent.artifactId;
        const parentVersion = this.resolveProperty(pom.parent.version || '', pom.properties);

        if (parentArtifactId && parentVersion) {
          try {
            const parentPom = await this.fetchPom(parentGroupId, parentArtifactId, parentVersion);
            // Parent의 dependencyManagement 상속
            this.processDependencyManagement(parentPom, pom.properties);
          } catch {
            // Parent POM을 찾을 수 없어도 계속 진행
          }
        }
      }

      // 현재 POM의 dependencyManagement 처리
      this.processDependencyManagement(pom, pom.properties);

      // Dependencies 처리
      const dependencies = this.normalizeDependencies(pom.dependencies?.dependency);

      for (const dep of dependencies) {
        // scope가 test, provided, system이면 건너뛰기
        const scope = dep.scope as DependencyScope;
        if (scope === 'test' || scope === 'provided' || scope === 'system') {
          continue;
        }

        // optional 의존성 처리
        if (dep.optional === 'true' || dep.optional === true) {
          if (!includeOptional) continue;
        }

        // 버전 해결
        let depVersion = this.resolveProperty(dep.version || '', pom.properties);
        if (!depVersion) {
          // dependencyManagement에서 버전 찾기
          const managedKey = `${dep.groupId}:${dep.artifactId}`;
          depVersion = this.dependencyManagement.get(managedKey) || '';
        }

        if (!depVersion) {
          // 버전이 없으면 최신 버전 조회 시도
          try {
            depVersion = await this.getLatestVersion(dep.groupId, dep.artifactId);
          } catch {
            continue;
          }
        }

        if (depVersion) {
          try {
            const childNode = await this.resolvePackage(
              dep.groupId,
              dep.artifactId,
              depVersion,
              depth + 1,
              maxDepth,
              includeOptional
            );
            childNode.scope = scope || 'compile';
            node.dependencies.push(childNode);
          } catch {
            logger.warn('Maven 의존성 패키지 조회 실패', {
              parent: `${groupId}:${artifactId}`,
              dependency: `${dep.groupId}:${dep.artifactId}`,
            });
          }
        }
      }

      return node;
    } catch (error) {
      logger.error('Maven POM 조회 실패', { groupId, artifactId, version, error });
      throw error;
    }
  }

  /**
   * POM 파일 조회
   */
  private async fetchPom(
    groupId: string,
    artifactId: string,
    version: string
  ): Promise<PomProject> {
    const groupPath = groupId.replace(/\./g, '/');
    const url = `${this.repoUrl}/${groupPath}/${artifactId}/${version}/${artifactId}-${version}.pom`;

    const response = await axios.get<string>(url);
    const parsed = this.parser.parse(response.data);

    return parsed.project as PomProject;
  }

  /**
   * dependencyManagement 처리
   */
  private processDependencyManagement(
    pom: PomProject,
    properties?: Record<string, string>
  ): void {
    const managed = this.normalizeDependencies(
      pom.dependencyManagement?.dependencies?.dependency
    );

    for (const dep of managed) {
      const version = this.resolveProperty(dep.version || '', properties);
      if (version) {
        const key = `${dep.groupId}:${dep.artifactId}`;
        if (!this.dependencyManagement.has(key)) {
          this.dependencyManagement.set(key, version);
        }
      }
    }
  }

  /**
   * Properties 치환 (${...} 형식)
   */
  private resolveProperty(value: string, properties?: Record<string, string>): string {
    if (!value || !properties) return value;

    return value.replace(/\$\{([^}]+)\}/g, (_, key) => {
      // project.version 등 특수 키 처리
      if (key === 'project.version' || key === 'pom.version') {
        return properties['version'] || value;
      }
      return properties[key] || value;
    });
  }

  /**
   * 의존성 배열 정규화
   */
  private normalizeDependencies(
    deps: PomDependency | PomDependency[] | undefined
  ): PomDependency[] {
    if (!deps) return [];
    return Array.isArray(deps) ? deps : [deps];
  }

  /**
   * 최신 버전 조회
   */
  private async getLatestVersion(
    groupId: string,
    artifactId: string
  ): Promise<string> {
    const groupPath = groupId.replace(/\./g, '/');
    const url = `${this.repoUrl}/${groupPath}/${artifactId}/maven-metadata.xml`;

    try {
      const response = await axios.get<string>(url);
      const parsed = this.parser.parse(response.data);
      return parsed.metadata?.versioning?.latest || parsed.metadata?.versioning?.release;
    } catch {
      throw new Error(`버전 조회 실패: ${groupId}:${artifactId}`);
    }
  }

  /**
   * 의존성 트리 평탄화
   */
  private flattenDependencies(node: DependencyNode): PackageInfo[] {
    const result: Map<string, PackageInfo> = new Map();

    const traverse = (n: DependencyNode) => {
      const key = `${n.package.name}@${n.package.version}`;
      if (!result.has(key)) {
        result.set(key, n.package);
        n.dependencies.forEach(traverse);
      }
    };

    traverse(node);
    return Array.from(result.values());
  }

  /**
   * pom.xml 텍스트 파싱
   */
  async parseFromText(content: string): Promise<PackageInfo[]> {
    try {
      const parsed = this.parser.parse(content);
      const pom = parsed.project as PomProject;
      const packages: PackageInfo[] = [];

      // 프로젝트 자체
      if (pom.groupId && pom.artifactId && pom.version) {
        packages.push({
          type: 'maven',
          name: `${pom.groupId}:${pom.artifactId}`,
          version: pom.version,
          metadata: {
            groupId: pom.groupId,
            artifactId: pom.artifactId,
          },
        });
      }

      // Dependencies
      const dependencies = this.normalizeDependencies(pom.dependencies?.dependency);

      for (const dep of dependencies) {
        const scope = dep.scope as DependencyScope;
        if (scope === 'test') continue;

        let version = this.resolveProperty(dep.version || '', pom.properties);
        if (!version) {
          // dependencyManagement에서 찾기
          this.processDependencyManagement(pom, pom.properties);
          version = this.dependencyManagement.get(`${dep.groupId}:${dep.artifactId}`) || 'latest';
        }

        packages.push({
          type: 'maven',
          name: `${dep.groupId}:${dep.artifactId}`,
          version,
          metadata: {
            groupId: dep.groupId,
            artifactId: dep.artifactId,
          },
        });
      }

      return packages;
    } catch (error) {
      logger.error('pom.xml 파싱 실패', { error });
      throw error;
    }
  }
}

// 싱글톤 인스턴스
let mavenResolverInstance: MavenResolver | null = null;

export function getMavenResolver(): MavenResolver {
  if (!mavenResolverInstance) {
    mavenResolverInstance = new MavenResolver();
  }
  return mavenResolverInstance;
}
